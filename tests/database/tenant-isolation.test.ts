import {
  auditEvents,
  createOrganization,
  createTenantRepository,
  createUser,
  recordAuditEvent,
} from '@echoloop/database';
import { createTestDb } from '@echoloop/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('tenant isolation (fail closed)', () => {
  let harness: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    harness = await createTestDb();
  });
  afterEach(async () => {
    await harness.close();
  });

  it('denies cross-organization reads', async () => {
    const { db } = harness;
    const orgA = await createOrganization(db, 'Org A');
    const orgB = await createOrganization(db, 'Org B');
    const userA = await createUser(db, 'a@example.test');

    const repoA = createTenantRepository(db, { organizationId: orgA.id });
    const account = await repoA.emailAccounts.create({
      userId: userA.id,
      providerEmail: 'a@example.test',
    });

    // Org B's repository must not see org A's row.
    const repoB = createTenantRepository(db, { organizationId: orgB.id });
    expect(await repoB.emailAccounts.getById(account.id)).toBeUndefined();
    expect(await repoB.emailAccounts.list()).toEqual([]);

    // Org A still sees its own row.
    expect((await repoA.emailAccounts.getById(account.id))?.id).toBe(account.id);
  });

  it('writes audit events under the acting organization only', async () => {
    const { db } = harness;
    const orgA = await createOrganization(db, 'Org A');
    const orgB = await createOrganization(db, 'Org B');

    await recordAuditEvent(db, { organizationId: orgA.id }, 'seed.loaded', { ok: true });

    const orgBEvents = await db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, orgB.id));
    expect(orgBEvents).toEqual([]);
  });

  it('redacts sensitive audit detail before storage', async () => {
    const { db } = harness;
    const org = await createOrganization(db, 'Org A');
    await recordAuditEvent(db, { organizationId: org.id }, 'seed.loaded', {
      refreshToken: 'super-secret',
      note: 'fine',
    });

    const events = await db.select().from(auditEvents);
    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain('super-secret');
    expect(serialized).toContain('[REDACTED]');
  });
});
