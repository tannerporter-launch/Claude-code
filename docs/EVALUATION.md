# EVALUATION

How EchoLoop measures whether learning from human edits actually reduces future
editing — without fooling itself. Evaluation fixtures and reports are built
across Phases 3, 8, and 11; as of Phase 0 this is the methodology only.

## Principle

Edit distance is **not** the sole success metric. Improvement is only claimed
within comparable context buckets, with stated sample size and measurement
window, and only when factual and commitment accuracy do not worsen.

## Metrics (tracked by context bucket)

Volume: eligible messages, drafts generated, drafts sent, drafts deleted,
drafts abandoned.

Pairing: automatic pairing success, manual pairing rate, pairing error rate.

Edit burden: normalized character edit distance, normalized token edit
distance, semantic change count, low-edit draft rate.

Quality: factual correction rate, unsupported-claim removal rate, commitment
correction rate, recipient correction rate.

Learning: rule proposal acceptance rate, rule rejection rate.

Operations: median time from draft creation to send, drafting latency, model
cost, model/schema failure rate.

## Claiming improvement (all must hold)

- The comparison bucket has sufficient sample size.
- The measurement window is stated.
- Factual and commitment correction rates do not worsen.
- Pairing confidence is adequate.
- The trend is not driven only by shorter messages.

## Context buckets

At minimum the dimensions in BUILD_BRIEF §3: sender relationship, 1:1 vs.
multi-participant, request type (information / action / mixed / acknowledgment /
scheduling / decision / none), internal vs. external, and contact/org/department
scope, plus time-bound emphasis.

## Honesty constraint

Do not claim "the system learned the user" without sufficient reliable paired
examples, declining edit burden within comparable buckets, stable-or-improving
factual and commitment accuracy, low rejection rates, and demonstrated user
confidence in audit and rollback. The MVP proves technical viability, not
product-market fit or learning effectiveness.
