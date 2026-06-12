import { createPgDatabase, emailAccounts, recordAuditEvent } from '@echoloop/database';
import { requireDatabaseUrl } from '@echoloop/schemas';

/**
 * USER-RUN CLI: record explicit consent for transmitting message content and
 * assembled context to the AI provider (BUILD_BRIEF §12; docs/PRIVACY.md).
 * Run once before enabling live AI features.
 *
 *   node apps/worker/dist/record-consent.js
 */
async function main(): Promise<void> {
  const { db, close } = await createPgDatabase(requireDatabaseUrl());
  try {
    const [account] = await db.select().from(emailAccounts).limit(1);
    if (!account) {
      console.log('No email account found. Run connect-gmail first.');
      return;
    }
    await recordAuditEvent(
      db,
      { organizationId: account.organizationId },
      'ai.transmission_consented',
      {
        scope: 'triage, drafting, comparison',
        documentedIn: 'docs/PRIVACY.md',
        accountId: account.id,
      },
      account.userId,
    );
    console.log(
      'Recorded consent: inbound message content, thread context, and approved\n' +
        'playbook/knowledge may be transmitted to the Anthropic API for triage,\n' +
        'drafting, and comparison (see docs/PRIVACY.md for the field-level list).',
    );
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
