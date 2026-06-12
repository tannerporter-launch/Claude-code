# GMAIL_INTEGRATION

Design contract for EchoLoop's Gmail integration. Implementation lands in Phase
2 (read-only sync) and Phase 6 (allowlisted draft creation). As of Phase 0
there is **no live Gmail integration** (see `docs/STATUS.md`).

## Provider interface (approved operations only)

The Gmail provider abstraction may expose:

- Get profile
- List history
- Get message
- Get thread
- List drafts
- Get draft
- Create draft
- Update draft (only if explicitly required)
- Revoke connection

It must **not** expose any of:

- Send message
- Send draft
- Insert sent message

Because draft-creation permission can technically authorize sending, the
no-send rule is enforced in code (static test + restricted imports + code-owner
review), not assumed from OAuth.

## Scopes

Request only: read messages and thread history, read sent messages, and
create/manage drafts. No label-management scope unless explicitly added.
Changing scopes is a STOP-and-ask decision.

## Synchronization model

- **Initial sync:** store the current `historyId` cursor; optionally import a
  limited user-selected historical sample for style analysis; mark it baseline;
  **never draft historical mail**; require explicit activation before live
  drafting.
- **Incremental polling:** poll history on a configurable interval using
  `historyId` as the cursor. Process all pages; persist the latest confirmed
  cursor only after successful processing; treat duplicate events idempotently;
  recover from expired/invalid cursors with a controlled full sync that does not
  re-draft previously seen mail. Inbox and sent-event processing are logically
  separate even on the same history feed.
- **Future push mode:** Cloud Pub/Sub push is a hosted-pilot backlog item. The
  provider and sync services do not assume polling is the only trigger.

## Activation modes

`disabled` → `dry_run` → `allowlist` → `enabled`. Drafts are only created in
`allowlist` (matching a configured sender/domain/label/thread/message) or
`enabled` (after the controlled pilot passes). Rate limits, error-pause, and two
kill switches (account-level + global) gate all drafting.

## Auditing

Every live Gmail write emits a structured audit event. Audit events never
contain raw bodies, addresses, tokens, or prompts.

## Pairing evidence (Phase 7)

Sent↔draft pairing never relies on thread ID alone; it combines thread ID,
draft/message-ID history, RFC `Message-ID`/`In-Reply-To`/`References`, optional
verified correlation header, normalized subject, recipient overlap, sender
account, time proximity, draft status, and candidate count.
