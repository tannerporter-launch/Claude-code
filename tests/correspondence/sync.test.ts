import {
  connectAccount,
  getCheckpoint,
  listRecentEligibleSummaries,
  revokeAccount,
  syncMailbox,
} from '@echoloop/correspondence';
import { auditEvents, emailAccounts, emailMessages, mailboxEvents } from '@echoloop/database';
import { MockGmailProvider } from '@echoloop/gmail';
import { createEncryptionService, generateEncryptionKey } from '@echoloop/security';
import { createTestDb, seed } from '@echoloop/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Phase 2 acceptance suite — entirely on the MOCK Gmail provider
 * (BUILD_BRIEF Phase 2: all automated tests use mocks).
 */
describe('gmail read-only sync (mock provider)', () => {
  let harness: Awaited<ReturnType<typeof createTestDb>>;
  let provider: MockGmailProvider;
  let enc: ReturnType<typeof createEncryptionService>;
  let ctx: { organizationId: string };
  let accountId: string;

  const tokens = {
    accessToken: 'synthetic-access',
    refreshToken: 'synthetic-refresh',
    expiryDate: new Date(Date.now() + 3600_000),
  };

  beforeEach(async () => {
    harness = await createTestDb();
    enc = createEncryptionService(generateEncryptionKey());
    const seeded = await seed(harness.db, generateEncryptionKey());
    ctx = { organizationId: seeded.organizationId };
    accountId = seeded.emailAccountId;
    provider = new MockGmailProvider();
    provider.setProfile('pilot@example.test', '1000');
  });
  afterEach(async () => {
    await harness.close();
  });

  async function connect() {
    return connectAccount(harness.db, ctx, accountId, provider, tokens, enc);
  }

  it('connects: encrypted tokens stored, baseline cursor captured, no history imported', async () => {
    const result = await connect();
    expect(result.baselineHistoryId).toBe('1000');

    const [account] = await harness.db
      .select()
      .from(emailAccounts)
      .where(eq(emailAccounts.id, accountId));
    expect(account!.status).toBe('connected');
    expect(account!.encryptedRefreshToken).toContain('v1:');
    expect(account!.encryptedRefreshToken).not.toContain('synthetic-refresh');
    expect(enc.decrypt(account!.encryptedRefreshToken!)).toBe('synthetic-refresh');

    expect(await getCheckpoint(harness.db, accountId, 'inbox')).toBe('1000');
    // Baseline imports nothing (no historical drafting, no historical messages).
    expect(await harness.db.select().from(emailMessages)).toEqual([]);
  });

  it('incremental sync persists new messages with encrypted bodies', async () => {
    await connect();
    provider.addMessage({
      id: 'm1',
      threadId: 't1',
      from: 'client@example.test',
      subject: 'Quick question',
      bodyText: 'What is the timeline?',
    });
    provider.queueHistoryPage(
      [{ historyId: '1001', type: 'messageAdded', message: { id: 'm1', threadId: 't1' } }],
      '1001',
    );

    const outcome = await syncMailbox(harness.db, ctx, accountId, provider, enc);
    expect(outcome).toMatchObject({ status: 'synced', newMessages: 1, cursor: '1001' });

    const messages = await harness.db.select().from(emailMessages);
    expect(messages).toHaveLength(1);
    expect(messages[0]!.direction).toBe('inbound');
    expect(messages[0]!.bodyTextEncrypted).toContain('v1:');
    expect(messages[0]!.bodyTextEncrypted).not.toContain('timeline');
    expect(await getCheckpoint(harness.db, accountId, 'inbox')).toBe('1001');
  });

  it('duplicate history events are idempotent (no duplicate records)', async () => {
    await connect();
    provider.addMessage({ id: 'm1', threadId: 't1', bodyText: 'hello' });
    const event = {
      historyId: '1001',
      type: 'messageAdded' as const,
      message: { id: 'm1', threadId: 't1' },
    };
    // Same event delivered twice within a page AND across two sync runs.
    provider.queueHistoryPage([event, event], '1001');
    await syncMailbox(harness.db, ctx, accountId, provider, enc);
    provider.queueHistoryPage([event], '1002');
    await syncMailbox(harness.db, ctx, accountId, provider, enc);

    expect(await harness.db.select().from(emailMessages)).toHaveLength(1);
    expect(await harness.db.select().from(mailboxEvents)).toHaveLength(1);
  });

  it('processes all pages and advances the cursor only at the end', async () => {
    await connect();
    provider.addMessage({ id: 'm1', threadId: 't1', bodyText: 'a' });
    provider.addMessage({ id: 'm2', threadId: 't2', bodyText: 'b' });
    provider.queueHistoryPage(
      [{ historyId: '1001', type: 'messageAdded', message: { id: 'm1', threadId: 't1' } }],
      '1001',
      'page2',
    );
    provider.queueHistoryPage(
      [{ historyId: '1002', type: 'messageAdded', message: { id: 'm2', threadId: 't2' } }],
      '1002',
    );

    const outcome = await syncMailbox(harness.db, ctx, accountId, provider, enc);
    expect(outcome).toMatchObject({ status: 'synced', newMessages: 2, cursor: '1002' });
  });

  it('invalid history cursor triggers controlled recovery (re-baseline, audited)', async () => {
    await connect();
    provider.simulateInvalidCursorOnce();
    provider.setProfile('pilot@example.test', '2000');

    const outcome = await syncMailbox(harness.db, ctx, accountId, provider, enc);
    expect(outcome).toMatchObject({ status: 'recovered', cursor: '2000' });
    expect(await getCheckpoint(harness.db, accountId, 'inbox')).toBe('2000');
    expect(await harness.db.select().from(emailMessages)).toEqual([]);

    const audits = await harness.db.select().from(auditEvents);
    expect(audits.some((a) => a.action === 'gmail.sync_recovered')).toBe(true);
  });

  it('expired refresh token → clean reconnect_required state, not a crash (7-day Testing expiry)', async () => {
    await connect();
    provider.simulateInvalidGrant();

    const outcome = await syncMailbox(harness.db, ctx, accountId, provider, enc);
    expect(outcome).toEqual({ status: 'reconnect_required' });

    const [account] = await harness.db
      .select()
      .from(emailAccounts)
      .where(eq(emailAccounts.id, accountId));
    expect(account!.status).toBe('reconnect_required');

    const audits = await harness.db.select().from(auditEvents);
    expect(audits.some((a) => a.action === 'gmail.reconnect_required')).toBe(true);

    // Subsequent syncs skip cleanly until the user re-consents.
    const next = await syncMailbox(harness.db, ctx, accountId, provider, enc);
    expect(next).toMatchObject({ status: 'skipped' });
  });

  it('reconnect after expiry restores syncing', async () => {
    await connect();
    provider.simulateInvalidGrant();
    await syncMailbox(harness.db, ctx, accountId, provider, enc);

    // User re-runs the connect flow → fresh provider/tokens.
    const fresh = new MockGmailProvider();
    fresh.setProfile('pilot@example.test', '3000');
    await connectAccount(harness.db, ctx, accountId, fresh, tokens, enc);

    const outcome = await syncMailbox(harness.db, ctx, accountId, fresh, enc);
    expect(outcome).toMatchObject({ status: 'synced' });
  });

  it('revocation clears tokens and stops synchronization', async () => {
    await connect();
    await revokeAccount(harness.db, ctx, accountId, provider);

    const [account] = await harness.db
      .select()
      .from(emailAccounts)
      .where(eq(emailAccounts.id, accountId));
    expect(account!.status).toBe('revoked');
    expect(account!.encryptedRefreshToken).toBeNull();

    const outcome = await syncMailbox(harness.db, ctx, accountId, provider, enc);
    expect(outcome).toMatchObject({ status: 'skipped' });
  });

  it('lists the last ten eligible inbound summaries (spam/self-sent excluded)', async () => {
    await connect();
    const events = [];
    for (let i = 1; i <= 12; i++) {
      provider.addMessage({
        id: `m${i}`,
        threadId: `t${i}`,
        subject: `Message ${i}`,
        bodyText: `body ${i}`,
        internalDate: 1700000000000 + i * 1000,
      });
      events.push({
        historyId: `10${String(i).padStart(2, '0')}`,
        type: 'messageAdded' as const,
        message: { id: `m${i}`, threadId: `t${i}` },
      });
    }
    provider.addMessage({
      id: 'spam1',
      threadId: 'ts',
      labelIds: ['SPAM'],
      subject: 'Spam',
      internalDate: 1700000099000,
    });
    provider.addMessage({
      id: 'self1',
      threadId: 'tself',
      from: 'pilot+alias@example.test',
      subject: 'Self sent',
      internalDate: 1700000098000,
    });
    events.push(
      {
        historyId: '1099',
        type: 'messageAdded' as const,
        message: { id: 'spam1', threadId: 'ts' },
      },
      {
        historyId: '1098',
        type: 'messageAdded' as const,
        message: { id: 'self1', threadId: 'tself' },
      },
    );
    provider.queueHistoryPage(events, '1100');
    await syncMailbox(harness.db, ctx, accountId, provider, enc);

    const summaries = await listRecentEligibleSummaries(harness.db, ctx, accountId, 10);
    expect(summaries).toHaveLength(10);
    const subjects = summaries.map((s) => s.subject);
    expect(subjects).not.toContain('Spam');
    expect(subjects).not.toContain('Self sent');
    // Newest first.
    expect(subjects[0]).toBe('Message 12');
  });

  it('INVARIANT: sync performs zero Gmail write operations', async () => {
    await connect();
    provider.addMessage({ id: 'm1', threadId: 't1', bodyText: 'x' });
    provider.queueHistoryPage(
      [{ historyId: '1001', type: 'messageAdded', message: { id: 'm1', threadId: 't1' } }],
      '1001',
    );
    await syncMailbox(harness.db, ctx, accountId, provider, enc);
    expect(provider.writeOps()).toEqual([]);
  });
});
