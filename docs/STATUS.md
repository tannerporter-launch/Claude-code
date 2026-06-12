# STATUS

Authoritative record of what is **live**, **mocked**, **incomplete**, or
**manually verified**. Update this file as part of completing every phase.

_Last updated: 2026-06-12 — Phase 2._

## Current phase

**Phase 2 — Gmail OAuth and read-only synchronization: implemented mock-first,
pending human review; live wiring awaits the user-run connect runbook.**
Phases 0 (governance) and 1 (database/security foundation) are complete on
their own PRs. Phase 3 (triage) has not started.

## Verification

- **Local verification passed** (Node 24): `pnpm install`, `pnpm run build`,
  `pnpm run lint`, `pnpm run format:check`, `pnpm run test` (**57 tests**,
  including all Phase 0/1 invariants and the Phase 2 acceptance suite on the
  mock provider).
- Integration tests run on PGlite (D-008); Gmail behavior is tested exclusively
  against the **mock provider** (BUILD_BRIEF Phase 2 requirement).

## Integration reality check

| Capability                      | State                           | Notes                                                                                                                      |
| ------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL schema + migrations  | **Live (local)**                | Drizzle; 14 tables across migrations `0000`–`0001`.                                                                        |
| Encryption / redacting logger   | **Live**                        | AES-256-GCM; key-name redaction.                                                                                           |
| Tenant repositories + audit     | **Live (local)**                | Cross-org fails closed.                                                                                                    |
| Durable job queue               | **Live (local)**                | `jobs`/`job_attempts`, idempotent claim.                                                                                   |
| Gmail provider — mock           | **Mock**                        | Full read-only interface with fault injection; used by ALL automated tests.                                                |
| Gmail provider — live           | **Code present, UNVERIFIED**    | `live.ts` + OAuth loopback flow exist; verified only when the user runs the connect runbook (`docs/GMAIL_INTEGRATION.md`). |
| Gmail OAuth consent (real)      | **Not performed**               | User-run step; scopes fixed to `gmail.readonly` + `gmail.compose` (D-009).                                                 |
| Mailbox sync engine             | **Implemented (mock-verified)** | Baseline, incremental, idempotent duplicates, cursor recovery, reconnect_required, revocation.                             |
| Live Anthropic / AI integration | **None**                        | No provider, no prompts, no model calls (Phase 3+).                                                                        |
| Web application (UI)            | **Stub only**                   | Phase 9.                                                                                                                   |
| Draft creation / sending        | **None**                        | Provider surface is read-only in Phase 2; createDraft is Phase 6; sending is permanently out of scope.                     |

**No real Gmail consent has occurred, no AI provider exists, and nothing can
create or send a draft.** The mock Gmail provider is a mock and is never
represented as a live integration.

## What exists today

- **Phase 0/1:** governance, invariant tests, DB/security/jobs foundation (see
  PR #2 and the Phase 1 PR).
- **Phase 2:**
  - `@echoloop/gmail`: read-only `GmailProvider` interface; fixed scope
    constant; Desktop-app OAuth (loopback) + token refresh with
    `invalid_grant → reconnect_required` mapping; MIME parsing + alias
    detection; live SDK adapter (`live.ts`, unverified); mock provider with
    fault injection.
  - `@echoloop/correspondence`: account lifecycle (connect/baseline,
    reconnect_required, revoke), incremental mailbox sync (idempotent events,
    all pages, cursor-advance-after-success, controlled cursor recovery),
    eligible-summaries query.
  - `@echoloop/database`: migration `0001` (mailbox_checkpoints,
    mailbox_events, email_threads, email_messages, message_participants).
  - `apps/worker`: `gmail.sync` job handler + user-run CLIs `connect-gmail`
    and `show-recent`.
  - Credentials safety: `GOOGLE_CREDENTIALS_PATH` must resolve outside the
    repo (enforced + tested); gitignore patterns for client-secret files.

## Mocked vs. live

- **MockGmailProvider** (`packages/gmail/src/mock.ts`) is the test double for
  all Gmail behavior — explicitly a mock.
- The live provider/OAuth code paths compile and are exercised structurally,
  but are **unverified against real Gmail** until the user runs the runbook in
  `docs/GMAIL_INTEGRATION.md`. They are not claimed as a working integration.
- PGlite is real PostgreSQL (WASM), not a mock.

## Known gaps / not yet built

Phase 3 onward: triage/classification, knowledge base, draft generation, real
Gmail drafts (Phase 6), sent capture/pairing, comparison/learning, review UI,
continuous worker loop, pilot. Sent-folder processing (checkpoint kind `sent`)
is schema-ready but unused until Phase 7. Continuous polling scheduling is
Phase 10 (Phase 2 syncs on demand / via enqueued job).

## Manual checks performed

- Full local suite on Node 24 — 57 tests pass; lint/format/build green.
- Verified the prohibited-send static test and Gmail SDK import boundary remain
  active (no changes to `tests/invariants/`).
- Credential scan over tracked files — no matches; `.env*` and
  `credentials*.json` patterns git-ignored; `.env.example` placeholders only.
