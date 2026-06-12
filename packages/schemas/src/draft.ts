import { z } from 'zod';
import { MESSAGE_TYPES, relationshipSchema } from './triage.js';

/**
 * Draft-generation contract (BUILD_BRIEF §10.3). AI output is untrusted until
 * it validates against this schema; invalid output creates no preview and no
 * draft. factsUsed/rulesUsed must reference records included in the context
 * snapshot — anything else is an unsupported claim and blocks the draft.
 */

export const REPLY_MODES = ['reply', 'reply_all'] as const;
export type ReplyMode = (typeof REPLY_MODES)[number];

export const draftResponseSchema = z
  .object({
    shouldDraft: z.boolean(),
    messageTypes: z.array(z.enum(MESSAGE_TYPES)).min(1),
    relationship: relationshipSchema,
    replyMode: z.enum(REPLY_MODES),
    subject: z.string(),
    bodyText: z.string(),
    questionsAnswered: z.array(z.string()).default([]),
    requestedActions: z.array(z.string()).default([]),
    commitmentsMade: z.array(z.string()).default([]),
    factsUsed: z.array(z.string()).default([]),
    rulesUsed: z.array(z.string()).default([]),
    uncertainties: z.array(z.string()).default([]),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export type DraftResponse = z.infer<typeof draftResponseSchema>;

export const GENERATION_STATUSES = [
  'completed',
  'declined',
  'failed_validation',
  'failed_provider',
  'blocked_policy',
] as const;
export type GenerationStatus = (typeof GENERATION_STATUSES)[number];
