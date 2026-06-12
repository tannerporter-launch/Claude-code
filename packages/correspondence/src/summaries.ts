import { type Database, type TenantContext, emailMessages } from '@echoloop/database';
import { and, desc, eq } from 'drizzle-orm';

/**
 * Phase 2 acceptance helper: the last N eligible inbound message summaries.
 * "Eligible" here is the deterministic Phase 2 notion only — inbound, not
 * spam/trash, not a draft. Full triage classification is Phase 3.
 */

export interface MessageSummary {
  id: string;
  subject: string | null;
  snippet: string | null;
  internalDate: Date;
}

const EXCLUDED_LABELS = new Set(['SPAM', 'TRASH', 'DRAFT']);

export async function listRecentEligibleSummaries(
  db: Database,
  ctx: TenantContext,
  accountId: string,
  limit = 10,
): Promise<MessageSummary[]> {
  const rows = await db
    .select()
    .from(emailMessages)
    .where(
      and(
        eq(emailMessages.organizationId, ctx.organizationId),
        eq(emailMessages.emailAccountId, accountId),
        eq(emailMessages.direction, 'inbound'),
      ),
    )
    .orderBy(desc(emailMessages.internalDate))
    .limit(limit * 3);

  return rows
    .filter((row) => {
      const labels = (row.labels as string[]) ?? [];
      return !labels.some((label) => EXCLUDED_LABELS.has(label));
    })
    .slice(0, limit)
    .map((row) => ({
      id: row.id,
      subject: row.subject,
      snippet: row.snippet,
      internalDate: row.internalDate,
    }));
}
