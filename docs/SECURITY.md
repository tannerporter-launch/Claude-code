# SECURITY

Security and privacy requirements for the EchoLoop MVP. Phase 0 establishes the
contract and the enforcing tests; cryptographic implementation lands in Phase 1
and is tracked in `docs/STATUS.md`.

## Non-negotiable invariants

- The application never sends email. No Gmail send operation exists in app code.
  Enforced by `tests/invariants/no-send.test.ts`, restricted imports, and the
  `CODEOWNERS` marker on `packages/gmail/`. OAuth scope alone is **not** treated
  as sufficient to prevent sending.
- Raw email content, email addresses, OAuth tokens, and prompts are redacted
  from logs (redacting logger, Phase 1).
- No secrets in the repository. Configuration comes from the environment;
  `.env` is git-ignored and only `.env.example` (no real values) is committed.

## Gmail scopes (controlled pilot)

Request only what is needed to: read messages and thread history, read sent
messages, and create/manage drafts. Do **not** request label-management scope
unless label management is explicitly added later. Changing requested scopes is
a STOP-and-ask decision (BUILD_BRIEF §1.2).

## Data at rest

- OAuth tokens encrypted at rest.
- Retained email bodies encrypted.
- Context snapshots containing correspondence encrypted.
- Local encryption key supplied via environment (`ENCRYPTION_KEY`), never
  committed.

## Application surface

- Local web app binds to `127.0.0.1` by default; not exposed publicly.
- CSRF protection, secure session handling, and rate limiting on sensitive
  routes (Phase 9 / ongoing).
- Push/webhook validation is required if/when push mode is implemented (future
  hosted pilot).

## User control

- Token revocation stops processing.
- Configurable content retention.
- Complete user-data export and deletion.
- AI-provider transmission consent is recorded, and `docs/PRIVACY.md` documents
  exactly what is transmitted to the model provider.

## Testing

- Automated tests use synthetic fixtures only.
- No test sends email to a real recipient.
- Live inbox data is never copied into committed fixtures.

## Threat model

A full threat model, scope inventory, restricted-data inventory, incident
response, and the public-launch gating checklist are Phase 12 deliverables.
Until then the product is labeled a controlled pilot, not production-ready.
