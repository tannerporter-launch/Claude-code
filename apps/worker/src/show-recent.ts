import { listRecentEligibleSummaries, syncMailbox } from '@echoloop/correspondence';
import { createPgDatabase, emailAccounts } from '@echoloop/database';
import {
  createLiveGmailProvider,
  createOAuthClient,
  loadOAuthClientConfig,
  refreshAccessToken,
} from '@echoloop/gmail';
import {
  requireDatabaseUrl,
  requireEncryptionKey,
  requireGoogleCredentialsPath,
} from '@echoloop/schemas';
import { createEncryptionService } from '@echoloop/security';

/**
 * USER-RUN CLI (live; never executed by automated tests):
 * sync once, then print the last ten eligible inbound message summaries —
 * the Phase 2 acceptance demonstration.
 *
 *   pnpm run build && node apps/worker/dist/show-recent.js
 */
async function main(): Promise<void> {
  const config = loadOAuthClientConfig(requireGoogleCredentialsPath());
  const enc = createEncryptionService(requireEncryptionKey());
  const { db, close } = await createPgDatabase(requireDatabaseUrl());
  try {
    const accounts = await db.select().from(emailAccounts).limit(1);
    const account = accounts[0];
    if (!account) {
      console.log('No email account found. Run connect-gmail first.');
      return;
    }
    if (account.status !== 'connected' || !account.encryptedRefreshToken) {
      console.log(
        `Account status is "${account.status}". ` +
          (account.status === 'reconnect_required'
            ? 'The refresh token expired (expected weekly in Testing status). Run connect-gmail to re-consent.'
            : 'Run connect-gmail first.'),
      );
      return;
    }

    const refreshToken = enc.decrypt(account.encryptedRefreshToken);
    const tokens = await refreshAccessToken(config, refreshToken);
    const authClient = createOAuthClient(config);
    authClient.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    const provider = createLiveGmailProvider(authClient);

    const ctx = { organizationId: account.organizationId };
    const outcome = await syncMailbox(db, ctx, account.id, provider, enc);
    console.log(`Sync: ${outcome.status}`);
    if (outcome.status === 'reconnect_required') {
      console.log('Run connect-gmail to re-consent, then try again.');
      return;
    }

    const summaries = await listRecentEligibleSummaries(db, ctx, account.id, 10);
    console.log(`\nLast ${summaries.length} eligible inbound messages:\n`);
    for (const s of summaries) {
      console.log(`- [${s.internalDate.toISOString()}] ${s.subject ?? '(no subject)'}`);
    }
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
