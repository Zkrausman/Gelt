---
type: specification
title: "TASK_010: Offline strategy, cash and passive comparison"
status: source-candidate-awaiting-independent-review
baseline: "eace8eebdb498333bf670ee35e0f723843352186"
scope: "Separate strict-CSV comparison with declared synthetic accounting assumptions"
---

# Offline causal comparison

The existing owner/assistant CLI consumer can inspect one strategy replay beside
flat cash and a fixed passive buy-and-hold control. This is a separate typed
`ComparisonCausalResult` and `Engine.RunComparisonCausal(ctx, symbol, bars,
initialModelCash, scenario)` API. No existing engine loop, API, result schema,
CLI, evaluator, price, fee or accounting helper changes.

The command is `gelt backtest-causal-compare <Target> <Symbol> <DataFile.csv>
<InitialModelCash> <FixedPerSideFee> <FeeBps> <BuyAdverseBps> <SellAdverseBps>`.
It requires exactly eight arguments and literal BreakoutVol, resolved through
the existing fresh offline resolver after complete strict CSV parsing and close.
No supplied file is generated, fetched, authenticated or assumed historical.
The parser retains its exact six-column header, 1MiB file, 10,000-row and
32-byte token ceilings. Output is a validated human table, at most8192 UTF8
bytes, attempted once; short/error output fails and may retain a prefix.
Failures expose only fixed bounded codes, never paths, CSV or callback text.

## Version and trusted input boundary

Comparison identity is `gelt.legacy-go.causal-comparison.v1`; strategy identity
remains `gelt.legacy-go.execution-scenario-close-next-open.v1`; cash is
`gelt.legacy-go.flat-cash-control.v1`; passive is
`gelt.legacy-go.one-lot-passive-control.v1`. Cost remains
`declared_fixed8_fees_and_adverse_execution_price_scenario`, basis
`uncalibrated_declared`, data and authority `unqualified_offline`. The fixed
policies are `flat_cash_no_interest_no_fills` and
`fixed_after_20_closes_one_buy_no_exit`.

The new API supports only an exclusively owned trusted standalone strategy
whose canonical Name is BreakoutVol, with no plan. Stable/pure metadata and
fresh exclusive callback state are preconditions. Pointer/name fences detect
observable mutation, not authenticate code or snapshot arbitrary hidden state.
No callback sandbox, panic containment, concurrent ownership or arbitrary
wall-clock preemption is promised. Caller bars are copied before validation;
the CLI also keeps an isolated source snapshot for display reconstruction.

## Validation and numeric semantics

Cancellation precedes configuration. Initial cash is parsed before fee/target
and BUY/SELL rates, then the complete copied bars, symbol and evaluator metadata
are validated. Pure controls finish before any strategy Evaluate. A control
numeric failure returns a zero whole result; it cannot be hidden by funding or
replaced with a cash-only result. The unchanged execution strategy API is called
exactly once. It alone evaluates close prefixes19 through n-1, with existing
next-open timing and protection. Metadata, count, time, symbol, scenario and
result bounds are rechecked before assembly. Failure/cancellation never retries
or returns partial metrics.

Bars number1..10000, Unix seconds1..253402300799 strictly increase, OHLC must be
finite0.01..1000000 and contain Open/Close within Low..High; volume is finite
0..1e12. Symbol is1..16 ASCII bytes, firstA-Z, remainderA-Z/0-9/dot/hyphen.
No calendar, adjustment, rights, source or completeness inference is made.

Scale8 uses canonical integer unit strings. Initial cash is unsigned plain
ASCII decimal0..1000000 USD with at most8 fractional digits and32 bytes;
fixed fee has the same grammar but is strictly below10. Fee bps are canonical
integer0..10000; buy/sell adversity canonical integer0..9999. No signs,
exponents, whitespace or leading-zero integer are accepted. Entry cap B=1e9
units. Principal target T=floor((B-fixedFee)*10000/(10000+feeBps)). T0 is a
valid declaration but an eligible entry rejects numeric_range before funding,
including cash0; no passive entry exists for at most20 bars.

BUY price uses the unchanged adverse exact-binary-rational rule and single
upward float64 conversion; zero preserves price bits. Entry price remains
0.01..1000000, quantity0.00001..1000. Nonzero fixed/fee/BUY costs use target/price
rounded down; zero fixed/fee/BUY preserves existing10/open float sizing even
when SELL adversity is nonzero. Principal quotes must equal T. Fixed8 notional
uses exact binary-rational multiplication and one nearest-ties-even rounding.
Fee is fixedFee+ceil(principal*feeBps/10000); principal+fee must be positive and
at mostB. There is no additional cash debit for execution-price adversity.

Cash/value/total fee ceilings are1e14 units; equity/peak ceilings2e14; entry
principal/fee/basis ceilings1e9; signed PnL and ending gaps stay within±2e14.
Inherited checked arithmetic and source-value bounds reject overflow, rather
than clamp, relax minimum quantity or waive costs.

## Control event and accounting semantics

Cash never evaluates, fills, pays fees or earns interest. Every supplied close
retains initial cash and equity, zero quantity/value/PnL/fees. Passive has one
eligibility event at index20 Open, policy decision index19, origin
`fixed_control_policy`, reason `fixed_after_20_closes_one_buy`. This is not a
fabricated strategy signal. Quote, quantity, principal, fee and debit bounds
are checked before funding. Insufficient cash retains the candidate event and
required/available debit but charges nothing; no resizing, loan or later retry.

A funded passive lot debits principal+entryFee once, holds unchanged quantity
and has no protection, rebalance, SELL, forced exit or hypothetical exit cost.
Each close quotes the reference close, cash+value=equity=initial+netUnrealized,
grossUnrealized=value-principal, netUnrealized=value-totalBasis. Realized PnL
and closed fees remain0; open/aggregate fees retain the entry fee. All bars,
including warmup, are marked. An open final position is explicit.

Peak starts at initial equity. Current close loss is peak-equity after the
peak update. Maximum drawdown updates on the first positive loss or a strictly
greater exact rational loss/peak; equal ratios keep the earliest bar. No-loss
maximum uses0 and the latest peak with null bar. Zero peak has null ratios and
`zero_initial_model_equity`; it is not favorable0. Current and maximum DD are
distinct. Two signed ending-equity gaps are the only comparisons; no ranking,
optimization, statistical edge, selection threshold or promotion exists.

The CLI reuses the existing independent strategy-result validator unchanged,
binds marks to the actual bars and reconstructs both complete controls and
entry events independently from the original bars/config. It compares all
records and aggregates, rejecting coordinated internally balanced forgeries.
Equal inputs/cost declarations do not make exposure, protection or turnover
identical; the table discloses these differences.

## Changed files and source acceptance evidence

New core and tests: `pkg/backtest/causal_comparison.go`,
`pkg/backtest/causal_comparison_test.go`. New CLI and tests:
`cmd/gelt/backtest_causal_comparison.go`,
`cmd/gelt/backtest_causal_comparison_test.go`. Existing changes are one explicit
main dispatch, package README, this specification and a bounded roadmap entry.
No dependencies, workflows, V2/PAMR/G05, persistence, receipts or security change.

The refined contract passed independent accuracy/privacy review before code.
Working focused tests cover independent exact control/fee/rounding oracles,
funding/zero-target and range-before-funding,1/19/20/21/10000 bar boundaries,
callback count/prefixes/identity/cancellation/no retry, unchanged strategy API,
per-close identities, earliest equal drawdown, forged display records and
coordinated controls, actual strict-CSV resolver, privacy and single-attempt
output failures. An initial focused compile failed because two new mutation
tests named nonexistent old result fields; corrected tests use actual fields.
That failure is retained; it is not a production regression or lost outcome.

Working source gates passed on the candidate code: Go1.26.1
`go test -race ./...`, `go vet ./...`, and compiled `go build ./cmd/gelt`.
Thirteen actual compiled CLI cases passed their expected exits: four funding
levels, no-eligible zero-cash, zero-target rejection, malformed trailing input,
unsupported target, usage, and the four existing causal/funded/fee/execution
commands. Tests and CLI fixtures are explicitly synthetic and offline. These
working checks are not postreview final-head or hosted acceptance evidence.

Complete independent and distinct adversarial source/privacy reviews, any
corrections and fresh final-head full repository checks are pending. Working
passes do not replace those gates or hosted browser acceptance. Draft PR/CI
requires accepted final artifacts and fresh verification. Ready, merge,
auto-merge, deployment and actual operation remain unapproved here.

No provider acquisition/calls, live runtime, orders, financial use, calibrated
realism/profitability or operating qualification is released. Supplier finality,
completion and vintage remain unknown. Runtime NOT_READY, production CLOSED,
operations DEFER, all original uncertain handoffs and historical defaults remain.
