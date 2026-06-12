/**
 * The Gmail provider abstraction. Phase 2 exposes READ-ONLY operations only;
 * createDraft arrives in Phase 6. No send-style operation may ever exist here
 * (BUILD_BRIEF §7.1 — enforced by the static no-send test).
 */

/**
 * OAuth scopes for the controlled pilot, confirmed by the user
 * (docs/DECISIONS.md D-009): read mail + manage drafts. Fixed in code on
 * purpose — scopes are a stop-and-ask decision and must not drift via config.
 */
export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
] as const;

export interface GmailProfile {
  emailAddress: string;
  historyId: string;
}

export interface GmailMessageRef {
  id: string;
  threadId: string;
}

export interface GmailHistoryEvent {
  historyId: string;
  type: 'messageAdded';
  message: GmailMessageRef;
}

export interface GmailHistoryPage {
  events: GmailHistoryEvent[];
  nextPageToken?: string;
  latestHistoryId: string;
}

export interface GmailHeader {
  name: string;
  value: string;
}

/** Raw message shape as returned by users.messages.get (format=full). */
export interface GmailRawMessage {
  id: string;
  threadId: string;
  labelIds: string[];
  snippet: string;
  internalDate: string;
  payload: GmailMessagePart;
}

export interface GmailMessagePart {
  mimeType: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
}

export interface GmailThread {
  id: string;
  messages: GmailRawMessage[];
}

export interface GmailDraftRef {
  id: string;
  message: GmailMessageRef;
}

export interface CreateDraftInput {
  threadId: string;
  rawMimeBase64Url: string;
}

/**
 * Approved operations (BUILD_BRIEF §7.1): reads plus draft creation. NEVER any
 * send operation — enforced by the static no-send test and code review.
 */
export interface GmailProvider {
  getProfile(): Promise<GmailProfile>;
  listHistory(startHistoryId: string, pageToken?: string): Promise<GmailHistoryPage>;
  getMessage(messageId: string): Promise<GmailRawMessage>;
  getThread(threadId: string): Promise<GmailThread>;
  listDrafts(): Promise<GmailDraftRef[]>;
  getDraft(draftId: string): Promise<GmailDraftRef>;
  /** Create a DRAFT in the user's mailbox. Creating is not sending. */
  createDraft(input: CreateDraftInput): Promise<GmailDraftRef>;
  /** Revoke this connection's token with Google. */
  revoke(): Promise<void>;
}

/**
 * Authentication failure. `reconnect_required` covers expired or revoked
 * refresh tokens (Google returns invalid_grant) — EXPECTED roughly weekly
 * while the OAuth consent screen is in Testing status, so callers must treat
 * it as a clean state transition, not a crash.
 */
export class GmailAuthError extends Error {
  constructor(
    public readonly reason: 'reconnect_required' | 'unauthorized',
    message?: string,
  ) {
    super(message ?? `Gmail auth failed: ${reason}`);
    this.name = 'GmailAuthError';
  }
}

/** The stored historyId is too old or invalid; a controlled re-baseline is required. */
export class HistoryCursorInvalidError extends Error {
  constructor(message = 'Gmail history cursor is invalid or expired') {
    super(message);
    this.name = 'HistoryCursorInvalidError';
  }
}

export class GmailRateLimitError extends Error {
  constructor(message = 'Gmail rate limit exceeded') {
    super(message);
    this.name = 'GmailRateLimitError';
  }
}
