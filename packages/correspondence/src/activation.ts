import {
  type Database,
  type TenantContext,
  allowlistEntries,
  generatedDrafts,
  recordAuditEvent,
} from '@echoloop/database';
import { parseEnv } from '@echoloop/schemas';
import { and, eq, gte } from 'drizzle-orm';
import { count } from 'drizzle-orm';

/**
 * Safe activation policy (BUILD_BRIEF §9). Drafting requires EVERY gate to
 * pass: global kill switch off, account kill switch off, activation mode
 * permits the message (allowlist match in `allowlist` mode), and rate limits
 * not exceeded. Failing any gate blocks the Gmail write — silently safe.
 */

export type ActivationDecision =
  | { allowed: true }
  | {
      allowed: false;
      reason:
        | 'global_kill_switch'
        | 'account_kill_switch'
        | 'mode_disabled'
        | 'mode_dry_run'
        | 'not_allowlisted'
        | 'rate_limited_hour'
        | 'rate_limited_cycle';
    };

export interface ActivationInput {
  accountId: string;
  accountDraftingPaused: boolean;
  senderAddress: string | null;
  gmailLabels: string[];
  providerThreadId: string;
  providerMessageId: string;
  /** Drafts already created in the current worker cycle. */
  draftsThisCycle: number;
}

export interface AllowlistInput {
  kind: 'sender_email' | 'sender_domain' | 'gmail_label' | 'thread' | 'message';
  value: string;
}

export async function addAllowlistEntry(
  db: Database,
  ctx: TenantContext,
  accountId: string,
  entry: AllowlistInput,
) {
  const [row] = await db
    .insert(allowlistEntries)
    .values({
      organizationId: ctx.organizationId,
      emailAccountId: accountId,
      kind: entry.kind,
      value: entry.value.toLowerCase(),
    })
    .returning();
  await recordAuditEvent(db, ctx, 'allowlist.added', { kind: entry.kind });
  return row!;
}

export function allowlistMatches(
  entries: { kind: string; value: string }[],
  input: Pick<
    ActivationInput,
    'senderAddress' | 'gmailLabels' | 'providerThreadId' | 'providerMessageId'
  >,
): boolean {
  const sender = input.senderAddress?.toLowerCase() ?? '';
  const domain = sender.split('@')[1] ?? '';
  const labels = input.gmailLabels.map((l) => l.toLowerCase());
  return entries.some((entry) => {
    switch (entry.kind) {
      case 'sender_email':
        return entry.value === sender;
      case 'sender_domain':
        return entry.value === domain;
      case 'gmail_label':
        return labels.includes(entry.value);
      case 'thread':
        return entry.value === input.providerThreadId.toLowerCase();
      case 'message':
        return entry.value === input.providerMessageId.toLowerCase();
      default:
        return false;
    }
  });
}

export async function decideActivation(
  db: Database,
  ctx: TenantContext,
  input: ActivationInput,
  env = parseEnv(),
): Promise<ActivationDecision> {
  if (env.ECHOLOOP_DRAFTING_KILL_SWITCH) return { allowed: false, reason: 'global_kill_switch' };
  if (input.accountDraftingPaused) return { allowed: false, reason: 'account_kill_switch' };

  const mode = env.ECHOLOOP_ACTIVATION_MODE;
  if (mode === 'disabled') return { allowed: false, reason: 'mode_disabled' };
  if (mode === 'dry_run') return { allowed: false, reason: 'mode_dry_run' };
  if (mode === 'allowlist') {
    const entries = await db
      .select()
      .from(allowlistEntries)
      .where(
        and(
          eq(allowlistEntries.organizationId, ctx.organizationId),
          eq(allowlistEntries.emailAccountId, input.accountId),
        ),
      );
    if (!allowlistMatches(entries, input)) {
      return { allowed: false, reason: 'not_allowlisted' };
    }
  }

  if (input.draftsThisCycle >= env.ECHOLOOP_MAX_DRAFTS_PER_CYCLE) {
    return { allowed: false, reason: 'rate_limited_cycle' };
  }
  const hourAgo = new Date(Date.now() - 3600_000);
  const counted = await db
    .select({ value: count() })
    .from(generatedDrafts)
    .where(
      and(
        eq(generatedDrafts.organizationId, ctx.organizationId),
        eq(generatedDrafts.status, 'drafted'),
        gte(generatedDrafts.createdAt, hourAgo),
      ),
    );
  if (Number(counted[0]?.value ?? 0) >= env.ECHOLOOP_MAX_DRAFTS_PER_HOUR) {
    return { allowed: false, reason: 'rate_limited_hour' };
  }

  return { allowed: true };
}
