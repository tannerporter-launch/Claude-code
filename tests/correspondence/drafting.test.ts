import { MockAiProvider } from '@echoloop/ai';
import {
  computeRecipients,
  connectAccount,
  createKnowledgeDocument,
  createRule,
  generateDraftPreview,
  runTriage,
  syncMailbox,
} from '@echoloop/correspondence';
import {
  contextSnapshots,
  emailMessages,
  generatedDrafts,
  generationRuns,
} from '@echoloop/database';
import { MockGmailProvider } from '@echoloop/gmail';
import { createEncryptionService, generateEncryptionKey } from '@echoloop/security';
import { createTestDb, seed } from '@echoloop/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ACCOUNT_EMAIL = 'pilot@example.test';

describe('draft generation (dry-run, mock AI)', () => {
  let harness: Awaited<ReturnType<typeof createTestDb>>;
  let gmail: MockGmailProvider;
  let ai: MockAiProvider;
  let enc: ReturnType<typeof createEncryptionService>;
  let ctx: { organizationId: string };
  let accountId: string;

  beforeEach(async () => {
    harness = await createTestDb();
    enc = createEncryptionService(generateEncryptionKey());
    const seeded = await seed(harness.db, generateEncryptionKey());
    ctx = { organizationId: seeded.organizationId };
    accountId = seeded.emailAccountId;
    gmail = new MockGmailProvider();
    gmail.setProfile(ACCOUNT_EMAIL, '1000');
    ai = new MockAiProvider();
    await connectAccount(
      harness.db,
      ctx,
      accountId,
      gmail,
      { accessToken: 'a', refreshToken: 'r', expiryDate: null },
      enc,
    );
  });
  afterEach(async () => {
    await harness.close();
  });

  /** Ingest one classified inbound message and return its DB id. */
  async function classifiedMessage(over: { cc?: string } = {}): Promise<string> {
    gmail.addMessage({
      id: 'm1',
      threadId: 't1',
      from: 'jane@client.test',
      to: ACCOUNT_EMAIL,
      cc: over.cc,
      subject: 'Question',
      bodyText: 'What are your support hours?',
    });
    gmail.queueHistoryPage(
      [{ historyId: '1001', type: 'messageAdded', message: { id: 'm1', threadId: 't1' } }],
      '1001',
    );
    await syncMailbox(harness.db, ctx, accountId, gmail, enc);
    ai.queueOutput('classification', {
      needsReply: true,
      messageTypes: ['information_request'],
      relationship: { value: 'client', source: 'inferred' },
      isGroupThread: Boolean(over.cc),
      isInternal: false,
      confidence: 0.95,
    });
    await runTriage(harness.db, ctx, accountId, ACCOUNT_EMAIL, ai, enc);
    const [message] = await harness.db.select().from(emailMessages);
    return message!.id;
  }

  const validDraft = (over: object = {}) => ({
    shouldDraft: true,
    messageTypes: ['information_request'],
    relationship: { value: 'client', source: 'inferred' },
    replyMode: 'reply',
    subject: 'Re: Question',
    bodyText: 'Our support hours are 9-5 CT.',
    confidence: 0.9,
    ...over,
  });

  it('produces a validated structured preview with traceable facts and rules', async () => {
    const fact = await createKnowledgeDocument(harness.db, ctx, {
      category: 'approved_fact',
      title: 'Hours',
      content: 'Support hours are 9-5 CT.',
    });
    const rule = await createRule(harness.db, ctx, {
      category: 'personal_style',
      instruction: 'Sign off with "Best, Pilot".',
      scopeType: 'user_global',
    });
    const messageId = await classifiedMessage();
    ai.queueOutput('drafting', validDraft({ factsUsed: [fact.id], rulesUsed: [rule.id] }));

    const outcome = await generateDraftPreview(harness.db, ctx, ACCOUNT_EMAIL, messageId, ai, enc);
    expect(outcome.status).toBe('completed');
    expect(outcome.preview!.factsUsed).toEqual([fact.id]);
    expect(outcome.preview!.rulesUsed).toEqual([rule.id]);
    expect(outcome.preview!.to).toEqual(['jane@client.test']);

    // Provenance: run links to a snapshot containing exactly those records.
    const [run] = await harness.db
      .select()
      .from(generationRuns)
      .where(eq(generationRuns.id, outcome.runId));
    const [snapshot] = await harness.db
      .select()
      .from(contextSnapshots)
      .where(eq(contextSnapshots.id, run!.contextSnapshotId!));
    const included = snapshot!.includedRecords as { id: string }[];
    expect(included.map((r) => r.id)).toEqual(expect.arrayContaining([fact.id, rule.id]));

    // Draft body stored encrypted.
    const [draft] = await harness.db.select().from(generatedDrafts);
    expect(draft!.bodyTextEncrypted).toContain('v1:');
    expect(enc.decrypt(draft!.bodyTextEncrypted)).toContain('9-5 CT');
    expect(draft!.correlationKey).toBeTruthy();
  });

  it('INVARIANT: invalid model output creates no preview and no draft row', async () => {
    const messageId = await classifiedMessage();
    ai.queueOutput('drafting', { nonsense: true });
    const outcome = await generateDraftPreview(harness.db, ctx, ACCOUNT_EMAIL, messageId, ai, enc);
    expect(outcome.status).toBe('failed_validation');
    expect(outcome.preview).toBeUndefined();
    expect(await harness.db.select().from(generatedDrafts)).toEqual([]);
  });

  it('INVARIANT: unsupported factual claims block the draft', async () => {
    const messageId = await classifiedMessage();
    ai.queueOutput('drafting', validDraft({ factsUsed: ['00000000-0000-0000-0000-00000000dead'] }));
    const outcome = await generateDraftPreview(harness.db, ctx, ACCOUNT_EMAIL, messageId, ai, enc);
    expect(outcome.status).toBe('blocked_policy');
    expect(outcome.reason).toBe('unsupported_claim');
    expect(await harness.db.select().from(generatedDrafts)).toEqual([]);
  });

  it('prohibited commitments block the draft', async () => {
    const messageId = await classifiedMessage();
    ai.queueOutput('drafting', validDraft({ commitmentsMade: ['We will refund you in full'] }));
    const outcome = await generateDraftPreview(harness.db, ctx, ACCOUNT_EMAIL, messageId, ai, enc);
    expect(outcome.status).toBe('blocked_policy');
    expect(outcome.reason).toBe('prohibited_commitment');
  });

  it('model declining to draft records a declined run and nothing else', async () => {
    const messageId = await classifiedMessage();
    ai.queueOutput('drafting', validDraft({ shouldDraft: false }));
    const outcome = await generateDraftPreview(harness.db, ctx, ACCOUNT_EMAIL, messageId, ai, enc);
    expect(outcome.status).toBe('declined');
    expect(await harness.db.select().from(generatedDrafts)).toEqual([]);
  });

  it('INVARIANT: dry-run drafting performs zero Gmail writes', async () => {
    const messageId = await classifiedMessage();
    ai.queueOutput('drafting', validDraft());
    await generateDraftPreview(harness.db, ctx, ACCOUNT_EMAIL, messageId, ai, enc);
    expect(gmail.writeOps()).toEqual([]);
  });

  it('reply-all recipient handling: sender + To + Cc minus own aliases, deduped', () => {
    const participants = [
      { role: 'from', address: 'jane@client.test' },
      { role: 'to', address: 'pilot@example.test' },
      { role: 'to', address: 'bob@client.test' },
      { role: 'cc', address: 'carol@client.test' },
      { role: 'cc', address: 'pilot+alias@example.test' },
      { role: 'cc', address: 'jane@client.test' }, // duplicate of sender
    ];
    const replyAll = computeRecipients(participants, 'pilot@example.test', 'reply_all');
    expect(replyAll.to).toEqual(['jane@client.test', 'bob@client.test']);
    expect(replyAll.cc).toEqual(['carol@client.test']);

    const reply = computeRecipients(participants, 'pilot@example.test', 'reply');
    expect(reply).toEqual({ to: ['jane@client.test'], cc: [] });
  });
});
