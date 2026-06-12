import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Phase 0 structural guarantees: the canonical workspace layout and governance
 * documents exist, architecture boundaries are respected, and the Gmail SDK
 * stays confined to packages/gmail.
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
  'AI_PIPELINE.md',
  'ARCHITECTURE.md',
  'BACKLOG.md',
  'DATA_MODEL.md',
  'DECISIONS.md',
  'EVALUATION.md',
  'GMAIL_INTEGRATION.md',
  'LEARNING_MODEL.md',
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

// Gmail SDK packages that only packages/gmail may declare or import. Everything
// else must depend on the @echoloop/gmail provider abstraction instead.
const GMAIL_SDK_PREFIXES = ['googleapis', '@googleapis/'];

function readPkg(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

function allDeps(pkg: Record<string, unknown>): string[] {
  return [
    ...Object.keys((pkg.dependencies as Record<string, string>) ?? {}),
    ...Object.keys((pkg.devDependencies as Record<string, string>) ?? {}),
  ];
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

  it('ignores private source material except its README', () => {
    const gitignore = readFileSync(join(repoRoot, '.gitignore'), 'utf8');
    expect(gitignore).toContain('docs/source-material/*');
    expect(gitignore).toContain('!docs/source-material/README.md');
  });
});

describe('architecture boundaries', () => {
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

describe('Gmail SDK import boundary', () => {
  const isGmailSdk = (dep: string): boolean =>
    GMAIL_SDK_PREFIXES.some((prefix) => dep === prefix || dep.startsWith(prefix));

  it('only packages/gmail may declare a Gmail SDK dependency', () => {
    const manifests = [
      join(repoRoot, 'package.json'),
      join(repoRoot, 'apps', 'web', 'package.json'),
      join(repoRoot, 'apps', 'worker', 'package.json'),
      ...REQUIRED_PACKAGES.filter((pkg) => pkg !== 'gmail').map((pkg) =>
        join(repoRoot, 'packages', pkg, 'package.json'),
      ),
    ];
    for (const manifest of manifests) {
      const offending = allDeps(readPkg(manifest)).filter(isGmailSdk);
      expect(offending, `${manifest} must not depend on a Gmail SDK directly`).toEqual([]);
    }
  });

  it('ESLint restricts direct Gmail SDK imports outside packages/gmail', () => {
    const eslintConfig = readFileSync(join(repoRoot, 'eslint.config.js'), 'utf8');
    expect(eslintConfig).toContain('no-restricted-imports');
    expect(eslintConfig).toContain('googleapis');
    expect(eslintConfig).toContain('packages/gmail/src/**');
  });
});
