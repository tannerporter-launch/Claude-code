# EchoLoop

A human-in-the-loop correspondence learning engine for a single controlled
Gmail pilot.

EchoLoop drafts replies to eligible inbound Gmail messages, **a human edits and
manually sends them in Gmail**, and EchoLoop then learns from the difference
between the draft and the sent message — applying that learning only after
explicit human approval. Its purpose is to prove that structured learning from
human edits reduces the amount and significance of future editing.

> EchoLoop **never sends email.** A human always presses Send in Gmail. The
> Gmail abstraction contains no send operation, and a static test enforces it.

## Status

Early build. **Phase 0 (governance and repository foundation).** There is no
live Gmail or AI integration yet. See `docs/STATUS.md` for the authoritative
breakdown of what is live, mocked, or incomplete, and `BUILD_BRIEF.md` for the
full MVP specification and phase plan.

## Layout

```
apps/web        Local-only review UI (Phase 9)
apps/worker     Sync + durable jobs (Phase 2+)
packages/*      schemas, security, database, gmail, ai, jobs, correspondence, testing
docs/*          Architecture, security, privacy, data model, decisions, status, ...
kb-templates/*  Knowledge base starter templates (not seeded with real prefs)
tests/*         Safety invariants and structural checks
```

## Getting started

Requires Node.js 24.x and pnpm.

```bash
pnpm install
pnpm run build         # type-check the workspace
pnpm run lint
pnpm run format:check
pnpm run test          # unit + integration + safety invariant tests
```

Tests need no database — they run against in-process PGlite (real PostgreSQL
compiled to WASM).

Copy `.env.example` to `.env` for local configuration. Never commit `.env` or
any real secret; user correspondence is never committed.

### Local database (for real dev runs, not tests)

```bash
docker compose up -d                              # Postgres 16 on :5432
# generate a 32-byte base64 ENCRYPTION_KEY and a DATABASE_URL in .env, then:
pnpm --filter @echoloop/database run db:generate  # regenerate migrations (after schema changes)
node apps/worker/dist/migrate.js                  # apply migrations (after pnpm run build)
```

## Key documents

- `BUILD_BRIEF.md` — authoritative MVP specification (read first).
- `CLAUDE.md` — operating guide for working in this repo.
- `docs/` — architecture, security, privacy, data model, Gmail integration,
  evaluation, decisions, backlog, and status.
