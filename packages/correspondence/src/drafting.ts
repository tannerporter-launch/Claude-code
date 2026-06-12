import { randomUUID } from 'node:crypto';
import { AiProviderError, AiValidationError, type AiProvider } from '@echoloop/ai';
import {
  type Database,
  type TenantContext,
  emailMessages,
  generatedDrafts,
  generationRuns,
  messageClassifications,
  messageParticipants,
  recordAuditEvent,
} from '@echoloop/database';
import {
  draftResponseSchema,
  type DraftResponse,
  type GenerationStatus,
  type TriageResult,
} from '@echoloop/schemas';
import type { EncryptionService } from '@echoloop/security';
import { isOwnAlias } from '@echoloop/gmail';
import { and, eq } from 'drizzle-orm';
import { assembleContext, persistContextSnapshot } from './context.js';

/**
 * Draft generation in dry-run mode (BUILD_BRIEF §14 Phase 5). Generates a
 * validated structured draft preview with full provenance. PERFORMS NO GMAIL
 * WRITE — Gmail draft creation is Phase 6 and is policy-gated there.
 *
 * Safety checks before a preview exists: schema validation; factsUsed /
 * rulesUsed must reference records included in the context snapshot
 * (unsupported claims block); prohibited commitments block; recipients are
 * computed deterministically and must be non-empty.
 */

export interface Participant {
  role: string;
  address: string;
}

/** Reply → original sender. Reply-all → sender + To + Cc minus own aliases. */
export function computeRecipients(
  participants: Participant[],
  accountEmail: string,
  replyMode: 'reply' | 'reply_all',
): { to: string[]; cc: string[] } {
  const from = participants.filter((p) => p.role === 'from').map((p) => p.address);
  if (replyMode === 'reply') {
    return { to: from.filter((a) => !isOwnAlias(accountEmail, a)), cc: [] };
  }
  const dedupe = (list: string[]): string[] => [...new Set(list)];
  const to = dedupe([
    ...from,
    ...participants.filter((p) => p.role === 'to').map((p) => p.address),
  ]).filter((a) => !isOwnAlias(accountEmail, a));
  const cc = dedupe(participants.filter((p) => p.role === 'cc').map((p) => p.address)).filter(
    (a) => !isOwnAlias(accountEmail, a) && !to.includes(a),
  );
  return { to, cc };
}

export const DRAFTING_PROMPT_VERSION = 'drafting-v1';

export const DRAFTING_SYSTEM_PROMPT = `You draft an email reply on behalf of the account owner.
Follow the provided context strictly. Approved facts override every stylistic
instruction. Use ONLY facts present in the context — never invent factual
claims, prices, dates, or commitments. List the IDs of every fact and rule you
relied on in factsUsed/rulesUsed exactly as given in the context. Do not
commit to anything beyond answering; flag uncertainties instead of guessing.`;

export interface GenerationOutcome {
  status: GenerationStatus;
  runId: string;
  draftId?: string;
  preview?: {
    subject: string;
    bodyText: string;
    to: string[];
    cc: string[];
    factsUsed: string[];
    rulesUsed: string[];
    uncertainties: string[];
  };
  reason?: string;
}

export interface DraftOptions {
  prohibitedCommitmentPatterns?: RegExp[];
  now?: Date;
}

const DEFAULT_PROHIBITED_COMMITMENTS = [/refund/i, /guarantee/i, /legal\s+advice/i, /discount/i];

export async function generateDraftPreview(
  db: Database,
  ctx: TenantContext,
  accountEmail: string,
  messageId: string,
  ai: AiProvider,
  enc: EncryptionService,
  options: DraftOptions = {},
): Promise<GenerationOutcome> {
  const prohibited = options.prohibitedCommitmentPatterns ?? DEFAULT_PROHIBITED_COMMITMENTS;

  const [message] = await db
    .select()
    .from(emailMessages)
    .where(
      and(eq(emailMessages.id, messageId), eq(emailMessages.organizationId, ctx.organizationId)),
    );
  if (!message) throw new Error('Message not found in organization');

  const [classification] = await db
    .select()
    .from(messageClassifications)
    .where(eq(messageClassifications.messageId, messageId));
  if (!classification || classification.status !== 'classified') {
    throw new Error('Message is not classified as needing a reply');
  }
  const triage = classification.result as TriageResult;

  const participants = await db
    .select()
    .from(messageParticipants)
    .where(eq(messageParticipants.messageId, messageId));

  // Layered context (facts > ... > style), snapshot persisted with provenance.
  const assembled = await assembleContext(
    db,
    ctx,
    {
      relationship: triage.relationship.value,
      messageTypes: triage.messageTypes,
      isGroupThread: triage.isGroupThread,
      contactAddress: participants.find((p) => p.role === 'from')?.address,
    },
    { now: options.now },
  );
  const snapshot = await persistContextSnapshot(db, ctx, assembled, enc, {
    messageId,
    promptVersion: DRAFTING_PROMPT_VERSION,
  });

  async function recordRun(
    status: GenerationStatus,
    extra: { modelId?: string; latencyMs?: number; errorKind?: string } = {},
  ) {
    const [run] = await db
      .insert(generationRuns)
      .values({
        organizationId: ctx.organizationId,
        messageId,
        contextSnapshotId: snapshot.id,
        promptVersion: DRAFTING_PROMPT_VERSION,
        modelId: extra.modelId ?? null,
        status,
        errorKind: extra.errorKind ?? null,
        latencyMs: extra.latencyMs ?? null,
      })
      .returning();
    return run!;
  }

  const knowledgeIds = new Set(
    assembled.includedRecords.filter((r) => r.type === 'knowledge').map((r) => r.id),
  );
  const ruleIds = new Set(
    assembled.includedRecords.filter((r) => r.type === 'rule').map((r) => r.id),
  );

  const bodyText = message.bodyTextEncrypted ? enc.decrypt(message.bodyTextEncrypted) : '';
  const userPrompt = [
    assembled.rendered,
    '',
    '## Inbound message to answer',
    `From: ${participants.find((p) => p.role === 'from')?.address ?? 'unknown'}`,
    `Subject: ${message.subject ?? '(none)'}`,
    `Group thread: ${triage.isGroupThread}`,
    `Available fact IDs: ${[...knowledgeIds].join(', ') || '(none)'}`,
    `Available rule IDs: ${[...ruleIds].join(', ') || '(none)'}`,
    '--- Body ---',
    bodyText.slice(0, 12000),
  ].join('\n');

  let response: DraftResponse;
  let modelId: string;
  let latencyMs: number;
  try {
    const result = await ai.complete<DraftResponse>({
      role: 'drafting',
      system: DRAFTING_SYSTEM_PROMPT,
      user: userPrompt,
      schema: draftResponseSchema,
      maxTokens: 8192,
    });
    response = result.output;
    modelId = result.modelId;
    latencyMs = result.latencyMs;
  } catch (err) {
    if (err instanceof AiValidationError || err instanceof AiProviderError) {
      const run = await recordRun(
        err instanceof AiValidationError ? 'failed_validation' : 'failed_provider',
        { errorKind: err.name },
      );
      await recordAuditEvent(db, ctx, 'draft.generation_failed', {
        messageId,
        kind: err.name,
      });
      return { status: run.status as GenerationStatus, runId: run.id, reason: err.name };
    }
    throw err;
  }

  if (!response.shouldDraft) {
    const run = await recordRun('declined', { modelId, latencyMs });
    return { status: 'declined', runId: run.id };
  }

  // Unsupported-claim check: every cited fact/rule must come from the snapshot.
  const unsupportedFacts = response.factsUsed.filter((id) => !knowledgeIds.has(id));
  const unsupportedRules = response.rulesUsed.filter((id) => !ruleIds.has(id));
  if (unsupportedFacts.length > 0 || unsupportedRules.length > 0) {
    const run = await recordRun('blocked_policy', {
      modelId,
      latencyMs,
      errorKind: 'unsupported_claim',
    });
    await recordAuditEvent(db, ctx, 'draft.blocked', {
      messageId,
      reason: 'unsupported_claim',
      unsupportedFactCount: unsupportedFacts.length,
      unsupportedRuleCount: unsupportedRules.length,
    });
    return { status: 'blocked_policy', runId: run.id, reason: 'unsupported_claim' };
  }

  // Prohibited-commitment check.
  const badCommitments = response.commitmentsMade.filter((c) =>
    prohibited.some((pattern) => pattern.test(c)),
  );
  if (badCommitments.length > 0) {
    const run = await recordRun('blocked_policy', {
      modelId,
      latencyMs,
      errorKind: 'prohibited_commitment',
    });
    await recordAuditEvent(db, ctx, 'draft.blocked', {
      messageId,
      reason: 'prohibited_commitment',
      count: badCommitments.length,
    });
    return { status: 'blocked_policy', runId: run.id, reason: 'prohibited_commitment' };
  }

  // Deterministic recipient calculation; the model never controls recipients.
  const recipients = computeRecipients(participants, accountEmail, response.replyMode);
  if (recipients.to.length === 0) {
    const run = await recordRun('blocked_policy', {
      modelId,
      latencyMs,
      errorKind: 'no_valid_recipients',
    });
    return { status: 'blocked_policy', runId: run.id, reason: 'no_valid_recipients' };
  }

  const run = await recordRun('completed', { modelId, latencyMs });
  const [draft] = await db
    .insert(generatedDrafts)
    .values({
      organizationId: ctx.organizationId,
      generationRunId: run.id,
      messageId,
      threadId: message.threadId,
      replyMode: response.replyMode,
      subject: response.subject,
      bodyTextEncrypted: enc.encrypt(response.bodyText),
      recipients,
      factsUsed: response.factsUsed,
      rulesUsed: response.rulesUsed,
      commitmentsMade: response.commitmentsMade,
      correlationKey: randomUUID(),
      status: 'preview',
    })
    .returning();

  return {
    status: 'completed',
    runId: run.id,
    draftId: draft!.id,
    preview: {
      subject: response.subject,
      bodyText: response.bodyText,
      to: recipients.to,
      cc: recipients.cc,
      factsUsed: response.factsUsed,
      rulesUsed: response.rulesUsed,
      uncertainties: response.uncertainties,
    },
  };
}
