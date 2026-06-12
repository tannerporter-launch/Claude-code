import {
  type Database,
  type TenantContext,
  emailMessages,
  emailThreads,
  mailboxEvents,
  messageParticipants,
  recordAuditEvent,
} from '@echoloop/database';
import {
  GmailAuthError,
  type GmailHistoryEvent,
  type GmailProvider,
  HistoryCursorInvalidError,
  isOwnAlias,
  normalizeSubject,
  parseGmailMessage,
} from '@echoloop/gmail';
import type { EncryptionService } from '@echoloop/security';
import { and, eq } from 'drizzle-orm';
import { getAccount, getCheckpoint, markReconnectRequired } from './accounts.js';
import { mailboxCheckpoints } from '@echoloop/database';

/**
 * Incremental mailbox synchronization (BUILD_BRIEF §8.2). Read-only: no draft
 * creation, no model calls, no historical auto-drafting. Duplicate history
 * events are idempotent (DB unique constraint); the cursor advances only after
 * a fully successful pass; an invalid cursor triggers a controlled re-baseline.
 */

export type SyncOutcome =
  | { status: 'synced'; newMessages: number; cursor: string }
  | { status: 'recovered'; cursor: string }
  | { status: 'reconnect_required' }
  | { status: 'skipped'; reason: string };

async function upsertThread(
  db: Database,
  ctx: TenantContext,
  accountId: string,
  providerThreadId: string,
  subject: string | null,
  lastMessageAt: Date,
): Promise<string> {
  await db
    .insert(emailThreads)
    .values({
      organizationId: ctx.organizationId,
      emailAccountId: accountId,
      providerThreadId,
      normalizedSubject: normalizeSubject(subject),
      lastMessageAt,
    })
    .onConflictDoNothing();
  const rows = await db
    .select()
    .from(emailThreads)
    .where(
      and(
        eq(emailThreads.emailAccountId, accountId),
        eq(emailThreads.providerThreadId, providerThreadId),
      ),
    );
  return rows[0]!.id;
}

/** Persist one Gmail message idempotently. Returns true if newly inserted. */
async function persistMessage(
  db: Database,
  ctx: TenantContext,
  accountId: string,
  accountEmail: string,
  provider: GmailProvider,
  messageId: string,
  enc: EncryptionService,
): Promise<boolean> {
  const raw = await provider.getMessage(messageId);
  const parsed = parseGmailMessage(raw);
  const threadId = await upsertThread(
    db,
    ctx,
    accountId,
    parsed.providerThreadId,
    parsed.subject,
    parsed.internalDate,
  );
  const direction =
    parsed.from && isOwnAlias(accountEmail, parsed.from.address) ? 'outbound' : 'inbound';

  const inserted = await db
    .insert(emailMessages)
    .values({
      organizationId: ctx.organizationId,
      emailAccountId: accountId,
      threadId,
      providerMessageId: parsed.providerMessageId,
      direction,
      subject: parsed.subject,
      snippet: parsed.snippet,
      bodyTextEncrypted: enc.encrypt(parsed.bodyText),
      messageIdHeader: parsed.messageIdHeader,
      inReplyToHeader: parsed.inReplyToHeader,
      referencesHeader: parsed.referencesHeader,
      labels: parsed.labelIds,
      isBulk: parsed.isBulk,
      isCalendar: parsed.isCalendar,
      correlationKeyHeader: parsed.correlationKey,
      contentHash: parsed.contentHash,
      internalDate: parsed.internalDate,
    })
    .onConflictDoNothing()
    .returning();

  if (!inserted[0]) return false;

  const participants = [
    ...(parsed.from ? [{ role: 'from', ...parsed.from }] : []),
    ...parsed.to.map((p) => ({ role: 'to', ...p })),
    ...parsed.cc.map((p) => ({ role: 'cc', ...p })),
  ];
  if (participants.length > 0) {
    await db.insert(messageParticipants).values(
      participants.map((p) => ({
        organizationId: ctx.organizationId,
        messageId: inserted[0]!.id,
        role: p.role,
        address: p.address,
        displayName: p.displayName,
      })),
    );
  }
  return true;
}

/**
 * Controlled recovery from an expired/invalid history cursor: re-baseline from
 * the current profile historyId. Previously seen mail is not reprocessed and
 * nothing is ever drafted during recovery (no drafting exists in Phase 2).
 */
async function recoverCursor(
  db: Database,
  ctx: TenantContext,
  accountId: string,
  provider: GmailProvider,
): Promise<string> {
  const profile = await provider.getProfile();
  await db
    .insert(mailboxCheckpoints)
    .values({
      organizationId: ctx.organizationId,
      emailAccountId: accountId,
      kind: 'inbox',
      cursor: profile.historyId,
    })
    .onConflictDoUpdate({
      target: [mailboxCheckpoints.emailAccountId, mailboxCheckpoints.kind],
      set: { cursor: profile.historyId, updatedAt: new Date() },
    });
  await recordAuditEvent(db, ctx, 'gmail.sync_recovered', {
    accountId,
    newCursor: profile.historyId,
  });
  return profile.historyId;
}

export async function syncMailbox(
  db: Database,
  ctx: TenantContext,
  accountId: string,
  provider: GmailProvider,
  enc: EncryptionService,
): Promise<SyncOutcome> {
  const account = await getAccount(db, ctx, accountId);
  if (account.status !== 'connected') {
    return { status: 'skipped', reason: `account status is ${account.status}` };
  }
  const cursor = (await getCheckpoint(db, accountId, 'inbox')) ?? account.lastHistoryId;
  if (!cursor) {
    return { status: 'skipped', reason: 'no baseline cursor; connect the account first' };
  }

  try {
    const events: GmailHistoryEvent[] = [];
    let pageToken: string | undefined;
    let latestHistoryId = cursor;
    do {
      const page = await provider.listHistory(cursor, pageToken);
      events.push(...page.events);
      latestHistoryId = page.latestHistoryId;
      pageToken = page.nextPageToken;
    } while (pageToken);

    let newMessages = 0;
    for (const event of events) {
      // Idempotency: a duplicate event hits the unique constraint and is skipped.
      const recorded = await db
        .insert(mailboxEvents)
        .values({
          organizationId: ctx.organizationId,
          emailAccountId: accountId,
          historyId: event.historyId,
          type: event.type,
          providerMessageId: event.message.id,
        })
        .onConflictDoNothing()
        .returning();
      if (!recorded[0]) continue;

      const inserted = await persistMessage(
        db,
        ctx,
        accountId,
        account.providerEmail,
        provider,
        event.message.id,
        enc,
      );
      if (inserted) newMessages += 1;
    }

    // Advance the cursor only after the whole pass succeeded (§8.2).
    await db
      .insert(mailboxCheckpoints)
      .values({
        organizationId: ctx.organizationId,
        emailAccountId: accountId,
        kind: 'inbox',
        cursor: latestHistoryId,
      })
      .onConflictDoUpdate({
        target: [mailboxCheckpoints.emailAccountId, mailboxCheckpoints.kind],
        set: { cursor: latestHistoryId, updatedAt: new Date() },
      });

    return { status: 'synced', newMessages, cursor: latestHistoryId };
  } catch (err) {
    if (err instanceof HistoryCursorInvalidError) {
      const newCursor = await recoverCursor(db, ctx, accountId, provider);
      return { status: 'recovered', cursor: newCursor };
    }
    if (err instanceof GmailAuthError && err.reason === 'reconnect_required') {
      await markReconnectRequired(db, ctx, accountId);
      return { status: 'reconnect_required' };
    }
    throw err;
  }
}
