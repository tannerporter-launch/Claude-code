import { connectAccount } from '@echoloop/correspondence';
import {
  type Database,
  addMembership,
  createOrganization,
  createPgDatabase,
  createTenantRepository,
  createUser,
  emailAccounts,
  migratePg,
} from '@echoloop/database';
import {
  createLiveGmailProvider,
  createOAuthClient,
  loadOAuthClientConfig,
  runLoopbackConsent,
} from '@echoloop/gmail';
import {
  requireDatabaseUrl,
  requireEncryptionKey,
  requireGoogleCredentialsPath,
} from '@echoloop/schemas';
import { createEncryptionService, createLogger } from '@echoloop/security';
import { eq } from 'drizzle-orm';

/**
 * USER-RUN CLI (live; never executed by automated tests):
 * connect the approved pilot Gmail account via the Desktop-app loopback
 * consent flow, store encrypted tokens, and capture the baseline history
 * cursor. Re-run this same command to re-consent when the account enters
 * `reconnect_required` (expected ~weekly while the consent screen is in
 * Testing status).
 *
 *   pnpm run build && node apps/worker/dist/connect-gmail.js
 */

async function ensurePilotAccount(db: Database): Promise<{ accountId: string; orgId: string }> {
  const existing = await db.select().from(emailAccounts).limit(1);
  if (existing[0]) {
    return { accountId: existing[0].id, orgId: existing[0].organizationId };
  }
  const org = await createOrganization(db, 'EchoLoop Pilot');
  const user = await createUser(db, 'pilot@pending.invalid', 'Pilot User');
  await addMembership(db, org.id, user.id, 'owner');
  const repo = createTenantRepository(db, { organizationId: org.id });
  const account = await repo.emailAccounts.create({
    userId: user.id,
    providerEmail: 'pilot@pending.invalid',
  });
  return { accountId: account.id, orgId: org.id };
}

async function main(): Promise<void> {
  const logger = createLogger({ base: { component: 'connect-gmail' } });
  const credentialsPath = requireGoogleCredentialsPath();
  const config = loadOAuthClientConfig(credentialsPath);
  const enc = createEncryptionService(requireEncryptionKey());

  const { db, close } = await createPgDatabase(requireDatabaseUrl());
  try {
    await migratePg(db);
    const { accountId, orgId } = await ensurePilotAccount(db);

    console.log('\nEchoLoop — connect Gmail (scopes: gmail.readonly + gmail.compose)');
    console.log('A browser consent URL will be printed. Open it, approve, and return here.\n');

    const tokens = await runLoopbackConsent(config, (url) => {
      console.log(`Open this URL to authorize:\n\n${url}\n`);
    });

    const authClient = createOAuthClient(config);
    authClient.setCredentials({
      access_token: tokens.accessToken,
      refresh_token: tokens.refreshToken,
    });
    const provider = createLiveGmailProvider(authClient);

    const result = await connectAccount(
      db,
      { organizationId: orgId },
      accountId,
      provider,
      tokens,
      enc,
    );

    // Keep the placeholder user aligned with the real connected address.
    await db
      .update(emailAccounts)
      .set({ providerEmail: result.emailAddress })
      .where(eq(emailAccounts.id, accountId));

    logger.info('gmail connected', { accountId, baseline: result.baselineHistoryId });
    console.log(
      `\nConnected. Baseline historyId: ${result.baselineHistoryId}.\n` +
        'No historical mail was imported and nothing will ever be sent by EchoLoop.\n' +
        'If sync later reports reconnect_required (expected ~weekly in Testing status),\n' +
        'just run this command again.',
    );
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
