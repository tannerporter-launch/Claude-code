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
