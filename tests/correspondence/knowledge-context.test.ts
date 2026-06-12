import {
  addRuleVersion,
  assembleContext,
  createKnowledgeDocument,
  createRule,
  exportPlaybook,
  persistContextSnapshot,
  rollbackRule,
  setRuleStatus,
  updateKnowledgeDocument,
} from '@echoloop/correspondence';
import {
  contextSnapshots,
  knowledgeDocumentVersions,
  ruleVersions,
  rules,
} from '@echoloop/database';
import { createEncryptionService, generateEncryptionKey } from '@echoloop/security';
import { createTestDb, seed } from '@echoloop/testing';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const MATCH = {
  relationship: 'client',
  messageTypes: ['information_request'],
  isGroupThread: false,
  contactAddress: 'jane@client.test',
};

describe('knowledge base and context assembly', () => {
  let harness: Awaited<ReturnType<typeof createTestDb>>;
  let ctx: { organizationId: string };
  let enc: ReturnType<typeof createEncryptionService>;

  beforeEach(async () => {
    harness = await createTestDb();
    enc = createEncryptionService(generateEncryptionKey());
    const seeded = await seed(harness.db, generateEncryptionKey());
    ctx = { organizationId: seeded.organizationId };
  });
  afterEach(async () => {
    await harness.close();
  });

  it('starter playbook is empty — nothing unapproved is seeded', async () => {
    const playbook = await exportPlaybook(harness.db, ctx);
    expect(playbook.knowledge).toEqual([]);
    expect(playbook.rules).toEqual([]);
    const assembled = await assembleContext(harness.db, ctx, MATCH);
    expect(assembled.includedRecords).toEqual([]);
  });

  it('INVARIANT: facts override style — facts render first and contradicting style rules are excluded', async () => {
    const fact = await createKnowledgeDocument(harness.db, ctx, {
      category: 'approved_fact',
      title: 'Pricing',
      content: 'The monthly plan costs $500.',
    });
    await createKnowledgeDocument(harness.db, ctx, {
      category: 'personal_style',
      title: 'Tone',
      content: 'Keep replies short and casual.',
    });
    const badRule = await createRule(harness.db, ctx, {
      category: 'personal_style',
      instruction: 'Tell clients the plan costs $400 to sound generous.',
      scopeType: 'user_global',
    });
    // The human (or Phase 8 routing) records the contradiction.
    await harness.db
      .update(rules)
      .set({ contradictsKnowledgeId: fact.id })
      .where(eq(rules.id, badRule.id));

    const assembled = await assembleContext(harness.db, ctx, MATCH);
    expect(assembled.rendered.indexOf('Approved facts')).toBeLessThan(
      assembled.rendered.indexOf('Personal style'),
    );
    expect(assembled.rendered).toContain('override every stylistic instruction');
    expect(assembled.rendered).not.toContain('$400');
    expect(assembled.excludedConflicts).toContainEqual({
      type: 'rule',
      id: badRule.id,
      reason: 'contradicts_approved_fact',
    });
  });

  it('expired temporary emphasis is excluded; active emphasis is included', async () => {
    await createKnowledgeDocument(harness.db, ctx, {
      category: 'temporary_emphasis',
      title: 'Expired push',
      content: 'Mention the spring webinar.',
      effectiveFrom: new Date('2026-01-01'),
      effectiveUntil: new Date('2026-02-01'),
    });
    await createKnowledgeDocument(harness.db, ctx, {
      category: 'temporary_emphasis',
      title: 'Current push',
      content: 'Mention the summer launch.',
      effectiveFrom: new Date('2026-06-01'),
      effectiveUntil: new Date('2026-07-01'),
    });
    const assembled = await assembleContext(harness.db, ctx, MATCH, {
      now: new Date('2026-06-12'),
    });
    expect(assembled.rendered).toContain('summer launch');
    expect(assembled.rendered).not.toContain('spring webinar');
    expect(assembled.excludedConflicts.some((c) => c.reason === 'expired_emphasis')).toBe(true);
  });

  it('relationship-scoped rules apply only to matching context', async () => {
    await createRule(harness.db, ctx, {
      category: 'personal_style',
      instruction: 'Open client replies with their first name.',
      scopeType: 'relationship',
      condition: { relationships: ['client'] },
    });
    await createRule(harness.db, ctx, {
      category: 'personal_style',
      instruction: 'Vendors get formal greetings.',
      scopeType: 'relationship',
      condition: { relationships: ['vendor'] },
    });

    const clientCtx = await assembleContext(harness.db, ctx, MATCH);
    expect(clientCtx.rendered).toContain('first name');
    expect(clientCtx.rendered).not.toContain('Vendors get formal');

    const vendorCtx = await assembleContext(harness.db, ctx, {
      ...MATCH,
      relationship: 'vendor',
    });
    expect(vendorCtx.rendered).toContain('Vendors get formal');
    expect(vendorCtx.rendered).not.toContain('first name');
  });

  it('INVARIANT: rejected and rolled-back rules never enter context', async () => {
    const rejected = await createRule(harness.db, ctx, {
      category: 'personal_style',
      instruction: 'REJECTED instruction.',
      scopeType: 'user_global',
    });
    await setRuleStatus(harness.db, ctx, rejected.id, 'rejected');

    const rolled = await createRule(harness.db, ctx, {
      category: 'personal_style',
      instruction: 'ROLLED BACK instruction.',
      scopeType: 'user_global',
    });
    await rollbackRule(harness.db, ctx, rolled.id); // v1 → status rolled_back

    const assembled = await assembleContext(harness.db, ctx, MATCH);
    expect(assembled.rendered).not.toContain('REJECTED');
    expect(assembled.rendered).not.toContain('ROLLED BACK');
  });

  it('rollback restores the previous rule version', async () => {
    const rule = await createRule(harness.db, ctx, {
      category: 'personal_style',
      instruction: 'Version one instruction.',
      scopeType: 'user_global',
    });
    await addRuleVersion(harness.db, ctx, rule.id, { instruction: 'Version two instruction.' });

    let assembled = await assembleContext(harness.db, ctx, MATCH);
    expect(assembled.rendered).toContain('Version two');

    await rollbackRule(harness.db, ctx, rule.id);
    assembled = await assembleContext(harness.db, ctx, MATCH);
    expect(assembled.rendered).toContain('Version one');
    expect(assembled.rendered).not.toContain('Version two');
  });

  it('versions are immutable history: every edit creates a new version row', async () => {
    const doc = await createKnowledgeDocument(harness.db, ctx, {
      category: 'terminology',
      title: 'Product name',
      content: 'Always write "EchoLoop", never "Echoloop".',
    });
    await updateKnowledgeDocument(harness.db, ctx, doc.id, 'Always write "EchoLoop™".');
    const versions = await harness.db
      .select()
      .from(knowledgeDocumentVersions)
      .where(eq(knowledgeDocumentVersions.documentId, doc.id));
    expect(versions).toHaveLength(2);
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);

    const rule = await createRule(harness.db, ctx, {
      category: 'personal_style',
      instruction: 'v1',
      scopeType: 'user_global',
    });
    await addRuleVersion(harness.db, ctx, rule.id, { instruction: 'v2' });
    const ruleVersionRows = await harness.db
      .select()
      .from(ruleVersions)
      .where(eq(ruleVersions.ruleId, rule.id));
    expect(ruleVersionRows).toHaveLength(2);
  });

  it('context snapshot provenance is complete (IDs+versions, exclusions, hash, encrypted render)', async () => {
    const doc = await createKnowledgeDocument(harness.db, ctx, {
      category: 'approved_fact',
      title: 'Hours',
      content: 'Support hours are 9–5 CT.',
    });
    const rule = await createRule(harness.db, ctx, {
      category: 'personal_style',
      instruction: 'Sign off with "Best, Pilot".',
      scopeType: 'user_global',
    });

    const assembled = await assembleContext(harness.db, ctx, MATCH);
    const snapshot = await persistContextSnapshot(harness.db, ctx, assembled, enc, {
      promptVersion: 'drafting-v1',
      modelId: 'mock-model',
    });

    const [stored] = await harness.db
      .select()
      .from(contextSnapshots)
      .where(eq(contextSnapshots.id, snapshot.id));
    const included = stored!.includedRecords as { type: string; id: string; version: number }[];
    expect(included).toContainEqual(
      expect.objectContaining({ type: 'knowledge', id: doc.id, version: 1 }),
    );
    expect(included).toContainEqual(
      expect.objectContaining({ type: 'rule', id: rule.id, version: 1 }),
    );
    expect(stored!.contentHash).toBe(assembled.contentHash);
    expect(stored!.promptVersion).toBe('drafting-v1');
    expect(stored!.modelId).toBe('mock-model');
    // Rendered context is stored encrypted, never plaintext.
    expect(stored!.renderedEncrypted).toContain('v1:');
    expect(stored!.renderedEncrypted).not.toContain('Support hours');
    expect(enc.decrypt(stored!.renderedEncrypted!)).toBe(assembled.rendered);
  });
});
