import { createHash } from 'node:crypto';
import type { GmailMessagePart, GmailRawMessage } from './provider.js';

/**
 * Canonical parsing of Gmail message payloads into a normalized shape the
 * rest of the system consumes. Pure functions, no I/O.
 */

export interface ParsedParticipant {
  address: string;
  displayName: string | null;
}

export interface ParsedMessage {
  providerMessageId: string;
  providerThreadId: string;
  labelIds: string[];
  snippet: string;
  internalDate: Date;
  subject: string | null;
  messageIdHeader: string | null;
  inReplyToHeader: string | null;
  referencesHeader: string | null;
  from: ParsedParticipant | null;
  to: ParsedParticipant[];
  cc: ParsedParticipant[];
  bodyText: string;
  contentHash: string;
  /** X-EchoLoop-Correlation header when present (pairing evidence). */
  correlationKey: string | null;
  /** Bulk/newsletter/mailing-list signals from headers (List-Id, List-Unsubscribe, Precedence, Auto-Submitted). */
  isBulk: boolean;
  /** Calendar/system notification (text/calendar part present). */
  isCalendar: boolean;
}

function headerValue(part: GmailMessagePart, name: string): string | null {
  const header = part.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase());
  return header?.value ?? null;
}

/**
 * Parse an RFC 5322 address list ("Name" <a@b.c>, d@e.f) into participants.
 * Tolerant by design: malformed entries are kept as bare addresses.
 */
export function parseAddressList(raw: string | null): ParsedParticipant[] {
  if (!raw) return [];
  const out: ParsedParticipant[] = [];
  // Split on commas that are not inside quoted display names.
  const entries = raw.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const angled = trimmed.match(/^(?:"?([^"<]*)"?\s*)?<([^>]+)>$/);
    if (angled) {
      const name = angled[1]?.trim();
      out.push({ address: angled[2]!.trim().toLowerCase(), displayName: name || null });
    } else {
      out.push({ address: trimmed.toLowerCase(), displayName: null });
    }
  }
  return out;
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
}

/** Very small HTML-to-text fallback for html-only messages. */
function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Depth-first search for the best text body: text/plain preferred, html fallback. */
export function extractBodyText(payload: GmailMessagePart): string {
  let html: string | null = null;

  const stack: GmailMessagePart[] = [payload];
  while (stack.length > 0) {
    const part = stack.shift()!;
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
    if (part.mimeType === 'text/html' && part.body?.data && html === null) {
      html = decodeBase64Url(part.body.data);
    }
    if (part.parts) stack.push(...part.parts);
  }
  return html ? htmlToText(html) : '';
}

function hasCalendarPart(part: GmailMessagePart): boolean {
  if (part.mimeType === 'text/calendar' || part.mimeType === 'application/ics') return true;
  return (part.parts ?? []).some(hasCalendarPart);
}

function detectBulk(payload: GmailMessagePart): boolean {
  const precedence = headerValue(payload, 'Precedence')?.toLowerCase() ?? '';
  const autoSubmitted = headerValue(payload, 'Auto-Submitted')?.toLowerCase() ?? '';
  return (
    headerValue(payload, 'List-Id') !== null ||
    headerValue(payload, 'List-Unsubscribe') !== null ||
    precedence === 'bulk' ||
    precedence === 'list' ||
    (autoSubmitted !== '' && autoSubmitted !== 'no')
  );
}

export function parseGmailMessage(raw: GmailRawMessage): ParsedMessage {
  const from = parseAddressList(headerValue(raw.payload, 'From'))[0] ?? null;
  const bodyText = extractBodyText(raw.payload);
  return {
    correlationKey: headerValue(raw.payload, 'X-EchoLoop-Correlation'),
    isBulk: detectBulk(raw.payload),
    isCalendar: hasCalendarPart(raw.payload),
    providerMessageId: raw.id,
    providerThreadId: raw.threadId,
    labelIds: raw.labelIds ?? [],
    snippet: raw.snippet ?? '',
    internalDate: new Date(Number(raw.internalDate)),
    subject: headerValue(raw.payload, 'Subject'),
    messageIdHeader: headerValue(raw.payload, 'Message-ID'),
    inReplyToHeader: headerValue(raw.payload, 'In-Reply-To'),
    referencesHeader: headerValue(raw.payload, 'References'),
    from,
    to: parseAddressList(headerValue(raw.payload, 'To')),
    cc: parseAddressList(headerValue(raw.payload, 'Cc')),
    bodyText,
    contentHash: createHash('sha256').update(bodyText).digest('hex'),
  };
}

/**
 * True when `address` belongs to the connected account, treating
 * plus-addressing (user+tag@domain) and case as the same mailbox.
 */
export function isOwnAlias(accountEmail: string, address: string): boolean {
  const normalize = (a: string): string => {
    const [local = '', domain = ''] = a.trim().toLowerCase().split('@');
    return `${local.split('+')[0]}@${domain}`;
  };
  return normalize(accountEmail) === normalize(address);
}

/** Normalize a subject for matching: strip reply/forward prefixes and whitespace. */
export function normalizeSubject(subject: string | null): string {
  return (subject ?? '')
    .replace(/^(\s*(re|fwd?|aw):\s*)+/i, '')
    .trim()
    .toLowerCase();
}
