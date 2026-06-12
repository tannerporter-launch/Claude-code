import { MockAiProvider } from '@echoloop/ai';
import {
  addAllowlistEntry,
  approveProposal,
  connectAccount,
  listPendingProposals,
  runLoopCycle,
} from '@echoloop/correspondence';
import { draftSentPairs, generatedDrafts, ruleProposals } from '@echoloop/database';
import { MockGmailProvider } from '@echoloop/gmail';
import { parseEnv } from '@echoloop/schemas';
import { createEncryptionService, generateEncryptionKey } from '@echoloop/security';
import { createTestDb, seed } from '@echoloop/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/**
 * END-TO-END (mock): the full Definition-of-Done loop driven through
 * runLoopCycle — inbound → triage → context → draft → Gmail draft (allowlist)
 * → user sends → pair → compare → proposal → approval → the NEXT draft's
 * context includes the approved rule. No live API is touched.
 */

const ACCOUNT_EMAIL = 'pilot@example.test';
const env = parseEnv({
  ECHOLOOP_DRAFTING_KILL_SWITCH: 'false',
  ECHOLOOP_ACTIVATION_MODE: 'allowlist',
} as NodeJS.ProcessEnv);

const triageOutput = {
  needsReply: true,
  messageTypes: ['information_request'],
  relationship: { value: 'client', source: 'inferred' },
  isGroupThread: false,
  isInternal: false,
  confidence: 0.95,
};
const draftOutput = (body: string) => ({
  shouldDraft: true,
  messageTypes: ['information_request'],
  relationship: { value: 'client', source: 'inferred' },
  replyMode: 'reply',
  subject: 'Re: Question',
  bodyText: body,
  confidence: 0.9,
});
const brevitySemantic = {
  categories: ['brevity'],
  summary: 'Shortened.',
  isOneTimeSituational: false,
  factualCorrectionDetail: null,
};

describe('full loop (mock end-to-end)', () => {
  let harness: Awaited<ReturnType<typeof createTestDb>>;
  let gmail: MockGmailProvider;
  let ai: MockAiProvider;
  let enc: ReturnType<typeof createEncryptionService>;
  let ctx: { organizationId: string };
  let account: { id: string; providerEmail: string; draftingPaused: boolean };
  let history = 1000;

  beforeEach(async () => {
    harness = await createTestDb();
    enc = createEncryptionService(generateEncryptionKey());
    const seeded = await seed(harness.db, generateEncryptionKey());
    ctx = { organizationId: seeded.organizationId };
    account = { id: seeded.emailAccountId, providerEmail: ACCOUNT_EMAIL, draftingPaused: false };
    gmail = new MockGmailProvider();
    gmail.setProfile(ACCOUNT_EMAIL, '1000');
    ai = new MockAiProvider();
    history = 1000;
    await connectAccount(
      harness.db,
      ctx,
      account.id,
      gmail,
      { accessToken: 'a', refreshToken: 'r', expiryDate: null },
      enc,
    );
    await addAllowlistEntry(harness.db, ctx, account.id, {
      kind: 'sender_domain',
      value: 'client.test',
    });
  });
  afterEach(async () => {
    await harness.close();
  });

  function arrive(msg: Parameters<MockGmailProvider['addMessage']>[0]): void {
    gmail.addMessage(msg);
    history += 1;
    gmail.queueHistoryPage(
      [
        {
          historyId: String(history),
          type: 'messageAdded',
          message: { id: msg.id, threadId: msg.threadId },
        },
      ],
      String(history),
    );
  }

  it('runs the complete loop and the approved rule influences the next draft', async () => {
    // ---- Three rounds: inbound → draft → user sends a much shorter reply ----
    for (let round = 1; round <= 3; round++) {
      arrive({
        id: `in${round}`,
        threadId: `t${round}`,
        from: 'jane@client.test',
        to: ACCOUNT_EMAIL,
        subject: 'Question',
        bodyText: `Question number ${round}?`,
        messageIdHeader: `<in${round}@client.test>`,
      });
      ai.queueOutput('classification', triageOutput);
      ai.queueOutput(
        'drafting',
        draftOutput(
          'Hello Jane, thank you so much for reaching out today. Our support hours are nine to five central, Monday through Friday, and we are always happy to help with anything else you might need.',
        ),
      );
      const cycle1 = await runLoopCycle(harness.db, ctx, account, gmail, ai, enc, { env });
      expect(cycle1.draftsCreated).toBe(1);

      // The user edits it down and sends (correlation header preserved).
      const drafts = await harness.db.select().from(generatedDrafts);
      const draft = drafts.find((d) => d.status === 'drafted')!;
      gmail.removeDraftFromMailbox(draft.providerDraftId!);
      arrive({
        id: `sent${round}`,
        threadId: `t${round}`,
        sent: true,
        from: ACCOUNT_EMAIL,
        to: 'jane@client.test',
        subject: 'Re: Question',
        bodyText: 'Hi Jane — 9-5 CT, Mon-Fri. Best.',
        inReplyToHeader: `<in${round}@client.test>`,
        correlationKey: draft.correlationKey!,
      });
      ai.queueOutput('comparison', brevitySemantic);
      const cycle2 = await runLoopCycle(harness.db, ctx, account, gmail, ai, enc, { env });
      expect(cycle2.paired).toBe(1);
      expect(cycle2.compared).toBe(1);
    }

    // ---- After 3 rounds the loop proposed exactly one scoped brevity rule ----
    const pairs = await harness.db.select().from(draftSentPairs);
    expect(pairs).toHaveLength(3);
    const pending = await listPendingProposals(harness.db, ctx);
    expect(pending).toHaveLength(1);
    expect(pending[0]!.evidenceCount).toBe(3);

    // Nothing active before approval.
    expect((await harness.db.select().from(ruleProposals))[0]!.status).toBe('pending');

    // ---- Human approves ----
    const { resultingRuleId } = await approveProposal(harness.db, ctx, pending[0]!.id);
    expect(resultingRuleId).toBeTruthy();

    // ---- Next inbound: the drafting prompt now contains the approved rule ----
    arrive({
      id: 'in4',
      threadId: 't4',
      from: 'jane@client.test',
      to: ACCOUNT_EMAIL,
      subject: 'Question',
      bodyText: 'One more question?',
      messageIdHeader: '<in4@client.test>',
    });
    ai.queueOutput('classification', triageOutput);
    ai.queueOutput('drafting', {
      ...draftOutput('Hi Jane — happy to help. 9-5 CT.'),
      rulesUsed: [resultingRuleId!],
    });
    const cycle = await runLoopCycle(harness.db, ctx, account, gmail, ai, enc, { env });
    expect(cycle.draftsCreated).toBe(1);

    const draftingCall = ai.calls.filter((c) => c.role === 'drafting').at(-1)!;
    expect(draftingCall.user).toContain('shorter and more concise');
    expect(draftingCall.user).toContain(resultingRuleId!);

    // The citation of the approved rule validates (traceable provenance).
    const drafts = await harness.db.select().from(generatedDrafts);
    const lastDraft = drafts
      .filter((d) => d.status === 'drafted')
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .at(-1)!;
    expect(lastDraft.rulesUsed).toEqual([resultingRuleId]);
  });

  it('kill switch stops drafting while sent capture and learning keep running', async () => {
    // A drafted reply exists and gets sent…
    arrive({
      id: 'in1',
      threadId: 't1',
      from: 'jane@client.test',
      to: ACCOUNT_EMAIL,
      subject: 'Question',
      bodyText: 'Q?',
      messageIdHeader: '<in1@client.test>',
    });
    ai.queueOutput('classification', triageOutput);
    ai.queueOutput('drafting', draftOutput('Long reply.'));
    await runLoopCycle(harness.db, ctx, account, gmail, ai, enc, { env });
    const [draft] = await harness.db.select().from(generatedDrafts);
    gmail.removeDraftFromMailbox(draft!.providerDraftId!);
    arrive({
      id: 'sent1',
      threadId: 't1',
      sent: true,
      from: ACCOUNT_EMAIL,
      to: 'jane@client.test',
      subject: 'Re: Question',
      bodyText: 'Short.',
      correlationKey: draft!.correlationKey!,
      inReplyToHeader: '<in1@client.test>',
    });

    // …and a NEW inbound arrives while the kill switch is ON.
    arrive({
      id: 'in2',
      threadId: 't2',
      from: 'jane@client.test',
      to: ACCOUNT_EMAIL,
      subject: 'Another',
      bodyText: 'Q2?',
      messageIdHeader: '<in2@client.test>',
    });
    ai.queueOutput('classification', triageOutput);
    ai.queueOutput('drafting', draftOutput('Another long reply.'));
    ai.queueOutput('comparison', brevitySemantic);

    const killed = parseEnv({
      ECHOLOOP_DRAFTING_KILL_SWITCH: 'true',
      ECHOLOOP_ACTIVATION_MODE: 'allowlist',
    } as NodeJS.ProcessEnv);
    const summary = await runLoopCycle(harness.db, ctx, account, gmail, ai, enc, { env: killed });

    expect(summary.draftsCreated).toBe(0); // drafting fully stopped
    expect(summary.paired).toBe(1); // sent capture still active
    expect(summary.compared).toBe(1); // learning still active
    expect(gmail.createdDrafts).toHaveLength(1); // only the pre-kill draft exists
  });
});
