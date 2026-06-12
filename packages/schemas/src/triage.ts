import { z } from 'zod';

/**
 * Triage classification contract (BUILD_BRIEF §3 / §10.1). AI output is
 * untrusted until it validates against this schema; invalid output is
 * rejected whole and never stored or acted on.
 *
 * The §3 contextual dimensions are modeled explicitly and must never be
 * silently narrowed.
 */

export const MESSAGE_TYPES = [
  'information_request',
  'action_request',
  'mixed_information_action',
  'acknowledgment_only',
  'scheduling_request',
  'decision_request',
  'no_response_required',
] as const;
export type MessageType = (typeof MESSAGE_TYPES)[number];

export const RELATIONSHIP_VALUES = [
  'client',
  'vendor',
  'team',
  'executive',
  'prospect',
  'family',
  'friend',
  'unknown',
] as const;

export const relationshipSchema = z.object({
  value: z.enum(RELATIONSHIP_VALUES),
  source: z.enum(['confirmed', 'inferred']),
});

export const triageResultSchema = z
  .object({
    needsReply: z.boolean(),
    messageTypes: z.array(z.enum(MESSAGE_TYPES)).min(1),
    relationship: relationshipSchema,
    isGroupThread: z.boolean(),
    isInternal: z.boolean(),
    requestedActions: z.array(z.string()).default([]),
    questionsAsked: z.array(z.string()).default([]),
    deadlines: z.array(z.string()).default([]),
    uncertainties: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type TriageResult = z.infer<typeof triageResultSchema>;

/** Deterministic prefilter outcomes — recorded so exclusions are auditable. */
export const EXCLUSION_REASONS = [
  'spam_or_trash',
  'self_sent',
  'no_reply_sender',
  'bulk_or_list',
  'calendar_or_system',
  'already_processed',
] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export const TRIAGE_STATUSES = ['classified', 'manual_review', 'excluded', 'failed'] as const;
export type TriageStatus = (typeof TRIAGE_STATUSES)[number];

/** Below this confidence a classification routes to manual review. */
export const TRIAGE_CONFIDENCE_THRESHOLD = 0.7;
