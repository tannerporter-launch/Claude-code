# BUILD_BRIEF.md

EchoLoop — Human-in-the-Loop Correspondence Learning Engine

Status: Authoritative MVP build specification
Working title: EchoLoop
Initial deployment: Single-user controlled Gmail pilot
Primary objective: Prove that structured learning from human edits reduces the amount and significance of editing required in future AI-generated correspondence.

---

## 1. Instructions for Claude Code

### 1.1 Read before acting

Before modifying the repository:

1. Read this entire file.
2. Read CLAUDE.md.
3. Read all files under docs/.
4. Inspect the current repository.
5. Enter or remain in plan mode.
6. Produce a dependency-aware plan for the current phase only.
7. Identify any conflict between the requested phase and existing implementation.
8. Do not implement later phases early.

### 1.2 Decision policy

Do not stop for every minor implementation choice.

Proceed with a documented, reversible default when the decision:

- Does not alter the product contract
- Does not weaken security
- Does not create destructive migration risk
- Does not materially affect the user-facing workflow
- Can be changed later without significant rework

Record such choices in docs/DECISIONS.md.

Stop and request a decision only when the choice:

- Changes Gmail permissions
- Changes what data is retained or transmitted
- Could permit autonomous sending
- Creates a destructive schema migration
- Changes the human approval model
- Creates material recurring infrastructure cost
- Changes the central product behavior
- Introduces an unresolved security tradeoff

Do not add explanatory comments throughout the code merely to document ordinary choices. Put architectural rationale in docs/DECISIONS.md. Use code comments only where the implementation would otherwise be misleading.

### 1.3 Source-of-truth hierarchy

When two sources conflict, apply this priority:

1. Explicit instruction in the current Claude Code session
2. docs/DECISIONS.md
3. This BUILD_BRIEF.md
4. Automated tests and acceptance criteria
5. Other approved documents under docs/
6. Existing implementation
7. Original transcript under docs/source-material/

The transcript is provenance, not an implementation specification.

Do not implement functionality solely because it appears in the transcript. Record any material transcript-only idea in docs/BACKLOG.md.

### 1.4 Hard product invariants

1. The application never sends an email.
2. A human must press Send in Gmail.
3. No Gmail send operation may exist in the application's Gmail abstraction.
4. No knowledge rule becomes active without human approval.
5. AI output is untrusted until schema-validated.
6. Factual knowledge takes precedence over stylistic rules.
7. A factual correction must not automatically become a style rule.
8. Every generated draft must preserve its production provenance.
9. Every active rule must preserve its supporting evidence.
10. Every active rule must be reversible.
11. Ambiguous sent-message pairings must require human review.
12. Raw email content and OAuth credentials must never appear in logs.
13. No automated test may send email to a real recipient.
14. Initial mailbox synchronization must not generate drafts for historical mail.
15. Mocked functionality must never be represented as a completed live integration.

### 1.5 Completion policy

A phase is complete only when:

- Its automated acceptance tests pass
- Relevant type checking and linting pass
- Documentation reflects the implementation
- No critical TODO remains hidden in code
- docs/STATUS.md accurately identifies what is live, mocked, incomplete, or manually verified
- The phase completion report lists: files changed, migrations added, tests executed, test results, manual checks performed, assumptions, remaining risks

Do not claim that the application is production-ready during the MVP phases.

---

## 2. Product concept

EchoLoop is a human-in-the-loop correspondence assistant.

It monitors eligible inbound Gmail messages, determines whether a reply is likely needed, generates a proposed response using approved factual context and communication guidance, and creates that response as a Gmail draft.

The user reviews, edits, and sends the message normally in Gmail.

EchoLoop then:

1. Detects the final sent message
2. Pairs it with the original AI draft
3. Measures and classifies the differences
4. Distinguishes reusable preferences from one-time corrections
5. Proposes a precise update to the communication playbook or knowledge base
6. Waits for human approval
7. Applies approved learning to subsequent drafts

The key product is the evidence-controlled loop between the recommended message, the final human-approved message, the context in which the change occurred, and the approved rule or knowledge update derived from repeated evidence.

---

## 3. Explicitly supported contextual dimensions

The MVP must model at least: sender relationship to the user; one-to-one versus multi-participant thread; information request; action request; mixed information and action request; acknowledgment or politeness-only response; scheduling request; decision or approval request; no response required; internal versus external correspondence; contact-specific context; organization-wide factual context; department-specific context; time-bound terminology or emphasis.

These dimensions may be extended, but not silently replaced with a narrower schema.

---

## 4. MVP scope

### 4.1 Build now

One user; one connected Gmail account; one default organization; Gmail only; a local or controlled private web application; Gmail OAuth; initial mailbox synchronization without drafting historical messages; incremental mailbox synchronization using Gmail history; dry-run classification; allowlist-based pilot drafting; inbound-message triage; context extraction; layered context assembly; AI draft generation; Gmail draft creation; human editing and manual sending; sent-message detection; draft-to-sent pairing; mechanical text comparison; semantic change classification; learning proposals; human approval, editing, rejection, and rollback; versioned communication rules; versioned knowledge documents; contact relationship management; audit history; evaluation fixtures and reports; Gmail revocation; data export and deletion; drafting kill switch.

### 4.2 Do not build in the MVP

Autonomous sending; SMS; Outlook; Slack; CRM integrations; billing; mobile applications; fine-tuning; full enterprise search; arbitrary agent actions; multi-user administration; public self-service signup; complicated enterprise SSO; automatic activation of learned rules; automatic processing of attachments; automatic Git commits containing user correspondence or company knowledge.

### 4.3 Productization-compatible foundations

Although the first pilot is single-user, core records must include appropriate organization_id, user_id, and email_account_id. Do not build multi-user interfaces yet.

---

## 5. Technical baseline

Use: Node.js 24.x; TypeScript with strict mode; pnpm workspaces; PostgreSQL;
Docker Compose for local PostgreSQL; a typed ORM with committed migrations; a
database-backed durable job queue; a React-based web application; a separate
worker process; Google OAuth and Gmail API; Anthropic API through a provider
abstraction; runtime schema validation; structured logging with field-level
redaction; unit tests; integration tests; browser tests; synthetic Gmail and AI
fixtures.

Recommended layout:

```
echoloop/
├── BUILD_BRIEF.md
├── CLAUDE.md
├── README.md
├── docker-compose.yml
├── .env.example
├── apps/
│   ├── web/
│   └── worker/
├── packages/
│   ├── ai/
│   ├── correspondence/
│   ├── database/
│   ├── gmail/
│   ├── jobs/
│   ├── schemas/
│   ├── security/
│   └── testing/
├── docs/
│   ├── ARCHITECTURE.md
│   ├── BACKLOG.md
│   ├── DATA_MODEL.md
│   ├── DECISIONS.md
│   ├── EVALUATION.md
│   ├── GMAIL_INTEGRATION.md
│   ├── PRIVACY.md
│   ├── SECURITY.md
│   ├── STATUS.md
│   └── source-material/
│       └── original-conversation-transcript.docx
├── kb-templates/
│   ├── personal-style.md
│   ├── company-facts.md
│   ├── terminology.md
│   └── emphasis.md
└── exports/
    └── .gitkeep
```

exports/ must be ignored except for .gitkeep. User data is not committed to the source repository.

---

## 6. Knowledge architecture

PostgreSQL is the authoritative store. The user must still experience the knowledge system as editable documents and discrete rules.

### 6.1 Knowledge categories

- **Approved facts** (services, pricing, policies, product names, company positions, approved claims, current initiatives). Approved facts override all stylistic instructions.
- **Terminology** (preferred vocabulary, internal jargon, product capitalization, terms to avoid, department-specific language).
- **Temporary emphasis** — every entry supports start date, expiration date, scope, active status.
- **Personal style** (length, tone, formatting, greetings, sign-offs, directness, degree of explanation). Do not seed unverified personal preferences.
- **Conditional rules** — each contains instruction, scope, conditions, priority, risk level, status, effective dates, version, supporting evidence, contradictory evidence, creation source, approval history.

### 6.2 Human-readable export

The application must provide explicit export of the active playbook to Markdown and JSON. Exports are snapshots, not authoritative sources.

---

## 7. Gmail permissions and safety architecture

For the controlled Gmail pilot, request only the scopes required to read messages and thread history, read sent messages, and create and manage drafts. Do not request label-management permission unless label management is explicitly added.

Because draft-creation permission can also technically authorize sending, enforce the no-send invariant in code.

### 7.1 Required safeguards

The Gmail provider interface must expose only approved operations: get profile, list history, get message, get thread, list drafts, get draft, create draft, update draft (if explicitly required), revoke connection.

It must not expose: send message, send draft, insert sent message.

Add: (1) a static test that fails when prohibited Gmail send operation names appear in executable application code; (2) restricted-import rules; (3) a code-owner or review marker around the Gmail adapter; (4) structured audit events for every live Gmail write; (5) an account-level drafting kill switch; (6) a global drafting kill switch.

Do not claim that OAuth alone prevents sending.

---

## 8. Gmail synchronization model

### 8.1 Initial synchronization

On first connection: store the current mailbox history position; optionally import a limited user-selected historical sample for style analysis; never generate drafts for historical messages; mark imported history as baseline data; require explicit activation before live drafting starts.

### 8.2 Incremental polling

The local MVP polls Gmail history on a configurable interval, using Gmail historyId as the synchronization cursor. Process all pages; store the latest confirmed cursor only after successful processing; treat duplicate events idempotently; recover from expired or invalid history cursors with a controlled full synchronization; do not generate drafts during recovery for previously seen mail; separate inbox and sent-event processing logically even if they use the same mailbox history feed.

### 8.3 Future push mode

Cloud Pub/Sub push notification support belongs in the hosted-pilot backlog. The Gmail provider and synchronization services must not assume polling is the only possible trigger mechanism.

---

## 9. Safe activation modes

The application must support: disabled, dry_run, allowlist, enabled.

- **Dry run:** classify messages, assemble context, optionally generate a preview internally, do not create Gmail drafts.
- **Allowlist:** create drafts only when at least one configured condition matches (sender email, sender domain, Gmail label, specific test thread, explicit user-selected message).
- **Enabled:** broad drafting is permitted only after the controlled pilot passes.

Also implement: maximum drafts per worker cycle; maximum drafts per hour; pause after repeated errors; manual resume.

---

## 10. Core workflow

### 10.1 Inbound triage

For each newly eligible inbound message: apply deterministic exclusions; parse canonical message content; remove quoted history and signatures where reliably possible; preserve the original encrypted body for audit and comparison when retention allows; determine whether a response is likely needed; extract contextual features; store a validated classification result; route low-confidence cases to review; continue to drafting only when activation policy permits.

Deterministic exclusions include: spam; trash; messages sent by the connected account; known automated notifications; no-reply addresses; bulk mail; mailing-list traffic unless explicitly enabled; calendar/system notifications; previously processed messages.

### 10.2 Context assembly

Apply context in this precedence order: (1) approved factual truth; (2) legal, privacy, and safety constraints; (3) organization terminology; (4) department guidance; (5) temporary emphasis; (6) user-wide style; (7) relationship-specific style; (8) contact-specific guidance; (9) thread history and commitments; (10) current inbound message.

Every context snapshot must preserve: IDs and versions of included records; excluded conflicting records; prompt version; model identifier; timestamp; content hash; encrypted rendered context where retained.

### 10.3 Draft generation

The model must return validated structured output including shouldDraft, messageTypes, relationship {value, source}, replyMode, subject, bodyText, questionsAnswered, requestedActions, commitmentsMade, factsUsed, rulesUsed, uncertainties, confidence.

Before creating a Gmail draft: validate the schema; validate recipients; check prohibited commitments; check unsupported factual claims; check activation mode; check rate limits; check both kill switches; record the generation run.

### 10.4 Human action

The user edits and sends in Gmail. The application does not control or simulate the Send action.

### 10.5 Sent-message capture

When a new sent message is detected: normalize headers, participants, subject, body, thread, and time; identify candidate generated drafts; score each candidate; pair automatically only above the approved confidence threshold; route ambiguous cases to manual pairing; preserve the evidence used for the pairing decision.

Pairing evidence may include Gmail thread ID, draft ID history, underlying draft message ID history, RFC Message-ID, In-Reply-To, References, optional custom correlation header when empirically verified, normalized subject, recipient overlap, sender account, time proximity, draft status, number of unresolved candidate drafts. Never rely on thread ID alone.

### 10.6 Comparison

- **Mechanical comparison:** insertions, deletions, replacements, reordering, subject changes, recipient changes, greeting changes, sign-off changes, length changes.
- **Semantic comparison:** classify changes as one or more of tone, brevity, formality, warmth, directness, structure, greeting, sign-off, formatting, relationship handling, added factual information, corrected factual information, removed unsupported claim, changed intent, changed commitment, changed deadline, changed requested action, scheduling correction, privacy correction, recipient correction, one-time situational change, unknown.

### 10.7 Learning proposal

A proposal must contain: exact proposed change; proposal type; target knowledge record or rule; narrowest defensible scope; confidence; risk level; supporting comparisons; contradictory comparisons; evidence count; rationale; expected effect; status.

Proposal types: new style rule; modify style rule; narrow rule scope; broaden rule scope; add contact guidance; add terminology; add approved fact; correct approved fact; add temporary emphasis; mark one-time exception; merge duplicate rules; retire rule.

No proposal becomes active automatically in the MVP.

---

## 11. Minimum data model

Implement the final schema in migrations before workflows that depend on it.

- **Identity:** users, organizations, memberships.
- **Gmail:** email_accounts, mailbox_checkpoints, mailbox_events, email_threads, email_messages, message_participants, gmail_drafts, gmail_draft_versions.
- **Context and generation:** contacts, contact_relationships, message_classifications, context_snapshots, prompt_versions, generation_runs, generated_drafts.
- **Pairing and comparison:** pairing_candidates, draft_sent_pairs, comparisons.
- **Learning:** knowledge_documents, knowledge_document_versions, rules, rule_versions, rule_evidence, rule_proposals, proposal_evidence.
- **Operations:** jobs, job_attempts, audit_events, evaluation_cases, evaluation_runs, data_export_requests, data_deletion_requests.

Use database constraints to ensure: one sent message cannot be paired with multiple generated drafts; one generated draft cannot be paired with multiple sent messages; provider identifiers are unique within an email account; tenant boundaries are explicit; rule versions are immutable; evidence records cannot reference another organization.

---

## 12. Security and privacy requirements

Encrypt OAuth tokens at rest; encrypt retained email bodies; encrypt context snapshots containing correspondence; redact message bodies, addresses, tokens, and prompts from logs; never store secrets in the repository; use a local encryption key from environment configuration; support token revocation; support configurable content retention; support complete user-data deletion; support playbook export; record AI-provider transmission consent; document which data is transmitted to the model provider; bind the local web application to localhost by default; add CSRF protection; add secure session handling; add rate limiting to sensitive routes; validate webhook or push events when push mode is later implemented; use synthetic fixtures for automated tests; never copy live inbox data into committed fixtures.

---

## 13. Evaluation model

Do not use edit distance as the sole success metric.

Track by context bucket: eligible messages; drafts generated; drafts sent; drafts deleted; drafts abandoned; automatic pairing success; manual pairing rate; pairing error rate; normalized character edit distance; normalized token edit distance; semantic change count; factual correction rate; unsupported-claim removal rate; commitment correction rate; recipient correction rate; low-edit draft rate; rule proposal acceptance rate; rule rejection rate; median time from draft creation to send; drafting latency; model cost; model/schema failure rate.

Only claim improvement when: the comparison bucket has sufficient sample size; the measurement window is stated; factual and commitment correction rates do not worsen; pairing confidence is adequate; the trend is not driven only by shorter messages.

---

## 14. Build phases

**Phase 0 — Governance and repository foundation.** Build: repository and workspace structure; CLAUDE.md; documentation files; source hierarchy; .env.example; formatting; linting; type checking; test framework; CI; architecture-boundary checks; prohibited-send-operation static test; docs/STATUS.md. Acceptance: clean installation succeeds; build succeeds; type checking succeeds; tests succeed; no credentials exist in the repository; prohibited-send test is active; status document accurately says that no live Gmail or AI integration exists.

**Phase 1 — Database and security foundation.** Build: PostgreSQL Docker configuration; ORM configuration; initial migrations; core schema; repository layer; tenant-scoped query helpers; encryption service; redacting logger; synthetic seed data; audit-event service; durable jobs foundation. Acceptance: empty database migrates successfully; seed data loads; encryption round-trip passes; sensitive values are redacted; cross-organization access tests fail closed; job claiming is idempotent.

**Phase 2 — Gmail OAuth and read-only synchronization.** Build: OAuth connection; encrypted token storage; token refresh; revocation; Gmail provider interface; message and thread retrieval; MIME parsing; account alias detection; initial baseline sync; Gmail history polling; cursor recovery; duplicate-event handling; mock Gmail provider. Constraints: no draft creation; no model calls; no historical auto-drafting. Acceptance: approved account connects; last ten eligible message summaries can be displayed; duplicate history events create no duplicate records; invalid history cursor triggers controlled recovery; token revocation stops synchronization; all automated tests use mocks.

**Phase 3 — Triage and context extraction.** Build: deterministic exclusion rules; validated triage schema; AI classifier abstraction; context-feature extraction; confirmed versus inferred relationship status; manual-review status; synthetic labeled evaluation set; dry-run reporting. Acceptance: invalid AI output fails safely; newsletters and no-reply messages are excluded in fixtures; human requests are identified in fixtures; mixed action/information messages are represented correctly; no Gmail draft is created.

**Phase 4 — Knowledge base and context assembly.** Build: knowledge-document editor; versioned records; rule engine; rule condition schema; context precedence; temporary effective dates; human-readable export; empty or explicitly approved starter playbook; context snapshot generation. Acceptance: conflicting style and fact rules resolve in favor of facts; expired emphasis is excluded; relationship-specific rules apply only to matching context; no unapproved preference is seeded; context snapshot provenance is complete.

**Phase 5 — Draft generation in dry-run mode.** Build: AI provider abstraction; versioned prompts; draft response schema; fact and commitment extraction; unsupported-claim checks; recipient calculation; reply versus reply-all logic; generation provenance; preview UI or CLI. Acceptance: invalid output creates no preview; fixtures produce valid structured drafts; reply-all participant handling is tested; every fact and rule used is traceable; no Gmail write occurs.

**Phase 6 — Gmail draft creation.** Build: createDraft provider operation; correct MIME construction; thread and reply headers; correlation metadata where supported; draft version registry; allowlist controls; rate limits; kill switches; Gmail-write audit events. Acceptance: an allowlisted test message receives a threaded Gmail draft; a non-allowlisted message receives no draft; the application contains no send operation; static no-send tests pass; disabling drafting prevents new drafts; generation provenance links to the Gmail draft.

**Phase 7 — Sent capture and pairing.** Build: sent-message synchronization; candidate generation; pairing score; pairing evidence; confidence thresholds; manual pairing queue; draft-discard detection; duplicate and retry handling. Acceptance fixtures cover: unedited send; edited body; changed subject; changed recipients; multiple drafts in one thread; send from another device; deleted draft; duplicate event; ambiguous pairing. Ambiguous cases remain unpaired.

**Phase 8 — Comparison and learning proposals.** Build: mechanical diff; semantic comparison; change categories; repeated-pattern grouping; contradictory-evidence search; proposal generation; risk levels; rule versioning; knowledge-correction routing; rollback. Acceptance: repeated shortening produces a scoped brevity proposal; one deletion does not create a global rule; price correction becomes a factual proposal; commitment changes are classified distinctly; rejected proposals do not affect drafting; rolled-back rules stop affecting drafting.

**Phase 9 — Review web application.** Views: connection and activation status; dashboard; message activity; generated-versus-sent comparison; mechanical diff; semantic analysis; manual pairing queue; proposal queue; rule editor; knowledge editor; contacts and relationships; audit log; privacy and deletion settings; evaluation reports. Acceptance: core workflows pass browser tests; loading and failure states exist; inferences are visually distinct from confirmed facts; dangerous actions require confirmation; no UI implies that EchoLoop sent a message.

**Phase 10 — Continuous worker and reliability.** Build: durable job orchestration; retry policy; dead-letter handling; graceful shutdown; token-refresh recovery; rate-limit handling; circuit breaker; worker health status; event replay; draft limits; error pause and manual resume. Acceptance: worker restart does not duplicate drafts; a failed job can be replayed; repeated failures pause drafting; sent capture can remain active while drafting is paused; graceful shutdown leaves no partially claimed job.

**Phase 11 — Evaluation and controlled pilot.** Pilot sequence: connect Gmail; complete baseline sync; run dry mode; review triage outcomes; configure allowlist; generate a Gmail draft; edit and manually send it; detect the sent message; pair it; compare it; produce a proposal; approve the proposal; generate a later draft using the approved rule; revoke Gmail access; verify processing stops. Acceptance: every step has recorded evidence. Do not claim that edit quality has improved based on one or two examples.

**Phase 12 — Security review and hosted-pilot design.** Build: threat model; scope inventory; OAuth verification plan; restricted-data inventory; retention plan; incident-response plan; backup and restoration procedure; push-notification architecture; multi-user authorization design; PostgreSQL deployment design; cost model; public-launch gating checklist. Acceptance: no unresolved critical security finding; data deletion passes end to end; token revocation passes end to end; production gaps are explicit; the application is still labeled a controlled pilot.

---

## 15. Required invariant tests

At minimum, implement tests proving: no application service exposes Gmail send; no prohibited send endpoint is referenced; historical sync does not create drafts; disabled mode creates no draft; dry-run mode creates no Gmail draft; allowlist mode rejects unmatched mail; duplicate Gmail events are idempotent; expired history cursor recovers safely; invalid model output creates no draft; unsupported facts are not silently introduced; company fact overrides style; ambiguous pairing remains unpaired; one sent message cannot pair twice; one draft cannot pair twice; factual corrections do not become style rules; rejected rules are not applied; rolled-back rules are not applied; cross-tenant access is denied; revoked OAuth stops processing; raw bodies and tokens are absent from logs; account deletion removes retained data.

---

## 16. Definition of done for the MVP

The MVP is complete when: a newly received allowlisted Gmail message is classified; EchoLoop creates a threaded Gmail draft; the user edits and manually sends it; EchoLoop detects the final sent message; the correct draft and sent message are paired with recorded evidence; their differences are mechanically and semantically classified; a scoped learning proposal appears; the user can approve, edit, reject, or defer it; an approved rule influences a later draft; the user can inspect why that rule was applied; the rule can be rolled back; drafting can be disabled immediately; Gmail access can be revoked; retained user data can be exported and deleted; no email has been sent by EchoLoop; no knowledge has changed without human approval.

---

## 17. Definition of product success

The MVP proves technical viability. It does not yet prove product-market fit or learning effectiveness.

Evidence of learning effectiveness requires: sufficient paired examples; reliable pairings; declining edit burden within comparable context buckets; stable or improving factual accuracy; stable or improving commitment accuracy; low rejection rates for accepted learning proposals; user confidence in the audit and rollback controls.

Do not claim "the system learned the user" without that evidence.
