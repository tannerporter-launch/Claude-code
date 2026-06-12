import { MockAiProvider } from '@echoloop/ai';
import {
  addAllowlistEntry,
  connectAccount,
  createGmailDraftFromPreview,
  generateDraftPreview,
  runTriage,
  syncMailbox,
} from '@echoloop/correspondence';
import { auditEvents, emailAccounts, emailMessages, generatedDrafts } from '@echoloop/database';
import { CORRELATION_HEADER, MockGmailProvider } from '@echoloop/gmail';
import { parseEnv } from '@echoloop/schemas';
import { createEncryptionService, generateEncryptionKey } from '@echoloop/security';
import { createTestDb, seed } from '@echoloop/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ACCOUNT_EMAIL = 'pilot@example.test';

/** Env with drafting actually enabled — tests pass it explicitly. */
const envWith = (over: Record<string, string>) =>
  parseEnv({
    ECHOLOOP_DRAFTING_KILL_SWITCH: 'false',
    ECHOLOOP_ACTIVATION_MODE: 'allowlist',
    ...over,
  } as NodeJS.ProcessEnv);

describe('Phase 6: real Gmail drafts, allowlist-gated (mock provider)', () => {
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

  /** End-to-end up to a preview: sync → triage → dry-run generation. */
  async function previewFor(sender: string): Promise<string> {
    gmail.addMessage({
      id: 'm1',
      threadId: 'thread-77',
      from: sender,
      to: ACCOUNT_EMAIL,
      subject: 'Question',
      bodyText: 'What are your hours?',
      messageIdHeader: '<orig-123@client.test>',
    });
    gmail.queueHistoryPage(
      [{ historyId: '1001', type: 'messageAdded', message: { id: 'm1', threadId: 'thread-77' } }],
      '1001',
    );
    await syncMailbox(harness.db, ctx, accountId, gmail, enc);
    ai.queueOutput('classification', {
      needsReply: true,
      messageTypes: ['information_request'],
      relationship: { value: 'client', source: 'inferred' },
      isGroupThread: false,
      isInternal: false,
      confidence: 0.95,
    });
    await runTriage(harness.db, ctx, accountId, ACCOUNT_EMAIL, ai, enc);
    const [message] = await harness.db.select().from(emailMessages);
    ai.queueOutput('drafting', {
      shouldDraft: true,
      messageTypes: ['information_request'],
      relationship: { value: 'client', source: 'inferred' },
      replyMode: 'reply',
      subject: 'Re: Question',
      bodyText: 'Our hours are 9-5 CT.',
      confidence: 0.9,
    });
    const outcome = await generateDraftPreview(
      harness.db,
      ctx,
      ACCOUNT_EMAIL,
      message!.id,
      ai,
      enc,
    );
    expect(outcome.status).toBe('completed');
    return outcome.draftId!;
  }

  function account(over: Partial<{ draftingPaused: boolean }> = {}) {
    return {
      id: accountId,
      providerEmail: ACCOUNT_EMAIL,
      draftingPaused: over.draftingPaused ?? false,
    };
  }

  it('allowlisted message receives a threaded Gmail draft with provenance + audit', async () => {
    const draftId = await previewFor('jane@client.test');
    await addAllowlistEntry(harness.db, ctx, accountId, {
      kind: 'sender_email',
      value: 'jane@client.test',
    });

    const result = await createGmailDraftFromPreview(
      harness.db,
      ctx,
      account(),
      draftId,
      gmail,
      enc,
      { env: envWith({}) },
    );
    expect(result.status).toBe('created');

    // Threaded draft created via provider with correlation + reply headers.
    expect(gmail.createdDrafts).toHaveLength(1);
    expect(gmail.createdDrafts[0]!.threadId).toBe('thread-77');
    const mime = Buffer.from(gmail.createdDrafts[0]!.rawMimeBase64Url, 'base64url').toString();
    expect(mime).toContain('In-Reply-To: <orig-123@client.test>');
    expect(mime).toContain(`${CORRELATION_HEADER}: `);
    expect(mime).toContain('To: jane@client.test');
    expect(mime).toContain('Our hours are 9-5 CT.');

    // Provenance links draft row to the provider draft.
    const [draft] = await harness.db
      .select()
      .from(generatedDrafts)
      .where(eq(generatedDrafts.id, draftId));
    expect(draft!.status).toBe('drafted');
    expect(draft!.providerDraftId).toBe('draft-1');

    // Audit event for the live Gmail write.
    const audits = await harness.db.select().from(auditEvents);
    expect(audits.some((a) => a.action === 'gmail.draft_created')).toBe(true);
  });

  it('INVARIANT: non-allowlisted message receives no draft', async () => {
    const draftId = await previewFor('stranger@elsewhere.test');
    await addAllowlistEntry(harness.db, ctx, accountId, {
      kind: 'sender_email',
      value: 'jane@client.test',
    });
    const result = await createGmailDraftFromPreview(
      harness.db,
      ctx,
      account(),
      draftId,
      gmail,
      enc,
      { env: envWith({}) },
    );
    expect(result).toEqual({ status: 'blocked', reason: 'not_allowlisted' });
    expect(gmail.createdDrafts).toHaveLength(0);
  });

  it('INVARIANT: disabled and dry_run modes create no Gmail draft', async () => {
    const draftId = await previewFor('jane@client.test');
    for (const mode of ['disabled', 'dry_run'] as const) {
      const result = await createGmailDraftFromPreview(
        harness.db,
        ctx,
        account(),
        draftId,
        gmail,
        enc,
        { env: envWith({ ECHOLOOP_ACTIVATION_MODE: mode }) },
      );
      expect(result.status).toBe('blocked');
    }
    expect(gmail.createdDrafts).toHaveLength(0);
  });

  it('INVARIANT: both kill switches block drafting', async () => {
    const draftId = await previewFor('jane@client.test');
    await addAllowlistEntry(harness.db, ctx, accountId, {
      kind: 'sender_email',
      value: 'jane@client.test',
    });

    const global = await createGmailDraftFromPreview(
      harness.db,
      ctx,
      account(),
      draftId,
      gmail,
      enc,
      { env: envWith({ ECHOLOOP_DRAFTING_KILL_SWITCH: 'true' }) },
    );
    expect(global).toEqual({ status: 'blocked', reason: 'global_kill_switch' });

    const perAccount = await createGmailDraftFromPreview(
      harness.db,
      ctx,
      account({ draftingPaused: true }),
      draftId,
      gmail,
      enc,
      { env: envWith({}) },
    );
    expect(perAccount).toEqual({ status: 'blocked', reason: 'account_kill_switch' });
    expect(gmail.createdDrafts).toHaveLength(0);
  });

  it('rate limits block drafting (per cycle and per hour)', async () => {
    const draftId = await previewFor('jane@client.test');
    await addAllowlistEntry(harness.db, ctx, accountId, {
      kind: 'sender_domain',
      value: 'client.test',
    });

    const cycle = await createGmailDraftFromPreview(
      harness.db,
      ctx,
      account(),
      draftId,
      gmail,
      enc,
      { draftsThisCycle: 3, env: envWith({}) },
    );
    expect(cycle).toEqual({ status: 'blocked', reason: 'rate_limited_cycle' });

    const hour = await createGmailDraftFromPreview(
      harness.db,
      ctx,
      account(),
      draftId,
      gmail,
      enc,
      { env: envWith({ ECHOLOOP_MAX_DRAFTS_PER_HOUR: '0' }) },
    );
    expect(hour).toEqual({ status: 'blocked', reason: 'rate_limited_hour' });
    expect(gmail.createdDrafts).toHaveLength(0);
  });

  it('default env blocks everything (kill switch on by default)', async () => {
    const draftId = await previewFor('jane@client.test');
    const result = await createGmailDraftFromPreview(
      harness.db,
      ctx,
      account(),
      draftId,
      gmail,
      enc,
      { env: parseEnv({} as NodeJS.ProcessEnv) },
    );
    expect(result).toEqual({ status: 'blocked', reason: 'global_kill_switch' });
  });

  it('account kill switch column exists and defaults to false', async () => {
    const [row] = await harness.db
      .select()
      .from(emailAccounts)
      .where(eq(emailAccounts.id, accountId));
    expect(row!.draftingPaused).toBe(false);
  });
});
