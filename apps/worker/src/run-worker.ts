import { createLiveAiProvider } from '@echoloop/ai';
import { runLoopCycle } from '@echoloop/correspondence';
import { createPgDatabase, emailAccounts } from '@echoloop/database';
import {
  createLiveGmailProvider,
  createOAuthClient,
  loadOAuthClientConfig,
  refreshAccessToken,
} from '@echoloop/gmail';
import {
  parseEnv,
  requireDatabaseUrl,
  requireEncryptionKey,
  requireGoogleCredentialsPath,
} from '@echoloop/schemas';
import { createEncryptionService, createLogger } from '@echoloop/security';

/**
 * USER-RUN CLI: minimal continuous worker loop (go-live wiring). Every
 * POLL_INTERVAL_SECONDS: sync → triage → draft (activation-policy gated) →
 * pair → discard-detect → compare → propose. Sent capture and learning keep
 * running even while drafting is blocked. Graceful SIGINT shutdown.
 * Full Phase 10 reliability (circuit breaker, dead-letter replay, health
 * endpoints) is NOT built yet — see docs/STATUS.md.
 *
 *   node apps/worker/dist/run-worker.js
 */
async function main(): Promise<void> {
  const env = parseEnv();
  const logger = createLogger({ base: { component: 'run-worker' } });
  if (!env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY is not set. Add it to .env first.');
    return;
  }
  const ai = createLiveAiProvider(env.ANTHROPIC_API_KEY);
  const enc = createEncryptionService(requireEncryptionKey());
  const config = loadOAuthClientConfig(requireGoogleCredentialsPath());
  const { db, close } = await createPgDatabase(requireDatabaseUrl());

  let stopping = false;
  process.on('SIGINT', () => {
    stopping = true;
    console.log('\nStopping after the current cycle…');
  });
  process.on('SIGTERM', () => {
    stopping = true;
  });

  console.log(
    `EchoLoop worker started. Mode=${env.ECHOLOOP_ACTIVATION_MODE}, ` +
      `kill switch=${env.ECHOLOOP_DRAFTING_KILL_SWITCH ? 'ON (no drafts)' : 'off'}, ` +
      `interval=${env.POLL_INTERVAL_SECONDS}s. Ctrl-C to stop.`,
  );

  try {
    while (!stopping) {
      const [account] = await db.select().from(emailAccounts).limit(1);
      if (!account) {
        console.log('No account connected. Run connect-gmail first.');
        break;
      }
      if (account.status !== 'connected' || !account.encryptedRefreshToken) {
        console.log(
          `Account status: ${account.status}.` +
            (account.status === 'reconnect_required'
              ? ' Run connect-gmail to re-consent (expected ~weekly in Testing status).'
              : ''),
        );
      } else {
        try {
          const tokens = await refreshAccessToken(
            config,
            enc.decrypt(account.encryptedRefreshToken),
          );
          const auth = createOAuthClient(config);
          auth.setCredentials({
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken,
          });
          const gmail = createLiveGmailProvider(auth);
          const summary = await runLoopCycle(
            db,
            { organizationId: account.organizationId },
            {
              id: account.id,
              providerEmail: account.providerEmail,
              draftingPaused: account.draftingPaused,
            },
            gmail,
            ai,
            enc,
            { env, logger },
          );
          logger.info('cycle complete', { ...summary });
          console.log(
            `[${new Date().toISOString()}] sync=${summary.sync} triaged=${summary.triaged} ` +
              `drafts=${summary.draftsCreated} blocked=${summary.draftsBlocked} ` +
              `paired=${summary.paired} ambiguous=${summary.ambiguous} ` +
              `compared=${summary.compared} proposals=${summary.proposals}`,
          );
        } catch (err: unknown) {
          logger.error('cycle failed', {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
      // Sleep in 1s steps so SIGINT exits promptly.
      for (let i = 0; i < env.POLL_INTERVAL_SECONDS && !stopping; i++) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  } finally {
    await close();
    console.log('Worker stopped cleanly.');
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
