import {
  type Database,
  type TenantContext,
  emailAccounts,
  mailboxCheckpoints,
  recordAuditEvent,
} from '@echoloop/database';
import type { GmailProvider, OAuthTokens } from '@echoloop/gmail';
import type { EncryptionService } from '@echoloop/security';
import { and, eq } from 'drizzle-orm';

/**
 * Email-account lifecycle. Status state machine:
 *
 *   disconnected → connected → reconnect_required → connected (re-consent)
 *                          ↘ revoked (terminal until reconnected explicitly)
 *
 * `reconnect_required` is an EXPECTED state for the pilot: Google expires
 * refresh tokens after ~7 days while the consent screen is in Testing status.
 */

export type AccountStatus = 'disconnected' | 'connected' | 'reconnect_required' | 'revoked';

export interface ConnectResult {
  accountId: string;
  emailAddress: string;
  baselineHistoryId: string;
}

async function getAccount(db: Database, ctx: TenantContext, accountId: string) {
  const rows = await db
    .select()
    .from(emailAccounts)
    .where(
      and(eq(emailAccounts.id, accountId), eq(emailAccounts.organizationId, ctx.organizationId)),
    );
  const account = rows[0];
  if (!account) throw new Error(`Email account ${accountId} not found in organization`);
  return account;
}

async function setCheckpoint(
  db: Database,
  ctx: TenantContext,
  accountId: string,
  kind: 'inbox' | 'sent',
  cursor: string,
): Promise<void> {
  await db
    .insert(mailboxCheckpoints)
    .values({ organizationId: ctx.organizationId, emailAccountId: accountId, kind, cursor })
    .onConflictDoUpdate({
      target: [mailboxCheckpoints.emailAccountId, mailboxCheckpoints.kind],
      set: { cursor, updatedAt: new Date() },
    });
}

export async function getCheckpoint(
  db: Database,
  accountId: string,
  kind: 'inbox' | 'sent',
): Promise<string | null> {
  const rows = await db
    .select()
    .from(mailboxCheckpoints)
    .where(
      and(eq(mailboxCheckpoints.emailAccountId, accountId), eq(mailboxCheckpoints.kind, kind)),
    );
  return rows[0]?.cursor ?? null;
}

/**
 * Connect (or reconnect) an account: store encrypted tokens and capture the
 * BASELINE history position. No historical mail is imported and no drafts are
 * ever generated for history (BUILD_BRIEF §8.1).
 */
export async function connectAccount(
  db: Database,
  ctx: TenantContext,
  accountId: string,
  provider: GmailProvider,
  tokens: OAuthTokens,
  enc: EncryptionService,
): Promise<ConnectResult> {
  await getAccount(db, ctx, accountId);
  const profile = await provider.getProfile();

  await db
    .update(emailAccounts)
    .set({
      providerEmail: profile.emailAddress,
      encryptedAccessToken: enc.encrypt(tokens.accessToken),
      encryptedRefreshToken: enc.encrypt(tokens.refreshToken),
      tokenExpiresAt: tokens.expiryDate,
      lastHistoryId: profile.historyId,
      status: 'connected' satisfies AccountStatus,
    })
    .where(eq(emailAccounts.id, accountId));

  await setCheckpoint(db, ctx, accountId, 'inbox', profile.historyId);
  await recordAuditEvent(db, ctx, 'gmail.connected', {
    accountId,
    baselineHistoryId: profile.historyId,
  });

  return {
    accountId,
    emailAddress: profile.emailAddress,
    baselineHistoryId: profile.historyId,
  };
}

/**
 * Move an account to `reconnect_required` (expired/revoked refresh token).
 * Clean, audited, recoverable by re-running the connect flow — not an error.
 */
export async function markReconnectRequired(
  db: Database,
  ctx: TenantContext,
  accountId: string,
): Promise<void> {
  await db
    .update(emailAccounts)
    .set({ status: 'reconnect_required' satisfies AccountStatus })
    .where(eq(emailAccounts.id, accountId));
  await recordAuditEvent(db, ctx, 'gmail.reconnect_required', {
    accountId,
    note: 'refresh token expired or revoked (expected weekly in Testing status)',
  });
}

/** Revoke the connection: tokens cleared, processing stops. */
export async function revokeAccount(
  db: Database,
  ctx: TenantContext,
  accountId: string,
  provider: GmailProvider,
): Promise<void> {
  await getAccount(db, ctx, accountId);
  await provider.revoke();
  await db
    .update(emailAccounts)
    .set({
      encryptedAccessToken: null,
      encryptedRefreshToken: null,
      tokenExpiresAt: null,
      status: 'revoked' satisfies AccountStatus,
    })
    .where(eq(emailAccounts.id, accountId));
  await recordAuditEvent(db, ctx, 'gmail.revoked', { accountId });
}

export { getAccount };
