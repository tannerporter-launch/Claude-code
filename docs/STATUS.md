# STATUS

Authoritative record of what is **live**, **mocked**, **incomplete**, or
**manually verified**. Update this file as part of completing every phase.

_Last updated: 2026-06-12 — Phase 3._

## Current phase

**Phase 3 — Triage and context extraction: implemented mock-first, pending
human review.** Phases 0–2 are complete on their own PRs (#2, #3, #4). Phase 4
(knowledge base and context assembly) has not started.

## Verification

- **Local verification passed** (Node 24): build, lint, format, tests
  (**73 tests**, including all earlier invariants and the Phase 3 acceptance
  suite). Gmail behavior uses the mock provider; AI behavior uses the mock AI
  provider — no automated test calls a live API.

## Integration reality check

| Capability                        | State                           | Notes                                                                                                           |
| --------------------------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| PostgreSQL schema + migrations    | **Live (local)**                | Drizzle; migrations `0000`–`0002` (identity/ops, mailbox, triage/contacts).                                     |
| Encryption / redacting logger     | **Live**                        | AES-256-GCM; key-name redaction.                                                                                |
| Durable job queue                 | **Live (local)**                | Idempotent claim on `jobs`/`job_attempts`.                                                                      |
| Gmail provider — mock             | **Mock**                        | Read-only interface + fault injection; used by ALL automated tests.                                             |
| Gmail provider — live             | **Code present, UNVERIFIED**    | Verified only when the user runs the connect runbook.                                                           |
| AI provider — mock                | **Mock**                        | Scripted outputs through the same schema-validation path; used by tests.                                        |
| AI provider — live (Anthropic)    | **Code present, UNVERIFIED**    | `packages/ai/live.ts`; activates only with the user's local API key + recorded consent.                         |
| Triage engine                     | **Implemented (mock-verified)** | Deterministic prefilters + schema-validated classification; low confidence → manual review; failures fail safe. |
| Synthetic triage eval set         | **Implemented**                 | Labeled counts, false positives/negatives, uncertain cases.                                                     |
| Knowledge base / context assembly | **None**                        | Phase 4.                                                                                                        |
| Draft generation / Gmail drafts   | **None**                        | Phases 5–6. No send path, ever.                                                                                 |
| Web application (UI)              | **Stub only**                   | Phase 9; CLIs are the interim review surface.                                                                   |

**No live Gmail consent has been performed and no data has been transmitted to
any model provider.** Live AI activates only when the user sets
`ANTHROPIC_API_KEY` locally and runs `record-consent` (D-013). Nothing can
create or send a draft.

## What exists today

- **Phases 0–2:** governance + invariants; DB/security/jobs foundation; Gmail
  OAuth + read-only sync (mock-first) — see PRs #2/#3/#4.
- **Phase 3:**
  - `@echoloop/ai`: `AiProvider` abstraction, live Anthropic adapter
    (env-configured model IDs, D-012), mock provider; schema-validated output
    with fail-safe rejection.
  - `@echoloop/schemas`: triage schema covering all BUILD_BRIEF §3 dimensions;
    AI/activation env config.
  - `@echoloop/correspondence`: deterministic prefilters (spam/trash,
    self-sent via alias detection, no-reply, bulk/list headers,
    calendar/system) + AI classification with confirmed-vs-inferred
    relationship handling and manual-review routing.
  - `@echoloop/gmail`: bulk/calendar header detection in MIME parsing.
  - `@echoloop/database`: migration `0002` (`message_classifications`,
    `contacts`, `contact_relationships`; `is_bulk`/`is_calendar` flags).
  - `@echoloop/testing`: synthetic labeled eval set + report (labeled counts,
    FP/FN, uncertain, failed).
  - `apps/worker`: `triage-report` and `record-consent` CLIs.

## Mocked vs. live

- `MockGmailProvider` and `MockAiProvider` are explicit mocks; all automated
  tests use them. PGlite is real PostgreSQL (WASM).
- Live Gmail and live Anthropic adapters compile but are **unverified** until
  the user runs the runbooks. They are not claimed as working integrations.

## Known gaps / not yet built

Phases 4 onward: knowledge base/context assembly, draft generation, real Gmail
drafts (allowlist), sent capture/pairing, comparison/learning, review UI,
continuous worker loop, controlled pilot.

## Manual checks performed

- Full local suite on Node 24 — 73 tests pass; lint/format/build green.
- Invariant tests (`tests/invariants/`) unchanged from Phase 0.
- Credential scan over tracked files — no matches; `.env*` and client-secret
  patterns git-ignored.
