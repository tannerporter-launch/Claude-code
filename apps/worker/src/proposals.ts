import {
  approveProposal,
  deferProposal,
  listPendingProposals,
  rejectProposal,
  rollbackRule,
} from '@echoloop/correspondence';
import { createPgDatabase, organizations, proposalEvidence } from '@echoloop/database';
import { requireDatabaseUrl } from '@echoloop/schemas';
import { eq } from 'drizzle-orm';

/**
 * USER-RUN CLI: the human-approval surface for learning proposals.
 *
 *   node apps/worker/dist/proposals.js list
 *   node apps/worker/dist/proposals.js approve <proposalId> [edited text…]
 *   node apps/worker/dist/proposals.js reject <proposalId>
 *   node apps/worker/dist/proposals.js defer <proposalId>
 *   node apps/worker/dist/proposals.js rollback-rule <ruleId>
 */
async function main(): Promise<void> {
  const [cmd, id, ...rest] = process.argv.slice(2);
  const { db, close } = await createPgDatabase(requireDatabaseUrl());
  try {
    const [org] = await db.select().from(organizations).limit(1);
    if (!org) {
      console.log('No organization found.');
      return;
    }
    const ctx = { organizationId: org.id };

    switch (cmd) {
      case 'list': {
        const pending = await listPendingProposals(db, ctx);
        if (pending.length === 0) {
          console.log('No pending proposals.');
          break;
        }
        for (const p of pending) {
          const evidence = await db
            .select()
            .from(proposalEvidence)
            .where(eq(proposalEvidence.proposalId, p.id));
          console.log(
            `\n[${p.id}]\n  type: ${p.proposalType} → ${p.targetKind}\n` +
              `  scope: ${p.scopeType}${p.scopeValue ? `=${p.scopeValue}` : ''}  ` +
              `risk: ${p.riskLevel}  confidence: ${(p.confidenceMilli / 1000).toFixed(2)}\n` +
              `  evidence: ${p.evidenceCount} supporting, ${p.contradictionCount} contradictory ` +
              `(${evidence.length} linked comparisons)\n` +
              `  proposed: ${p.proposedText}\n  rationale: ${p.rationale}`,
          );
        }
        break;
      }
      case 'approve': {
        if (!id) throw new Error('proposal id required');
        const edited = rest.join(' ').trim();
        const result = await approveProposal(db, ctx, id, edited ? { editedText: edited } : {});
        console.log(
          `Approved.${result.resultingRuleId ? ` Rule ${result.resultingRuleId} is now active and will influence future drafts.` : ' Knowledge updated.'}`,
        );
        break;
      }
      case 'reject':
        if (!id) throw new Error('proposal id required');
        await rejectProposal(db, ctx, id);
        console.log('Rejected. It will never affect drafting.');
        break;
      case 'defer':
        if (!id) throw new Error('proposal id required');
        await deferProposal(db, ctx, id);
        console.log('Deferred.');
        break;
      case 'rollback-rule':
        if (!id) throw new Error('rule id required');
        await rollbackRule(db, ctx, id);
        console.log('Rolled back. The rule no longer affects drafting.');
        break;
      default:
        console.log(
          'Usage: proposals.js list | approve <id> [edited text] | reject <id> | defer <id> | rollback-rule <ruleId>',
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
