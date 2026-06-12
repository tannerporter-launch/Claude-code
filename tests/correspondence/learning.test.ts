import { MockAiProvider } from '@echoloop/ai';
import {
  approveProposal,
  assembleContext,
  generateProposals,
  listPendingProposals,
  mechanicalDiff,
  rejectProposal,
  rollbackRule,
  runComparisons,
} from '@echoloop/correspondence';
import {
  comparisons,
  draftSentPairs,
  emailAccounts,
  emailMessages,
  emailThreads,
  generatedDrafts,
  generationRuns,
  knowledgeDocuments,
  messageClassifications,
  ruleProposals,
  rules,
} from '@echoloop/database';
import { createEncryptionService, generateEncryptionKey } from '@echoloop/security';
import { createTestDb, seed } from '@echoloop/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * Phase 8 acceptance. Pairs are fabricated directly in the DB (Phase 7 already
 * proves pairing); the mock AI provides semantic classifications.
 */
describe('Phase 8: comparison and learning proposals', () => {
  let harness: Awaited<ReturnType<typeof createTestDb>>;
  let ai: MockAiProvider;
  let enc: ReturnType<typeof createEncryptionService>;
  let ctx: { organizationId: string };
  let accountId: string;
  let userId: string;
  let pairCounter = 0;

  const MATCH = {
    relationship: 'client',
    messageTypes: ['information_request'],
    isGroupThread: false,
  };

  beforeEach(async () => {
    harness = await createTestDb();
    enc = createEncryptionService(generateEncryptionKey());
    const seeded = await seed(harness.db, generateEncryptionKey());
    ctx = { organizationId: seeded.organizationId };
    accountId = seeded.emailAccountId;
    userId = seeded.userId;
    ai = new MockAiProvider();
    pairCounter = 0;
    void userId;
  });
  afterEach(async () => {
    await harness.close();
  });

  /** Fabricate a reliable pair: inbound msg + classification + draft + sent + pair. */
  async function fabricatePair(opts: {
    draftBody: string;
    sentBody: string;
    relationship?: string;
  }): Promise<string> {
    pairCounter += 1;
    const n = pairCounter;
    const [thread] = await harness.db
      .insert(emailThreads)
      .values({
        organizationId: ctx.organizationId,
        emailAccountId: accountId,
        providerThreadId: `t${n}`,
        normalizedSubject: 'question',
      })
      .returning();
    const [inbound] = await harness.db
      .insert(emailMessages)
      .values({
        organizationId: ctx.organizationId,
        emailAccountId: accountId,
        threadId: thread!.id,
        providerMessageId: `in${n}`,
        direction: 'inbound',
        subject: 'Question',
        bodyTextEncrypted: enc.encrypt('What are your hours?'),
        internalDate: new Date(),
      })
      .returning();
    await harness.db.insert(messageClassifications).values({
      organizationId: ctx.organizationId,
      messageId: inbound!.id,
      status: 'classified',
      result: {
        needsReply: true,
        messageTypes: ['information_request'],
        relationship: { value: opts.relationship ?? 'client', source: 'inferred' },
        isGroupThread: false,
        isInternal: false,
        requestedActions: [],
        questionsAsked: [],
        deadlines: [],
        uncertainties: [],
        confidence: 0.9,
      },
    });
    const [run] = await harness.db
      .insert(generationRuns)
      .values({
        organizationId: ctx.organizationId,
        messageId: inbound!.id,
        status: 'completed',
      })
      .returning();
    const [draft] = await harness.db
      .insert(generatedDrafts)
      .values({
        organizationId: ctx.organizationId,
        generationRunId: run!.id,
        messageId: inbound!.id,
        threadId: thread!.id,
        replyMode: 'reply',
        subject: 'Re: Question',
        bodyTextEncrypted: enc.encrypt(opts.draftBody),
        recipients: { to: ['jane@client.test'], cc: [] },
        status: 'sent',
      })
      .returning();
    const [sent] = await harness.db
      .insert(emailMessages)
      .values({
        organizationId: ctx.organizationId,
        emailAccountId: accountId,
        threadId: thread!.id,
        providerMessageId: `sent${n}`,
        direction: 'outbound',
        subject: 'Re: Question',
        bodyTextEncrypted: enc.encrypt(opts.sentBody),
        internalDate: new Date(),
      })
      .returning();
    const [pair] = await harness.db
      .insert(draftSentPairs)
      .values({
        organizationId: ctx.organizationId,
        sentMessageId: sent!.id,
        generatedDraftId: draft!.id,
        confidence: 900,
        evidence: {},
        method: 'auto',
      })
      .returning();
    return pair!.id;
  }

  const LONG =
    'Hello Jane, thank you so much for reaching out to us today. Our support hours are nine to five central time, Monday through Friday, and we are always happy to help with anything else you might need.';
  const SHORT = 'Hi Jane — hours are 9-5 CT, Mon-Fri. Best, Pilot';

  const brevitySemantic = {
    categories: ['brevity'],
    summary: 'User shortened the reply substantially.',
    isOneTimeSituational: false,
    factualCorrectionDetail: null,
  };

  it('mechanical diff captures insertions/deletions, greeting/signoff, length', () => {
    const diff = mechanicalDiff(
      { body: 'Hello Jane,\nlong body here\nBest, Pilot', subject: 'Re: Q', recipients: ['a'] },
      { body: 'Hi Jane,\nshort\nCheers, P', subject: 'Re: Q', recipients: [] },
    );
    expect(diff.greetingChanged).toBe(true);
    expect(diff.signoffChanged).toBe(true);
    expect(diff.insertions).toBeGreaterThan(0);
    expect(diff.deletions).toBeGreaterThan(0);
    expect(diff.identical).toBe(false);

    const same = mechanicalDiff(
      { body: 'Same text.', subject: 's', recipients: [] },
      { body: 'Same text.', subject: 's', recipients: [] },
    );
    expect(same.identical).toBe(true);
    expect(same.normalizedEditDistanceMilli).toBe(0);
  });

  it('repeated shortening produces ONE scoped brevity proposal; approval influences drafting; rollback stops it', async () => {
    for (let i = 0; i < 3; i++) {
      await fabricatePair({ draftBody: LONG, sentBody: SHORT });
      ai.queueOutput('comparison', brevitySemantic);
    }
    const compared = await runComparisons(harness.db, ctx, ai, enc);
    expect(compared.compared).toBe(3);

    const summary = await generateProposals(harness.db, ctx);
    expect(summary.styleProposals).toBe(1);

    const pending = await listPendingProposals(harness.db, ctx);
    expect(pending).toHaveLength(1);
    const proposal = pending[0]!;
    expect(proposal.proposalType).toBe('new_style_rule');
    expect(proposal.scopeType).toBe('relationship'); // narrowest defensible scope
    expect(proposal.scopeValue).toBe('client');
    expect(proposal.evidenceCount).toBe(3);

    // INVARIANT: nothing activates without approval.
    expect(await harness.db.select().from(rules)).toEqual([]);
    let assembled = await assembleContext(harness.db, ctx, MATCH);
    expect(assembled.includedRecords).toEqual([]);

    // Approve → rule exists with evidence → influences the next draft context.
    const { resultingRuleId } = await approveProposal(harness.db, ctx, proposal.id);
    assembled = await assembleContext(harness.db, ctx, MATCH);
    expect(assembled.rendered).toContain('shorter and more concise');
    expect(assembled.includedRecords.some((r) => r.id === resultingRuleId)).toBe(true);
    // …and only in the matching relationship context.
    const vendorCtx = await assembleContext(harness.db, ctx, { ...MATCH, relationship: 'vendor' });
    expect(vendorCtx.rendered).not.toContain('shorter and more concise');

    // Rollback → stops affecting drafting immediately.
    await rollbackRule(harness.db, ctx, resultingRuleId!);
    assembled = await assembleContext(harness.db, ctx, MATCH);
    expect(assembled.rendered).not.toContain('shorter and more concise');
  });

  it('INVARIANT: one deletion does not create a global rule', async () => {
    await fabricatePair({ draftBody: LONG, sentBody: SHORT });
    ai.queueOutput('comparison', brevitySemantic);
    await runComparisons(harness.db, ctx, ai, enc);
    const summary = await generateProposals(harness.db, ctx);
    expect(summary.styleProposals).toBe(0);
    expect(await listPendingProposals(harness.db, ctx)).toEqual([]);
  });

  it('INVARIANT: a price correction becomes a FACTUAL proposal, never a style rule', async () => {
    await fabricatePair({
      draftBody: 'The plan costs $400 per month.',
      sentBody: 'The plan costs $500 per month.',
    });
    ai.queueOutput('comparison', {
      categories: ['corrected_factual_information'],
      summary: 'User corrected the price from $400 to $500.',
      isOneTimeSituational: false,
      factualCorrectionDetail: 'Monthly plan price is $500, not $400.',
    });
    await runComparisons(harness.db, ctx, ai, enc);
    const summary = await generateProposals(harness.db, ctx);
    expect(summary.factualProposals).toBe(1);
    expect(summary.styleProposals).toBe(0);

    const [proposal] = await listPendingProposals(harness.db, ctx);
    expect(proposal!.targetKind).toBe('knowledge');
    expect(proposal!.proposalType).toBe('correct_approved_fact');
    expect(proposal!.riskLevel).toBe('high');
    expect(proposal!.proposedText).toContain('$500');

    // Approving creates an approved fact, not a rule.
    await approveProposal(harness.db, ctx, proposal!.id);
    expect(await harness.db.select().from(rules)).toEqual([]);
    const docs = await harness.db.select().from(knowledgeDocuments);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.category).toBe('approved_fact');
  });

  it('commitment changes are classified distinctly and never become style proposals', async () => {
    await fabricatePair({
      draftBody: 'I will deliver this by Friday.',
      sentBody: 'I can probably deliver this by Friday.',
    });
    ai.queueOutput('comparison', {
      categories: ['changed_commitment'],
      summary: 'Softened commitment from "will" to "can probably".',
      isOneTimeSituational: false,
      factualCorrectionDetail: null,
    });
    await runComparisons(harness.db, ctx, ai, enc);
    const [comparison] = await harness.db.select().from(comparisons);
    expect((comparison!.semantic as { categories: string[] }).categories).toContain(
      'changed_commitment',
    );
    const summary = await generateProposals(harness.db, ctx);
    expect(summary.styleProposals).toBe(0);
    expect(summary.factualProposals).toBe(0);
  });

  it('contradictory evidence suppresses the proposal', async () => {
    // 3 shortenings + 2 lengthenings in the same bucket. Compared in two
    // homogeneous batches so the mock's FIFO outputs map deterministically.
    for (let i = 0; i < 3; i++) {
      await fabricatePair({ draftBody: LONG, sentBody: SHORT });
      ai.queueOutput('comparison', brevitySemantic);
    }
    await runComparisons(harness.db, ctx, ai, enc);
    for (let i = 0; i < 2; i++) {
      await fabricatePair({ draftBody: SHORT, sentBody: LONG });
      ai.queueOutput('comparison', {
        categories: ['structure'],
        summary: 'User expanded the reply.',
        isOneTimeSituational: false,
        factualCorrectionDetail: null,
      });
    }
    await runComparisons(harness.db, ctx, ai, enc);
    const summary = await generateProposals(harness.db, ctx);
    expect(summary.skippedContradicted).toBeGreaterThanOrEqual(1);
    const pending = await listPendingProposals(harness.db, ctx);
    expect(pending.filter((p) => p.proposedText.includes('shorter'))).toEqual([]);
  });

  it('one-time situational changes never generate proposals', async () => {
    for (let i = 0; i < 3; i++) {
      await fabricatePair({ draftBody: LONG, sentBody: SHORT });
      ai.queueOutput('comparison', { ...brevitySemantic, isOneTimeSituational: true });
    }
    await runComparisons(harness.db, ctx, ai, enc);
    const summary = await generateProposals(harness.db, ctx);
    expect(summary.styleProposals).toBe(0);
  });

  it('INVARIANT: rejected proposals never affect drafting', async () => {
    for (let i = 0; i < 3; i++) {
      await fabricatePair({ draftBody: LONG, sentBody: SHORT });
      ai.queueOutput('comparison', brevitySemantic);
    }
    await runComparisons(harness.db, ctx, ai, enc);
    await generateProposals(harness.db, ctx);
    const [proposal] = await listPendingProposals(harness.db, ctx);
    await rejectProposal(harness.db, ctx, proposal!.id);

    expect(await harness.db.select().from(rules)).toEqual([]);
    const assembled = await assembleContext(harness.db, ctx, MATCH);
    expect(assembled.includedRecords).toEqual([]);

    const [stored] = await harness.db
      .select()
      .from(ruleProposals)
      .where(eq(ruleProposals.id, proposal!.id));
    expect(stored!.status).toBe('rejected');
  });

  it('proposal generation is idempotent over already-used evidence', async () => {
    for (let i = 0; i < 3; i++) {
      await fabricatePair({ draftBody: LONG, sentBody: SHORT });
      ai.queueOutput('comparison', brevitySemantic);
    }
    await runComparisons(harness.db, ctx, ai, enc);
    await generateProposals(harness.db, ctx);
    const second = await generateProposals(harness.db, ctx);
    expect(second.styleProposals).toBe(0);
    expect(await harness.db.select().from(ruleProposals)).toHaveLength(1);
  });

  it('invalid semantic output fails safe (no comparison row)', async () => {
    await fabricatePair({ draftBody: LONG, sentBody: SHORT });
    ai.queueOutput('comparison', { bogus: true });
    const summary = await runComparisons(harness.db, ctx, ai, enc);
    expect(summary.failed).toBe(1);
    expect(await harness.db.select().from(comparisons)).toEqual([]);
  });
});
