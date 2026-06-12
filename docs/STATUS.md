# STATUS

Authoritative record of what is **live**, **mocked**, **incomplete**, or
**manually verified**. Update this file as part of completing every phase.

_Last updated: 2026-06-12 — Phase 0._

## Current phase

**Phase 0 — Governance and repository foundation.** In progress / completing.

## Integration reality check

| Capability                      | State         | Notes                                            |
| ------------------------------- | ------------- | ------------------------------------------------ |
| Live Gmail integration          | **None**      | No OAuth, no API calls, no provider implemented. |
| Live Anthropic / AI integration | **None**      | No provider, no prompts, no model calls.         |
| PostgreSQL / ORM / migrations   | **None**      | Scaffolding only; schema arrives in Phase 1.     |
| Durable job queue               | **None**      | Foundation in Phase 1.                           |
| Web application (UI)            | **Stub only** | Placeholder package; built in Phase 9.           |
| Worker process                  | **Stub only** | Placeholder package; built from Phase 2.         |
| Draft creation / sending        | **None**      | Sending is permanently out of scope (invariant). |

There is **no live Gmail or AI integration**. Nothing in this repository can
read a mailbox, call a model, or create or send a draft.

## What exists today (Phase 0)

- pnpm workspace with `apps/{web,worker}` and `packages/{ai, correspondence,
database, gmail, jobs, schemas, security, testing}` as typed placeholders.
- TypeScript (strict), ESLint, Prettier, Vitest, and a CI workflow.
- Governance docs under `docs/` and `kb-templates/`.
- Safety invariant tests under `tests/invariants/` (prohibited Gmail send
  static check) and structural/boundary tests under `tests/structure/`.

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

- Local `pnpm install`, `pnpm run build`, `pnpm run lint`, `pnpm run
format:check`, and `pnpm run test` (recorded in the Phase 0 completion report
  in the pull request).
