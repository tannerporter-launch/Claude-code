import {
  type Database,
  type TenantContext,
  comparisons,
  proposalEvidence,
  recordAuditEvent,
  ruleEvidence,
  ruleProposals,
} from '@echoloop/database';
import {
  FACTUAL_CATEGORIES,
  STYLE_CATEGORIES,
  STYLE_EVIDENCE_THRESHOLD,
  type SemanticComparison,
} from '@echoloop/schemas';
import { and, eq } from 'drizzle-orm';
import type { MechanicalDiff } from './comparison.js';
import { createKnowledgeDocument, createRule } from './knowledge.js';

/**
 * Evidence-controlled learning proposals (BUILD_BRIEF §10.7).
 *
 * - Style patterns require repeated evidence (STYLE_EVIDENCE_THRESHOLD) in the
 *   same context bucket, survive a contradictory-evidence search, and take the
 *   narrowest defensible scope. One-off edits never create a global rule.
 * - Factual corrections route to KNOWLEDGE review — never to style rules.
 * - Commitment changes are classified distinctly and never become style rules.
 * - NOTHING activates automatically: every proposal awaits explicit human
 *   approval, rejection, or deferral.
 */

const STYLE_INSTRUCTION: Record<string, string> = {
  brevity: 'Keep replies in this context noticeably shorter and more concise.',
  tone: 'Match the adjusted tone the user consistently applies in this context.',
  formality: 'Match the formality level the user consistently applies in this context.',
  warmth: 'Match the warmth level the user consistently applies in this context.',
  directness: 'Be more direct, the way the user consistently edits replies in this context.',
  structure: 'Match the paragraph/list structure the user consistently applies in this context.',
  greeting: 'Use the greeting style the user consistently applies in this context.',
  signoff: 'Use the sign-off the user consistently applies in this context.',
  formatting: 'Match the formatting the user consistently applies in this context.',
};

export interface ProposalRunSummary {
  styleProposals: number;
  factualProposals: number;
  skippedContradicted: number;
}

export async function generateProposals(
  db: Database,
  ctx: TenantContext,
): Promise<ProposalRunSummary> {
  const summary: ProposalRunSummary = {
    styleProposals: 0,
    factualProposals: 0,
    skippedContradicted: 0,
  };

  const allComparisons = await db
    .select()
    .from(comparisons)
    .where(eq(comparisons.organizationId, ctx.organizationId));

  // Comparisons already used as evidence are not re-proposed.
  const usedEvidence = new Set(
    (
      await db
        .select()
        .from(proposalEvidence)
        .where(eq(proposalEvidence.organizationId, ctx.organizationId))
    ).map((e) => e.comparisonId),
  );

  type Row = (typeof allComparisons)[number];
  const semantic = (row: Row) => row.semantic as SemanticComparison;
  const mechanical = (row: Row) => row.mechanical as MechanicalDiff & { lengthDeltaWords: number };

  // ---- Factual corrections → knowledge review (threshold 1, never style) ----
  for (const row of allComparisons) {
    if (usedEvidence.has(row.id)) continue;
    const sem = semantic(row);
    const factual = sem.categories.filter((c) => (FACTUAL_CATEGORIES as string[]).includes(c));
    if (factual.length === 0) continue;

    const [proposal] = await db
      .insert(ruleProposals)
      .values({
        organizationId: ctx.organizationId,
        proposalType: factual.includes('corrected_factual_information')
          ? 'correct_approved_fact'
          : 'add_approved_fact',
        targetKind: 'knowledge',
        proposedText:
          sem.factualCorrectionDetail ??
          `Review factual change observed in sent message: ${sem.summary}`,
        scopeType: 'organization',
        condition: {},
        confidenceMilli: 800,
        riskLevel: 'high',
        evidenceCount: 1,
        rationale: `Factual ${factual.join(', ')} detected in a sent edit. Routed to knowledge review — factual corrections never become style rules.`,
      })
      .returning();
    await db.insert(proposalEvidence).values({
      organizationId: ctx.organizationId,
      proposalId: proposal!.id,
      comparisonId: row.id,
      supports: true,
    });
    usedEvidence.add(row.id);
    summary.factualProposals += 1;
  }

  // ---- Style patterns: group by (category, contextBucket) ----
  const groups = new Map<string, Row[]>();
  for (const row of allComparisons) {
    if (usedEvidence.has(row.id)) continue;
    const sem = semantic(row);
    if (sem.isOneTimeSituational) continue;
    for (const category of sem.categories) {
      if (!(STYLE_CATEGORIES as string[]).includes(category)) continue;
      const key = `${category}|${row.contextBucket}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
  }

  for (const [key, rows] of groups) {
    const [category, bucket] = key.split('|') as [string, string];
    if (rows.length < STYLE_EVIDENCE_THRESHOLD) continue;

    // Contradictory-evidence search: for brevity, opposite-direction edits in
    // the same bucket contradict the pattern.
    let contradictions: Row[] = [];
    if (category === 'brevity') {
      contradictions = allComparisons.filter(
        (row) =>
          row.contextBucket === bucket &&
          !rows.includes(row) &&
          mechanical(row).lengthDeltaWords > 0,
      );
      if (contradictions.length * 2 >= rows.length) {
        summary.skippedContradicted += 1;
        continue;
      }
    }

    const [relationship] = bucket.split('/');
    const [proposal] = await db
      .insert(ruleProposals)
      .values({
        organizationId: ctx.organizationId,
        proposalType: 'new_style_rule',
        targetKind: 'rule',
        proposedText: STYLE_INSTRUCTION[category] ?? `Apply the observed ${category} preference.`,
        // Narrowest defensible scope: the relationship bucket the evidence came from.
        scopeType: 'relationship',
        scopeValue: relationship,
        condition: { relationships: [relationship] },
        confidenceMilli: Math.min(950, 500 + rows.length * 100),
        riskLevel: 'low',
        evidenceCount: rows.length,
        contradictionCount: contradictions.length,
        rationale: `Repeated ${category} edits observed in ${rows.length} sent replies in the ${bucket} context.`,
      })
      .returning();
    for (const row of rows) {
      await db.insert(proposalEvidence).values({
        organizationId: ctx.organizationId,
        proposalId: proposal!.id,
        comparisonId: row.id,
        supports: true,
      });
      usedEvidence.add(row.id);
    }
    for (const row of contradictions) {
      await db.insert(proposalEvidence).values({
        organizationId: ctx.organizationId,
        proposalId: proposal!.id,
        comparisonId: row.id,
        supports: false,
      });
    }
    summary.styleProposals += 1;
  }

  return summary;
}

/** Approve: creates the rule/knowledge record. Edited text wins when given. */
export async function approveProposal(
  db: Database,
  ctx: TenantContext,
  proposalId: string,
  options: { editedText?: string } = {},
) {
  const [proposal] = await db
    .select()
    .from(ruleProposals)
    .where(
      and(eq(ruleProposals.id, proposalId), eq(ruleProposals.organizationId, ctx.organizationId)),
    );
  if (!proposal) throw new Error('Proposal not found in organization');
  if (proposal.status !== 'pending') throw new Error(`Proposal is ${proposal.status}`);

  const text = options.editedText ?? proposal.proposedText;
  let resultingRuleId: string | null = null;

  if (proposal.targetKind === 'rule') {
    const rule = await createRule(db, ctx, {
      category: 'personal_style',
      instruction: text,
      condition: proposal.condition as { relationships?: string[] },
      scopeType: proposal.scopeType as 'relationship',
      scopeValue: proposal.scopeValue ?? undefined,
      riskLevel: proposal.riskLevel as 'low',
      creationSource: 'learning_approved',
    });
    resultingRuleId = rule.id;
    // Preserve evidence on the rule itself.
    const evidence = await db
      .select()
      .from(proposalEvidence)
      .where(eq(proposalEvidence.proposalId, proposalId));
    for (const item of evidence) {
      await db.insert(ruleEvidence).values({
        organizationId: ctx.organizationId,
        ruleId: rule.id,
        supportsRule: item.supports,
        comparisonId: item.comparisonId,
        summary: null,
      });
    }
  } else {
    await createKnowledgeDocument(db, ctx, {
      category: 'approved_fact',
      title: `Learning-approved fact (${proposal.proposalType})`,
      content: text,
    });
  }

  await db
    .update(ruleProposals)
    .set({ status: 'approved', resultingRuleId, reviewedAt: new Date() })
    .where(eq(ruleProposals.id, proposalId));
  await recordAuditEvent(db, ctx, 'proposal.approved', {
    proposalId,
    resultingRuleId,
    edited: Boolean(options.editedText),
  });
  return { resultingRuleId };
}

export async function rejectProposal(db: Database, ctx: TenantContext, proposalId: string) {
  await db
    .update(ruleProposals)
    .set({ status: 'rejected', reviewedAt: new Date() })
    .where(
      and(eq(ruleProposals.id, proposalId), eq(ruleProposals.organizationId, ctx.organizationId)),
    );
  await recordAuditEvent(db, ctx, 'proposal.rejected', { proposalId });
}

export async function deferProposal(db: Database, ctx: TenantContext, proposalId: string) {
  await db
    .update(ruleProposals)
    .set({ status: 'deferred', reviewedAt: new Date() })
    .where(
      and(eq(ruleProposals.id, proposalId), eq(ruleProposals.organizationId, ctx.organizationId)),
    );
  await recordAuditEvent(db, ctx, 'proposal.deferred', { proposalId });
}

export async function listPendingProposals(db: Database, ctx: TenantContext) {
  return db
    .select()
    .from(ruleProposals)
    .where(
      and(
        eq(ruleProposals.organizationId, ctx.organizationId),
        eq(ruleProposals.status, 'pending'),
      ),
    );
}
