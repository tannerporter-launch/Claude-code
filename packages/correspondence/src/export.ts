import {
  type Database,
  type TenantContext,
  knowledgeDocumentVersions,
  knowledgeDocuments,
  ruleVersions,
  rules,
} from '@echoloop/database';
import { and, eq } from 'drizzle-orm';

/**
 * Human-readable playbook export (BUILD_BRIEF §6.2). Exports are snapshots,
 * not authoritative sources; the database remains canonical.
 */

export interface PlaybookExport {
  exportedAt: string;
  knowledge: {
    id: string;
    category: string;
    title: string;
    version: number;
    content: string;
    effectiveFrom: string | null;
    effectiveUntil: string | null;
  }[];
  rules: {
    id: string;
    category: string;
    scopeType: string;
    scopeValue: string | null;
    priority: number;
    riskLevel: string;
    version: number;
    instruction: string;
    condition: unknown;
  }[];
}

export async function exportPlaybook(db: Database, ctx: TenantContext): Promise<PlaybookExport> {
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

  const activeRules = await db
    .select()
    .from(rules)
    .innerJoin(
      ruleVersions,
      and(eq(ruleVersions.ruleId, rules.id), eq(ruleVersions.version, rules.currentVersion)),
    )
    .where(and(eq(rules.organizationId, ctx.organizationId), eq(rules.status, 'active')));

  return {
    exportedAt: new Date().toISOString(),
    knowledge: docs.map((row) => ({
      id: row.knowledge_documents.id,
      category: row.knowledge_documents.category,
      title: row.knowledge_documents.title,
      version: row.knowledge_documents.currentVersion,
      content: row.knowledge_document_versions.content,
      effectiveFrom: row.knowledge_documents.effectiveFrom?.toISOString() ?? null,
      effectiveUntil: row.knowledge_documents.effectiveUntil?.toISOString() ?? null,
    })),
    rules: activeRules.map((row) => ({
      id: row.rules.id,
      category: row.rules.category,
      scopeType: row.rules.scopeType,
      scopeValue: row.rules.scopeValue,
      priority: row.rules.priority,
      riskLevel: row.rules.riskLevel,
      version: row.rules.currentVersion,
      instruction: row.rule_versions.instruction,
      condition: row.rule_versions.condition,
    })),
  };
}

export function playbookToMarkdown(playbook: PlaybookExport): string {
  const lines = [
    '# EchoLoop Playbook (snapshot)',
    `Exported: ${playbook.exportedAt}`,
    '',
    '## Knowledge',
  ];
  if (playbook.knowledge.length === 0) lines.push('_Empty — nothing approved yet._');
  for (const doc of playbook.knowledge) {
    lines.push(`### [${doc.category}] ${doc.title} (v${doc.version})`, doc.content, '');
  }
  lines.push('## Rules');
  if (playbook.rules.length === 0) lines.push('_Empty — no active rules._');
  for (const rule of playbook.rules) {
    lines.push(
      `- (${rule.scopeType}${rule.scopeValue ? `: ${rule.scopeValue}` : ''}, ` +
        `priority ${rule.priority}, risk ${rule.riskLevel}, v${rule.version}) ${rule.instruction}`,
    );
  }
  return lines.join('\n');
}
