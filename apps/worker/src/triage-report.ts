import { createPgDatabase, messageClassifications } from '@echoloop/database';
import { requireDatabaseUrl } from '@echoloop/schemas';

/**
 * USER-RUN CLI: dry-run triage report over the local database — counts by
 * status and exclusion reason. No model calls, no Gmail access; reads only
 * already-stored classification rows.
 *
 *   node apps/worker/dist/triage-report.js
 */
async function main(): Promise<void> {
  const { db, close } = await createPgDatabase(requireDatabaseUrl());
  try {
    const rows = await db.select().from(messageClassifications);
    const byStatus = new Map<string, number>();
    const byExclusion = new Map<string, number>();
    for (const row of rows) {
      byStatus.set(row.status, (byStatus.get(row.status) ?? 0) + 1);
      if (row.exclusionReason) {
        byExclusion.set(row.exclusionReason, (byExclusion.get(row.exclusionReason) ?? 0) + 1);
      }
    }
    console.log(`Triage report — ${rows.length} processed messages`);
    for (const [status, count] of byStatus) console.log(`  ${status}: ${count}`);
    if (byExclusion.size > 0) {
      console.log('Exclusions:');
      for (const [reason, count] of byExclusion) console.log(`  ${reason}: ${count}`);
    }
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
