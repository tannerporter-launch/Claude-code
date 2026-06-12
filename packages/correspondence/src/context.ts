import { createHash } from 'node:crypto';
import {
  type Database,
  type TenantContext,
  contextSnapshots,
  knowledgeDocumentVersions,
  knowledgeDocuments,
  ruleVersions,
  rules,
} from '@echoloop/database';
import {
  ruleConditionMatches,
  ruleConditionSchema,
  type RuleMatchContext,
} from '@echoloop/schemas';
import type { EncryptionService } from '@echoloop/security';
import { and, eq } from 'drizzle-orm';

/**
 * Layered context assembly (BUILD_BRIEF §10.2). Precedence, highest first:
 * approved facts → terminology → temporary emphasis (active window only) →
 * user-wide style → relationship/contact-scoped rules → thread/message (added
 * by the drafting phase). Approved facts override all stylistic guidance;
 * style rules recorded as contradicting a fact are excluded and listed in the
 * snapshot's excludedConflicts.
 */

export interface IncludedRecord {
  type: 'knowledge' | 'rule';
  id: string;
  version: number;
  category: string;
}

export interface AssembledContext {
  sections: { heading: string; entries: string[] }[];
  includedRecords: IncludedRecord[];
  excludedConflicts: { type: string; id: string; reason: string }[];
  rendered: string;
  contentHash: string;
}

const CATEGORY_ORDER: { category: string; heading: string }[] = [
  { category: 'approved_fact', heading: 'Approved facts (override all style guidance)' },
  { category: 'terminology', heading: 'Terminology' },
  { category: 'temporary_emphasis', heading: 'Current emphasis (time-bound)' },
  { category: 'personal_style', heading: 'Personal style' },
];

function withinEffectiveWindow(from: Date | null, until: Date | null, now: Date): boolean {
  if (from && now < from) return false;
  if (until && now > until) return false;
  return true;
}

export async function assembleContext(
  db: Database,
  ctx: TenantContext,
  match: RuleMatchContext,
  options: { now?: Date } = {},
): Promise<AssembledContext> {
  const now = options.now ?? new Date();
  const includedRecords: IncludedRecord[] = [];
  const excludedConflicts: AssembledContext['excludedConflicts'] = [];
  const sections: AssembledContext['sections'] = [];

  // Knowledge documents in precedence order; expired emphasis excluded.
  const docs = await db
    .select()
    .from(knowledgeDocuments)
    .innerJoin(
      knowledgeDocumentVersions,
      and(
        eq(knowledgeDocumentVersions.documentId, knowledgeDocuments.id),
        eq(knowledgeDocumentVersions.version, knowledgeDocuments.currentVersion),
      ),
    )
    .where(
      and(
        eq(knowledgeDocuments.organizationId, ctx.organizationId),
        eq(knowledgeDocuments.status, 'active'),
      ),
    );

  for (const { category, heading } of CATEGORY_ORDER) {
    const entries: string[] = [];
    for (const row of docs) {
      const doc = row.knowledge_documents;
      if (doc.category !== category) continue;
      if (
        category === 'temporary_emphasis' &&
        !withinEffectiveWindow(doc.effectiveFrom, doc.effectiveUntil, now)
      ) {
        excludedConflicts.push({ type: 'knowledge', id: doc.id, reason: 'expired_emphasis' });
        continue;
      }
      entries.push(`${doc.title}: ${row.knowledge_document_versions.content}`);
      includedRecords.push({
        type: 'knowledge',
        id: doc.id,
        version: doc.currentVersion,
        category,
      });
    }
    if (entries.length > 0) sections.push({ heading, entries });
  }

  // Active rules whose current version's condition matches this context.
  const activeRules = await db
    .select()
    .from(rules)
    .innerJoin(
      ruleVersions,
      and(eq(ruleVersions.ruleId, rules.id), eq(ruleVersions.version, rules.currentVersion)),
    )
    .where(and(eq(rules.organizationId, ctx.organizationId), eq(rules.status, 'active')));

  const ruleEntries: { instruction: string; priority: number }[] = [];
  for (const row of activeRules) {
    const rule = row.rules;
    const version = row.rule_versions;
    if (!withinEffectiveWindow(version.effectiveFrom, version.effectiveUntil, now)) {
      excludedConflicts.push({ type: 'rule', id: rule.id, reason: 'outside_effective_window' });
      continue;
    }
    if (rule.contradictsKnowledgeId) {
      excludedConflicts.push({ type: 'rule', id: rule.id, reason: 'contradicts_approved_fact' });
      continue;
    }
    const condition = ruleConditionSchema.parse(version.condition ?? {});
    if (!ruleConditionMatches(condition, match)) continue;
    ruleEntries.push({ instruction: version.instruction, priority: rule.priority });
    includedRecords.push({
      type: 'rule',
      id: rule.id,
      version: rule.currentVersion,
      category: rule.category,
    });
  }
  ruleEntries.sort((a, b) => a.priority - b.priority);
  if (ruleEntries.length > 0) {
    sections.push({
      heading: 'Communication rules (in priority order)',
      entries: ruleEntries.map((r) => r.instruction),
    });
  }

  const rendered = [
    'Context precedence: approved facts override every stylistic instruction below them.',
    ...sections.map((s) => `## ${s.heading}\n${s.entries.map((e) => `- ${e}`).join('\n')}`),
  ].join('\n\n');

  return {
    sections,
    includedRecords,
    excludedConflicts,
    rendered,
    contentHash: createHash('sha256').update(rendered).digest('hex'),
  };
}

/** Persist a context snapshot with full provenance (BUILD_BRIEF §10.2). */
export async function persistContextSnapshot(
  db: Database,
  ctx: TenantContext,
  assembled: AssembledContext,
  enc: EncryptionService,
  meta: { messageId?: string; promptVersion?: string; modelId?: string } = {},
) {
  const [snapshot] = await db
    .insert(contextSnapshots)
    .values({
      organizationId: ctx.organizationId,
      messageId: meta.messageId ?? null,
      includedRecords: assembled.includedRecords,
      excludedConflicts: assembled.excludedConflicts,
      promptVersion: meta.promptVersion ?? null,
      modelId: meta.modelId ?? null,
      contentHash: assembled.contentHash,
      renderedEncrypted: enc.encrypt(assembled.rendered),
    })
    .returning();
  return snapshot!;
}
