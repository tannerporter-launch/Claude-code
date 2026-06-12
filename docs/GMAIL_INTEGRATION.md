# GMAIL_INTEGRATION

Design contract and implementation status for EchoLoop's Gmail integration.
Phase 2 (OAuth + read-only synchronization) is implemented mock-first; the live
provider code exists but is verified only when the user runs the connect
runbook below. **No draft creation, no model calls, no historical
auto-drafting, and no send operation — ever.**

## Scopes (user-approved, docs/DECISIONS.md D-009)

Exactly two scopes, fixed in code (`GMAIL_SCOPES` in `packages/gmail`):

| Scope            | Why it is needed                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `gmail.readonly` | Read inbox/thread history and sent messages for sync, triage (Phase 3), and sent-capture/pairing (Phase 7).                                 |
| `gmail.compose`  | Create and manage drafts (Phase 6). Technically also covers sending — which is why the no-send invariant is enforced in code, not by scope. |

`gmail.modify` is **not** requested (no label management). Scopes are not
configurable via env, so they cannot drift; changing them is a stop-and-ask
decision.

## Provider interface (Phase 2 surface)

`GmailProvider` exposes read-only operations only: `getProfile`, `listHistory`,
`getMessage`, `getThread`, `listDrafts`, `getDraft`, `revoke`. `createDraft`
arrives in Phase 6. Send-style operations never exist (static no-send test +
ESLint SDK-import boundary + CODEOWNERS on `packages/gmail/`). The live
implementation (`live.ts`) is the only module touching the Gmail SDK.

## Credentials handling

The Desktop-app OAuth client JSON lives **outside the repository tree** —
default `~/.echoloop/credentials.json`, overridable via
`GOOGLE_CREDENTIALS_PATH`. The env loader **rejects any path that resolves
inside the repo** (docs/DECISIONS.md D-010), and `.gitignore` additionally
blocks `credentials*.json` / `client_secret*.json`. Tokens are stored only as
AES-256-GCM ciphertext in `email_accounts`.

## Account status state machine

```
disconnected ──connect──▶ connected ──invalid_grant──▶ reconnect_required
                              │                              │
                              │◀──────── re-consent ─────────┘
                              └──revoke──▶ revoked
```

**`reconnect_required` is an expected state, not an error** (docs/DECISIONS.md
D-011): while the Google consent screen is in Testing status, refresh tokens
expire after ~7 days. Sync detects `invalid_grant`, marks the account, emits an
audit event, and stops cleanly; re-running the connect CLI re-consents and
restores syncing. Revocation clears tokens and stops all processing.

## Synchronization model (implemented, Phase 2)

- **Baseline:** on connect, store the current `historyId` as the inbox
  checkpoint. No historical mail is imported; nothing historical is ever
  drafted.
- **Incremental:** `listHistory` from the checkpoint, processing **all pages**;
  each event is recorded in `mailbox_events` under a unique dedupe key, so
  duplicate events are idempotent; messages are parsed (MIME → canonical form)
  and persisted with **encrypted bodies**; the checkpoint advances **only after
  the whole pass succeeds**.
- **Cursor recovery:** an expired/invalid `historyId` triggers a controlled
  re-baseline from the current profile (audited as `gmail.sync_recovered`);
  previously seen mail is not reprocessed and nothing is drafted during
  recovery.
- Inbox and sent-event processing are logically separate (`mailbox_checkpoints.kind`);
  sent-capture arrives in Phase 7.
- **Future push mode:** Cloud Pub/Sub remains hosted-pilot backlog; nothing
  assumes polling is the only trigger.

## Live-wiring runbook (user-run; the only live steps)

Prereqs: dev GCP project `echoloop-dev` with Gmail API enabled; Testing consent
screen with the pilot address as test user; Desktop-app OAuth client JSON saved
to `~/.echoloop/credentials.json`; local Postgres (`docker compose up -d`);
`.env` with `DATABASE_URL`, `ENCRYPTION_KEY` (32-byte base64), and optionally
`GOOGLE_CREDENTIALS_PATH`.

```bash
pnpm install && pnpm run build
node apps/worker/dist/connect-gmail.js   # prints consent URL; approve in browser
node apps/worker/dist/show-recent.js     # syncs once, prints last 10 eligible summaries
```

When sync reports `reconnect_required` (expected ~weekly in Testing status),
re-run `connect-gmail.js`.

## Pairing evidence (Phase 7, unchanged contract)

Sent↔draft pairing never relies on thread ID alone; it combines thread ID,
draft/message-ID history, RFC `Message-ID`/`In-Reply-To`/`References`, optional
verified correlation header, normalized subject, recipient overlap, sender
account, time proximity, draft status, and candidate count.
