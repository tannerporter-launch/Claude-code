import { listAmbiguousPairings, manuallyPair } from '@echoloop/correspondence';
import { createPgDatabase, organizations } from '@echoloop/database';
import { requireDatabaseUrl } from '@echoloop/schemas';

/**
 * USER-RUN CLI: manual pairing queue for ambiguous draft↔sent matches.
 *
 *   node apps/worker/dist/pairing-queue.js list
 *   node apps/worker/dist/pairing-queue.js pair <sentMessageId> <generatedDraftId>
 */
async function main(): Promise<void> {
  const [cmd, sentId, draftId] = process.argv.slice(2);
  const { db, close } = await createPgDatabase(requireDatabaseUrl());
  try {
    const [org] = await db.select().from(organizations).limit(1);
    if (!org) {
      console.log('No organization found.');
      return;
    }
    const ctx = { organizationId: org.id };
    if (cmd === 'list') {
      const queue = await listAmbiguousPairings(db, ctx);
      if (queue.length === 0) console.log('No ambiguous pairings.');
      for (const c of queue) {
        console.log(
          `sent=${c.sentMessageId} candidate-draft=${c.generatedDraftId} ` +
            `score=${(c.score / 1000).toFixed(2)} evidence=${JSON.stringify(c.evidence)}`,
        );
      }
    } else if (cmd === 'pair' && sentId && draftId) {
      await manuallyPair(db, ctx, sentId, draftId);
      console.log('Paired manually.');
    } else {
      console.log('Usage: pairing-queue.js list | pair <sentMessageId> <generatedDraftId>');
    }
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
