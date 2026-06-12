import { syncMailbox } from '@echoloop/correspondence';
import type { Database } from '@echoloop/database';
import type { GmailProvider } from '@echoloop/gmail';
import type { EncryptionService } from '@echoloop/security';
import type { JobHandler } from './index.js';

/**
 * The `gmail.sync` job handler. Read-only synchronization; a
 * `reconnect_required` or `skipped` outcome completes the job cleanly —
 * an expired refresh token is an expected state, not a failure to retry.
 */
export function createGmailSyncHandler(
  db: Database,
  providerFor: (accountId: string) => Promise<GmailProvider>,
  enc: EncryptionService,
): JobHandler {
  return async (job) => {
    const payload = job.payload as { accountId?: string };
    if (!payload.accountId) {
      throw new Error('gmail.sync job payload requires accountId');
    }
    const provider = await providerFor(payload.accountId);
    await syncMailbox(db, { organizationId: job.organizationId }, payload.accountId, provider, enc);
  };
}
