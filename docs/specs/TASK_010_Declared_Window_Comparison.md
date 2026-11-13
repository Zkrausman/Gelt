---
type: specification
title: Declared-window offline comparison
status: local-source-candidate-awaiting-independent-review
scope: Fixed twenty-bar warmup and one declared scoring interval
---

`backtest-causal-window-compare` is a separate human-output command:

```
gelt backtest-causal-window-compare BreakoutVol SYMBOL INPUT.csv START END CASH FIXED_FEE FEE_BPS BUY_BPS SELL_BPS
```

Start is inclusive and must exactly match a supplied bar with at least twenty
predecessors. End is exclusive and must match a later supplied bar, or be exactly
one second after the last supplied timestamp. That terminal sentinel includes
the final bar without inventing a successor. No nearest-date or calendar rule
exists. Full CSV parsing/close and full bar-domain validation include excluded
rows and preserve existing 1 MiB, 32-byte token and 10,000-bar bounds.

The new `Engine.RunWindowComparisonCausal` API privately copies input, validates
cash/costs, full bars, symbol and boundaries, and invokes the unchanged shipped
comparison exactly once on `[startIndex-20:endIndex]`. Successful replay has
K+1 evaluations with prefix lengths 20 through 20+K. No excluded values reach the
evaluator. Strategy and passive may first enter at consumed index 20, aligned
to source start. Existing fees, adverse prices, fee-inclusive simulated $10 cap,
numeric-before-funding priority and terminal open-position/pending semantics are
unchanged. Future rows never fill a final signal or cause a terminal sale.

The typed result retains the unchanged nested replay and adds source/relative/
scored mapping and three score summaries. Source index is replay index plus
warmup-start offset; scored index is replay index minus 20. Warmup marks must be
flat with zero fees and position. Starting scored equity is initial cash before
the first scored open. Scored drawdown scans from that initial baseline, uses
exact loss/peak comparisons and earliest ties, and preserves zero-equity nulls.
Nested indices stay relative; mapped drawdown indices are additive, checked
metadata. Monetary summaries use canonical scale-eight integer units internally.

The CLI independently reconstructs selection and validates the nested comparison,
original close valuations, controls and score projections. It also reconstructs
the complete expected reference-event and nonfill sequence from consumed original
OHLC and normalized signals before display. This conditional check does not prove
indicator calculations, signal provenance, input authenticity or untouched data.
The unchanged library API does not independently reconstruct these OHLC events.
The historical PR52 H1 alternate-open fixture exposed the earlier CLI limitation;
it is now retained as a rejection regression for this CLI change.

New errors use fixed codes, zero whole results and checked source-bar indices;
missing or reversed boundaries reject before insufficient warmup. No raw paths,
CSV, callback errors or rationale appear in the bounded table or fixed errors.
Successful output is at most 8,192 UTF-8 bytes and uses one stdout attempt; short
or failed output is not retried. Cancellation is cooperative, including around
bounded scans and callbacks, and cannot preempt blocking file/callback/writer work.

Changed source is limited to new API/CLI and synthetic test files, one explicit
main dispatch, this specification and the backtest README. Existing comparison,
core event loop, parser, strategies, result schemas and commands are unchanged.
The selected Q2 profile and held M1/explorer sources are not dependencies.

Working focused tests cover exact/sentinel boundaries, maximum size, excluded
value noninterference, callback counts/prefixes, funding and entry-fee drawdown,
zero and tied drawdown, final state, source error mapping, forged projections,
full excluded-row rejection, cancellation and single-write failures. Working
checks are not independent review, postreview final verification or qualification.
A complete independent/adversarial source/privacy pair must review this artifact
before the required fresh final-head suite and any separately released delivery.
No test here launches configured services, calls providers or executes trades.
NOT_READY / CLOSED / DEFER and original uncertain-operation holds remain.


## Test-only telemetry oracle correction

The first fresh final-head suite at the original Q1 candidate failed the unchanged
legacy `TestThneedBackend_NonBlocking` wall-clock assertion: 10.424086 ms against
1 ms. Its cause remains UNKNOWN; the failure is retained, not waived as a flake.
The replacement proves queue-backpressure behavior with a full bounded queue,
unchanged sentinel, no consumer, immediate fallback and synchronized producer
completion. A five-second watchdog detects nonreturn, releases controlled queue
capacity and joins the producer before failing; cleanup cannot convert failure
to success. This is not a relaxed numerical latency contract. Actual worker/file
coverage now waits for successful `Flush` completion instead of sleeping.

Only `pkg/telemetry/thneed_backend_test.go` and this explanation change in this
correction. Production telemetry, fallback/drop policy, concurrent shutdown
semantics and all Q1 implementation bytes remain unchanged. New focused race
checks and a disposable blocking-send negative control precede original-reviewer
correction review. Full fresh final-head gates remain required after accepted
review of the corrected head; no prior partial pass becomes new-head acceptance.

## Original-OHLC CLI validation successor

The dedicated fixed-20 CLI checker walks every consumed bar, including bars
with no returned event. It compares expected fills, funding nonfills and terminal
position against the normalized trace using the existing fixed8 and adverse-price
assumptions. It checks producer signal and protection bounds before use; it does
not evaluate the strategy again. Existing library, Q2 and old whole-input APIs,
identities and execution algorithms are unchanged. The changed files are the Q1
window CLI and tests, the new private reference checker and tests, this spec and
the scoped backtest README. Working focused race tests cover coherent alternate
opens, omitted entries and low-only stop exits, protection ordering, funding,
bounds and cancellation. Complete fresh source/privacy reviews and final-head
verification remain separate delivery gates.

Working verification on the candidate based on `f348e89050e6131f06a3d22142cabb961f80317a`
used pinned offline Go 1.26.1. Focused race tests passed for the coherent
alternate-open and low-only forgeries, omitted entry, event ordering, bounds,
funding and cancellation. A disposable exact-base export and the candidate
produced matching Q1 API result digests for zero and fixed-fee cases; their
compiled Q1 numeric/header output matched, with the footer intentionally
changed, and an exercised Q2 command remained byte-identical. Full working Go
race, vet and build receipts are retained in the private implementation packet.
These checks do not replace the fresh independent and adversarial reviews or
the final-head suite.
