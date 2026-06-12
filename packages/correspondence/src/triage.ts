import { AiProviderError, AiValidationError, type AiProvider } from '@echoloop/ai';
import {
  type Database,
  type TenantContext,
  contactRelationships,
  contacts,
  emailMessages,
  messageClassifications,
  messageParticipants,
  recordAuditEvent,
} from '@echoloop/database';
import {
  TRIAGE_CONFIDENCE_THRESHOLD,
  type ExclusionReason,
  type TriageResult,
  triageResultSchema,
} from '@echoloop/schemas';
import type { EncryptionService } from '@echoloop/security';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * Inbound triage (BUILD_BRIEF §10.1): deterministic exclusions first, then AI
 * classification of survivors. Invalid or failed AI output fails safe — the
 * message is recorded as `failed` and nothing downstream happens. Low
 * confidence routes to `manual_review`. No drafting occurs here.
 */

const NO_REPLY_PATTERN =
  /^(no-?reply|do-?not-?reply|notifications?|mailer-daemon|postmaster|bounce)/i;

export interface PrefilterInput {
  labels: string[];
  direction: string;
  fromAddress: string | null;
  isBulk: boolean;
  isCalendar: boolean;
}

/** Deterministic exclusions. Returns the reason or null when eligible. */
export function deterministicExclusion(input: PrefilterInput): ExclusionReason | null {
  if (input.labels.includes('SPAM') || input.labels.includes('TRASH')) return 'spam_or_trash';
  if (input.direction !== 'inbound') return 'self_sent';
  const local = (input.fromAddress ?? '').split('@')[0] ?? '';
  if (NO_REPLY_PATTERN.test(local)) return 'no_reply_sender';
  if (input.isBulk) return 'bulk_or_list';
  if (input.isCalendar) return 'calendar_or_system';
  return null;
}

export const TRIAGE_SYSTEM_PROMPT = `You triage inbound business email for a correspondence assistant.
Given one inbound email, decide whether a human reply is likely needed and
classify the message. Use the provided sender-relationship hint when present.
Classify conservatively: when unsure, lower your confidence rather than guess.`;

export interface ClassificationInput {
  subject: string | null;
  bodyText: string;
  fromAddress: string | null;
  toAddresses: string[];
  ccAddresses: string[];
  accountEmail: string;
  confirmedRelationship?: string;
}

export function renderClassificationPrompt(input: ClassificationInput): string {
  const participants = [...input.toAddresses, ...input.ccAddresses];
  return [
    `Account owner: ${input.accountEmail}`,
    `From: ${input.fromAddress ?? 'unknown'}`,
    `To/Cc count (excluding owner): ${participants.filter((a) => a !== input.accountEmail).length}`,
    input.confirmedRelationship
      ? `Confirmed sender relationship: ${input.confirmedRelationship}`
      : 'Sender relationship: not confirmed — infer it.',
    `Subject: ${input.subject ?? '(none)'}`,
    '--- Message body ---',
    input.bodyText.slice(0, 8000),
  ].join('\n');
}

export interface TriageRunSummary {
  processed: number;
  excluded: number;
  classified: number;
  manualReview: number;
  failed: number;
}

async function confirmedRelationshipFor(
  db: Database,
  ctx: TenantContext,
  address: string | null,
): Promise<string | undefined> {
  if (!address) return undefined;
  const rows = await db
    .select({ relationship: contactRelationships.relationship })
    .from(contacts)
    .innerJoin(contactRelationships, eq(contactRelationships.contactId, contacts.id))
    .where(
      and(
        eq(contacts.organizationId, ctx.organizationId),
        eq(contacts.address, address),
        eq(contactRelationships.source, 'confirmed'),
      ),
    );
  return rows[0]?.relationship;
}

/** Classify every inbound message that has no classification yet. */
export async function runTriage(
  db: Database,
  ctx: TenantContext,
  accountId: string,
  accountEmail: string,
  ai: AiProvider,
  enc: EncryptionService,
): Promise<TriageRunSummary> {
  const summary: TriageRunSummary = {
    processed: 0,
    excluded: 0,
    classified: 0,
    manualReview: 0,
    failed: 0,
  };

  const pending = await db
    .select()
    .from(emailMessages)
    .leftJoin(messageClassifications, eq(messageClassifications.messageId, emailMessages.id))
    .where(
      and(
        eq(emailMessages.organizationId, ctx.organizationId),
        eq(emailMessages.emailAccountId, accountId),
        isNull(messageClassifications.id),
      ),
    );

  for (const row of pending) {
    const message = row.email_messages;
    summary.processed += 1;

    const fromRows = await db
      .select()
      .from(messageParticipants)
      .where(eq(messageParticipants.messageId, message.id));
    const fromAddress = fromRows.find((p) => p.role === 'from')?.address ?? null;
    const toAddresses = fromRows.filter((p) => p.role === 'to').map((p) => p.address);
    const ccAddresses = fromRows.filter((p) => p.role === 'cc').map((p) => p.address);

    const exclusion = deterministicExclusion({
      labels: (message.labels as string[]) ?? [],
      direction: message.direction,
      fromAddress,
      isBulk: message.isBulk,
      isCalendar: message.isCalendar,
    });

    if (exclusion) {
      await db.insert(messageClassifications).values({
        organizationId: ctx.organizationId,
        messageId: message.id,
        status: 'excluded',
        exclusionReason: exclusion,
      });
      summary.excluded += 1;
      continue;
    }

    const confirmed = await confirmedRelationshipFor(db, ctx, fromAddress);
    try {
      const result = await ai.complete<TriageResult>({
        role: 'classification',
        system: TRIAGE_SYSTEM_PROMPT,
        user: renderClassificationPrompt({
          subject: message.subject,
          bodyText: message.bodyTextEncrypted ? enc.decrypt(message.bodyTextEncrypted) : '',
          fromAddress,
          toAddresses,
          ccAddresses,
          accountEmail,
          confirmedRelationship: confirmed,
        }),
        schema: triageResultSchema,
        maxTokens: 2048,
      });

      // A human-confirmed relationship always outranks the model's inference.
      const finalResult: TriageResult = confirmed
        ? {
            ...result.output,
            relationship: {
              value: confirmed as TriageResult['relationship']['value'],
              source: 'confirmed',
            },
          }
        : result.output;

      const status =
        finalResult.confidence >= TRIAGE_CONFIDENCE_THRESHOLD ? 'classified' : 'manual_review';
      await db.insert(messageClassifications).values({
        organizationId: ctx.organizationId,
        messageId: message.id,
        status,
        result: finalResult,
        modelId: result.modelId,
        promptVersion: result.promptVersion,
        latencyMs: result.latencyMs,
      });
      if (status === 'classified') summary.classified += 1;
      else summary.manualReview += 1;
    } catch (err) {
      if (err instanceof AiValidationError || err instanceof AiProviderError) {
        await db.insert(messageClassifications).values({
          organizationId: ctx.organizationId,
          messageId: message.id,
          status: 'failed',
        });
        await recordAuditEvent(db, ctx, 'triage.failed', {
          messageId: message.id,
          kind: err.name,
        });
        summary.failed += 1;
        continue;
      }
      throw err;
    }
  }

  return summary;
}
