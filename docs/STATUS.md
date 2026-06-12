# STATUS

Authoritative record of what is **live**, **mocked**, **incomplete**, or
**manually verified**. Update this file as part of completing every phase.

_Last updated: 2026-06-12 — Phase 0 closeout._

## Current phase

**Phase 0 — Governance and repository foundation: implementation complete,
pending human review and merge of PR #2.** Phase 1 has not started; its ORM and
job-queue selections are deliberately unapproved (see `docs/DECISIONS.md`
D-004).

## Verification

- **Local verification passed** on the Phase 0 closeout commit (Node 24):
  `pnpm install --frozen-lockfile`, `pnpm run build` (type check),
  `pnpm run lint`, `pnpm run format:check`, and `pnpm run test`.
- **GitHub Actions `verify` passed** on the reviewed PR head; the exact commit
  SHA under review is recorded on PR #2's checks. (It also passed on the prior
  commit `9cff42b`.)
- Credential hygiene: no credentials were found in tracked files by a
  pattern-based scan (see "Manual checks performed"), and secret-containing
  environment files (`.env`, `.env.*`) are git-ignored; only `.env.example`
  with empty placeholder values is committed.

## Integration reality check

| Capability                      | State         | Notes                                            |
| ------------------------------- | ------------- | ------------------------------------------------ |
| Live database (PostgreSQL/ORM)  | **None**      | No schema, migrations, or queue; Phase 1.        |
| Durable job queue               | **None**      | Foundation in Phase 1.                           |
| Live Gmail / OAuth integration  | **None**      | No OAuth, no API calls, no provider implemented. |
| Live Anthropic / AI integration | **None**      | No provider, no prompts, no model calls.         |
| Web application (UI)            | **Stub only** | Placeholder package; built in Phase 9.           |
| Worker process                  | **Stub only** | Placeholder package; built from Phase 2.         |
| Draft creation / sending        | **None**      | Sending is permanently out of scope (invariant). |

**No live database, Gmail, OAuth, AI, queue, or drafting integration exists.**
Nothing in this repository can read a mailbox, call a model, persist data, or
create or send a draft.

## What exists today (Phase 0)

- pnpm workspace with `apps/{web,worker}` and `packages/{ai, correspondence,
database, gmail, jobs, schemas, security, testing}` as typed placeholders.
- TypeScript (strict), ESLint, Prettier, Vitest, and a CI workflow (Node 24).
- Governance docs under `docs/` (including `AI_PIPELINE.md` and
  `LEARNING_MODEL.md`) and `kb-templates/`.
- Safety invariant tests under `tests/invariants/` (prohibited Gmail send
  static check) and structural/boundary tests under `tests/structure/`
  (workspace layout, dependency directions, Gmail SDK confinement, ignore
  rules for `exports/` and `docs/source-material/`).
- An ESLint `no-restricted-imports` rule confining Gmail SDK imports to
  `packages/gmail`.

## Mocked vs. live

Nothing is mocked yet because no integration code exists. When mocks are
introduced (e.g. the mock Gmail provider in Phase 2), they will be listed here
and never presented as a live integration.

## Known gaps / not yet built

Everything from Phase 1 onward (database, security/encryption, Gmail OAuth and
sync, triage, knowledge base, draft generation, draft creation, pairing,
comparison, learning proposals, the review UI, the continuous worker, and the
controlled pilot). See `BUILD_BRIEF.md` §14 for the phase plan.

## Manual checks performed

- Local `pnpm install --frozen-lockfile`, `pnpm run build`, `pnpm run lint`,
  `pnpm run format:check`, and `pnpm run test` on Node 24.
- Credential scan over tracked files. Exact command (this file is excluded
  because it documents the pattern list and would self-match):

  ```bash
  git ls-files -z ':(exclude)docs/STATUS.md' | xargs -0 grep -lE \
    'sk-ant|AIza|-----BEGIN|client_secret"?\s*[:=]\s*"?[A-Za-z0-9_-]{8,}'
  ```

  Result: no matches. This is a pattern scan of tracked files, not a
  guarantee that no secret exists; independently, secret-containing
  environment files (`.env`, `.env.*`) are git-ignored and `.env.example`
  contains empty placeholder values only.

- Negative test of the prohibited-send invariant: an injected
  `messages.send` probe file made `tests/invariants/no-send.test.ts` fail;
  removing it restored green.
