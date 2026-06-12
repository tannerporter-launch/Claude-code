import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_GOOGLE_CREDENTIALS_PATH,
  requireGoogleCredentialsPath,
  resolveGoogleCredentialsPath,
} from '@echoloop/schemas';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * The downloaded OAuth client secret must live OUTSIDE the repository tree so
 * it can never be committed by accident (user requirement, Phase 2).
 */
describe('Google credentials path safety', () => {
  const repoRoot = process.cwd();
  const outside = mkdtempSync(join(tmpdir(), 'echoloop-creds-'));

  afterAll(() => {
    rmSync(outside, { recursive: true, force: true });
  });

  it('accepts a path outside the repository', () => {
    const path = join(outside, 'credentials.json');
    const resolved = resolveGoogleCredentialsPath(
      { GOOGLE_CREDENTIALS_PATH: path } as NodeJS.ProcessEnv,
      repoRoot,
    );
    expect(resolved).toBe(path);
  });

  it('rejects a path inside the repository tree', () => {
    const inside = join(repoRoot, 'credentials.json');
    expect(() =>
      resolveGoogleCredentialsPath(
        { GOOGLE_CREDENTIALS_PATH: inside } as NodeJS.ProcessEnv,
        repoRoot,
      ),
    ).toThrow(/outside the repository/);
  });

  it('rejects the repo root itself and nested paths', () => {
    expect(() =>
      resolveGoogleCredentialsPath(
        {
          GOOGLE_CREDENTIALS_PATH: join(repoRoot, 'packages', 'gmail', 'secret.json'),
        } as NodeJS.ProcessEnv,
        repoRoot,
      ),
    ).toThrow(/outside the repository/);
  });

  it('defaults to ~/.echoloop/credentials.json', () => {
    const resolved = resolveGoogleCredentialsPath({} as NodeJS.ProcessEnv, repoRoot);
    expect(resolved).toBe(DEFAULT_GOOGLE_CREDENTIALS_PATH);
  });

  it('requireGoogleCredentialsPath also checks existence', () => {
    const missing = join(outside, 'nope.json');
    expect(() =>
      requireGoogleCredentialsPath(
        { GOOGLE_CREDENTIALS_PATH: missing } as NodeJS.ProcessEnv,
        repoRoot,
      ),
    ).toThrow(/not found/);

    const present = join(outside, 'credentials.json');
    writeFileSync(present, '{}');
    expect(
      requireGoogleCredentialsPath(
        { GOOGLE_CREDENTIALS_PATH: present } as NodeJS.ProcessEnv,
        repoRoot,
      ),
    ).toBe(present);
  });
});
