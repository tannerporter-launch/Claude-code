import { redact } from '@echoloop/security';
import type { Database } from './client.js';
import type { TenantContext } from './repositories.js';
import { auditEvents } from './schema.js';

/**
 * Append-only audit trail. Detail is redacted before storage so raw bodies,
 * tokens, addresses, and prompts can never leak into audit records.
 */
export async function recordAuditEvent(
  db: Database,
  ctx: TenantContext,
  action: string,
  detail: Record<string, unknown> = {},
  actorUserId?: string,
) {
  const safeDetail = redact(detail) as Record<string, unknown>;
  const [row] = await db
    .insert(auditEvents)
    .values({
      organizationId: ctx.organizationId,
      actorUserId: actorUserId ?? null,
      action,
      detail: safeDetail,
    })
    .returning();
  return row!;
}
