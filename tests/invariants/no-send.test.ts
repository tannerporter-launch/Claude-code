import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * HARD PRODUCT INVARIANT (BUILD_BRIEF 1.4 / 7.1):
 *
 *   The application never sends an email. No Gmail send operation may exist in
 *   the application's Gmail abstraction (or anywhere in executable app code).
 *
 * This static test fails when a prohibited Gmail send operation name appears in
 * executable application code under apps/ and packages/. It deliberately lives
 * under tests/ so its own pattern list is not scanned.
 *
 * Do not weaken this test to make code pass. If a future feature appears to
 * require sending, stop and escalate (see BUILD_BRIEF 1.2 stop conditions).
 */

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

const SCAN_DIRS = ['apps', 'packages'];

// Prohibited Gmail send operation names / endpoints. Matched case-insensitively.
const PROHIBITED_PATTERNS: { label: string; regex: RegExp }[] = [
  { label: 'gmail users.messages.send', regex: /users\.messages\.send\b/i },
  { label: 'gmail users.drafts.send', regex: /users\.drafts\.send\b/i },
  { label: 'messages.send endpoint', regex: /\bmessages\.send\b/i },
  { label: 'drafts.send endpoint', regex: /\bdrafts\.send\b/i },
  { label: 'sendMessage operation', regex: /\bsendMessage\b/i },
  { label: 'sendDraft operation', regex: /\bsendDraft\b/i },
  { label: 'sendEmail operation', regex: /\bsendEmail\b/i },
  { label: 'gmail.send REST path', regex: /gmail\/v1\/users\/[^/'"`]+\/messages\/send/i },
  { label: 'gmail.send scope', regex: /gmail\.send/i },
];

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    const info = statSync(full);
    if (info.isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      out.push(...collectSourceFiles(full));
    } else if (/\.(ts|tsx|js|cjs|mjs)$/.test(entry) && !/\.test\.(ts|tsx|js)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe('Gmail no-send invariant', () => {
  const files = SCAN_DIRS.flatMap((d) => collectSourceFiles(join(repoRoot, d)));

  it('scans at least the placeholder source files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('contains no prohibited Gmail send operation in executable application code', () => {
    const violations: string[] = [];
    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      for (const { label, regex } of PROHIBITED_PATTERNS) {
        if (regex.test(contents)) {
          violations.push(`${file}: matched prohibited operation "${label}"`);
        }
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});
