---
type: audit and proposed correction specification
title: Legacy backtest execution and accounting audit
status: audit-and-proposed-correction-contract
parent_ticket: TASK_010 / ZAR-235
source_baseline: 66be3a0828316fef75a02b80d8c72f2ebcf791ce
scope: documentation only; no engine behavior or counterexample execution
---

# Legacy backtest execution and accounting audit

This is a bounded follow-up to [TASK_010 / ZAR-235](TASK_010_Historical_Backtester.md)
and the existing Phase 5 simulator item, not a new simulator epic. The owner
approved the audit. The proposed correction policies below are recommendations
for a later explicitly scoped source change, not implemented behavior, calibrated
market assumptions, operating-policy acceptance or permission to run a campaign.
No strategy, dependency, runtime, data source or execution path is adopted here.
Cost-aware portfolio rebalancing remains deferred.

## Applicability and inherited behavior

At the source baseline, the only non-test callers of `NewStrategyEngine` and
`NewPlanEngine` found by repository search are the legacy
[`gelt backtest` branch](../../cmd/gelt/main.go), which accepts a CSV or generates
synthetic bars, then invokes `Engine.Run`. The package tests and CLI synthetic
regressions are other callers. No connection to the V2/PAMR inspection, declaration
or constructed lifecycle path was found. This static call-site finding is not a
deployed runtime audit; there is no admitted actual qualification run established
by this record. V2's exact-decimal contracts are not these Go float64 metrics.

ZAR-235 validated complete input and bar-derived evaluation timestamps while
explicitly retaining valid-series trade behavior and metrics. The following are
inherited limitations, not regressions from that delivery or findings against
inert V2/PAMR. Preserve its historical completion and verification evidence.

| Source anchor in `pkg/backtest/engine.go` | Observed behavior | Interpretation |
| --- | --- | --- |
| `Run`, current-bar history loop; entry/explicit sell | Evaluation sees close and volume through bar i; entry and explicit sell use close i. | Same-close execution is not justified when the completed bar determines the signal; no earlier order/close-auction availability is evidenced. |
| Open-position exit block | Current high raises PeakPrice; evaluation using current close selects trailing/target percentages; the raised stop is checked against current low. Stop takes precedence over target. | OHLC does not establish high-before-low ordering. Current-close policy also cannot retroactively govern earlier intrabar prices. Stop-first alone does not resolve that causal problem. |
| Stop/target fills | A stop hit fills at StopLoss even after an opening gap below it; target fills at Target. | Explicit simplified price rules, not attainable-price or liquidity proof. |
| PnL accumulation and `Result.NetPnL` | Price difference times quantity; no fee/spread/slippage subtraction in Run. | Gross price PnL, despite the NetPnL name. No cost-aware result is established. |
| accountValue / MaxDrawdownPct | Dummy starting equity 10000; updates only at exits, including forced final-close liquidation. | Realized-exit equity drawdown, not marked-to-market portfolio drawdown. Open losses and peaks are omitted. |
| End of Run and ProfitFactor | Remaining position is closed at the last close; positive gains/no losses yield +Inf. | Imposed horizon liquidation and undefined denominator need explicit labels; infinity is not a promotion pass. |

Primary sources: [complete engine](../../pkg/backtest/engine.go),
[CLI](../../cmd/gelt/main.go), [package README](../../pkg/backtest/README.md),
[existing synthetic tests](../../pkg/backtest/engine_test.go) and the ZAR-235 report.
The CLI's default synthetic generator is seeded from wall time; repeatability of
Engine.Run on identical input does not make separately generated CLI inputs
identical. Any later evidence must pin the actual bars/configuration/seed rather
than treating the word deterministic in CLI output as a reproducibility receipt.

## Recommended causal bar-model contract for a later correction

Use a versioned long-only, one-position, close-signal/next-open research model.
It is a transparent OHLC approximation, not a claim of realistic market fills.
Preserve the existing trade cap and offline isolation; do not increase capital,
add instruments, borrow/short/leverage, market access or arbitrary callbacks.

1. Evaluate the strategy/plan once at close i using only its available prefix.
   Freeze that signal and valid stop/target percentages for the next event.
   Do not use close i, its derived parameters or full-day volume to price an
   opening execution earlier on bar i. An evaluation error must not supply new
   risk parameters or silently masquerade as a successful evaluation; the proposed
   corrected run rejects with an explicit failure disposition.
2. Execute queued market entry/explicit exit at the next supplied bar's open.
   Record both signal and fill bar identities. No next bar means no new fill.
   No same-bar re-entry after an exit. A flat Sell is an explicit no-op.
3. For an existing long position, apply protection already in force at bar open.
   Resolve an opening stop gap first, then an opening target gap, then any queued
   market exit, then remaining intrabar protection. This is the proposed fixed
   tie policy, not a reconstruction of exchange event order. Reject invalid or
   overlapping protection (stop >= target when both enabled) before trading.
   New next-open entries may activate their frozen, entry-relative protection
   for that bar; if both levels are reachable, use the same stop-first rule.
4. Model a protective stop as stop-market: an open below the active stop uses
   the open as pre-slippage base; otherwise a low crossing uses the active stop.
   Model a target as sell-limit: an open/high reaching it uses the target price,
   with no assumed favorable opening improvement. No sell-limit fill may be
   worsened below its limit by a slippage rule. Touch-based target eligibility
   assumes liquidity and queue availability and must be disclosed as uncalibrated;
   target price slippage is not modeled in this minimal contract.
5. When high and low span both levels, stop-first is a declared adverse ambiguity
   convention, not proof the stop occurred first or a universal worst-case model.
   Do not update a stop from the same bar's later high before checking that bar.
   Only after processing its executions may the completed bar's high update the
   peak and next-bar trailing stop, using parameters available at that close.
   A zero/absent stop or target means disabled, not an order at the entry price.
6. At the final bar, report cash, remaining quantity, last close, unrealized PnL
   and terminal equity. Do not fabricate a new trade for an unfilled final signal
   or silently liquidate an open position. The recommended minimal correction
   carries it marked to close with a terminal-open flag. A separately declared
   liquidation policy would need its own version, fees and comparability record.

The future implementation must freeze this event ordering, treatment of missing
next bars, invalid policy and evaluation failures before behavior changes.
Compatibility must be explicit: no silent reinterpretation of old result fields
or historical reports; retain the old model identity if a legacy mode is retained.

## Cost and accounting semantics

Recommend two explicitly identified reporting modes, not inferred zero costs:

- **Frictionless diagnostic:** disclose costs not modeled; report gross price
  PnL and frictionless close-mark equity/drawdown only. It is not net performance
  and cannot satisfy cost-aware evaluation requirements.
- **Declared cost scenario:** require finite nonnegative, bounded explicit rate
  parameters and their units/provenance; zero is an explicit uncalibrated scenario,
  never an implicit market estimate. Recommend a fixed fee plus notional basis
  points per filled side. Market entry/exit/stop prices may use declared adverse
  slippage (buy higher, sell lower); never charge the same modeled spread twice.
  The limited target convention above remains separately disclosed. Missing
  calibration still prevents claims of actual execution fidelity.

A proposed fill price for market-like fills is base * (1 + side * bps / 10000),
where side is +1 for Buy and -1 for Sell. A proposed per-side fee is fixedFee +
abs(quantity * fillPrice) * feeBps / 10000. Reject nonfinite/nonpositive prices,
invalid rates, unaffordable quantities or negative cash; never silently scale a
position, create leverage or waive costs. Quantity sizing and cash feasibility
must include entry fees under the unchanged trade cap. Numeric bounds, rounding
and float64 tolerances require an explicit implementation contract; this audit
neither imports V2 arithmetic nor claims exact decimal accounting in legacy Go.
No partial-fill/queue/participation simulator is introduced by these formulas.

Use one cash/quantity ledger: buys debit notional plus fees; sells credit notional
minus fees; equity at each completed bar is cash + quantity * close. The initial
capital and units must be explicit in the model receipt, not an unexplained
10000 denominator combined with unrelated small-account sizing. Preserve the
existing cap; choosing research capital does not authorize broker capital.
Reconcile gross price PnL, fees, slippage attribution, realized/unrealized results
and ending equity without double counting. Price slippage is already embedded
in executed-price PnL; attribution is a reconciliation, not a second deduction.

Recommended truthful fields/labels are `grossPricePnL`, `feesPaid`,
`netRealizedPnL` (only in declared cost mode), `unrealizedPnL`, `endingEquity`,
`maxCloseEquityDrawdownPct`, `closedTradeCount` and `openPositionAtEnd`, plus
execution/cost/terminal model identities. Define each metric denominator and
units. Close-mark drawdown is the maximum peak-to-trough percentage of this
sampled equity path including initial equity; it is not intrabar worst loss,
VaR or a bound on ruin. If equity/peak is invalid or nonpositive, reject or report
an explicit undefined state under the frozen numeric contract, never NaN as pass.
No trades or no losing closed trades produces an explicitly undefined profit
factor with reason, not a favorable infinite score. Do not relabel gross results
net or label realized-only drawdown as portfolio risk during migration.

## Synthetic counterexample specifications — not executed

These are hand-derived toy acceptance oracles with zero modeled costs unless
explicitly stated, independent of actual market data or a performance claim.
The future tests must exercise both Strategy and Plan callers, the CLI summary
and the complete event/cash ledger, not merely mirror implementation branches.

| Case | Explicit constructed setup | Expected discriminating result under proposed contract |
| --- | --- | --- |
| Close signal / opening gap | A Buy first exists at close100; next open110. Quantity0.01, no protection. | Fill base110 on next bar, never100; final-bar Buy with no successor produces no fill. |
| Same-bar high/low ambiguity | Existing long; prior peak100, active stop95, target120; next O100/H110/L96/C105; 5% trailing convention. | No stop this bar from hindsight high110. Only after close may next stop become104.5. This isolates ordering, not liquidity. |
| Stop gap / collision | Existing stop95, target110. Bar A O90/H94/L85/C92. Separate bar B O100/H115/L90/C105. | A stop pre-slip base90, not95. B fixed stop-first base95, with ambiguity explicitly recorded. |
| Target limit / no improvement | Existing target110; O115/H116/L112/C114, stop95. | Target base110, no assumed115 improvement or below-limit adverse price slip; fees separately debited if declared. |
| Unclosed equity trough | Initial cash10; buy quantity0.01 at100; closes100,60,100; no protective/explicit exit. | Close equity10,9.6,10; maximum close-equity drawdown4%; closed trades0, open quantity0.01, unrealized terminal0. Realized-only drawdown would miss the trough. |
| Fee round trip | Quantity0.01, buy100/sell100, fixed fee1 on each side, no slippage. | Gross price PnL0, fees2, net realized-2; cash/equity fall2. No cost-free win. |
| Adverse price scenario | Quantity0.01, bases100/100; market-like slippage10bps each side, fixed fee1 per side. | Executed100.1/99.9; price PnL-0.002, fees2, net-2.002, without deducting slippage twice. |
| Undefined / state boundaries | No closed trades; or gains but zero loss denominator; disabled zero stop/target; evaluation error; rejected order; insufficient cash; final open position. | Explicit undefined reasons/disabled protection/failure or no-effect outcomes; no infinity pass, hidden terminal liquidation, new leverage or duplicate entry. |

Decimal figures are mathematical expectations, not a claim of exact binary
float representation. Future assertions need independently specified numeric
tolerances and money precision. Do not execute these examples under this audit
approval or reuse any toy result as operational qualification.

## Held-out evaluation: reuse the existing protocol

[ZAR-209](ZAR-209-Research-to-Shadow.md#historical-gate) and the
[prospective protocol](Prospective-Shadow-Promotion-Protocol.md#case-registration-to-freeze-before-observation)
already require training/calibration, validation and untouched evaluation
boundaries fixed before inspection, complete failed-variant selection history,
causal timing, cost sensitivity and justified uncertainty/adequacy. No duplicate
walk-forward/optimization epic or universal performance cutoff is proposed.
The selected first PAMR case remains engineering evidence-chain integrity;
economic performance and strategy adoption are not selected by this audit.

One negative source example is sufficient: the inspected
[QuantJourney WF05 example](https://github.com/QuantJourneyOrg/quantjourney-bt/blob/main/strategies/example_wf_05_optuna_tpe_optimization.py)
uses one full-history objective, selects its winner, then passes that winner's
portfolio to walk-forward diagnostics. Those overlapping folds are not untouched
post-selection evidence. This is static source interpretation, not execution;
the main-branch link was inspected on 2026-10-31 and is not an immutable version
pin or a claim about every released version. The repository itself describes
WF04/WF05 as selection diagnostics. Any future use would need pinned source and
a separate held-out/fold-local selection procedure; nothing is installed here.

## Proposed correction scopes within the existing simulator item

These are proposed follow-up ticket slices, not new issues or implementation
releases. The existing input-validation delivery stays complete. Each future
source delivery needs its exact scope approval, independent source/privacy and
distinct adversarial review, synthetic regression evidence, Go race/vet/build,
applicable CLI/integration checks and ordinary CI/merge/remote verification.
Do not claim newly run tests in this audit document.

| Slice | Concrete output / dependency | Acceptance / full remaining effort uncertainty |
| --- | --- | --- |
| TASK_010-A: causal fills and event ordering | Versioned one-position close-signal/next-open model, frozen protection/gap/collision/disabled-level/final-open/error semantics and explicit legacy compatibility. Depends on accepting the precise source correction contract; no provider or market data needed for toy regressions. | Hand-derived counterexamples distinguish old/new paths for Strategy and Plan; no future bar data at decision; no retrospective trailing, fake terminal trades, duplicated evaluation effects or changed risk cap. Numeric-domain and compatibility decisions must be frozen. Full source/tests/review/remediation/CLI/CI/delivery effort UNKNOWN; no measured implementation or estimated elapsed promise supplied. |
| TASK_010-B: coherent costs and close-mark accounting | One cash/quantity/equity path, explicit frictionless/declared-cost modes and truthful versioned metrics/CLI labels. Depends on A's fill stream and frozen bounded cost/numeric/starting-capital contract. No calibration is inferred from accepting a scenario. | Fee/slippage/quantity/cash/realized/unrealized reconciliation; trough and terminal-open oracles; undefined metrics never pass; migration preserves old report meaning. Full source/tests/review/remediation/integration/CI/delivery effort UNKNOWN until scope and migration/numeric choices are frozen. Cost-aware rebalancing remains deferred. |

A is a source-correction proposal, not currently authorized implementation. B is
dependency-ordered and is not independent ready depth. Historical data acquisition,
backtests/optimization campaigns, benchmarks, inference, qualification and trading
are outside both this audit and its unapproved proposed source slices. No change
to V2/PAMR math, artifacts, lifecycle, security, credentials or operating policy.
All actual sixteen checks/C07/C13/C14 remain UNKNOWN, qualification NOT_READY,
production CLOSED and operations DEFER. An honest finite model can support later
research without proving strategy profitability, execution realism or promotion.
