import { z } from 'zod';

/**
 * Knowledge and rule contracts (BUILD_BRIEF §6). PostgreSQL is authoritative;
 * the user experiences knowledge as editable documents and discrete rules.
 */

export const KNOWLEDGE_CATEGORIES = [
  'approved_fact',
  'terminology',
  'temporary_emphasis',
  'personal_style',
] as const;
export type KnowledgeCategory = (typeof KNOWLEDGE_CATEGORIES)[number];

export const RULE_SCOPES = [
  'user_global',
  'relationship',
  'contact',
  'department',
  'organization',
  'thread_type',
  'temporary_campaign',
] as const;
export type RuleScope = (typeof RULE_SCOPES)[number];

export const RULE_STATUSES = ['active', 'rejected', 'rolled_back', 'retired'] as const;
export type RuleStatus = (typeof RULE_STATUSES)[number];

export const RISK_LEVELS = ['low', 'medium', 'high'] as const;

/** Conditions under which a rule applies. All present fields must match. */
export const ruleConditionSchema = z
  .object({
    relationships: z.array(z.string()).optional(),
    messageTypes: z.array(z.string()).optional(),
    isGroupThread: z.boolean().optional(),
    contactAddress: z.string().optional(),
  })
  .strict();
export type RuleCondition = z.infer<typeof ruleConditionSchema>;

export interface RuleMatchContext {
  relationship: string;
  messageTypes: string[];
  isGroupThread: boolean;
  contactAddress?: string;
}

export function ruleConditionMatches(condition: RuleCondition, context: RuleMatchContext): boolean {
  if (condition.relationships && !condition.relationships.includes(context.relationship)) {
    return false;
  }
  if (
    condition.messageTypes &&
    !condition.messageTypes.some((t) => context.messageTypes.includes(t))
  ) {
    return false;
  }
  if (condition.isGroupThread !== undefined && condition.isGroupThread !== context.isGroupThread) {
    return false;
  }
  if (condition.contactAddress && condition.contactAddress !== context.contactAddress) {
    return false;
  }
  return true;
}
