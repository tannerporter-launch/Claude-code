import {
  type Database,
  type TenantContext,
  draftSentPairs,
  emailMessages,
  generatedDrafts,
  messageParticipants,
  pairingCandidates,
  recordAuditEvent,
} from '@echoloop/database';
import { normalizeSubject, type GmailProvider } from '@echoloop/gmail';
import { and, eq, isNull } from 'drizzle-orm';

/**
 * Sent-message capture and draft↔sent pairing (BUILD_BRIEF §10.5). Evidence
 * is combined across the correlation header, thread, RFC reply headers,
 * normalized subject, recipient overlap, and time proximity — NEVER thread ID
 * alone (a thread-only match scores below the auto-pair threshold). Ambiguous
 * cases stay unpaired and go to the manual queue. DB unique constraints make
 * double-pairing impossible in either direction.
 */

export interface PairingEvidence {
  correlationMatch: boolean;
  threadMatch: boolean;
  inReplyToMatch: boolean;
  subjectMatch: boolean;
  recipientOverlap: number;
  hoursApart: number | null;
}

/** Score in milli-units (0–1000). */
export function scoreEvidence(evidence: PairingEvidence): number {
  let score = 0;
  if (evidence.correlationMatch) score += 500;
  if (evidence.threadMatch) score += 200;
  if (evidence.inReplyToMatch) score += 150;
  if (evidence.subjectMatch) score += 100;
  score += Math.round(150 * Math.min(1, Math.max(0, evidence.recipientOverlap)));
  if (evidence.hoursApart !== null && evidence.hoursApart <= 168) {
    score += evidence.hoursApart <= 24 ? 100 : 50;
  }
  return Math.min(1000, score);
}

/**
 * Auto-pair only at/above this confidence — and only with a unique winner.
 * 550 = full thread+subject+recipients+time consistency at minimum; a
 * thread-only match (200) can never reach it.
 */
export const AUTO_PAIR_THRESHOLD = 550;

export interface PairingRunSummary {
  sentProcessed: number;
  autoPaired: number;
  ambiguous: number;
  unmatched: number;
}

export async function runPairing(
  db: Database,
  ctx: TenantContext,
  accountId: string,
): Promise<PairingRunSummary> {
  const summary: PairingRunSummary = {
    sentProcessed: 0,
    autoPaired: 0,
    ambiguous: 0,
    unmatched: 0,
  };

  // Unpaired outbound (sent) messages.
  const sentRows = await db
    .select()
    .from(emailMessages)
    .leftJoin(draftSentPairs, eq(draftSentPairs.sentMessageId, emailMessages.id))
    .where(
      and(
        eq(emailMessages.organizationId, ctx.organizationId),
        eq(emailMessages.emailAccountId, accountId),
        eq(emailMessages.direction, 'outbound'),
        isNull(draftSentPairs.id),
      ),
    );

  // Unpaired drafts that exist in Gmail.
  const draftRows = await db
    .select()
    .from(generatedDrafts)
    .leftJoin(draftSentPairs, eq(draftSentPairs.generatedDraftId, generatedDrafts.id))
    .where(
      and(
        eq(generatedDrafts.organizationId, ctx.organizationId),
        eq(generatedDrafts.status, 'drafted'),
        isNull(draftSentPairs.id),
      ),
    );

  for (const sentRow of sentRows) {
    const sent = sentRow.email_messages;
    summary.sentProcessed += 1;

    const sentParticipants = await db
      .select()
      .from(messageParticipants)
      .where(eq(messageParticipants.messageId, sent.id));
    const sentRecipients = new Set(
      sentParticipants.filter((p) => p.role !== 'from').map((p) => p.address),
    );

    const scored: { draftId: string; score: number; evidence: PairingEvidence }[] = [];
    for (const draftRow of draftRows) {
      const draft = draftRow.generated_drafts;
      // Original inbound message this draft replies to (for In-Reply-To match).
      const [original] = await db
        .select()
        .from(emailMessages)
        .where(eq(emailMessages.id, draft.messageId));

      const draftRecipients = draft.recipients as { to: string[]; cc: string[] };
      const allDraftRecipients = [...draftRecipients.to, ...draftRecipients.cc];
      const overlap =
        allDraftRecipients.length === 0
          ? 0
          : allDraftRecipients.filter((a) => sentRecipients.has(a)).length /
            allDraftRecipients.length;

      const evidence: PairingEvidence = {
        correlationMatch:
          Boolean(sent.correlationKeyHeader) && sent.correlationKeyHeader === draft.correlationKey,
        threadMatch: sent.threadId === draft.threadId,
        inReplyToMatch:
          Boolean(sent.inReplyToHeader) &&
          sent.inReplyToHeader === (original?.messageIdHeader ?? undefined),
        subjectMatch:
          normalizeSubject(sent.subject) !== '' &&
          normalizeSubject(sent.subject) === normalizeSubject(draft.subject),
        recipientOverlap: overlap,
        hoursApart:
          draft.createdAt && sent.internalDate
            ? Math.abs(sent.internalDate.getTime() - draft.createdAt.getTime()) / 3600_000
            : null,
      };
      const score = scoreEvidence(evidence);
      if (score > 0) scored.push({ draftId: draft.id, score, evidence });
    }

    scored.sort((a, b) => b.score - a.score);
    const top = scored[0];
    const aboveThreshold = scored.filter((s) => s.score >= AUTO_PAIR_THRESHOLD);

    if (top && aboveThreshold.length === 1) {
      await db.insert(draftSentPairs).values({
        organizationId: ctx.organizationId,
        sentMessageId: sent.id,
        generatedDraftId: top.draftId,
        confidence: top.score,
        evidence: top.evidence,
        method: 'auto',
      });
      await db
        .update(generatedDrafts)
        .set({ status: 'sent', sentMessageId: sent.id })
        .where(eq(generatedDrafts.id, top.draftId));
      await recordAuditEvent(db, ctx, 'pairing.auto', {
        sentMessageId: sent.id,
        generatedDraftId: top.draftId,
        confidence: top.score,
      });
      summary.autoPaired += 1;
      // Remove the consumed draft from this run's candidate pool.
      const idx = draftRows.findIndex((r) => r.generated_drafts.id === top.draftId);
      if (idx >= 0) draftRows.splice(idx, 1);
    } else if (aboveThreshold.length > 1) {
      // Ambiguous: record candidates for the manual queue; stays UNPAIRED.
      for (const candidate of aboveThreshold) {
        await db.insert(pairingCandidates).values({
          organizationId: ctx.organizationId,
          sentMessageId: sent.id,
          generatedDraftId: candidate.draftId,
          score: candidate.score,
          evidence: candidate.evidence,
        });
      }
      await recordAuditEvent(db, ctx, 'pairing.ambiguous', {
        sentMessageId: sent.id,
        candidateCount: aboveThreshold.length,
      });
      summary.ambiguous += 1;
    } else {
      summary.unmatched += 1;
    }
  }

  return summary;
}

/** Manual resolution from the review queue. */
export async function manuallyPair(
  db: Database,
  ctx: TenantContext,
  sentMessageId: string,
  generatedDraftId: string,
) {
  const [pair] = await db
    .insert(draftSentPairs)
    .values({
      organizationId: ctx.organizationId,
      sentMessageId,
      generatedDraftId,
      confidence: 1000,
      evidence: { manual: true },
      method: 'manual',
    })
    .returning();
  await db
    .update(generatedDrafts)
    .set({ status: 'sent', sentMessageId })
    .where(eq(generatedDrafts.id, generatedDraftId));
  await db
    .update(pairingCandidates)
    .set({ status: 'resolved' })
    .where(eq(pairingCandidates.sentMessageId, sentMessageId));
  await recordAuditEvent(db, ctx, 'pairing.manual', { sentMessageId, generatedDraftId });
  return pair!;
}

export async function listAmbiguousPairings(db: Database, ctx: TenantContext) {
  return db
    .select()
    .from(pairingCandidates)
    .where(
      and(
        eq(pairingCandidates.organizationId, ctx.organizationId),
        eq(pairingCandidates.status, 'pending'),
      ),
    );
}

/**
 * Draft-discard detection: a drafted Gmail draft that no longer exists in the
 * mailbox and was never paired was deleted by the user.
 */
export async function detectDiscardedDrafts(
  db: Database,
  ctx: TenantContext,
  provider: GmailProvider,
): Promise<number> {
  const existing = new Set((await provider.listDrafts()).map((d) => d.id));
  const drafted = await db
    .select()
    .from(generatedDrafts)
    .where(
      and(
        eq(generatedDrafts.organizationId, ctx.organizationId),
        eq(generatedDrafts.status, 'drafted'),
      ),
    );
  let discarded = 0;
  for (const draft of drafted) {
    if (draft.providerDraftId && !existing.has(draft.providerDraftId)) {
      await db
        .update(generatedDrafts)
        .set({ status: 'discarded' })
        .where(eq(generatedDrafts.id, draft.id));
      await recordAuditEvent(db, ctx, 'draft.discarded', { generatedDraftId: draft.id });
      discarded += 1;
    }
  }
  return discarded;
}
