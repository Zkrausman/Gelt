---
type: specification-closeout
title: G05 shadow-first reproducible rules core
status: candidate-awaiting-final-reviews-and-exact-source-checks
date: 2026-10-14
---

# G05 pure rules core

The owner approved AI-assisted research with fixed testable rules, one
reproducible strategy, explicit costs and a passive/cash comparison. Runtime
Codex is no longer compulsory for the first decision. Its original runtime,
authentication and probe holds are preserved on that route.

The selected auditable hypothesis is a long-only/cash sign-return adaptation:
compare the latest eligible adjusted close with the close 252 completed trading
observations earlier. Positive sign targets the configured exposure cap; zero
or negative targets cash. This is an adaptation for later eligible-instrument
evaluation, not reproduction of futures results or proven superiority/profit.
No tuning, model inference, data acquisition, scheduler, sockets, filesystem,
orders, new store, framework or G06 execution integration is added.

Changed files: `shadow-rule-contract.ts`, `shadow-rule.ts`,
`shadow-rule.test.ts` under `v2/worker/src/`, and this closeout.
The pure evaluator uses strict bounded duplicate-key-rejecting JSON, existing
exact decimal schemas and canonical SHA256. It validates canonical timestamps,
positive prices, contiguous unique observation ordinals, availability at or
before the decision, sufficient warm-up and declared freshness. Unknown execution
or undeclared data/cost readiness abstains. Prices are compared with BigInt across
scales, without floating-point monetary arithmetic. It emits a target fraction
or abstention, never order quantities or fills. Cash target is not cancellation.

Validated input identity binds rule, run, supplied source, dataset/provenance,
calendar, schedule, exposure, portfolio, costs/stress and passive/cash assumptions.
Decision IDs are canonical deterministic receipt hashes. Malformed inputs yield
sanitized uncorrelated abstentions; oversized inputs are unbound rejections.
The replay comparator re-evaluates the same input bytes and compares the entire
validated receipt; changed inputs/targets/IDs or authority are rejected. It is
not provenance authentication or effect admission and rejects invalid inputs.
Evidence digests and eligibility declarations remain caller assertions, not
independent rights, instrument, calendar or market verification. Receipts always
state market evaluation not established, no effect authority and no promotion.
Costs are frozen input bindings only: this core computes no costs/P&L or benchmark
returns and does not establish their realism or evaluation acceptance.

Constructed offline tests cover exact above-safe-integer/cross-scale sign,
deterministic replay without mutation, changed bindings, readiness abstention,
timestamp/availability/freshness boundaries, gaps/reordering, strict schema,
duplicate keys, malformed encoding and bounds. They are unit evidence, never
genuine historical or prospective market/shadow results. Local dependencies are
absent; no local installation, held listener/process/ownership/probe or runtime
test is run. Fresh complete independent/adversarial source review and applicable
candidate/integrated hosted checks remain required before delivery acceptance.

Actual eligible data/instrument, point-in-time adjustment/calendar, justified
cost/control manifests and sizing still await acceptance. G06 must review actual
entry/exit, cost/timing and durable cash/position mapping against the existing
simulator; BUY-only fixed-price mock fixtures cannot supply that proof. UNKNOWN
and duplicate fences remain. G04 numerical reference remains accepted optional
risk/allocation support, not strategy/market proof. Auto-promotion implementation
remains unplanned; no live-money activation or financial transaction authority.
