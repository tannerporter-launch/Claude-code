import { addAllowlistEntry } from '@echoloop/correspondence';
import { allowlistEntries, createPgDatabase, emailAccounts } from '@echoloop/database';
import { requireDatabaseUrl } from '@echoloop/schemas';

/**
 * USER-RUN CLI: manage the drafting allowlist.
 *
 *   node apps/worker/dist/allowlist.js list
 *   node apps/worker/dist/allowlist.js add sender_email jane@client.test
 *   node apps/worker/dist/allowlist.js add sender_domain client.test
 *   node apps/worker/dist/allowlist.js add gmail_label important
 */
async function main(): Promise<void> {
  const [cmd, kind, value] = process.argv.slice(2);
  const { db, close } = await createPgDatabase(requireDatabaseUrl());
  try {
    const [account] = await db.select().from(emailAccounts).limit(1);
    if (!account) {
      console.log('No account. Run connect-gmail first.');
      return;
    }
    const ctx = { organizationId: account.organizationId };
    if (cmd === 'list') {
      const entries = await db.select().from(allowlistEntries);
      if (entries.length === 0) console.log('Allowlist is empty — no drafting in allowlist mode.');
      for (const e of entries) console.log(`${e.kind}: ${e.value}`);
    } else if (cmd === 'add' && kind && value) {
      await addAllowlistEntry(db, ctx, account.id, {
        kind: kind as 'sender_email',
        value,
      });
      console.log(`Added ${kind}: ${value}`);
    } else {
      console.log(
        'Usage: allowlist.js list | add <sender_email|sender_domain|gmail_label|thread|message> <value>',
      );
    }
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
