# STATUS

Authoritative record of what is **live**, **mocked**, **incomplete**, or
**manually verified**. Update this file as part of completing every phase.

_Last updated: 2026-06-12 — Phase 1._

## Current phase

**Phase 1 — Database and security foundation: implementation complete (local),
pending human review.** Phase 0 governance/scaffold is complete. Phase 2 (Gmail
OAuth + read-only sync) has not started.

## Verification

- **Local verification passed** (Node 24): `pnpm install`, `pnpm run build`
  (type check), `pnpm run lint`, `pnpm run format:check`, `pnpm run test`
  (**30 tests**, including the Phase 0 invariants).
- Integration tests run against **PGlite** (real PostgreSQL compiled to WASM,
  in-process) — no database server required locally or in CI (see
  `docs/DECISIONS.md` D-008).

## Integration reality check

| Capability                         | State            | Notes                                                                            |
| ---------------------------------- | ---------------- | -------------------------------------------------------------------------------- |
| PostgreSQL schema + migrations     | **Live (local)** | Drizzle; 9 core tables; migrations committed under `packages/database/drizzle/`. |
| Encryption service (AES-256-GCM)   | **Live**         | `@echoloop/security`; tokens/bodies stored as ciphertext.                        |
| Redacting structured logger        | **Live**         | `@echoloop/security`; bodies/addresses/tokens/prompts redacted.                  |
| Tenant-scoped repositories + audit | **Live (local)** | Cross-org access fails closed; audit detail redacted.                            |
| Durable job queue                  | **Live (local)** | `@echoloop/jobs` on `jobs`/`job_attempts`; idempotent claim.                     |
| Worker process                     | **Skeleton**     | `runOnce` claim/run/complete loop + migrate CLI. No live sync, no handlers.      |
| Live Gmail / OAuth integration     | **None**         | No OAuth, no API calls, no provider implemented (Phase 2).                       |
| Live Anthropic / AI integration    | **None**         | No provider, no prompts, no model calls (Phase 3+).                              |
| Web application (UI)               | **Stub only**    | Placeholder package; built in Phase 9.                                           |
| Draft creation / sending           | **None**         | Sending is permanently out of scope (invariant).                                 |

**No live Gmail, OAuth, AI, or drafting integration exists.** The database and
job queue are real but run locally only; nothing reads a mailbox, calls a model,
or creates or sends a draft.

## What exists today

- **Phase 0:** pnpm workspace, strict TS, ESLint/Prettier/Vitest, CI (Node 24),
  docs, prohibited-send static test, workspace + Gmail-SDK boundary tests.
- **Phase 1:**
  - `@echoloop/security`: AES-256-GCM encryption service + redacting logger.
  - `@echoloop/database`: Drizzle schema (identity/tenancy + operations),
    committed migrations, migration runner, tenant-scoped repositories,
    provisioning helpers, audit-event service.
  - `@echoloop/jobs`: durable queue (enqueue/claim/complete/fail, backoff,
    dead-letter) on `jobs`/`job_attempts`.
  - `@echoloop/testing`: PGlite test harness + synthetic seed (encrypted tokens).
  - `apps/worker`: migration CLI + inert `runOnce` job-loop skeleton.
  - `docker-compose.yml` (Postgres 16) for real local dev.

## Mocked vs. live

- Tests use **PGlite**, which is real PostgreSQL (WASM), not a mock — the same
  migrations and SQL run there as against a Postgres server.
- No Gmail or AI mocks exist yet; the mock Gmail provider arrives in Phase 2 and
  will be listed here, never presented as a live integration.

## Known gaps / not yet built

Everything from Phase 2 onward: Gmail OAuth and read-only sync, triage, knowledge
base, draft generation, real Gmail drafts, pairing, comparison, learning
proposals, the review UI, the continuous worker, and the controlled pilot. Domain
tables (Gmail/context/pairing/learning) are added by the phase that first writes
them (incremental migrations). See `BUILD_BRIEF.md` §14.

## Manual checks performed

- Local `pnpm install`, `pnpm run build`, `pnpm run lint`, `pnpm run
format:check`, `pnpm run test` on Node 24 — all pass (30 tests).
- Confirmed Docker daemon is unavailable in the build sandbox; integration tests
  therefore use PGlite. A real Postgres run uses `docker-compose.yml`.
- Credential scan over tracked files (command in the Phase 0 history) — no
  matches; `.env*` git-ignored; `.env.example` placeholders only.
