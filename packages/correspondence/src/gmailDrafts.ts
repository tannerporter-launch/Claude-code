import {
  type Database,
  type TenantContext,
  emailMessages,
  emailThreads,
  generatedDrafts,
  messageParticipants,
  recordAuditEvent,
} from '@echoloop/database';
import { buildReplyMime, mimeToBase64Url, type GmailProvider } from '@echoloop/gmail';
import { parseEnv } from '@echoloop/schemas';
import type { EncryptionService } from '@echoloop/security';
import { and, eq } from 'drizzle-orm';
import { decideActivation, type ActivationDecision } from './activation.js';

/**
 * Phase 6: turn a validated dry-run preview (generated_drafts.status =
 * 'preview') into a REAL threaded Gmail draft — only when the activation
 * policy allows it. Creating a draft is the only Gmail write; sending never
 * exists. Every live Gmail write emits an audit event.
 */

export type CreateDraftOutcome =
  | { status: 'created'; providerDraftId: string }
  | { status: 'blocked'; reason: Extract<ActivationDecision, { allowed: false }>['reason'] };

export async function createGmailDraftFromPreview(
  db: Database,
  ctx: TenantContext,
  account: { id: string; providerEmail: string; draftingPaused: boolean },
  generatedDraftId: string,
  provider: GmailProvider,
  enc: EncryptionService,
  options: { draftsThisCycle?: number; env?: ReturnType<typeof parseEnv> } = {},
): Promise<CreateDraftOutcome> {
  const [draft] = await db
    .select()
    .from(generatedDrafts)
    .where(
      and(
        eq(generatedDrafts.id, generatedDraftId),
        eq(generatedDrafts.organizationId, ctx.organizationId),
      ),
    );
  if (!draft) throw new Error('Generated draft not found in organization');
  if (draft.status !== 'preview')
    throw new Error(`Draft is not in preview state (${draft.status})`);

  const [original] = await db
    .select()
    .from(emailMessages)
    .where(eq(emailMessages.id, draft.messageId));
  if (!original) throw new Error('Original message not found');
  const [thread] = await db
    .select()
    .from(emailThreads)
    .where(eq(emailThreads.id, original.threadId));
  const providerThreadId = thread?.providerThreadId ?? '';

  const participants = await db
    .select()
    .from(messageParticipants)
    .where(eq(messageParticipants.messageId, draft.messageId));
  const senderAddress = participants.find((p) => p.role === 'from')?.address ?? null;

  const decision = await decideActivation(
    db,
    ctx,
    {
      accountId: account.id,
      accountDraftingPaused: account.draftingPaused,
      senderAddress,
      gmailLabels: (original.labels as string[]) ?? [],
      providerThreadId,
      providerMessageId: original.providerMessageId,
      draftsThisCycle: options.draftsThisCycle ?? 0,
    },
    options.env,
  );
  if (!decision.allowed) {
    await recordAuditEvent(db, ctx, 'gmail.draft_blocked', {
      generatedDraftId,
      reason: decision.reason,
    });
    return { status: 'blocked', reason: decision.reason };
  }

  const recipients = draft.recipients as { to: string[]; cc: string[] };
  const mime = buildReplyMime({
    from: account.providerEmail,
    to: recipients.to,
    cc: recipients.cc,
    subject: draft.subject,
    bodyText: enc.decrypt(draft.bodyTextEncrypted),
    inReplyTo: original.messageIdHeader,
    references: original.referencesHeader,
    correlationKey: draft.correlationKey,
  });

  const created = await provider.createDraft({
    threadId: providerThreadId,
    rawMimeBase64Url: mimeToBase64Url(mime),
  });

  await db
    .update(generatedDrafts)
    .set({
      status: 'drafted',
      providerDraftId: created.id,
      providerDraftMessageId: created.message.id,
    })
    .where(eq(generatedDrafts.id, generatedDraftId));

  // Structured audit event for every live Gmail write (BUILD_BRIEF §7.1).
  await recordAuditEvent(db, ctx, 'gmail.draft_created', {
    generatedDraftId,
    providerDraftId: created.id,
    threadId: providerThreadId,
  });

  return { status: 'created', providerDraftId: created.id };
}
