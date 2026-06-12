import { and, eq, sql } from 'drizzle-orm';
import { type Database, type TenantContext, jobAttempts, jobs } from '@echoloop/database';

/**
 * A durable, database-backed job queue built on the `jobs` / `job_attempts`
 * tables. Claiming uses `FOR UPDATE SKIP LOCKED` so concurrent workers never
 * claim the same job. Enqueue is idempotent when an idempotency key is given
 * (enforced by a unique constraint), so duplicate Gmail events or retried
 * enqueues do not create duplicate work.
 */

export type Job = typeof jobs.$inferSelect;

export interface EnqueueInput {
  type: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
  runAt?: Date;
  maxAttempts?: number;
}

export async function enqueue(db: Database, ctx: TenantContext, input: EnqueueInput): Promise<Job> {
  const values = {
    organizationId: ctx.organizationId,
    type: input.type,
    payload: input.payload ?? {},
    idempotencyKey: input.idempotencyKey ?? null,
    runAt: input.runAt ?? new Date(),
    maxAttempts: input.maxAttempts ?? 5,
  };

  if (input.idempotencyKey) {
    const inserted = await db
      .insert(jobs)
      .values(values)
      .onConflictDoNothing({ target: [jobs.organizationId, jobs.idempotencyKey] })
      .returning();
    if (inserted[0]) return inserted[0];

    const existing = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.organizationId, ctx.organizationId),
          eq(jobs.idempotencyKey, input.idempotencyKey),
        ),
      );
    return existing[0]!;
  }

  const [row] = await db.insert(jobs).values(values).returning();
  return row!;
}

/**
 * Atomically claim the next due job. Returns null when none are available.
 * The claim increments attempts and records the lock holder in one statement.
 */
export async function claim(db: Database, workerId: string): Promise<Job | null> {
  const result = await db.execute(sql`
    UPDATE jobs SET
      status = 'claimed',
      locked_by = ${workerId},
      locked_at = now(),
      attempts = attempts + 1,
      updated_at = now()
    WHERE id = (
      SELECT id FROM jobs
      WHERE status = 'pending' AND run_at <= now()
      ORDER BY run_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id
  `);

  const rows = (result as unknown as { rows: Array<{ id: string }> }).rows;
  const id = rows[0]?.id;
  if (!id) return null;

  const claimed = await db.select().from(jobs).where(eq(jobs.id, id));
  return claimed[0] ?? null;
}

export async function complete(db: Database, job: Job): Promise<void> {
  await db
    .update(jobs)
    .set({ status: 'completed', updatedAt: new Date() })
    .where(eq(jobs.id, job.id));
  await db.insert(jobAttempts).values({ jobId: job.id, attempt: job.attempts, succeeded: true });
}

export interface FailResult {
  deadLettered: boolean;
}

/** Exponential backoff in milliseconds for the given attempt number. */
export function backoffMs(attempt: number, baseMs = 1000): number {
  return baseMs * 2 ** Math.max(0, attempt - 1);
}

export async function fail(db: Database, job: Job, error: string): Promise<FailResult> {
  const deadLettered = job.attempts >= job.maxAttempts;

  if (deadLettered) {
    await db
      .update(jobs)
      .set({ status: 'dead', lastError: error, updatedAt: new Date() })
      .where(eq(jobs.id, job.id));
  } else {
    await db
      .update(jobs)
      .set({
        status: 'pending',
        lastError: error,
        lockedBy: null,
        lockedAt: null,
        runAt: new Date(Date.now() + backoffMs(job.attempts)),
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, job.id));
  }

  await db
    .insert(jobAttempts)
    .values({ jobId: job.id, attempt: job.attempts, succeeded: false, error });

  return { deadLettered };
}
