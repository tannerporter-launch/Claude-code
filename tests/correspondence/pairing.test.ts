import { MockAiProvider } from '@echoloop/ai';
import {
  AUTO_PAIR_THRESHOLD,
  addAllowlistEntry,
  connectAccount,
  createGmailDraftFromPreview,
  detectDiscardedDrafts,
  generateDraftPreview,
  listAmbiguousPairings,
  manuallyPair,
  runPairing,
  runTriage,
  scoreEvidence,
  syncMailbox,
} from '@echoloop/correspondence';
import { draftSentPairs, emailMessages, generatedDrafts } from '@echoloop/database';
import { MockGmailProvider } from '@echoloop/gmail';
import { parseEnv } from '@echoloop/schemas';
import { createEncryptionService, generateEncryptionKey } from '@echoloop/security';
import { createTestDb, seed } from '@echoloop/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ACCOUNT_EMAIL = 'pilot@example.test';
const env = parseEnv({
  ECHOLOOP_DRAFTING_KILL_SWITCH: 'false',
  ECHOLOOP_ACTIVATION_MODE: 'allowlist',
} as NodeJS.ProcessEnv);

describe('Phase 7: sent capture and pairing (mock provider)', () => {
  let harness: Awaited<ReturnType<typeof createTestDb>>;
  let gmail: MockGmailProvider;
  let ai: MockAiProvider;
  let enc: ReturnType<typeof createEncryptionService>;
  let ctx: { organizationId: string };
  let accountId: string;
  let historyCounter = 2000;

  beforeEach(async () => {
    harness = await createTestDb();
    enc = createEncryptionService(generateEncryptionKey());
    const seeded = await seed(harness.db, generateEncryptionKey());
    ctx = { organizationId: seeded.organizationId };
    accountId = seeded.emailAccountId;
    gmail = new MockGmailProvider();
    gmail.setProfile(ACCOUNT_EMAIL, '1000');
    ai = new MockAiProvider();
    historyCounter = 2000;
    await connectAccount(
      harness.db,
      ctx,
      accountId,
      gmail,
      { accessToken: 'a', refreshToken: 'r', expiryDate: null },
      enc,
    );
    await addAllowlistEntry(harness.db, ctx, accountId, {
      kind: 'sender_domain',
      value: 'client.test',
    });
  });
  afterEach(async () => {
    await harness.close();
  });

  async function ingest(msg: Parameters<MockGmailProvider['addMessage']>[0]): Promise<void> {
    gmail.addMessage(msg);
    historyCounter += 1;
    gmail.queueHistoryPage(
      [
        {
          historyId: String(historyCounter),
          type: 'messageAdded',
          message: { id: msg.id, threadId: msg.threadId },
        },
      ],
      String(historyCounter),
    );
    await syncMailbox(harness.db, ctx, accountId, gmail, enc);
  }

  /** Full pipeline: inbound → triage → preview → real (mock) Gmail draft. */
  async function draftedReply(opts: {
    inboundId: string;
    threadId: string;
    subject?: string;
    sender?: string;
  }): Promise<{ draftRowId: string; correlationKey: string; providerDraftId: string }> {
    await ingest({
      id: opts.inboundId,
      threadId: opts.threadId,
      from: opts.sender ?? 'jane@client.test',
      to: ACCOUNT_EMAIL,
      subject: opts.subject ?? 'Question',
      bodyText: 'What are your hours?',
      messageIdHeader: `<${opts.inboundId}@client.test>`,
    });
    ai.queueOutput('classification', {
      needsReply: true,
      messageTypes: ['information_request'],
      relationship: { value: 'client', source: 'inferred' },
      isGroupThread: false,
      isInternal: false,
      confidence: 0.95,
    });
    await runTriage(harness.db, ctx, accountId, ACCOUNT_EMAIL, ai, enc);
    const messages = await harness.db.select().from(emailMessages);
    const inbound = messages.find(
      (m) => m.providerMessageId === opts.inboundId && m.direction === 'inbound',
    )!;
    ai.queueOutput('drafting', {
      shouldDraft: true,
      messageTypes: ['information_request'],
      relationship: { value: 'client', source: 'inferred' },
      replyMode: 'reply',
      subject: `Re: ${opts.subject ?? 'Question'}`,
      bodyText: 'Our hours are 9-5 CT.',
      confidence: 0.9,
    });
    const preview = await generateDraftPreview(harness.db, ctx, ACCOUNT_EMAIL, inbound.id, ai, enc);
    const created = await createGmailDraftFromPreview(
      harness.db,
      ctx,
      { id: accountId, providerEmail: ACCOUNT_EMAIL, draftingPaused: false },
      preview.draftId!,
      gmail,
      enc,
      { env },
    );
    expect(created.status).toBe('created');
    const [draft] = await harness.db
      .select()
      .from(generatedDrafts)
      .where(eq(generatedDrafts.id, preview.draftId!));
    return {
      draftRowId: draft!.id,
      correlationKey: draft!.correlationKey!,
      providerDraftId: draft!.providerDraftId!,
    };
  }

  /** Simulate the user sending the draft (Gmail consumes draft, SENT appears). */
  async function userSends(opts: {
    sentId: string;
    threadId: string;
    subject: string;
    inReplyTo?: string;
    correlationKey?: string;
    to?: string;
    consumeDraftId?: string;
  }): Promise<void> {
    if (opts.consumeDraftId) gmail.removeDraftFromMailbox(opts.consumeDraftId);
    await ingest({
      id: opts.sentId,
      threadId: opts.threadId,
      sent: true,
      from: ACCOUNT_EMAIL,
      to: opts.to ?? 'jane@client.test',
      subject: opts.subject,
      bodyText: 'Edited reply body.',
      inReplyToHeader: opts.inReplyTo,
      correlationKey: opts.correlationKey,
    });
  }

  it('unedited and edited sends pair automatically with recorded evidence', async () => {
    const { draftRowId, correlationKey, providerDraftId } = await draftedReply({
      inboundId: 'in1',
      threadId: 't1',
    });
    await userSends({
      sentId: 'sent1',
      threadId: 't1',
      subject: 'Re: Question',
      inReplyTo: '<in1@client.test>',
      correlationKey,
      consumeDraftId: providerDraftId,
    });

    const summary = await runPairing(harness.db, ctx, accountId);
    expect(summary).toMatchObject({ autoPaired: 1, ambiguous: 0 });

    const [pair] = await harness.db.select().from(draftSentPairs);
    expect(pair!.generatedDraftId).toBe(draftRowId);
    expect(pair!.method).toBe('auto');
    expect(pair!.confidence).toBeGreaterThanOrEqual(AUTO_PAIR_THRESHOLD);
    const evidence = pair!.evidence as { correlationMatch: boolean; threadMatch: boolean };
    expect(evidence.correlationMatch).toBe(true);
    expect(evidence.threadMatch).toBe(true);

    const [draft] = await harness.db
      .select()
      .from(generatedDrafts)
      .where(eq(generatedDrafts.id, draftRowId));
    expect(draft!.status).toBe('sent');
  });

  it('send from another device (no correlation header) still pairs via thread+headers+subject+recipients', async () => {
    const { draftRowId, providerDraftId } = await draftedReply({
      inboundId: 'in1',
      threadId: 't1',
    });
    await userSends({
      sentId: 'sent1',
      threadId: 't1',
      subject: 'Re: Question',
      inReplyTo: '<in1@client.test>',
      consumeDraftId: providerDraftId,
      // no correlationKey — sent from a client that stripped it
    });
    const summary = await runPairing(harness.db, ctx, accountId);
    expect(summary.autoPaired).toBe(1);
    const [pair] = await harness.db.select().from(draftSentPairs);
    expect(pair!.generatedDraftId).toBe(draftRowId);
    const evidence = pair!.evidence as { correlationMatch: boolean };
    expect(evidence.correlationMatch).toBe(false);
  });

  it('changed subject and changed recipients still pair safely (correlation carries it)', async () => {
    const { correlationKey, providerDraftId, draftRowId } = await draftedReply({
      inboundId: 'in1',
      threadId: 't1',
    });
    await userSends({
      sentId: 'sent1',
      threadId: 't1',
      subject: 'Totally different subject',
      to: 'someoneelse@other.test',
      correlationKey,
      consumeDraftId: providerDraftId,
    });
    const summary = await runPairing(harness.db, ctx, accountId);
    expect(summary.autoPaired).toBe(1);
    const [pair] = await harness.db.select().from(draftSentPairs);
    expect(pair!.generatedDraftId).toBe(draftRowId);
  });

  it('INVARIANT: thread match alone never auto-pairs', () => {
    expect(
      scoreEvidence({
        correlationMatch: false,
        threadMatch: true,
        inReplyToMatch: false,
        subjectMatch: false,
        recipientOverlap: 0,
        hoursApart: null,
      }),
    ).toBeLessThan(AUTO_PAIR_THRESHOLD);
  });

  it('INVARIANT: ambiguous pairing (two drafts in one thread) stays unpaired → manual queue', async () => {
    const a = await draftedReply({ inboundId: 'in1', threadId: 't1', subject: 'Question' });
    const b = await draftedReply({ inboundId: 'in2', threadId: 't1', subject: 'Question' });
    expect(a.draftRowId).not.toBe(b.draftRowId);
    // Sent without correlation header; matches both drafts equally well.
    await userSends({
      sentId: 'sent1',
      threadId: 't1',
      subject: 'Re: Question',
    });

    const summary = await runPairing(harness.db, ctx, accountId);
    expect(summary.ambiguous).toBe(1);
    expect(summary.autoPaired).toBe(0);
    expect(await harness.db.select().from(draftSentPairs)).toEqual([]);

    const queue = await listAmbiguousPairings(harness.db, ctx);
    expect(queue.length).toBeGreaterThanOrEqual(2);

    // Manual resolution pairs exactly one and clears the queue.
    const [sent] = await harness.db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.providerMessageId, 'sent1'));
    await manuallyPair(harness.db, ctx, sent!.id, a.draftRowId);
    expect(await harness.db.select().from(draftSentPairs)).toHaveLength(1);
    expect(await listAmbiguousPairings(harness.db, ctx)).toEqual([]);
  });

  it('INVARIANT: one sent message cannot pair twice; one draft cannot pair twice (DB constraints)', async () => {
    const { draftRowId, correlationKey, providerDraftId } = await draftedReply({
      inboundId: 'in1',
      threadId: 't1',
    });
    await userSends({
      sentId: 'sent1',
      threadId: 't1',
      subject: 'Re: Question',
      correlationKey,
      consumeDraftId: providerDraftId,
    });
    await runPairing(harness.db, ctx, accountId);

    const [sent] = await harness.db
      .select()
      .from(emailMessages)
      .where(eq(emailMessages.providerMessageId, 'sent1'));
    await expect(manuallyPair(harness.db, ctx, sent!.id, draftRowId)).rejects.toThrow();
  });

  it('duplicate sent events are idempotent (no second pair)', async () => {
    const { correlationKey, providerDraftId } = await draftedReply({
      inboundId: 'in1',
      threadId: 't1',
    });
    await userSends({
      sentId: 'sent1',
      threadId: 't1',
      subject: 'Re: Question',
      correlationKey,
      consumeDraftId: providerDraftId,
    });
    await runPairing(harness.db, ctx, accountId);
    // Same history event again + rerun pairing.
    gmail.queueHistoryPage(
      [
        {
          historyId: '2001',
          type: 'messageAdded',
          message: { id: 'sent1', threadId: 't1' },
        },
      ],
      '9999',
    );
    await syncMailbox(harness.db, ctx, accountId, gmail, enc);
    const second = await runPairing(harness.db, ctx, accountId);
    expect(second.autoPaired).toBe(0);
    expect(await harness.db.select().from(draftSentPairs)).toHaveLength(1);
  });

  it('deleted draft is detected as discarded; no comparison pair is created', async () => {
    const { draftRowId, providerDraftId } = await draftedReply({
      inboundId: 'in1',
      threadId: 't1',
    });
    gmail.removeDraftFromMailbox(providerDraftId);

    await runPairing(harness.db, ctx, accountId); // nothing sent
    const discarded = await detectDiscardedDrafts(harness.db, ctx, gmail);
    expect(discarded).toBe(1);

    const [draft] = await harness.db
      .select()
      .from(generatedDrafts)
      .where(eq(generatedDrafts.id, draftRowId));
    expect(draft!.status).toBe('discarded');
    expect(await harness.db.select().from(draftSentPairs)).toEqual([]);
  });

  it('a sent draft is not misdetected as discarded when pairing runs first', async () => {
    const { draftRowId, correlationKey, providerDraftId } = await draftedReply({
      inboundId: 'in1',
      threadId: 't1',
    });
    await userSends({
      sentId: 'sent1',
      threadId: 't1',
      subject: 'Re: Question',
      correlationKey,
      consumeDraftId: providerDraftId,
    });
    await runPairing(harness.db, ctx, accountId);
    const discarded = await detectDiscardedDrafts(harness.db, ctx, gmail);
    expect(discarded).toBe(0);
    const [draft] = await harness.db
      .select()
      .from(generatedDrafts)
      .where(eq(generatedDrafts.id, draftRowId));
    expect(draft!.status).toBe('sent');
  });
});
