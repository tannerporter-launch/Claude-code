# AI_PIPELINE

Safety and provenance contract for every model interaction in EchoLoop. This
document defines the pipeline contract only — it does not restate the product
specification (`BUILD_BRIEF.md` remains authoritative), and
`docs/EVALUATION.md` serves as the evaluation plan.

Implementation arrives in Phase 3 (classification) and Phase 5 (draft
generation). As of Phase 0 **no AI integration exists** and no data is
transmitted to any model provider (see `docs/STATUS.md`).

## Provider abstraction

- All model access goes through the provider interface in `packages/ai`; the
  Anthropic API sits behind it. No app or other package calls a model API
  directly.
- The provider records, for every call: model identifier, prompt version,
  request timestamp, and outcome (success, schema failure, provider error).
- The abstraction permits swapping or mocking the provider; mocked providers
  are always labeled as mocks in `docs/STATUS.md`, never as live integrations.

## Schema-validated model outputs

- AI output is untrusted until it validates against a runtime schema defined in
  `packages/schemas` (triage schema, draft response schema).
- Invalid output is rejected whole: it produces no classification record, no
  preview, and no Gmail draft. There is no partial application of invalid
  output.
- Validation failures are recorded as audit events with redacted payload
  references, and count toward the model/schema failure-rate metric.

## Prompt versions

- Prompts are versioned, immutable records (`prompt_versions`). Editing a
  prompt creates a new version; nothing rewrites a version in place.
- Every generation and classification records the exact prompt version used,
  so any output can be traced to the prompt that produced it.

## Context snapshots and provenance

Every model call that consumes assembled context persists a context snapshot
containing: the IDs and versions of every included knowledge record and rule;
excluded conflicting records; the prompt version; the model identifier; a
timestamp; a content hash; and the encrypted rendered context where retention
allows. Generated drafts link to their generation run and snapshot, so "why
did it say this?" is always answerable from stored provenance.

## Transmitted data

- Only the data required for the task is transmitted to the model provider:
  the relevant inbound message content, thread context, and the assembled
  approved context. OAuth credentials, tokens, and unrelated mailbox content
  are never transmitted.
- The per-feature enumeration of transmitted fields lives in
  `docs/PRIVACY.md`, and AI-provider transmission consent is recorded before
  any transmission occurs.

## Dry-run behavior

In `dry_run` activation mode the pipeline may classify messages, assemble
context, and optionally generate an internal preview — but it creates no Gmail
draft and performs no Gmail write. Dry-run results are reportable for review.

## Safe failure behavior

- Provider errors, timeouts, and schema-validation failures leave the message
  in a safe unprocessed state: no draft is created, and low-confidence or
  failed cases route to manual review where applicable.
- Failures never bypass activation modes, allowlists, rate limits, or the
  account-level/global kill switches.
- Repeated failures trigger the error-pause behavior (drafting pauses; manual
  resume required). All failures are audited with redacted logging — raw
  bodies, prompts, and credentials never appear in logs.
