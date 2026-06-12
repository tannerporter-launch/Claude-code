# CLAUDE.md

Operating guide for Claude Code working in the EchoLoop repository. Read this
together with `BUILD_BRIEF.md` (the authoritative MVP specification) before
making changes.

## What EchoLoop is

A human-in-the-loop correspondence assistant for a single controlled Gmail
pilot. It drafts replies, a human edits and **sends them manually in Gmail**,
and EchoLoop learns from the difference between the draft and the sent message —
but only with explicit human approval.

## Before acting (every session)

1. Read `BUILD_BRIEF.md` in full.
2. Read this file and everything under `docs/`.
3. Inspect the current repository state.
4. Plan the **current phase only**. Do not implement later phases early.
5. Identify any conflict between the requested work and existing code.

## Source-of-truth hierarchy (highest first)

1. Explicit instruction in the current session
2. `docs/DECISIONS.md`
3. `BUILD_BRIEF.md`
4. Automated tests and acceptance criteria
5. Other approved docs under `docs/`
6. Existing implementation
7. `docs/source-material/` transcript (provenance only, never a spec)

## Hard invariants (never violate)

1. The application never sends an email; a human presses Send in Gmail.
2. No Gmail send operation may exist in the Gmail abstraction or app code.
3. No knowledge rule becomes active without human approval.
4. AI output is untrusted until schema-validated.
5. Factual knowledge outranks stylistic rules; a fact correction never
   auto-becomes a style rule.
6. Drafts and active rules preserve provenance/evidence and are reversible.
7. Raw email content and OAuth credentials never appear in logs.
8. No automated test sends email to a real recipient.
9. Initial mailbox sync never drafts historical mail.
10. Mocked functionality is never presented as a live integration.

These are enforced partly by static tests under `tests/invariants/`. Do not
weaken those tests to make code pass.

## Decision policy

Proceed with a documented, reversible default (record it in
`docs/DECISIONS.md`) when the choice does not change the product contract,
weaken security, risk destructive migrations, or alter the user workflow.

**Stop and ask** when the choice changes Gmail permissions, what data is
retained/transmitted, could permit autonomous sending, creates a destructive
migration, changes the human-approval model, adds recurring infrastructure
cost, changes central product behavior, or introduces an unresolved security
tradeoff.

## Phase discipline

Work proceeds in phases 0–12 (see `BUILD_BRIEF.md` §14). A phase is complete
only when its acceptance tests pass, type-check/lint pass, docs reflect reality,
and `docs/STATUS.md` accurately states what is live, mocked, or incomplete. Do
not claim production readiness during the MVP.

## Common commands

```bash
pnpm install          # install workspace dependencies
pnpm run build        # tsc -b across the workspace (also the type check)
pnpm run lint         # ESLint
pnpm run format:check # Prettier check
pnpm run test         # Vitest, including safety invariants
```

## Repository conventions

- pnpm workspaces: `apps/*` and `packages/*`.
- TypeScript strict everywhere. Runtime validation for all external input.
- User correspondence and company knowledge are **never** committed (`exports/`
  is git-ignored except `.gitkeep`; tests use synthetic fixtures only).
- Architectural rationale belongs in `docs/DECISIONS.md`, not scattered code
  comments. Comment code only where it would otherwise mislead.
