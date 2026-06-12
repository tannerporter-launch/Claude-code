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
pnpm run test          # unit + safety invariant tests
```

Copy `.env.example` to `.env` for local configuration. Never commit `.env` or
any real secret; user correspondence is never committed.

## Key documents

- `BUILD_BRIEF.md` — authoritative MVP specification (read first).
- `CLAUDE.md` — operating guide for working in this repo.
- `docs/` — architecture, security, privacy, data model, Gmail integration,
  evaluation, decisions, backlog, and status.
