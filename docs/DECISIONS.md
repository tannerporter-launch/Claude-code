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

## D-004 — Deferred: ORM and durable job queue selection (2026-06-12) — Pending

The BUILD_BRIEF requires "a typed ORM with committed migrations" and "a
database-backed durable job queue" but does not name products. These will be
selected at the start of Phase 1 and recorded here. Current leaning (not yet
committed): a typed query builder/ORM that emits reviewable SQL migrations.
Because the schema and migrations carry destructive-migration risk, the final
choice and the initial migration plan will be confirmed before Phase 1
implementation lands.

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
