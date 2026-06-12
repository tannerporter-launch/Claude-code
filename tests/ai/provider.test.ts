import { AiProviderError, AiValidationError, MockAiProvider, extractJson } from '@echoloop/ai';
import { triageResultSchema } from '@echoloop/schemas';
import { describe, expect, it } from 'vitest';

const validTriage = {
  needsReply: true,
  messageTypes: ['information_request'],
  relationship: { value: 'client', source: 'inferred' },
  isGroupThread: false,
  isInternal: false,
  confidence: 0.9,
};

describe('AI provider abstraction', () => {
  it('validates output against the schema and returns parsed data', async () => {
    const ai = new MockAiProvider();
    ai.queueOutput('classification', validTriage);
    const result = await ai.complete({
      role: 'classification',
      system: 's',
      user: 'u',
      schema: triageResultSchema,
    });
    expect(result.output.needsReply).toBe(true);
    expect(result.output.requestedActions).toEqual([]); // defaults applied
  });

  it('INVARIANT: invalid model output fails safe with AiValidationError', async () => {
    const ai = new MockAiProvider();
    ai.queueOutput('classification', { totally: 'wrong' });
    await expect(
      ai.complete({ role: 'classification', system: 's', user: 'u', schema: triageResultSchema }),
    ).rejects.toBeInstanceOf(AiValidationError);
  });

  it('rejects schema-violating extras (strict schema)', async () => {
    const ai = new MockAiProvider();
    ai.queueOutput('classification', { ...validTriage, injected: 'field' });
    await expect(
      ai.complete({ role: 'classification', system: 's', user: 'u', schema: triageResultSchema }),
    ).rejects.toBeInstanceOf(AiValidationError);
  });

  it('surfaces provider failures as AiProviderError', async () => {
    const ai = new MockAiProvider();
    ai.simulateProviderErrorOnce();
    await expect(
      ai.complete({ role: 'classification', system: 's', user: 'u', schema: triageResultSchema }),
    ).rejects.toBeInstanceOf(AiProviderError);
  });
});

describe('extractJson', () => {
  it('extracts a JSON object from surrounding prose', () => {
    expect(extractJson('Sure! {"a": 1} hope that helps')).toEqual({ a: 1 });
  });
  it('throws AiValidationError on non-JSON output', () => {
    expect(() => extractJson('no json here')).toThrow(AiValidationError);
    expect(() => extractJson('{broken')).toThrow(AiValidationError);
  });
});
