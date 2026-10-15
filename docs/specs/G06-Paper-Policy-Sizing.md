---
ticket: G06
title: Pure constructed-fixture paper policy sizing
status: implemented_pending_verification_and_fresh_review
verification:
  tests: NOT_RUN
  build: NOT_RUN
  runtime: NOT_RUN
  independent_review: PENDING
  privacy_review: PENDING
  adversarial_review: PENDING
changed_files:
  - v2/worker/src/synthetic-simulation-economics.ts
  - v2/worker/src/shadow-sizing-contract.ts
  - v2/worker/src/shadow-sizing.ts
  - v2/worker/src/paper-policy-sizing.test.ts
  - v2/IMPORT-MANIFEST.json
  - docs/specs/G06-Paper-Policy-Sizing.md
---

# G06 pure paper policy sizing

This change adds a separate, pure paper-sizing proposal and exact input/result
replay over `constructed_offline_test` fixtures. It does not create a paper
runner, a study, an order, stored state, or market-evaluation authority.

## Fixed paper policy

The new policy identity is `gelt.spy-long-cash-paper-policy.v1`. Its input
schema is `gelt.paper-sizing-input.v1`; its result schema is
`gelt.paper-sizing-proposal.v1`. Both schemas are strict and versioned. The
only public entry points added for this slice are `proposePaperSizing(bytes)`
and `matchesPaperSizingProposal(bytes, result)`.

The new API uses a fixed USD10,000 fee-inclusive per-order cap, checked against
both the modeled execution price and supplied limit price. It has no cap field,
argument, or fallback. The existing `feeCap`, legacy sizing entry points,
simulation schemas, USD10 legacy cap, and old behavior remain unchanged. The
cap is available only inside the new pure sizing path.

The constructed policy fixes initial cash at USD10,000, initial holdings at
zero, a 0.95 post-cost exposure ceiling, and whole-share increments. Base
economics use USD1 commission, 0.0002 spread, and 0.0003 slippage. Stress
economics use USD1 commission, 0.001 spread, and 0.0015 slippage. These are
assumptions in the fixture contract, not measured costs or calibration. Exact
decimal and adverse-price/cumulative-cash rounding are retained.

A positive signal proposes a whole-share buy only when modeled and limit-price
post-cost exposure stay at or below 0.95. If the existing position is already
above that ceiling, or has an off-grid fractional position, the result abstains
without trimming. This is a buy-sizing ceiling, not a continuously enforced
exposure limit. A cash signal permits a full whole-share exit only. If that
exit exceeds the cap, violates the share grid, lacks fee cash, or cannot be
modeled under the supplied limit, no partial order is proposed and the result
reports `holdings_retained_incomplete`. No result in this slice claims actual
liquidation or a complete liquidated return.

## Identity and rejection rules

The paper config, mapping, portfolio snapshot, and proposal are separate strict
records. The result binds run ID, source commit, policy and scenario digests,
genesis, config, mapping, complete portfolio snapshot, full history digest and
revision, plus the original rule input and receipt digests. These hashes commit
to supplied bytes; they do not authenticate a caller's provenance assertions.
The config carries the exact mapping digest, and the snapshot must match it.
The revision-zero portfolio must equal fixed genesis; later constructed history
timestamps must be monotone and no later than the evaluation time.

The underlying identity is SPY, NYSE Arca, USD, whole SPY shares, and the
asserted Alpaca data-v2 / IEX / 1Day / `all` adjustment source with explicit
date-only `asof` (`YYYY-MM-DD`), entity, calendar, product, and source digests.
The internal portfolio
instrument remains `SYNTH-RH-USD` / USD. The mapping binds these roles. The
embedded G05 rule input retains instrument ID `SPY`; the implementation
re-evaluates its original bytes/receipt pair and does not rewrite the G05
instrument to the internal synthetic ID.

Pure-input validation requires constructed classification, declared fixture eligibility,
the fixed 0.95 policy, matching scenario economics, and internally consistent
run/source/config/mapping/genesis/snapshot/history/receipt identities. Market
and unverified candidates, extra fields, stale hashes, and cross-identity
substitutions fail closed. Invalid inputs return sanitized results without
fabricated run, policy, source, portfolio, or decision correlation. Valid
results replay exactly from the complete canonical input. Results always state
`effectAuthority: none`, `marketEvaluation: not_established`,
`promotionAllowed: false`, and caller-asserted provenance.

These checks admit only a constructed input to this pure function. They do not
admit market data, an order, a runtime study, a calendar, or provider output.

## Tests authored

The new constructed-only test file covers base and stress whole-share
arithmetic, the USD10,000 versus unchanged USD10 differential, old-schema
rejection, exact proposal replay, SPY/internal-instrument separation, receipt
preservation, cap/config/mapping/genesis/source/history/receipt substitution,
revision-zero and history-time invariants, date-only `asof` validation,
off-grid abstention, overweight abstention, blocked and hypothetical full cash
exits, already-cash no-action, stale observation, unknown lifecycle, malformed
and oversized input, and strict rejection of added callback fields. The legacy
comparison uses a separate synthetic legacy fixture; it does not rewrite the
G05 SPY input.

Tests, builds, runtimes, and fresh source, privacy, and adversarial reviews are
pending. No result from this source change establishes real-data eligibility, a
complete SPY study, lawful retention, or live-money readiness.

## Deferred integration obligations

The pure API does not validate an actual exchange calendar, quote, corporate
action, or provider observation. Before future integration, the expected last
bar must match both the frozen calendar session ordinal and `closedAt`
timestamp. This must not be described as equality to an official Arca closing
price. A future runner must freeze the first structurally eligible quote
before testing each branch's quantity, size, and cost envelope; insufficient
size cannot trigger a search for a later quote.

Future admission also requires source rights and finite retention, actual
eligible 253-session adjusted input, raw execution provenance, clock/calendar
evidence, cost calibration, and admitted initial simulation facts. Missing
corporate-action coverage must stop future study admission. An unsupported
action affecting holdings must stop new study orders without suppressing
distributions or inventing cash or quantity. A terminal exit needs its own
policy instruction and cannot counterfeit a G05 cash signal; if a required
exit cannot be represented, holdings remain and the study cannot claim a
complete liquidated return. None of those mechanisms is implemented here.
