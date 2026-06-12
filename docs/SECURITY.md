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

Confirmed scope set (user-approved, `docs/DECISIONS.md` D-009):
`gmail.readonly` + `gmail.compose` only — fixed as a code constant, not
env-configurable. No label-management scope. Changing scopes is a STOP-and-ask
decision (BUILD_BRIEF §1.2).

## OAuth credential & token lifecycle (implemented, Phase 2)

- The Desktop-app client JSON is referenced via `GOOGLE_CREDENTIALS_PATH` and
  must resolve **outside the repository tree** — enforced by
  `resolveGoogleCredentialsPath` (D-010), plus gitignore patterns for
  `credentials*.json` / `client_secret*.json`.
- Access/refresh tokens are stored only as AES-256-GCM ciphertext in
  `email_accounts`; never logged (redaction by key name).
- Refresh-token expiry/revocation (`invalid_grant`) → clean, audited
  `reconnect_required` account state; sync stops for that account until the
  user re-consents (D-011 — expected ~weekly while the consent screen is in
  Testing status).
- Revocation clears stored tokens and stops processing.

## Data at rest

- OAuth tokens encrypted at rest.
- Retained email bodies encrypted.
- Context snapshots containing correspondence encrypted.
- Local encryption key supplied via environment (`ENCRYPTION_KEY`), never
  committed.

**Scheme (implemented in `@echoloop/security`, Phase 1):** AES-256-GCM with a
random 96-bit IV per value and an authentication tag. The stored envelope is
`v1:<base64 iv>:<base64 authTag>:<base64 ciphertext>`. Decryption fails closed on
tampering or a wrong key (the GCM tag does not verify). The 32-byte key is read
from `ENCRYPTION_KEY` (base64); a key of the wrong length is rejected. Tests
cover round-trip, tamper-detection, wrong-key, and key-length failures.

**Log redaction (implemented):** the structured logger redacts, by key name and
recursively, anything matching tokens, authorization, secrets, the encryption
key, bodies/`bodyText`/raw bodies, prompts, and addresses/recipients/emails —
before serialization. The audit-event service applies the same redaction to
stored audit detail.

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
