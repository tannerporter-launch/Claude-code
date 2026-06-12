import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { z } from 'zod';

/**
 * Runtime-validated environment configuration. External input (including
 * process.env) is untrusted until parsed here. Secrets are read from the
 * environment only; nothing is defaulted to a real credential.
 */

const base64Key32 = z
  .string()
  .min(1, 'ENCRYPTION_KEY is required')
  .refine((value) => {
    try {
      return Buffer.from(value, 'base64').length === 32;
    } catch {
      return false;
    }
  }, 'ENCRYPTION_KEY must be 32 bytes encoded as base64');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().optional(),
  ENCRYPTION_KEY: base64Key32.optional(),
  GOOGLE_CREDENTIALS_PATH: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  // Model IDs are env-configurable (never hardcoded at call sites; D-012).
  ANTHROPIC_MODEL_CLASSIFICATION: z.string().min(1).default('claude-haiku-4-5'),
  ANTHROPIC_MODEL_DRAFTING: z.string().min(1).default('claude-opus-4-8'),
  ANTHROPIC_MODEL_COMPARISON: z.string().min(1).default('claude-opus-4-8'),
  // Activation policy (BUILD_BRIEF §9). Drafting is off unless explicitly enabled.
  ECHOLOOP_ACTIVATION_MODE: z
    .enum(['disabled', 'dry_run', 'allowlist', 'enabled'])
    .default('disabled'),
  ECHOLOOP_DRAFTING_KILL_SWITCH: z
    .string()
    .optional()
    .transform((value) => value !== 'false'),
  ECHOLOOP_MAX_DRAFTS_PER_HOUR: z.coerce.number().int().nonnegative().default(10),
  ECHOLOOP_MAX_DRAFTS_PER_CYCLE: z.coerce.number().int().nonnegative().default(3),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}

/** Require an encryption key, failing loudly when absent. */
export function requireEncryptionKey(source: NodeJS.ProcessEnv = process.env): string {
  const env = parseEnv(source);
  if (!env.ENCRYPTION_KEY) {
    throw new Error('ENCRYPTION_KEY is required but was not provided');
  }
  return env.ENCRYPTION_KEY;
}

/** Require a database URL, failing loudly when absent. */
export function requireDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  const env = parseEnv(source);
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required but was not provided');
  }
  return env.DATABASE_URL;
}

export const DEFAULT_GOOGLE_CREDENTIALS_PATH = join(homedir(), '.echoloop', 'credentials.json');

function expandHome(path: string): string {
  if (path === '~' || path.startsWith(`~${sep}`) || path.startsWith('~/')) {
    return join(homedir(), path.slice(1));
  }
  return path;
}

/**
 * Resolve the Google OAuth client credentials path. The downloaded client
 * secret must live OUTSIDE the repository working tree so it can never be
 * committed by accident — a path resolving inside `repoRoot` is rejected.
 */
export function resolveGoogleCredentialsPath(
  source: NodeJS.ProcessEnv = process.env,
  repoRoot: string = process.cwd(),
): string {
  const env = parseEnv(source);
  const raw = env.GOOGLE_CREDENTIALS_PATH ?? DEFAULT_GOOGLE_CREDENTIALS_PATH;
  const path = resolve(expandHome(raw));

  const root = resolve(repoRoot);
  if (path === root || path.startsWith(root + sep)) {
    throw new Error(
      `GOOGLE_CREDENTIALS_PATH must resolve outside the repository (got ${path}). ` +
        `Store the client secret somewhere like ${DEFAULT_GOOGLE_CREDENTIALS_PATH}.`,
    );
  }
  if (!isAbsolute(path)) {
    throw new Error('GOOGLE_CREDENTIALS_PATH must be an absolute path');
  }
  return path;
}

/** Like resolveGoogleCredentialsPath, but also requires the file to exist. */
export function requireGoogleCredentialsPath(
  source: NodeJS.ProcessEnv = process.env,
  repoRoot: string = process.cwd(),
): string {
  const path = resolveGoogleCredentialsPath(source, repoRoot);
  if (!existsSync(path)) {
    throw new Error(
      `Google OAuth client credentials not found at ${path}. Download the Desktop-app ` +
        `client JSON from Google Cloud and place it there (never inside the repository).`,
    );
  }
  return path;
}
