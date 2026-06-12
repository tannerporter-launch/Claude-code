/**
 * RFC 2822 MIME construction for reply DRAFTS (BUILD_BRIEF §14 Phase 6).
 * Threading is preserved via In-Reply-To/References; a correlation header
 * supports Phase 7 pairing. This module builds message bytes only — it never
 * transmits anything.
 */

export const CORRELATION_HEADER = 'X-EchoLoop-Correlation';

export interface ReplyMimeInput {
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  bodyText: string;
  inReplyTo?: string | null;
  references?: string | null;
  correlationKey?: string | null;
}

function encodeHeaderValue(value: string): string {
  // RFC 2047 encode only when non-ASCII present.
  if (/^[\x20-\x7e]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf8').toString('base64')}?=`;
}

export function buildReplyMime(input: ReplyMimeInput): string {
  const headers: string[] = [`From: ${input.from}`, `To: ${input.to.join(', ')}`];
  if (input.cc && input.cc.length > 0) headers.push(`Cc: ${input.cc.join(', ')}`);
  headers.push(`Subject: ${encodeHeaderValue(input.subject)}`);
  if (input.inReplyTo) {
    headers.push(`In-Reply-To: ${input.inReplyTo}`);
    const refs = [input.references, input.inReplyTo].filter(Boolean).join(' ');
    headers.push(`References: ${refs}`);
  }
  if (input.correlationKey) headers.push(`${CORRELATION_HEADER}: ${input.correlationKey}`);
  headers.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"');

  return `${headers.join('\r\n')}\r\n\r\n${input.bodyText}`;
}

export function mimeToBase64Url(mime: string): string {
  return Buffer.from(mime, 'utf8').toString('base64url');
}
