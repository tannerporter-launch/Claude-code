import type { AiProvider } from '@echoloop/ai';
import { type Database, type TenantContext, generatedDrafts } from '@echoloop/database';
import type { GmailProvider } from '@echoloop/gmail';
import { parseEnv } from '@echoloop/schemas';
import type { EncryptionService, Logger } from '@echoloop/security';
import { and, eq } from 'drizzle-orm';
import { runComparisons } from './comparison.js';
import { generateDraftPreview } from './drafting.js';
import { createGmailDraftFromPreview } from './gmailDrafts.js';
import { generateProposals } from './learning.js';
import { detectDiscardedDrafts, runPairing } from './pairing.js';
import { syncMailbox } from './sync.js';
import { runTriage } from './triage.js';
import { messageClassifications, emailMessages } from '@echoloop/database';
import type { TriageResult } from '@echoloop/schemas';
import { isNull } from 'drizzle-orm';

/**
 * One full loop cycle: sync → triage → draft (policy-gated) → pair →
 * discard-detect → compare → propose. Drafting is gated by the activation
 * policy on every message; sent capture and learning keep running even when
 * drafting is blocked. Continuous scheduling/retry hardening is Phase 10.
 */

export interface CycleAccount {
  id: string;
  providerEmail: string;
  draftingPaused: boolean;
}

export interface CycleSummary {
  sync: string;
  triaged: number;
  draftsCreated: number;
  draftsBlocked: number;
  paired: number;
  ambiguous: number;
  discarded: number;
  compared: number;
  proposals: number;
}

export async function runLoopCycle(
  db: Database,
  ctx: TenantContext,
  account: CycleAccount,
  gmail: GmailProvider,
  ai: AiProvider,
  enc: EncryptionService,
  options: { env?: ReturnType<typeof parseEnv>; logger?: Logger } = {},
): Promise<CycleSummary> {
  const env = options.env ?? parseEnv();

  const sync = await syncMailbox(db, ctx, account.id, gmail, enc);
  if (sync.status === 'reconnect_required' || sync.status === 'skipped') {
    return {
      sync: sync.status,
      triaged: 0,
      draftsCreated: 0,
      draftsBlocked: 0,
      paired: 0,
      ambiguous: 0,
      discarded: 0,
      compared: 0,
      proposals: 0,
    };
  }

  const triage = await runTriage(db, ctx, account.id, account.providerEmail, ai, enc);

  // Draft classified needsReply messages that have no generation yet.
  let draftsCreated = 0;
  let draftsBlocked = 0;
  const classified = await db
    .select()
    .from(messageClassifications)
    .innerJoin(emailMessages, eq(emailMessages.id, messageClassifications.messageId))
    .leftJoin(generatedDrafts, eq(generatedDrafts.messageId, messageClassifications.messageId))
    .where(
      and(
        eq(messageClassifications.organizationId, ctx.organizationId),
        eq(messageClassifications.status, 'classified'),
        isNull(generatedDrafts.id),
      ),
    );
  for (const row of classified) {
    const triageResult = row.message_classifications.result as TriageResult;
    if (!triageResult.needsReply) continue;
    if (draftsCreated >= env.ECHOLOOP_MAX_DRAFTS_PER_CYCLE) break;
    const preview = await generateDraftPreview(
      db,
      ctx,
      account.providerEmail,
      row.message_classifications.messageId,
      ai,
      enc,
    );
    if (preview.status !== 'completed') continue;
    const created = await createGmailDraftFromPreview(
      db,
      ctx,
      account,
      preview.draftId!,
      gmail,
      enc,
      { draftsThisCycle: draftsCreated, env },
    );
    if (created.status === 'created') draftsCreated += 1;
    else draftsBlocked += 1;
  }

  // Sent capture stays active regardless of drafting gates.
  const pairing = await runPairing(db, ctx, account.id);
  const discarded = await detectDiscardedDrafts(db, ctx, gmail);
  const comparisons = await runComparisons(db, ctx, ai, enc);
  const proposals = await generateProposals(db, ctx);

  return {
    sync: sync.status,
    triaged: triage.processed,
    draftsCreated,
    draftsBlocked,
    paired: pairing.autoPaired,
    ambiguous: pairing.ambiguous,
    discarded,
    compared: comparisons.compared,
    proposals: proposals.styleProposals + proposals.factualProposals,
  };
}
