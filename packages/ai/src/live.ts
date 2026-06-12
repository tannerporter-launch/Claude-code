import Anthropic from '@anthropic-ai/sdk';
import { parseEnv } from '@echoloop/schemas';
import {
  AiProviderError,
  AiValidationError,
  type AiProvider,
  type AiRequest,
  type AiResult,
  type AiRole,
} from './provider.js';

/**
 * Live Anthropic adapter. Model IDs come from env (D-012), never hardcoded at
 * call sites. The model is asked for JSON; the response is parsed and then
 * validated against the caller's zod schema — schema failure rejects the
 * output whole (AiValidationError).
 *
 * Transmitted data: exactly the system + user strings the caller assembles
 * (documented per feature in docs/PRIVACY.md). Never tokens or credentials.
 */

const PROMPT_VERSION_SUFFIX = 'v1';

function modelForRole(role: AiRole, env = parseEnv()): string {
  switch (role) {
    case 'classification':
      return env.ANTHROPIC_MODEL_CLASSIFICATION;
    case 'drafting':
      return env.ANTHROPIC_MODEL_DRAFTING;
    case 'comparison':
      return env.ANTHROPIC_MODEL_COMPARISON;
  }
}

/** Extract the first JSON object from model text output. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new AiValidationError('No JSON object found in model output');
  }
  try {
    return JSON.parse(text.slice(start, end + 1)) as unknown;
  } catch {
    throw new AiValidationError('Model output was not valid JSON');
  }
}

export function createLiveAiProvider(apiKey: string): AiProvider {
  const client = new Anthropic({ apiKey });

  return {
    async complete<T>(request: AiRequest<T>): Promise<AiResult<T>> {
      const modelId = modelForRole(request.role);
      const startedAt = Date.now();
      let text: string;
      try {
        const response = await client.messages.create({
          model: modelId,
          max_tokens: request.maxTokens ?? 4096,
          system: `${request.system}\n\nRespond with a single JSON object only — no prose, no markdown fences.`,
          messages: [{ role: 'user', content: request.user }],
        });
        if ((response.stop_reason as string) === 'refusal') {
          throw new AiProviderError('Model declined the request');
        }
        text = response.content
          .filter((block): block is Anthropic.TextBlock => block.type === 'text')
          .map((block) => block.text)
          .join('');
      } catch (err) {
        if (err instanceof AiProviderError) throw err;
        throw new AiProviderError(err instanceof Error ? err.message : String(err));
      }

      const parsed = request.schema.safeParse(extractJson(text));
      if (!parsed.success) {
        throw new AiValidationError(parsed.error.message);
      }
      return {
        output: parsed.data,
        modelId,
        promptVersion: `${request.role}-${PROMPT_VERSION_SUFFIX}`,
        latencyMs: Date.now() - startedAt,
      };
    },
  };
}
