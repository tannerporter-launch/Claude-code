import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GMAIL_SCOPES, isInvalidGrant, loadOAuthClientConfig } from '@echoloop/gmail';
import { afterAll, describe, expect, it } from 'vitest';

describe('OAuth client config', () => {
  const dir = mkdtempSync(join(tmpdir(), 'echoloop-oauth-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('loads a Desktop-app ("installed") credentials file', () => {
    const path = join(dir, 'credentials.json');
    writeFileSync(
      path,
      JSON.stringify({ installed: { client_id: 'id-123', client_secret: 'secret-123' } }),
    );
    expect(loadOAuthClientConfig(path)).toEqual({ clientId: 'id-123', clientSecret: 'secret-123' });
  });

  it('rejects a file that is not an OAuth client JSON', () => {
    const path = join(dir, 'bogus.json');
    writeFileSync(path, JSON.stringify({ something: 'else' }));
    expect(() => loadOAuthClientConfig(path)).toThrow(/not a valid Google OAuth client/);
  });
});

describe('scope set (user-approved, D-009)', () => {
  it('requests exactly gmail.readonly and gmail.compose', () => {
    expect(GMAIL_SCOPES).toEqual([
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.compose',
    ]);
  });
});

describe('invalid_grant detection (7-day Testing-status expiry)', () => {
  it('matches Google invalid_grant errors in message or response data', () => {
    expect(isInvalidGrant(new Error('invalid_grant: Token has been expired or revoked.'))).toBe(
      true,
    );
    const gaxios = Object.assign(new Error('request failed'), {
      response: { data: { error: 'invalid_grant' } },
    });
    expect(isInvalidGrant(gaxios)).toBe(true);
    expect(isInvalidGrant(new Error('rateLimitExceeded'))).toBe(false);
  });
});
