/**
 * The AI provider abstraction. All model access goes through this interface
 * (docs/AI_PIPELINE.md); no other package calls a model API directly. Output
 * is untrusted until validated against the supplied schema — validation
 * failures surface as AiValidationError and the caller treats the message as
 * unprocessed-safe (no record, no preview, no draft).
 */

export type AiRole = 'classification' | 'drafting' | 'comparison';

/** Structural subset of a zod schema — keeps provider variance simple. */
export interface SchemaLike<T> {
  safeParse(
    data: unknown,
  ): { success: true; data: T } | { success: false; error: { message: string } };
}

export interface AiRequest<T> {
  role: AiRole;
  system: string;
  user: string;
  schema: SchemaLike<T>;
  maxTokens?: number;
}

export interface AiResult<T> {
  output: T;
  modelId: string;
  promptVersion: string;
  latencyMs: number;
}

export interface AiProvider {
  complete<T>(request: AiRequest<T>): Promise<AiResult<T>>;
}

/** The model returned output that failed schema validation. Fail safe. */
export class AiValidationError extends Error {
  constructor(message = 'AI output failed schema validation') {
    super(message);
    this.name = 'AiValidationError';
  }
}

/** Provider-level failure (network, rate limit, refusal). Fail safe. */
export class AiProviderError extends Error {
  constructor(message = 'AI provider request failed') {
    super(message);
    this.name = 'AiProviderError';
  }
}
