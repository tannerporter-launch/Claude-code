import {
  type Database,
  type TenantContext,
  knowledgeDocumentVersions,
  knowledgeDocuments,
  recordAuditEvent,
  ruleVersions,
  rules,
} from '@echoloop/database';
import {
  ruleConditionSchema,
  type KnowledgeCategory,
  type RuleCondition,
  type RuleScope,
} from '@echoloop/schemas';
import { and, eq } from 'drizzle-orm';

/**
 * Versioned knowledge documents and rules (BUILD_BRIEF §6). Every change
 * creates a new immutable version; nothing is seeded — the starter playbook
 * is empty until the human adds approved content. No rule activates without
 * human action (here: explicit human authoring; Phase 8: explicit approval).
 */

export interface NewKnowledgeDocument {
  category: KnowledgeCategory;
  title: string;
  content: string;
  effectiveFrom?: Date;
  effectiveUntil?: Date;
}

export async function createKnowledgeDocument(
  db: Database,
  ctx: TenantContext,
  input: NewKnowledgeDocument,
) {
  const [doc] = await db
    .insert(knowledgeDocuments)
    .values({
      organizationId: ctx.organizationId,
      category: input.category,
      title: input.title,
      effectiveFrom: input.effectiveFrom ?? null,
      effectiveUntil: input.effectiveUntil ?? null,
    })
    .returning();
  await db.insert(knowledgeDocumentVersions).values({
    documentId: doc!.id,
    version: 1,
    content: input.content,
  });
  await recordAuditEvent(db, ctx, 'knowledge.created', {
    documentId: doc!.id,
    category: input.category,
  });
  return doc!;
}

/** Edit creates a new immutable version and bumps the pointer. */
export async function updateKnowledgeDocument(
  db: Database,
  ctx: TenantContext,
  documentId: string,
  content: string,
) {
  const [doc] = await db
    .select()
    .from(knowledgeDocuments)
    .where(
      and(
        eq(knowledgeDocuments.id, documentId),
        eq(knowledgeDocuments.organizationId, ctx.organizationId),
      ),
    );
  if (!doc) throw new Error('Knowledge document not found in organization');
  const nextVersion = doc.currentVersion + 1;
  await db.insert(knowledgeDocumentVersions).values({
    documentId,
    version: nextVersion,
    content,
  });
  await db
    .update(knowledgeDocuments)
    .set({ currentVersion: nextVersion })
    .where(eq(knowledgeDocuments.id, documentId));
  await recordAuditEvent(db, ctx, 'knowledge.updated', { documentId, version: nextVersion });
  return nextVersion;
}

export interface NewRule {
  category: string;
  instruction: string;
  condition?: RuleCondition;
  scopeType: RuleScope;
  scopeValue?: string;
  priority?: number;
  riskLevel?: 'low' | 'medium' | 'high';
  creationSource?: string;
  effectiveFrom?: Date;
  effectiveUntil?: Date;
}

export async function createRule(db: Database, ctx: TenantContext, input: NewRule) {
  const condition = ruleConditionSchema.parse(input.condition ?? {});
  const [rule] = await db
    .insert(rules)
    .values({
      organizationId: ctx.organizationId,
      category: input.category,
      scopeType: input.scopeType,
      scopeValue: input.scopeValue ?? null,
      priority: input.priority ?? 100,
      riskLevel: input.riskLevel ?? 'low',
      creationSource: input.creationSource ?? 'human',
    })
    .returning();
  await db.insert(ruleVersions).values({
    ruleId: rule!.id,
    version: 1,
    instruction: input.instruction,
    condition,
    effectiveFrom: input.effectiveFrom ?? null,
    effectiveUntil: input.effectiveUntil ?? null,
  });
  await recordAuditEvent(db, ctx, 'rule.created', {
    ruleId: rule!.id,
    scopeType: input.scopeType,
  });
  return rule!;
}

/** New immutable version + pointer bump (modification path; audited). */
export async function addRuleVersion(
  db: Database,
  ctx: TenantContext,
  ruleId: string,
  input: { instruction: string; condition?: RuleCondition },
) {
  const [rule] = await db
    .select()
    .from(rules)
    .where(and(eq(rules.id, ruleId), eq(rules.organizationId, ctx.organizationId)));
  if (!rule) throw new Error('Rule not found in organization');
  const nextVersion = rule.currentVersion + 1;
  await db.insert(ruleVersions).values({
    ruleId,
    version: nextVersion,
    instruction: input.instruction,
    condition: ruleConditionSchema.parse(input.condition ?? {}),
  });
  await db.update(rules).set({ currentVersion: nextVersion }).where(eq(rules.id, ruleId));
  await recordAuditEvent(db, ctx, 'rule.versioned', { ruleId, version: nextVersion });
  return nextVersion;
}

export async function setRuleStatus(
  db: Database,
  ctx: TenantContext,
  ruleId: string,
  status: 'active' | 'rejected' | 'rolled_back' | 'retired',
) {
  await db
    .update(rules)
    .set({ status })
    .where(and(eq(rules.id, ruleId), eq(rules.organizationId, ctx.organizationId)));
  await recordAuditEvent(db, ctx, 'rule.status_changed', { ruleId, status });
}

/**
 * Roll a rule back to its previous version (or mark rolled_back at v1).
 * Rolled-back rules stop affecting drafting immediately.
 */
export async function rollbackRule(db: Database, ctx: TenantContext, ruleId: string) {
  const [rule] = await db
    .select()
    .from(rules)
    .where(and(eq(rules.id, ruleId), eq(rules.organizationId, ctx.organizationId)));
  if (!rule) throw new Error('Rule not found in organization');
  if (rule.currentVersion > 1) {
    await db
      .update(rules)
      .set({ currentVersion: rule.currentVersion - 1 })
      .where(eq(rules.id, ruleId));
    await recordAuditEvent(db, ctx, 'rule.rolled_back', {
      ruleId,
      restoredVersion: rule.currentVersion - 1,
    });
  } else {
    await setRuleStatus(db, ctx, ruleId, 'rolled_back');
  }
}
