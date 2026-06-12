import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Phase 0 structural guarantees: the canonical workspace layout and governance
 * documents exist, and architecture boundaries are respected.
 */

const REQUIRED_PACKAGES = [
  'ai',
  'correspondence',
  'database',
  'gmail',
  'jobs',
  'schemas',
  'security',
  'testing',
];

const REQUIRED_DOCS = [
  'ARCHITECTURE.md',
  'BACKLOG.md',
  'DATA_MODEL.md',
  'DECISIONS.md',
  'EVALUATION.md',
  'GMAIL_INTEGRATION.md',
  'PRIVACY.md',
  'SECURITY.md',
  'STATUS.md',
];

// Forbidden internal dependency directions (BUILD_BRIEF 5 / ARCHITECTURE.md).
// The Gmail adapter must stay free of product/orchestration concerns, and no
// package may depend on the apps.
const FORBIDDEN_DEPENDENCIES: Record<string, string[]> = {
  '@echoloop/gmail': ['@echoloop/ai', '@echoloop/correspondence'],
  '@echoloop/schemas': [
    '@echoloop/ai',
    '@echoloop/gmail',
    '@echoloop/database',
    '@echoloop/correspondence',
  ],
};

function readPkg(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

describe('workspace structure', () => {
  it('has all required packages', () => {
    for (const pkg of REQUIRED_PACKAGES) {
      expect(existsSync(join(repoRoot, 'packages', pkg, 'package.json')), pkg).toBe(true);
    }
  });

  it('has both apps', () => {
    expect(existsSync(join(repoRoot, 'apps', 'web', 'package.json'))).toBe(true);
    expect(existsSync(join(repoRoot, 'apps', 'worker', 'package.json'))).toBe(true);
  });

  it('has all required governance docs', () => {
    for (const doc of REQUIRED_DOCS) {
      expect(existsSync(join(repoRoot, 'docs', doc)), doc).toBe(true);
    }
  });

  it('ignores exports/ except .gitkeep', () => {
    const gitignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8');
    expect(gitignore).toContain('exports/*');
    expect(gitignore).toContain('!exports/.gitkeep');
  });
});

describe('architecture boundaries', () => {
  const allDeps = (pkg: Record<string, unknown>): string[] => [
    ...Object.keys((pkg.dependencies as Record<string, string>) ?? {}),
    ...Object.keys((pkg.devDependencies as Record<string, string>) ?? {}),
  ];

  it('no package depends on the apps', () => {
    for (const pkg of REQUIRED_PACKAGES) {
      const deps = allDeps(readPkg(join(repoRoot, 'packages', pkg, 'package.json')));
      expect(
        deps.some((d) => d.startsWith('@echoloop/web') || d.startsWith('@echoloop/worker')),
      ).toBe(false);
    }
  });

  it('respects forbidden internal dependency directions', () => {
    for (const [name, forbidden] of Object.entries(FORBIDDEN_DEPENDENCIES)) {
      const short = name.replace('@echoloop/', '');
      const deps = allDeps(readPkg(join(repoRoot, 'packages', short, 'package.json')));
      for (const bad of forbidden) {
        expect(deps.includes(bad), `${name} must not depend on ${bad}`).toBe(false);
      }
    }
  });
});
