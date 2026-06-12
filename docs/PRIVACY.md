# PRIVACY

How EchoLoop handles user correspondence and personal data in the controlled
single-user pilot. Phase 0 records the policy; enforcement mechanisms arrive in
later phases (see `docs/STATUS.md`).

## Principles

- **Minimization.** Retain only what is needed for triage, drafting, pairing,
  comparison, and evidence-controlled learning. Retention is configurable.
- **Local-first.** PostgreSQL is the authoritative store; the web app binds to
  localhost. Nothing about correspondence is committed to source control.
- **No silent learning.** No knowledge changes and no rule activates without
  explicit human approval.

## Data categories

| Category                           | Stored?            | Encrypted at rest                                  |
| ---------------------------------- | ------------------ | -------------------------------------------------- |
| OAuth tokens                       | Yes                | Yes (AES-256-GCM, implemented Phase 1/2)           |
| Retained email bodies              | Yes (configurable) | Yes (implemented Phase 2)                          |
| Message headers/participants       | Yes                | Plaintext (needed for pairing); redacted from logs |
| Context snapshots (correspondence) | Yes                | Yes                                                |
| Logs                               | Yes                | Redacted (no bodies/addresses/tokens/prompts)      |
| Knowledge base / rules / evidence  | Yes                | Per security policy                                |

As of Phase 2, the data actually stored from Gmail is: message metadata
(subject, snippet, labels, RFC headers, timestamps), participants (addresses +
display names), and the message body **as ciphertext only**. Baseline sync
stores a cursor, not historical mail. Revoking access clears tokens and stops
processing.

## Transmission to the AI provider

When AI features are implemented, the relevant message content and assembled
context are transmitted to the Anthropic API to produce a draft or
classification. This document will enumerate, per feature, exactly which fields
are transmitted. Transmission consent is recorded. As of Phase 0 **no data is
transmitted to any model provider** because no AI integration exists.

## User rights

- **Export:** the active playbook (Markdown + JSON) and retained user data.
- **Deletion:** complete removal of retained user data (account deletion
  removes retained data — verified end-to-end by Phase 12).
- **Revocation:** revoking Gmail access stops all processing.

## Out of scope for the MVP

Multi-user data handling, public signup, and any third-party data sharing
beyond the model provider used to generate drafts.
