import { createOrganization, jobAttempts, jobs } from '@echoloop/database';
import { backoffMs, claim, complete, enqueue, fail } from '@echoloop/jobs';
import { createTestDb } from '@echoloop/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('durable job queue', () => {
  let harness: Awaited<ReturnType<typeof createTestDb>>;
  let orgId: string;

  beforeEach(async () => {
    harness = await createTestDb();
    orgId = (await createOrganization(harness.db, 'Org')).id;
  });
  afterEach(async () => {
    await harness.close();
  });

  it('enqueue is idempotent by idempotency key', async () => {
    const ctx = { organizationId: orgId };
    const a = await enqueue(harness.db, ctx, { type: 'sync', idempotencyKey: 'evt-1' });
    const b = await enqueue(harness.db, ctx, { type: 'sync', idempotencyKey: 'evt-1' });
    expect(b.id).toBe(a.id);

    const all = await harness.db.select().from(jobs);
    expect(all).toHaveLength(1);
  });

  it('claims a job once, then returns null (no double claim)', async () => {
    const ctx = { organizationId: orgId };
    await enqueue(harness.db, ctx, { type: 'sync' });

    const first = await claim(harness.db, 'worker-1');
    expect(first?.status).toBe('claimed');
    expect(first?.attempts).toBe(1);

    const second = await claim(harness.db, 'worker-2');
    expect(second).toBeNull();
  });

  it('does not claim jobs scheduled in the future', async () => {
    const ctx = { organizationId: orgId };
    await enqueue(harness.db, ctx, { type: 'later', runAt: new Date(Date.now() + 60_000) });
    expect(await claim(harness.db, 'worker-1')).toBeNull();
  });

  it('completing records a successful attempt', async () => {
    const ctx = { organizationId: orgId };
    await enqueue(harness.db, ctx, { type: 'sync' });
    const job = await claim(harness.db, 'worker-1');
    await complete(harness.db, job!);

    const [row] = await harness.db.select().from(jobs).where(eq(jobs.id, job!.id));
    expect(row!.status).toBe('completed');
    const attempts = await harness.db
      .select()
      .from(jobAttempts)
      .where(eq(jobAttempts.jobId, job!.id));
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!.succeeded).toBe(true);
  });

  it('failing reschedules with backoff until max attempts, then dead-letters', async () => {
    const ctx = { organizationId: orgId };
    await enqueue(harness.db, ctx, { type: 'flaky', maxAttempts: 2 });

    const a = await claim(harness.db, 'w');
    const r1 = await fail(harness.db, a!, 'boom');
    expect(r1.deadLettered).toBe(false);

    // Make it due again, then exhaust attempts.
    await harness.db
      .update(jobs)
      .set({ runAt: new Date(0) })
      .where(eq(jobs.id, a!.id));
    const b = await claim(harness.db, 'w');
    expect(b?.attempts).toBe(2);
    const r2 = await fail(harness.db, b!, 'boom again');
    expect(r2.deadLettered).toBe(true);

    const [row] = await harness.db.select().from(jobs).where(eq(jobs.id, a!.id));
    expect(row!.status).toBe('dead');
  });

  it('computes exponential backoff', () => {
    expect(backoffMs(1, 1000)).toBe(1000);
    expect(backoffMs(2, 1000)).toBe(2000);
    expect(backoffMs(3, 1000)).toBe(4000);
  });
});
