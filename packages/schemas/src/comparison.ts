import { z } from 'zod';

/**
 * Comparison and learning contracts (BUILD_BRIEF §10.6–§10.7).
 */

export const SEMANTIC_CHANGE_CATEGORIES = [
  'tone',
  'brevity',
  'formality',
  'warmth',
  'directness',
  'structure',
  'greeting',
  'signoff',
  'formatting',
  'relationship_handling',
  'added_factual_information',
  'corrected_factual_information',
  'removed_unsupported_claim',
  'changed_intent',
  'changed_commitment',
  'changed_deadline',
  'changed_requested_action',
  'scheduling_correction',
  'privacy_correction',
  'recipient_correction',
  'one_time_situational',
  'unknown',
] as const;
export type SemanticChangeCategory = (typeof SEMANTIC_CHANGE_CATEGORIES)[number];

/** Categories that route to KNOWLEDGE review — never to style rules. */
export const FACTUAL_CATEGORIES: SemanticChangeCategory[] = [
  'added_factual_information',
  'corrected_factual_information',
  'removed_unsupported_claim',
];

/** Categories that are commitment/intent changes — classified distinctly. */
export const COMMITMENT_CATEGORIES: SemanticChangeCategory[] = [
  'changed_commitment',
  'changed_deadline',
  'changed_requested_action',
];

/** Style categories eligible for repeated-pattern rule proposals. */
export const STYLE_CATEGORIES: SemanticChangeCategory[] = [
  'tone',
  'brevity',
  'formality',
  'warmth',
  'directness',
  'structure',
  'greeting',
  'signoff',
  'formatting',
];

export const semanticComparisonSchema = z
  .object({
    categories: z.array(z.enum(SEMANTIC_CHANGE_CATEGORIES)).min(1),
    summary: z.string(),
    isOneTimeSituational: z.boolean(),
    factualCorrectionDetail: z.string().nullable().default(null),
  })
  .strict();
export type SemanticComparison = z.infer<typeof semanticComparisonSchema>;

export const PROPOSAL_TYPES = [
  'new_style_rule',
  'modify_style_rule',
  'narrow_rule_scope',
  'broaden_rule_scope',
  'add_contact_guidance',
  'add_terminology',
  'add_approved_fact',
  'correct_approved_fact',
  'add_temporary_emphasis',
  'mark_one_time_exception',
  'merge_duplicate_rules',
  'retire_rule',
] as const;
export type ProposalType = (typeof PROPOSAL_TYPES)[number];

export const PROPOSAL_STATUSES = ['pending', 'approved', 'rejected', 'deferred'] as const;

/** Minimum supporting comparisons before a STYLE proposal is raised. */
export const STYLE_EVIDENCE_THRESHOLD = 3;
