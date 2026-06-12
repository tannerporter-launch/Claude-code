import {
  GmailAuthError,
  type GmailDraftRef,
  type GmailHistoryEvent,
  type GmailHistoryPage,
  type GmailProfile,
  type GmailProvider,
  type GmailRawMessage,
  type GmailThread,
  HistoryCursorInvalidError,
} from './provider.js';

/**
 * In-memory Gmail provider for automated tests (BUILD_BRIEF Phase 2: all
 * automated tests use mocks). Supports scripted history pages, duplicate-event
 * injection, invalid-cursor and invalid_grant simulation, and records every
 * call so tests can assert that no write operation was ever attempted.
 *
 * This is a MOCK and is never represented as a live integration
 * (docs/STATUS.md).
 */

export interface MockMessageInput {
  id: string;
  threadId: string;
  labelIds?: string[];
  from?: string;
  to?: string;
  cc?: string;
  subject?: string;
  bodyText?: string;
  internalDate?: number;
  messageIdHeader?: string;
  inReplyToHeader?: string;
}

function toRaw(input: MockMessageInput): GmailRawMessage {
  const headers = [
    { name: 'From', value: input.from ?? 'sender@example.test' },
    { name: 'To', value: input.to ?? 'pilot@example.test' },
    { name: 'Subject', value: input.subject ?? '(no subject)' },
    { name: 'Message-ID', value: input.messageIdHeader ?? `<${input.id}@example.test>` },
  ];
  if (input.cc) headers.push({ name: 'Cc', value: input.cc });
  if (input.inReplyToHeader) headers.push({ name: 'In-Reply-To', value: input.inReplyToHeader });
  return {
    id: input.id,
    threadId: input.threadId,
    labelIds: input.labelIds ?? ['INBOX'],
    snippet: (input.bodyText ?? '').slice(0, 80),
    internalDate: String(input.internalDate ?? Date.now()),
    payload: {
      mimeType: 'text/plain',
      headers,
      body: { data: Buffer.from(input.bodyText ?? '').toString('base64url') },
    },
  };
}

export class MockGmailProvider implements GmailProvider {
  readonly calls: { op: string; args: unknown[] }[] = [];

  private messages = new Map<string, GmailRawMessage>();
  private historyPages: GmailHistoryPage[] = [];
  private profile: GmailProfile = { emailAddress: 'pilot@example.test', historyId: '1000' };
  private failNextHistoryWithInvalidCursor = false;
  private failAllWithInvalidGrant = false;
  private revoked = false;

  setProfile(emailAddress: string, historyId: string): void {
    this.profile = { emailAddress, historyId };
  }

  addMessage(input: MockMessageInput): void {
    this.messages.set(input.id, toRaw(input));
  }

  /** Queue a history page; events may intentionally repeat to simulate duplicates. */
  queueHistoryPage(
    events: GmailHistoryEvent[],
    latestHistoryId: string,
    nextPageToken?: string,
  ): void {
    this.historyPages.push({ events, latestHistoryId, nextPageToken });
  }

  simulateInvalidCursorOnce(): void {
    this.failNextHistoryWithInvalidCursor = true;
  }

  /** Simulate an expired/revoked refresh token (Testing-status 7-day expiry). */
  simulateInvalidGrant(): void {
    this.failAllWithInvalidGrant = true;
  }

  private guard(op: string, args: unknown[]): void {
    this.calls.push({ op, args });
    if (this.revoked) {
      throw new GmailAuthError('unauthorized', 'Connection revoked');
    }
    if (this.failAllWithInvalidGrant) {
      throw new GmailAuthError('reconnect_required', 'invalid_grant (simulated)');
    }
  }

  async getProfile(): Promise<GmailProfile> {
    this.guard('getProfile', []);
    return { ...this.profile };
  }

  async listHistory(startHistoryId: string, pageToken?: string): Promise<GmailHistoryPage> {
    this.guard('listHistory', [startHistoryId, pageToken]);
    if (this.failNextHistoryWithInvalidCursor) {
      this.failNextHistoryWithInvalidCursor = false;
      throw new HistoryCursorInvalidError();
    }
    const page = this.historyPages.shift();
    if (!page) {
      return { events: [], latestHistoryId: startHistoryId };
    }
    return page;
  }

  async getMessage(messageId: string): Promise<GmailRawMessage> {
    this.guard('getMessage', [messageId]);
    const msg = this.messages.get(messageId);
    if (!msg) throw new Error(`Mock has no message ${messageId}`);
    return msg;
  }

  async getThread(threadId: string): Promise<GmailThread> {
    this.guard('getThread', [threadId]);
    return {
      id: threadId,
      messages: [...this.messages.values()].filter((m) => m.threadId === threadId),
    };
  }

  async listDrafts(): Promise<GmailDraftRef[]> {
    this.guard('listDrafts', []);
    return [];
  }

  async getDraft(draftId: string): Promise<GmailDraftRef> {
    this.guard('getDraft', [draftId]);
    throw new Error(`Mock has no draft ${draftId}`);
  }

  async revoke(): Promise<void> {
    this.calls.push({ op: 'revoke', args: [] });
    this.revoked = true;
  }

  /** Operations that would write to Gmail. Must always be empty in Phase 2. */
  writeOps(): string[] {
    return this.calls.filter((c) => /create|update|insert|modify/i.test(c.op)).map((c) => c.op);
  }
}
