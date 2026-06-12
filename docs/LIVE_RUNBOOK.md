# LIVE_RUNBOOK — going live on your inbox

The end-to-end script for taking EchoLoop live as a controlled single-user
pilot. Every step is user-run on your machine. EchoLoop **never sends email**
— you always press Send in Gmail — and **no learning activates without your
approval**.

## 0. Prerequisites (once)

- Docker Desktop (for local Postgres), Node 24, pnpm.
- Dev Google Cloud project (`echoloop-dev`) with the Gmail API enabled;
  External/Testing consent screen with your pilot address as a test user;
  Desktop-app OAuth client JSON saved to `~/.echoloop/credentials.json`
  (must live outside this repository — enforced in code).
- Anthropic API key.

## 1. Configure

```bash
docker compose up -d           # Postgres 16 on :5432
cp .env.example .env
```

Fill `.env`:

```
DATABASE_URL=postgres://echoloop:echoloop@127.0.0.1:5432/echoloop
ENCRYPTION_KEY=<base64 of 32 random bytes; e.g. `openssl rand -base64 32`>
ANTHROPIC_API_KEY=<your key>
GOOGLE_CREDENTIALS_PATH=~/.echoloop/credentials.json
ECHOLOOP_ACTIVATION_MODE=dry_run
ECHOLOOP_DRAFTING_KILL_SWITCH=true
```

```bash
pnpm install && pnpm run build
node apps/worker/dist/migrate.js
```

## 2. Connect Gmail + record AI consent

```bash
node apps/worker/dist/connect-gmail.js    # prints consent URL; approve in browser
node apps/worker/dist/record-consent.js   # records AI-transmission consent (audited)
node apps/worker/dist/show-recent.js      # sanity check: last 10 eligible messages
```

While the consent screen is in Testing status, Google expires refresh tokens
after ~7 days — the worker will report `reconnect_required`; just re-run
`connect-gmail.js`.

## 3. Dry-run period (recommended: a day or two)

```bash
node apps/worker/dist/run-worker.js       # leave running; Ctrl-C to stop
node apps/worker/dist/triage-report.js    # review what it would have replied to
```

In `dry_run` mode messages are classified but **no Gmail draft is created**.

## 4. Allowlist + enable drafting

```bash
node apps/worker/dist/allowlist.js add sender_email <your-second-address>
```

Then in `.env` set:

```
ECHOLOOP_ACTIVATION_MODE=allowlist
ECHOLOOP_DRAFTING_KILL_SWITCH=false
```

Restart `run-worker.js`.

## 5. Run the loop for real

1. From the allowlisted address, send your pilot inbox a clear question.
2. Within one poll cycle a **threaded draft appears in Gmail Drafts** —
   review it, edit it (e.g. shorten it), and **press Send yourself**.
3. Next cycles: the worker detects the sent message, pairs it (evidence
   recorded), compares draft vs sent, and — after repeated consistent edits
   (3+ for style; immediately for factual corrections) — files a proposal.
4. Review proposals:
   ```bash
   node apps/worker/dist/proposals.js list
   node apps/worker/dist/proposals.js approve <id>     # or reject / defer
   ```
5. Send another test email: the new draft's context now includes your
   approved rule (`preview-draft.js` shows facts/rules used).
6. Inspect or undo at any time:
   ```bash
   node apps/worker/dist/proposals.js rollback-rule <ruleId>
   node apps/worker/dist/pairing-queue.js list         # ambiguous pairings
   node apps/worker/dist/export-playbook.js            # Markdown/JSON snapshot
   ```

## 6. Controls

| Action                  | How                                                                                          |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| Stop drafting instantly | `ECHOLOOP_DRAFTING_KILL_SWITCH=true` + restart worker (sent capture keeps running)           |
| Pause one account       | set `email_accounts.drafting_paused`                                                         |
| Stop everything         | Ctrl-C the worker; revoke Gmail access (Google account settings) — sync then stops by design |
| Weekly re-consent       | re-run `connect-gmail.js` when status is `reconnect_required`                                |

## Honest limits of this go-live

This is a controlled pilot, not production: the continuous loop is minimal
(Phase 10 reliability hardening — circuit breaker, dead-letter replay, health
checks — is not built); the review surface is CLI (Phase 9 web app pending);
do not claim learning effectiveness from one or two examples
(`docs/EVALUATION.md`).
