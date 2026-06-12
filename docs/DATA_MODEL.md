# DATA_MODEL

The authoritative store is PostgreSQL. The user nonetheless experiences
knowledge as editable documents and discrete rules. The concrete schema and
migrations are implemented in Phase 1 (and extended as later phases need them);
as of Phase 0 **no schema exists yet**. This document enumerates the planned
tables and the constraints they must enforce.

## Tenancy

Even though the pilot is single-user, core records carry `organization_id`,
`user_id`, and `email_account_id` so the foundation is productization-ready. No
multi-user UI is built in the MVP.

## Planned tables

**Identity:** `users`, `organizations`, `memberships`.

**Gmail:** `email_accounts`, `mailbox_checkpoints`, `mailbox_events`,
`email_threads`, `email_messages`, `message_participants`, `gmail_drafts`,
`gmail_draft_versions`.

**Context & generation:** `contacts`, `contact_relationships`,
`message_classifications`, `context_snapshots`, `prompt_versions`,
`generation_runs`, `generated_drafts`.

**Pairing & comparison:** `pairing_candidates`, `draft_sent_pairs`,
`comparisons`.

**Learning:** `knowledge_documents`, `knowledge_document_versions`, `rules`,
`rule_versions`, `rule_evidence`, `rule_proposals`, `proposal_evidence`.

**Operations:** `jobs`, `job_attempts`, `audit_events`, `evaluation_cases`,
`evaluation_runs`, `data_export_requests`, `data_deletion_requests`.

## Required database-level constraints

- One sent message cannot be paired with multiple generated drafts.
- One generated draft cannot be paired with multiple sent messages.
- Provider identifiers are unique within an email account.
- Tenant boundaries are explicit on every row.
- Rule versions are immutable once written.
- Evidence rows cannot reference another organization.

## Knowledge categories (modeled, not seeded)

Approved facts (override style), terminology, temporary emphasis (with
start/expiration/scope/active), personal style, and conditional rules
(instruction, scope, conditions, priority, risk, status, effective dates,
version, supporting + contradictory evidence, creation source, approval
history). Unverified personal preferences are never seeded.

## Implemented so far (Phase 1)

Drizzle schema + one committed migration (`packages/database/drizzle/`) covering
identity/tenancy + operations only:

- **Identity/tenancy:** `organizations`, `users`, `memberships`,
  `email_accounts` (encrypted token columns hold ciphertext, populated in
  Phase 2).
- **Operations:** `audit_events`, `jobs`, `job_attempts`,
  `data_export_requests`, `data_deletion_requests`.

Constraints enforced now: explicit `organization_id` + FKs on tenant rows;
`email_accounts(provider, provider_email)` unique; `memberships(org, user)`
unique; `jobs(organization_id, idempotency_key)` unique (idempotent enqueue).
Immutable rule versions, draft↔sent uniqueness, and evidence cross-org guards
land with their tables in later phases.

## Implemented in Phase 2 (migration `0001`)

- **`mailbox_checkpoints`** — sync cursor per account and kind (`inbox`/`sent`);
  unique `(email_account_id, kind)`.
- **`mailbox_events`** — durable record of Gmail history events; unique
  `(email_account_id, history_id, type, provider_message_id)` makes duplicate
  event delivery idempotent.
- **`email_threads`** — unique `(email_account_id, provider_thread_id)`;
  normalized subject for later pairing.
- **`email_messages`** — unique `(email_account_id, provider_message_id)`;
  direction (inbound/outbound via alias detection); `body_text_encrypted`
  ciphertext only; RFC headers (`Message-ID`, `In-Reply-To`, `References`),
  labels, content hash, internal date.
- **`message_participants`** — from/to/cc participants per message (plaintext
  addresses, required for Phase 7 pairing; always redacted from logs).

`email_accounts.status` state machine: `disconnected → connected →
reconnect_required → connected` (re-consent) or `→ revoked`
(see `docs/GMAIL_INTEGRATION.md`).

Remaining domain tables (drafts, context/generation, pairing, learning) are
added by the phase that first writes them — incremental migrations per
`docs/DECISIONS.md` D-004.

## Migrations policy

Migrations are committed and reviewed. The final schema is implemented in
migrations **before** workflows that depend on it. A destructive migration is a
STOP-and-ask decision (BUILD_BRIEF §1.2).
