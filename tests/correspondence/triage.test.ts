import { MockAiProvider } from '@echoloop/ai';
import {
  connectAccount,
  deterministicExclusion,
  runTriage,
  syncMailbox,
} from '@echoloop/correspondence';
import { auditEvents, messageClassifications } from '@echoloop/database';
import { MockGmailProvider } from '@echoloop/gmail';
import { createEncryptionService, generateEncryptionKey } from '@echoloop/security';
import { createTestDb, seed } from '@echoloop/testing';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';

describe('triage (mock AI + mock Gmail)', () => {
  let harness: Awaited<ReturnType<typeof createTestDb>>;
  let gmail: MockGmailProvider;
  let ai: MockAiProvider;
  let enc: ReturnType<typeof createEncryptionService>;
  let ctx: { organizationId: string };
  let accountId: string;

  const tokens = {
    accessToken: 'a',
    refreshToken: 'r',
    expiryDate: null,
  };

  const validTriage = (confidence: number, needsReply = true, extra: object = {}) => ({
    needsReply,
    messageTypes: ['information_request'],
    relationship: { value: 'client', source: 'inferred' },
    isGroupThread: false,
    isInternal: false,
    confidence,
    ...extra,
  });

  beforeEach(async () => {
    harness = await createTestDb();
    enc = createEncryptionService(generateEncryptionKey());
    const seeded = await seed(harness.db, generateEncryptionKey());
    ctx = { organizationId: seeded.organizationId };
    accountId = seeded.emailAccountId;
    gmail = new MockGmailProvider();
    gmail.setProfile('pilot@example.test', '1000');
    ai = new MockAiProvider();
    await connectAccount(harness.db, ctx, accountId, gmail, tokens, enc);
  });
  afterEach(async () => {
    await harness.close();
  });

  async function ingest(messages: Parameters<MockGmailProvider['addMessage']>[0][]): Promise<void> {
    const events = messages.map((m, i) => {
      gmail.addMessage(m);
      return {
        historyId: `20${String(i).padStart(2, '0')}`,
        type: 'messageAdded' as const,
        message: { id: m.id, threadId: m.threadId },
      };
    });
    gmail.queueHistoryPage(events, '2100');
    await syncMailbox(harness.db, ctx, accountId, gmail, enc);
  }

  it('deterministic prefilters exclude spam, self-sent, no-reply, bulk, calendar', () => {
    const base = {
      labels: ['INBOX'],
      direction: 'inbound',
      fromAddress: 'human@client.test',
      isBulk: false,
      isCalendar: false,
    };
    expect(deterministicExclusion({ ...base, labels: ['SPAM'] })).toBe('spam_or_trash');
    expect(deterministicExclusion({ ...base, direction: 'outbound' })).toBe('self_sent');
    expect(deterministicExclusion({ ...base, fromAddress: 'no-reply@x.test' })).toBe(
      'no_reply_sender',
    );
    expect(deterministicExclusion({ ...base, fromAddress: 'donotreply@x.test' })).toBe(
      'no_reply_sender',
    );
    expect(deterministicExclusion({ ...base, isBulk: true })).toBe('bulk_or_list');
    expect(deterministicExclusion({ ...base, isCalendar: true })).toBe('calendar_or_system');
    expect(deterministicExclusion(base)).toBeNull();
  });

  it('excludes newsletters/no-reply without any model call; classifies a human ask', async () => {
    await ingest([
      { id: 'news', threadId: 't1', from: 'updates@news.test', listUnsubscribe: true },
      { id: 'ask', threadId: 't2', from: 'jane@client.test', bodyText: 'When is delivery?' },
    ]);
    ai.queueOutput('classification', validTriage(0.92));

    const summary = await runTriage(harness.db, ctx, accountId, 'pilot@example.test', ai, enc);
    expect(summary).toMatchObject({ processed: 2, excluded: 1, classified: 1, failed: 0 });
    // Only the human ask reached the model.
    expect(ai.calls).toHaveLength(1);
    expect(ai.calls[0]!.user).toContain('jane@client.test');

    const rows = await harness.db.select().from(messageClassifications);
    const excluded = rows.find((r) => r.status === 'excluded');
    expect(excluded?.exclusionReason).toBe('bulk_or_list');
    const classified = rows.find((r) => r.status === 'classified');
    expect((classified?.result as { needsReply: boolean }).needsReply).toBe(true);
  });

  it('mixed action/information messages are represented correctly', async () => {
    await ingest([{ id: 'mixed', threadId: 't1', from: 'jane@client.test' }]);
    ai.queueOutput(
      'classification',
      validTriage(0.9, true, {
        messageTypes: ['mixed_information_action'],
        requestedActions: ['Send contract'],
        questionsAsked: ['What is the price?'],
      }),
    );
    await runTriage(harness.db, ctx, accountId, 'pilot@example.test', ai, enc);
    const [row] = await harness.db.select().from(messageClassifications);
    const result = row!.result as { messageTypes: string[] };
    expect(result.messageTypes).toContain('mixed_information_action');
  });

  it('low confidence routes to manual review', async () => {
    await ingest([{ id: 'vague', threadId: 't1', from: 'who@unknown.test' }]);
    ai.queueOutput('classification', validTriage(0.4));
    const summary = await runTriage(harness.db, ctx, accountId, 'pilot@example.test', ai, enc);
    expect(summary.manualReview).toBe(1);
  });

  it('INVARIANT: invalid AI output fails safe — recorded as failed, audited, nothing else', async () => {
    await ingest([{ id: 'm1', threadId: 't1', from: 'jane@client.test' }]);
    ai.queueOutput('classification', { garbage: true });
    const summary = await runTriage(harness.db, ctx, accountId, 'pilot@example.test', ai, enc);
    expect(summary.failed).toBe(1);

    const rows = await harness.db.select().from(messageClassifications);
    expect(rows[0]!.status).toBe('failed');
    expect(rows[0]!.result).toBeNull();

    const audits = await harness.db.select().from(auditEvents);
    expect(audits.some((a) => a.action === 'triage.failed')).toBe(true);
  });

  it('INVARIANT: triage performs zero Gmail writes — no draft is created', async () => {
    await ingest([{ id: 'm1', threadId: 't1', from: 'jane@client.test' }]);
    ai.queueOutput('classification', validTriage(0.95));
    await runTriage(harness.db, ctx, accountId, 'pilot@example.test', ai, enc);
    expect(gmail.writeOps()).toEqual([]);
  });

  it('already-classified messages are not reprocessed (idempotent)', async () => {
    await ingest([{ id: 'm1', threadId: 't1', from: 'jane@client.test' }]);
    ai.queueOutput('classification', validTriage(0.9));
    await runTriage(harness.db, ctx, accountId, 'pilot@example.test', ai, enc);
    const second = await runTriage(harness.db, ctx, accountId, 'pilot@example.test', ai, enc);
    expect(second.processed).toBe(0);
    expect(ai.calls).toHaveLength(1);
  });
});
