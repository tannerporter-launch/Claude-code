import { auditEvents, emailAccounts, organizations } from '@echoloop/database';
import { generateEncryptionKey } from '@echoloop/security';
import { createTestDb, seed } from '@echoloop/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('migrations and seed', () => {
  let harness: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    harness = await createTestDb();
  });
  afterEach(async () => {
    await harness.close();
  });

  it('migrates an empty database (tables queryable)', async () => {
    // If migrations did not run, selecting from these tables would throw.
    expect(await harness.db.select().from(organizations)).toEqual([]);
    expect(await harness.db.select().from(emailAccounts)).toEqual([]);
  });

  it('loads synthetic seed data with encrypted tokens', async () => {
    const result = await seed(harness.db, generateEncryptionKey());
    expect(result.organizationId).toBeTruthy();

    const accounts = await harness.db
      .select()
      .from(emailAccounts)
      .where(eq(emailAccounts.id, result.emailAccountId));
    expect(accounts).toHaveLength(1);
    // Stored token is ciphertext, never plaintext.
    expect(accounts[0]!.encryptedAccessToken).toContain('v1:');
    expect(accounts[0]!.encryptedAccessToken).not.toContain('synthetic-access-token');

    const audits = await harness.db.select().from(auditEvents);
    expect(audits.some((a) => a.action === 'seed.loaded')).toBe(true);
  });
});
