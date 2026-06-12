# LEARNING_MODEL

How EchoLoop turns observed human edits into approved, reversible knowledge.
This document defines the distinctions and state machine only — it does not
restate the product specification (`BUILD_BRIEF.md` §10 remains
authoritative), and `docs/EVALUATION.md` serves as the evaluation plan.

As of Phase 0 none of this is implemented (see `docs/STATUS.md`).

## Three distinct record kinds (never conflated)

1. **Observation** — a single paired draft↔sent comparison, mechanical and
   semantic. Observations are evidence. An observation by itself never changes
   drafting behavior.
2. **Proposal** — a precise suggested change derived from observations,
   carrying type, target, narrowest defensible scope, confidence, risk level,
   supporting and contradictory evidence, rationale, and expected effect. A
   proposal is pending until a human acts on it. **No proposal activates
   automatically.**
3. **Active rule / knowledge record** — exists only after explicit human
   approval. Versioned, evidence-linked, and reversible.

## Factual corrections vs. style changes

- Factual corrections route to the knowledge base (approved facts), and facts
  outrank all stylistic rules during context assembly.
- A factual correction never automatically becomes a style rule, and a style
  observation never silently edits a fact.
- Commitment, deadline, requested-action, recipient, privacy, and scheduling
  changes are classified distinctly from tone/brevity/formatting changes and
  are routed and risk-rated accordingly.

## Evidence thresholds

- A single edit produces at most a **one-time exception** marker — never a
  global rule.
- Proposals require repeated supporting evidence within a comparable context
  bucket before being raised, and they record their evidence count.
- Higher-risk proposal types (facts, commitments, broadened scope) require
  stronger evidence and carry elevated risk levels in review.

## Contradiction search

Before a proposal is raised, the comparison history is searched for
contradictory evidence (edits pointing the opposite way in the same scope).
Contradictory comparisons are attached to the proposal so the reviewer sees
both sides; unresolved contradictions lower confidence and can hold a proposal
back entirely.

## Scope selection

Proposals take the **narrowest defensible scope** supported by their evidence —
contact-specific before relationship-specific before department before
organization-wide. Broadening a scope is itself a proposal type requiring new
evidence and approval.

## Approval, rejection, versioning, rollback

- A reviewer can **approve** (optionally after editing), **reject**, or
  **defer** any proposal.
- Rejected proposals never affect drafting and remain on record with their
  evidence.
- Approval creates a new immutable rule/knowledge **version** with approval
  history and provenance preserved.
- **Rollback** restores the prior version; a rolled-back rule stops affecting
  drafting immediately. Every transition emits an audit event.

## Historical / baseline mail

Historical sent-mail analysis is **explicitly user-selected**, is marked as
baseline data, and may create **pending proposals only**. It never silently
activates rules, and it never generates drafts for historical messages.
