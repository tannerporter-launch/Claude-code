import { type Database } from '@echoloop/database';
import { type Job, claim, complete, fail } from '@echoloop/jobs';
import { type Logger, createLogger } from '@echoloop/security';

/**
 * @echoloop/worker
 *
 * The durable-job worker. Phase 1 provides the claim/run/complete skeleton only.
 * It performs NO live Gmail sync and NO AI calls — job handlers that do real
 * work are added by later phases. There is no email send path here, ever.
 */
export const APP_NAME = '@echoloop/worker';

export type JobHandler = (job: Job) => Promise<void>;

export interface RunOnceOptions {
  workerId: string;
  handlers: Record<string, JobHandler>;
  logger?: Logger;
}

/**
 * Claim and process a single job, recording success or failure durably.
 * Returns true if a job was processed, false if the queue was empty.
 */
export async function runOnce(db: Database, options: RunOnceOptions): Promise<boolean> {
  const logger = options.logger ?? createLogger({ base: { component: 'worker' } });
  const job = await claim(db, options.workerId);
  if (!job) return false;

  const handler = options.handlers[job.type];
  try {
    if (!handler) {
      throw new Error(`No handler registered for job type "${job.type}"`);
    }
    await handler(job);
    await complete(db, job);
    logger.info('job completed', { jobId: job.id, type: job.type });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const result = await fail(db, job, message);
    logger.warn('job failed', {
      jobId: job.id,
      type: job.type,
      deadLettered: result.deadLettered,
    });
  }
  return true;
}
