import {
  AiProviderError,
  AiValidationError,
  type AiProvider,
  type AiRequest,
  type AiResult,
} from './provider.js';

/**
 * Mock AI provider for automated tests. Outputs are scripted per role; the
 * same schema-validation path as the live provider applies, so tests can
 * prove that invalid model output fails safe. This is a MOCK and is never
 * represented as a live integration (docs/STATUS.md).
 */
export class MockAiProvider implements AiProvider {
  readonly calls: { role: string; system: string; user: string }[] = [];
  private queues = new Map<string, unknown[]>();
  private failNext: 'provider' | null = null;

  /** Queue a raw output for a role; it will be schema-validated like real output. */
  queueOutput(role: string, output: unknown): void {
    const queue = this.queues.get(role) ?? [];
    queue.push(output);
    this.queues.set(role, queue);
  }

  simulateProviderErrorOnce(): void {
    this.failNext = 'provider';
  }

  async complete<T>(request: AiRequest<T>): Promise<AiResult<T>> {
    this.calls.push({ role: request.role, system: request.system, user: request.user });
    if (this.failNext === 'provider') {
      this.failNext = null;
      throw new AiProviderError('simulated provider failure');
    }
    const queue = this.queues.get(request.role) ?? [];
    const raw = queue.shift();
    if (raw === undefined) {
      throw new AiProviderError(`Mock has no queued output for role "${request.role}"`);
    }
    const parsed = request.schema.safeParse(raw);
    if (!parsed.success) {
      throw new AiValidationError(parsed.error.message);
    }
    return {
      output: parsed.data,
      modelId: 'mock-model',
      promptVersion: `${request.role}-mock`,
      latencyMs: 0,
    };
  }
}
