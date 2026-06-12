import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { OAuth2Client } from 'google-auth-library';
import { GMAIL_SCOPES, GmailAuthError } from './provider.js';

/**
 * Desktop-app OAuth flow for the single-user pilot. The client credentials
 * JSON is loaded from a path that the env layer guarantees lives OUTSIDE the
 * repository tree. Token persistence is the caller's responsibility (encrypted
 * columns in the database) — nothing here writes tokens to disk.
 */

export interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiryDate: Date | null;
}

/** Parse the downloaded Desktop-app client JSON ("installed" or "web" shape). */
export function loadOAuthClientConfig(credentialsPath: string): OAuthClientConfig {
  const raw = JSON.parse(readFileSync(credentialsPath, 'utf8')) as Record<
    string,
    { client_id?: string; client_secret?: string }
  >;
  const section = raw.installed ?? raw.web;
  if (!section?.client_id || !section.client_secret) {
    throw new Error(
      'Credentials JSON is not a valid Google OAuth client file (expected "installed" with client_id/client_secret)',
    );
  }
  return { clientId: section.client_id, clientSecret: section.client_secret };
}

export function createOAuthClient(config: OAuthClientConfig, redirectUri?: string): OAuth2Client {
  return new OAuth2Client(config.clientId, config.clientSecret, redirectUri);
}

export function buildConsentUrl(client: OAuth2Client): string {
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [...GMAIL_SCOPES],
  });
}

/**
 * Run the interactive loopback consent flow: start a listener on a 127.0.0.1
 * ephemeral port, print the consent URL via `onAuthUrl`, capture the code on
 * redirect, and exchange it for tokens. Only used by the user-run connect CLI;
 * never by automated tests.
 */
export async function runLoopbackConsent(
  config: OAuthClientConfig,
  onAuthUrl: (url: string) => void,
  timeoutMs = 5 * 60 * 1000,
): Promise<OAuthTokens> {
  // The exchange must reuse the exact client/redirect URI the consent URL was
  // built with, so the client is created once the listener port is known.
  let oauthClient: OAuth2Client | undefined;

  const code = await new Promise<string>((resolvePromise, rejectPromise) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const authCode = url.searchParams.get('code');
      const err = url.searchParams.get('error');
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end(
        authCode
          ? 'EchoLoop: Gmail connected. You can close this tab.'
          : 'EchoLoop: consent failed or was denied. You can close this tab.',
      );
      if (authCode) {
        server.close();
        clearTimeout(timer);
        resolvePromise(authCode);
      } else if (err) {
        server.close();
        clearTimeout(timer);
        rejectPromise(new GmailAuthError('unauthorized', `Consent denied: ${err}`));
      }
    });
    const timer = setTimeout(() => {
      server.close();
      rejectPromise(new Error('OAuth consent timed out'));
    }, timeoutMs);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      oauthClient = createOAuthClient(config, `http://127.0.0.1:${port}`);
      onAuthUrl(buildConsentUrl(oauthClient));
    });
  });

  const { tokens } = await oauthClient!.getToken(code);
  if (!tokens.access_token || !tokens.refresh_token) {
    throw new GmailAuthError('unauthorized', 'Token exchange returned no refresh token');
  }
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
  };
}

/** True when a Google auth error means the refresh token is expired/revoked. */
export function isInvalidGrant(err: unknown): boolean {
  const msg =
    err instanceof Error
      ? `${err.message} ${JSON.stringify((err as { response?: { data?: unknown } }).response?.data ?? '')}`
      : String(err);
  return /invalid_grant/i.test(msg);
}

/**
 * Refresh an access token. Maps invalid_grant (expired/revoked refresh token —
 * expected ~weekly in Testing status) to GmailAuthError('reconnect_required').
 */
export async function refreshAccessToken(
  config: OAuthClientConfig,
  refreshToken: string,
): Promise<OAuthTokens> {
  const client = createOAuthClient(config);
  client.setCredentials({ refresh_token: refreshToken });
  try {
    const { credentials } = await client.refreshAccessToken();
    if (!credentials.access_token) {
      throw new GmailAuthError('unauthorized', 'Refresh returned no access token');
    }
    return {
      accessToken: credentials.access_token,
      refreshToken: credentials.refresh_token ?? refreshToken,
      expiryDate: credentials.expiry_date ? new Date(credentials.expiry_date) : null,
    };
  } catch (err) {
    if (isInvalidGrant(err)) {
      throw new GmailAuthError(
        'reconnect_required',
        'Refresh token expired or revoked (expected weekly while the consent screen is in Testing status). Re-run the connect CLI to re-consent.',
      );
    }
    throw err;
  }
}
