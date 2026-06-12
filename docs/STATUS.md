# STATUS

Authoritative record of what is **live**, **mocked**, **incomplete**, or
**manually verified**. Update this file as part of completing every phase.

_Last updated: 2026-06-12 — go-live wiring._

## Current phase

**Go-live wiring complete: the full loop (Phases 0–8) is feature-complete and
verified end-to-end on mocks, with CLIs for every human-control point and a
minimal continuous worker.** Live operation awaits the user running
`docs/LIVE_RUNBOOK.md` on their machine. Phases 9–12 (web UI, reliability
hardening, pilot evidence, security review) remain.

## Verification

- **Local verification passed** (Node 24): build, lint, format, tests
  (**116 tests**, incl. a full Definition-of-Done loop test on mocks, including all earlier invariants and the Phase 3/4 acceptance
  suites). Gmail behavior uses the mock provider; AI behavior uses the mock AI
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
- **Phase 4:**
  - `@echoloop/correspondence`: versioned knowledge documents (approved facts,
    terminology, time-bound emphasis, personal style — nothing seeded), rule
    engine with condition schema + immutable versions + rollback, layered
    context assembly in BUILD_BRIEF §10.2 precedence (facts override style;
    expired emphasis and fact-contradicting style rules excluded and recorded),
    context snapshots with full provenance (IDs+versions, exclusions, prompt
    version, model id, content hash, encrypted render), playbook export.
  - `@echoloop/database`: migration `0003` (knowledge_documents/\_versions,
    rules/rule_versions/rule_evidence, prompt_versions, context_snapshots).
  - `apps/worker`: `export-playbook` CLI (Markdown + JSON snapshots).
- **Phase 5:**
  - `@echoloop/correspondence`: dry-run draft generation — drafting prompt v1,
    schema-validated structured output, deterministic recipient calculation
    (reply vs reply-all minus own aliases), unsupported-claim check (factsUsed/
    rulesUsed must reference snapshot records), prohibited-commitment check,
    full generation provenance (runs → snapshots → drafts, encrypted bodies,
    correlation keys). Zero Gmail writes.
  - `@echoloop/database`: migration `0004` (generation_runs, generated_drafts).
  - `apps/worker`: `preview-draft` CLI (live, user-run; prints the preview and
    states that no Gmail draft was created).
- **Phase 6:**
  - `@echoloop/gmail`: `createDraft` provider operation (the ONLY Gmail write;
    no send operation exists), RFC 2822 reply MIME with In-Reply-To/References
    threading and the X-EchoLoop-Correlation header; mock records all writes.
  - `@echoloop/correspondence`: activation policy (disabled/dry_run/allowlist/
    enabled), DB-backed allowlist (sender/domain/label/thread/message), global
    env + per-account kill switches, per-cycle and per-hour rate limits;
    preview→draft promotion with audit events for every live Gmail write.
  - `@echoloop/database`: migration `0005` (allowlist_entries;
    email_accounts.drafting_paused).
- **Phase 7:**
  - `@echoloop/correspondence`: pairing engine — evidence scoring across
    correlation header (parsed + persisted), thread, In-Reply-To, normalized
    subject, recipient overlap, time proximity (never thread alone);
    auto-pair only above threshold with a unique winner; ambiguous cases stay
    unpaired in a manual queue (manual pair/resolve); draft-discard detection;
    duplicate-event idempotency; DB uniques prevent double-pairing both ways.
  - `@echoloop/database`: migration `0006` (pairing_candidates,
    draft_sent_pairs; email_messages.correlation_key_header).
- **Phase 8:**
  - `@echoloop/correspondence`: word-level LCS mechanical diff (insertions/
    deletions, greeting/sign-off/subject/recipient/length changes, normalized
    edit distance); schema-validated semantic comparison (§10.6 categories;
    one-time flag; factual detail); evidence-controlled proposals — style
    patterns need ≥3 supporting comparisons in the same context bucket and a
    contradiction search, narrowest scope; FACTUAL corrections route to
    knowledge review (threshold 1, high risk) and never become style rules;
    commitment changes classified distinctly; approve (creates versioned rule
    with evidence, or approved fact)/reject/defer; nothing activates
    automatically.
  - `@echoloop/database`: migration `0007` (comparisons, rule_proposals,
    proposal_evidence).
- **Go-live wiring:**
  - `@echoloop/correspondence`: `runLoopCycle` — sync → triage → draft
    (activation-policy gated per message) → pair → discard-detect → compare →
    propose; sent capture and learning keep running while drafting is blocked.
  - `apps/worker` CLIs: `run-worker` (minimal polling loop, graceful SIGINT —
    Phase 10 hardening NOT built), `proposals` (list/approve/edit/reject/
    defer/rollback-rule), `pairing-queue` (list/pair), `allowlist` (list/add).
  - `docs/LIVE_RUNBOOK.md`: the user-run go-live script.

## Mocked vs. live

- `MockGmailProvider` and `MockAiProvider` are explicit mocks; all automated
  tests use them. PGlite is real PostgreSQL (WASM).
- Live Gmail and live Anthropic adapters compile but are **unverified** until
  the user runs the runbooks. They are not claimed as working integrations.

## Known gaps / not yet built

Phase 9 (review web app), Phase 10 (continuous worker hardening), Phase 11
(controlled pilot evidence), Phase 12 (security review). CLIs are the interim
review surface; a minimal polling loop ships with go-live wiring.

## Manual checks performed

- Full local suite on Node 24 — 73 tests pass; lint/format/build green.
- Invariant tests (`tests/invariants/`) unchanged from Phase 0.
- Credential scan over tracked files — no matches; `.env*` and client-secret
  patterns git-ignored.
