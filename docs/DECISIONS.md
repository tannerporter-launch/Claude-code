# DECISIONS

Architectural decisions and documented reversible defaults. This file ranks
above `BUILD_BRIEF.md` in the source-of-truth hierarchy, so record durable
choices here. Each entry notes whether it is a free default (BUILD_BRIEF §1.2)
or a choice that required — or will require — explicit human approval.

Format: `D-NNN — Title (date) — Status`.

---

## D-001 — Toolchain: TypeScript + pnpm + Vitest (2026-06-12) — Default

The BUILD_BRIEF mandates Node 24, TypeScript strict, and pnpm workspaces. For
the remaining undecided toolchain pieces we adopt reversible defaults:

- **Test runner:** Vitest. Single runner for unit/integration/structure tests;
  browser tests (Phase 9) will layer Playwright on top.
- **Lint/format:** ESLint (flat config) with `typescript-eslint`, plus Prettier.
- **Build / type check:** `tsc -b` with project references; `pnpm run build`
  doubles as the type check.

Reversible; no product/security impact.

## D-002 — Architecture-boundary enforcement via tests (2026-06-12) — Default

Rather than add a heavyweight dependency-analysis tool in Phase 0, boundaries
are enforced by `tests/structure/workspace.test.ts`, which asserts forbidden
internal dependency directions (e.g. `@echoloop/gmail` must not depend on
`@echoloop/ai` or `@echoloop/correspondence`, and no package depends on the
apps). If the dependency graph grows complex we may add `dependency-cruiser`
later. Reversible.

## D-003 — Prohibited-send enforced as a static test (2026-06-12) — Default

The no-send invariant (BUILD_BRIEF §1.4 / §7.1) is enforced by
`tests/invariants/no-send.test.ts`, a static scan of `apps/` and `packages/`
source for prohibited Gmail send operation names. Restricted-import rules and a
CODEOWNERS marker on `packages/gmail/` reinforce it. The test lives under
`tests/` so its own pattern list is not self-flagged. We do **not** rely on
OAuth scopes alone to prevent sending.

## D-004 — ORM, durable job queue, migration granularity (2026-06-12) — Approved by user

Confirmed by the user at the start of Phase 1:

- **ORM/migrations:** Drizzle (`drizzle-orm` + `drizzle-kit`). Typed schema in
  TypeScript; reviewable committed `.sql` migrations under
  `packages/database/drizzle/`; no engine binary.
- **Durable job queue:** a custom queue built on the spec's `jobs` /
  `job_attempts` tables using `SELECT … FOR UPDATE SKIP LOCKED`. No third-party
  queue library; full control of idempotency, audit, and kill-switch hooks.
- **Migration granularity:** incremental per-phase. Each phase ships the
  migration for the tables its workflow needs, ahead of that workflow. Phase 1
  covers identity/tenancy + operations tables only (see `docs/DATA_MODEL.md`).

Rationale and per-option analysis were presented to and approved by the user.
Reversible at moderate cost; committed SQL migrations remain replayable.

## D-005 — `docker-compose.yml` deferred to Phase 1 (2026-06-12) — Default

PostgreSQL Docker configuration is a Phase 1 build item, so no
`docker-compose.yml` is added in Phase 0 to avoid implementing a later phase
early. The canonical layout slot is reserved. Reversible.

## D-006 — Web app stub carries no framework yet (2026-06-12) — Default

`apps/web` is a typed placeholder package without React/Vite wiring, because the
review web application is a Phase 9 deliverable. Adding the framework now would
implement a later phase early. Reversible.

## D-007 — Gmail SDK import boundary enforced mechanically (2026-06-12) — Default

The documentation's claim that only `packages/gmail` touches the Gmail SDK is
now enforced two ways: an ESLint `no-restricted-imports` rule blocks
`googleapis`/`@googleapis/*` imports everywhere except `packages/gmail/src`,
and `tests/structure/workspace.test.ts` fails if any other workspace manifest
declares a Gmail SDK dependency (and if the ESLint rule is removed). This
complements — and does not weaken — the prohibited-send static test (D-003).
Reversible (additive enforcement only).

## D-008 — Test database via PGlite; real Postgres for dev/CI-service (2026-06-12) — Default

Automated tests run against **PGlite** (`@electric-sql/pglite`), real Postgres
compiled to WASM running in-process — no server required, so the suite runs in
the sandbox and in CI without a service container. Local development and
production use real PostgreSQL 16 via `docker-compose.yml` and Drizzle's
`node-postgres` driver, selected by `DATABASE_URL`. CI may additionally run the
integration suite against a real Postgres service to validate true
multi-connection `FOR UPDATE SKIP LOCKED` concurrency. Reversible; test-only
infrastructure choice.

## D-009 — Gmail OAuth scope set (2026-06-12) — Approved by user

The pilot requests exactly two scopes: `gmail.readonly` + `gmail.compose`.
No `gmail.modify` (no label management) and nothing else. Confirmed explicitly
by the user as the stop-and-ask scope gate. The scope list is a hardcoded
constant in `packages/gmail` (not env-configurable) so it cannot drift; any
change is a new stop-and-ask decision. Because `gmail.compose` can technically
authorize sending, the no-send invariant remains enforced in code (D-003), not
by scope.

## D-010 — OAuth client credentials must live outside the repo tree (2026-06-12) — User requirement

The downloaded client-secret JSON is referenced via `GOOGLE_CREDENTIALS_PATH`
(default `~/.echoloop/credentials.json`). `resolveGoogleCredentialsPath` in
`packages/schemas` rejects any path resolving inside the repository working
tree, so the secret cannot be committed by accident even if gitignore rules
were bypassed. `.gitignore` additionally blocks `credentials*.json` /
`client_secret*.json`.

## D-011 — `reconnect_required` is an expected account state (2026-06-12) — User requirement

While the Google consent screen is in Testing status, refresh tokens expire
after ~7 days. Sync maps `invalid_grant` to a clean `reconnect_required`
account status (audited), stops processing for that account, and recovers when
the user re-runs the connect CLI. This is modeled as normal pilot behavior —
never a crash, never a silent stall.

## D-012 — AI provider, model defaults, env-configured model IDs (2026-06-12) — Default

All model access goes through `packages/ai` (`AiProvider`), with the official
`@anthropic-ai/sdk`. Model IDs are env-configured, never hardcoded at call
sites: `ANTHROPIC_MODEL_CLASSIFICATION` (default `claude-haiku-4-5` — fast,
cost-effective triage), `ANTHROPIC_MODEL_DRAFTING` and
`ANTHROPIC_MODEL_COMPARISON` (default `claude-opus-4-8`). Output is parsed and
validated against a caller-supplied zod schema; failures reject the output
whole (`AiValidationError`) and the pipeline fails safe. Reversible — swap
models via env.

## D-013 — AI transmission consent (2026-06-12) — Approved by user

The user explicitly approved transmitting inbound message content, thread
context, and approved playbook/knowledge to the Anthropic API for triage,
drafting, and comparison (the §1.2 retention/transmission stop-and-ask gate).
Per-feature field lists live in `docs/PRIVACY.md`; consent is recorded as the
`ai.transmission_consented` audit event via the `record-consent` CLI before
live use. The API key stays in the user's local `.env`.
