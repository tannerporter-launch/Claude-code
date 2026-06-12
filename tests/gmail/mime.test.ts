import {
  type GmailRawMessage,
  extractBodyText,
  isOwnAlias,
  normalizeSubject,
  parseAddressList,
  parseGmailMessage,
} from '@echoloop/gmail';
import { describe, expect, it } from 'vitest';

const b64url = (s: string): string => Buffer.from(s).toString('base64url');

describe('address parsing', () => {
  it('parses display names, angle brackets, and bare addresses', () => {
    const parsed = parseAddressList('"Doe, Jane" <jane@example.test>, bob@example.test');
    expect(parsed).toEqual([
      { address: 'jane@example.test', displayName: 'Doe, Jane' },
      { address: 'bob@example.test', displayName: null },
    ]);
  });

  it('lowercases addresses and handles empty input', () => {
    expect(parseAddressList('Bob <BOB@Example.TEST>')[0]!.address).toBe('bob@example.test');
    expect(parseAddressList(null)).toEqual([]);
  });
});

describe('body extraction', () => {
  it('prefers text/plain in multipart messages', () => {
    const body = extractBodyText({
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/html', body: { data: b64url('<p>html</p>') } },
        { mimeType: 'text/plain', body: { data: b64url('plain text') } },
      ],
    });
    expect(body).toBe('plain text');
  });

  it('falls back to stripped html when no plain part exists', () => {
    const body = extractBodyText({
      mimeType: 'multipart/alternative',
      parts: [{ mimeType: 'text/html', body: { data: b64url('<p>Hello&nbsp;<b>world</b></p>') } }],
    });
    expect(body).toContain('Hello world');
    expect(body).not.toContain('<p>');
  });

  it('traverses nested multiparts', () => {
    const body = extractBodyText({
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [{ mimeType: 'text/plain', body: { data: b64url('nested') } }],
        },
      ],
    });
    expect(body).toBe('nested');
  });
});

describe('full message parsing', () => {
  const raw: GmailRawMessage = {
    id: 'm1',
    threadId: 't1',
    labelIds: ['INBOX', 'UNREAD'],
    snippet: 'snippet',
    internalDate: '1760000000000',
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'Jane <jane@client.test>' },
        { name: 'To', value: 'pilot@example.test' },
        { name: 'Cc', value: 'cc@example.test' },
        { name: 'Subject', value: 'Re: Project timeline' },
        { name: 'Message-ID', value: '<abc@client.test>' },
        { name: 'In-Reply-To', value: '<prev@example.test>' },
      ],
      body: { data: b64url('When can we expect delivery?') },
    },
  };

  it('extracts headers, participants, body, and a content hash', () => {
    const parsed = parseGmailMessage(raw);
    expect(parsed.from?.address).toBe('jane@client.test');
    expect(parsed.to[0]!.address).toBe('pilot@example.test');
    expect(parsed.cc[0]!.address).toBe('cc@example.test');
    expect(parsed.subject).toBe('Re: Project timeline');
    expect(parsed.messageIdHeader).toBe('<abc@client.test>');
    expect(parsed.inReplyToHeader).toBe('<prev@example.test>');
    expect(parsed.bodyText).toBe('When can we expect delivery?');
    expect(parsed.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(parsed.internalDate.getTime()).toBe(1760000000000);
  });
});

describe('alias detection', () => {
  it('treats plus-addressing and case as the same mailbox', () => {
    expect(isOwnAlias('pilot@example.test', 'Pilot@Example.TEST')).toBe(true);
    expect(isOwnAlias('pilot@example.test', 'pilot+tag@example.test')).toBe(true);
    expect(isOwnAlias('pilot@example.test', 'other@example.test')).toBe(false);
  });
});

describe('subject normalization', () => {
  it('strips reply/forward prefixes recursively', () => {
    expect(normalizeSubject('Re: RE: Fwd: Hello')).toBe('hello');
    expect(normalizeSubject(null)).toBe('');
  });
});
