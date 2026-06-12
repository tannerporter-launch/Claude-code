import { AiProviderError, AiValidationError, type AiProvider } from '@echoloop/ai';
import {
  type Database,
  type TenantContext,
  comparisons,
  draftSentPairs,
  emailMessages,
  generatedDrafts,
  messageClassifications,
  recordAuditEvent,
} from '@echoloop/database';
import {
  semanticComparisonSchema,
  type SemanticComparison,
  type TriageResult,
} from '@echoloop/schemas';
import type { EncryptionService } from '@echoloop/security';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * Mechanical + semantic comparison of paired draft↔sent messages
 * (BUILD_BRIEF §10.6). Comparisons run only on reliable pairs — ambiguous
 * pairings never reach here by construction (Phase 7).
 */

export interface MechanicalDiff {
  insertions: number;
  deletions: number;
  draftWordCount: number;
  sentWordCount: number;
  lengthDeltaWords: number;
  greetingChanged: boolean;
  signoffChanged: boolean;
  subjectChanged: boolean;
  recipientsChanged: boolean;
  identical: boolean;
}

const tokenize = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/** Word-level LCS length (O(n·m), fine at email scale). */
function lcsLength(a: string[], b: string[]): number {
  const dp = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j]!, dp[j - 1]!);
      prev = tmp;
    }
  }
  return dp[b.length]!;
}

function firstLine(text: string): string {
  return (
    text
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0) ?? ''
  );
}
function lastLine(text: string): string {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines[lines.length - 1] ?? '';
}

export function mechanicalDiff(
  draft: { body: string; subject: string; recipients: string[] },
  sent: { body: string; subject: string | null; recipients: string[] },
): MechanicalDiff & { normalizedEditDistanceMilli: number } {
  const a = tokenize(draft.body);
  const b = tokenize(sent.body);
  const lcs = lcsLength(a, b);
  const deletions = a.length - lcs;
  const insertions = b.length - lcs;
  const maxLen = Math.max(a.length, b.length, 1);
  const sortedEq = (x: string[], y: string[]) =>
    JSON.stringify([...x].sort()) === JSON.stringify([...y].sort());
  return {
    insertions,
    deletions,
    draftWordCount: a.length,
    sentWordCount: b.length,
    lengthDeltaWords: b.length - a.length,
    greetingChanged: firstLine(draft.body) !== firstLine(sent.body),
    signoffChanged: lastLine(draft.body) !== lastLine(sent.body),
    subjectChanged: (sent.subject ?? '') !== draft.subject,
    recipientsChanged: !sortedEq(draft.recipients, sent.recipients),
    identical: insertions === 0 && deletions === 0,
    normalizedEditDistanceMilli: Math.round(((insertions + deletions) / maxLen) * 1000),
  };
}

export const COMPARISON_SYSTEM_PROMPT = `You compare an AI-generated email draft with the version the human actually sent.
Classify every meaningful difference into the allowed categories. Distinguish
carefully between reusable stylistic preferences (tone, brevity, greeting...)
and one-off changes. A factual correction (price, date, name, claim) is NEVER a
style preference — use the factual categories and describe the correction in
factualCorrectionDetail. Commitment/deadline/action changes get their own
categories. If the change only makes sense for this specific situation, set
isOneTimeSituational true.`;

export interface ComparisonRunSummary {
  compared: number;
  failed: number;
}

/** Compare every reliable pair that has no comparison yet. */
export async function runComparisons(
  db: Database,
  ctx: TenantContext,
  ai: AiProvider,
  enc: EncryptionService,
): Promise<ComparisonRunSummary> {
  const summary: ComparisonRunSummary = { compared: 0, failed: 0 };

  const pending = await db
    .select()
    .from(draftSentPairs)
    .leftJoin(comparisons, eq(comparisons.pairId, draftSentPairs.id))
    .where(and(eq(draftSentPairs.organizationId, ctx.organizationId), isNull(comparisons.id)));

  for (const row of pending) {
    const pair = row.draft_sent_pairs;
    const [draft] = await db
      .select()
      .from(generatedDrafts)
      .where(eq(generatedDrafts.id, pair.generatedDraftId));
    const [sent] = await db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.id, pair.sentMessageId));
    if (!draft || !sent) continue;

    // Context bucket from the original inbound classification (relationship x type).
    const [classification] = await db
      .select()
      .from(messageClassifications)
      .where(eq(messageClassifications.messageId, draft.messageId));
    const triage = (classification?.result ?? null) as TriageResult | null;
    const bucket = triage
      ? `${triage.relationship.value}/${triage.messageTypes[0]}`
      : 'unknown/unknown';

    const draftBody = enc.decrypt(draft.bodyTextEncrypted);
    const sentBody = sent.bodyTextEncrypted ? enc.decrypt(sent.bodyTextEncrypted) : '';
    const draftRecipients = draft.recipients as { to: string[]; cc: string[] };

    const mech = mechanicalDiff(
      {
        body: draftBody,
        subject: draft.subject,
        recipients: [...draftRecipients.to, ...draftRecipients.cc],
      },
      { body: sentBody, subject: sent.subject, recipients: [] },
    );

    let semantic: SemanticComparison;
    try {
      const result = await ai.complete<SemanticComparison>({
        role: 'comparison',
        system: COMPARISON_SYSTEM_PROMPT,
        user: [
          `Context bucket: ${bucket}`,
          '--- AI draft ---',
          draftBody.slice(0, 8000),
          '--- Actually sent ---',
          sentBody.slice(0, 8000),
        ].join('\n'),
        schema: semanticComparisonSchema,
        maxTokens: 2048,
      });
      semantic = result.output;
    } catch (err) {
      if (err instanceof AiValidationError || err instanceof AiProviderError) {
        await recordAuditEvent(db, ctx, 'comparison.failed', { pairId: pair.id, kind: err.name });
        summary.failed += 1;
        continue;
      }
      throw err;
    }

    await db.insert(comparisons).values({
      organizationId: ctx.organizationId,
      pairId: pair.id,
      mechanical: mech,
      semantic,
      normalizedEditDistanceMilli: mech.normalizedEditDistanceMilli,
      contextBucket: bucket,
    });
    summary.compared += 1;
  }

  return summary;
}
