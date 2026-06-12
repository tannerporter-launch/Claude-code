/**
 * Shared identifier and enum contracts used across packages. Kept minimal in
 * Phase 1 and extended additively as later phases introduce their tables.
 */

export const ACTIVATION_MODES = ['disabled', 'dry_run', 'allowlist', 'enabled'] as const;
export type ActivationMode = (typeof ACTIVATION_MODES)[number];

export const JOB_STATUSES = ['pending', 'claimed', 'completed', 'failed', 'dead'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const AUDIT_ACTIONS = [
  'seed.loaded',
  'job.enqueued',
  'job.claimed',
  'job.completed',
  'job.failed',
  'job.dead_lettered',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];
