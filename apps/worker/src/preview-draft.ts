import { createLiveAiProvider } from '@echoloop/ai';
import { generateDraftPreview } from '@echoloop/correspondence';
import {
  createPgDatabase,
  emailAccounts,
  emailMessages,
  messageClassifications,
} from '@echoloop/database';
import { parseEnv, requireDatabaseUrl, requireEncryptionKey } from '@echoloop/schemas';
import { createEncryptionService } from '@echoloop/security';
import { and, eq } from 'drizzle-orm';

/**
 * USER-RUN CLI: generate a dry-run draft PREVIEW for the most recent
 * classified message. No Gmail write occurs. Requires ANTHROPIC_API_KEY and
 * recorded consent (record-consent CLI).
 *
 *   node apps/worker/dist/preview-draft.js
 */
async function main(): Promise<void> {
  const env = parseEnv();
  if (!env.ANTHROPIC_API_KEY) {
    console.log('ANTHROPIC_API_KEY is not set. Add it to .env first.');
    return;
  }
  const ai = createLiveAiProvider(env.ANTHROPIC_API_KEY);
  const enc = createEncryptionService(requireEncryptionKey());
  const { db, close } = await createPgDatabase(requireDatabaseUrl());
  try {
    const [account] = await db.select().from(emailAccounts).limit(1);
    if (!account) {
      console.log('No account. Run connect-gmail first.');
      return;
    }
    const ctx = { organizationId: account.organizationId };
    const [row] = await db
      .select()
      .from(messageClassifications)
      .innerJoin(emailMessages, eq(emailMessages.id, messageClassifications.messageId))
      .where(
        and(
          eq(messageClassifications.organizationId, account.organizationId),
          eq(messageClassifications.status, 'classified'),
        ),
      )
      .limit(1);
    if (!row) {
      console.log('No classified message found. Sync + triage first.');
      return;
    }
    const outcome = await generateDraftPreview(
      db,
      ctx,
      account.providerEmail,
      row.message_classifications.messageId,
      ai,
      enc,
    );
    console.log(
      `Generation status: ${outcome.status}${outcome.reason ? ` (${outcome.reason})` : ''}`,
    );
    if (outcome.preview) {
      const p = outcome.preview;
      console.log(`\nTo: ${p.to.join(', ')}${p.cc.length ? `\nCc: ${p.cc.join(', ')}` : ''}`);
      console.log(`Subject: ${p.subject}\n\n${p.bodyText}\n`);
      console.log(`Facts used: ${p.factsUsed.join(', ') || '(none)'}`);
      console.log(`Rules used: ${p.rulesUsed.join(', ') || '(none)'}`);
      if (p.uncertainties.length) console.log(`Uncertainties: ${p.uncertainties.join('; ')}`);
      console.log('\nDRY RUN — no Gmail draft was created. A human reviews everything.');
    }
  } finally {
    await close();
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});
