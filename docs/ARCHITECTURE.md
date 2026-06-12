# ARCHITECTURE

High-level architecture for the EchoLoop MVP. This describes the intended
target shape; see `docs/STATUS.md` for what is actually built today (Phase 0:
scaffolding only).

## Shape

A pnpm monorepo with two runnable apps and a set of domain packages.

```
apps/
  web/      Local-only React review UI (Phase 9), bound to localhost.
  worker/   Separate process: Gmail sync + durable jobs (Phase 2+).
packages/
  schemas/        Runtime validation + shared typed contracts.
  security/       Encryption, token handling, redacting logger.
  database/       ORM, migrations, repositories, tenant-scoped queries.
  gmail/          Gmail provider abstraction (READ + drafts only; NO send).
  ai/             Anthropic provider abstraction + versioned prompts.
  jobs/           Database-backed durable job queue.
  correspondence/ Triage, context assembly, pairing, comparison, learning.
  testing/        Synthetic Gmail/AI fixtures (never live data).
```

## Dependency direction

Boundaries are enforced by `tests/structure/workspace.test.ts`.

- `schemas` and `security` are foundational; they depend on no other internal
  package.
- `database` builds on `schemas` + `security`.
- `gmail` depends only on `schemas` + `security`. It MUST NOT depend on `ai` or
  `correspondence`: the Gmail adapter stays a thin, auditable I/O boundary.
- `ai` depends on `schemas` + `security`.
- `jobs` builds on `database`.
- `correspondence` is the orchestration layer and may compose the above.
- No package depends on `apps/*`.

## Safety boundary: Gmail

The Gmail provider exposes only approved operations (get profile, list history,
get message/thread, list/get drafts, create/update draft, revoke). It exposes
**no** send-style operation. This is enforced by:

1. The prohibited-send static test (`tests/invariants/no-send.test.ts`).
2. Restricted imports and a `CODEOWNERS` review marker on `packages/gmail/`.
3. (Later phases) structured audit events for every live Gmail write and two
   kill switches (account-level and global).

## Trigger model

The MVP polls Gmail history on an interval (worker). The provider and sync
services are written so that polling is not the only possible trigger — Cloud
Pub/Sub push is a future hosted-pilot mode, not assumed away.

## Data flow (target)

Inbound message → deterministic exclusions → canonical parse → triage
classification → layered context assembly → AI draft generation → schema
validation + safety checks → Gmail draft creation (allowlist only) → human
edits and sends → sent-message capture → draft↔sent pairing with evidence →
mechanical + semantic comparison → learning proposal → human approval →
versioned rule/knowledge update → influences later drafts.

Every step records provenance; no rule activates and no email is sent without a
human in the loop.
