---
type: specification
title: "TASK_010: Interactive Strategy Backtester & Historical Replay Suite"
ticket: ZAR-235
status: implemented
baseline: "3b8b82e1514c341fce092b49e4bbfc8e29599c61"
scope: "Offline V1 historical validation plus separate opt-in TASK_010-A causal replay"
---

# TASK_010: Interactive Strategy Backtester & Historical Replay Suite

## Overview & Context
We need to add an offline backtesting and historical replay suite to the Gelt trading engine (`gelt/pkg/backtest`). This tool will allow us to replay historical market price bars against any registered Trading Plan or Strategy to evaluate performance metrics (Win Rate, Profit Factor, Net PnL, Max Drawdown) without needing live market hours or websocket connections.

---

## Technical Specifications & Requirements

1. **New Package (`gelt/pkg/backtest`):**
   - Create `engine.go` implementing a replay engine harness.
   - The engine must accept historical price bar series (`OHLCV` + timestamp data).
   - Implement sequential bar-by-bar iteration, feeding price ticks to target `BasePlan` or `Strategy` implementations.
   - Simulate paper trade execution:
     - Track virtual entry/exit prices.
     - Apply position sizing under `RiskProfile` rules.
     - Enforce dynamic ATR trailing stop-losses and profit targets.

2. **CLI Integration (`main.go` / `cmd/`):**
   - Add a new CLI subcommand: `gelt backtest <PlanOrStrategy> <Symbol> [Days]`
   - Formatted Output: Render a terminal summary table displaying:
     - Total Historical Bars Evaluated
     - Total Simulated Trades
     - Win Rate (%)
     - Net PnL ($)
     - Profit Factor (with divide-by-zero safeguard returning `INF` or `N/A`)
     - Max Drawdown (%)

3. **Documentation & Specification Artifact:**
   - Create the file `docs/specs/TASK_010_Historical_Backtester.md` containing these specifications for repository record-keeping.

4. **Strict Isolation & Constraints:**
   - **CRITICAL:** Backtest executions must be 100% offline and deterministic.
   - Under no circumstances should the backtest module initiate network calls to the `Robinhood MCP` or attempt live broker execution.

---

## Verification & Testing Requirements

1. **Unit & Integration Tests (`gelt/pkg/backtest/engine_test.go`):**
   - Write comprehensive unit tests using synthetic price arrays (e.g., 100-bar simulated bull trend and bear trend arrays).
   - Verify trade calculation accuracy, stop-loss triggers, and metric computations.

2. **Repository Validation:**
   - Ensure the entire test suite passes cleanly by running:
     `go test ./...`

---

## ZAR-235 Implementation Report

### Implemented behavior

`Engine.Run` now validates the complete historical series before any strategy or plan evaluation or trade calculation. It rejects an empty series, nonpositive Unix-second timestamps, duplicate or non-increasing timestamps, non-finite OHLCV values, nonpositive OHLC prices, negative volume, and candles that violate `low <= open, close <= high` or `low <= high`. Errors identify the invalid bar (or the empty series), and invalid input returns a zero `Result`. A valid single bar remains accepted and produces zero trades.

Evaluation timestamps are now derived exclusively from each bar's Unix-seconds timestamp; there is no `time.Now()` fallback. Valid-series trade behavior, constructors, `Run` signature, and metrics remain unchanged. The module remains offline and non-executing; no provider, broker, or V2 worker/ledger paths were added.

### Changed files

- `pkg/backtest/engine.go` — full-series validation and removal of wall-clock fallback.
- `pkg/backtest/engine_test.go` — invalid-input coverage for strategy and plan engines, single-bar acceptance, deterministic repeated replay and input-derived evaluation times; existing bull/bear fixtures retained with fixed timestamps.
- `pkg/backtest/README.md` — documented preflight validation and timestamp behavior.
- `cmd/gelt/main.go` — keep the existing offline CLI synthetic fallback's high/low bounds consistent with its generated close, so default backtests pass the stricter preflight.
- `cmd/gelt/backtest_synthetic_test.go` — seeded generator coverage for the default 100-bar replay across CLI base prices.
- `docs/specs/TASK_010_Historical_Backtester.md` — this implementation report.

### Verification evidence

The following checks passed in the original Squire candidate checkout, before independent review:

- `go test ./pkg/backtest`
- `go test ./...`
- `go test -race ./...`
- `go vet ./...`
- `git diff --check`

The candidate-local checks did not exercise the default CLI synthetic-data path. A subsequent independent review found that the old generator could create closes outside its high/low bounds; both unchanged A/B benchmark candidates failed an offline 100-bar CLI run. The CLI generator correction and regression test above were added **after** grading in a separate delivery branch, not credited to the candidate. On this branch, `GOPROXY=off go build ./...`, `GOPROXY=off go test -race ./...`, `GOPROXY=off go vet ./...`, `git diff --check`, and `GOPROXY=off go run ./cmd/gelt backtest IntradayAlphaPlan SPY 100` passed locally. Independent final review and hosted exact-head PR checks remain required before merge. No broker or MCP operation was invoked. Host worktrees, prompts and disabled extensions are not credential or network isolation.


## Execution/accounting audit follow-up (2026-10-31; documentation only)

The [bounded legacy execution/accounting audit](Legacy-Backtest-Execution-Accounting-Audit.md)
records inherited same-close fills, intrabar trailing/gap assumptions, unmodeled
costs and realized-exit drawdown. It recommends a versioned causal bar model and
truthful accounting/metric semantics, with unexecuted synthetic counterexamples
and proposed TASK_010-A/B correction slices. The input-validation/determinism
delivery above remains complete; no engine behavior, tests or current V2/PAMR
qualification path changes. Correction implementation is not released by this
audit approval. Cost-aware rebalancing and all operating holds remain.


## TASK_010-A opt-in causal source candidate (2026-11-01)

The owner separately approved A on October 31. The preceding implementation and
audit reports remain historical evidence. This additive candidate implements a
new model, not a migration or correction of `Run`/`Result` or the existing
`backtest` CLI. Final source review and delivery verification are tracked below;
source implementation is distinct from merge, installation, use and operation.

### API, identity and event ordering

`(*Engine).RunCausal(ctx, symbol, bars) (CausalResult, error)` uses fixed model
`gelt.legacy-go.close-next-open.v1`, cost label `frictionless_diagnostic` and
`unqualified_offline` data/authority labels. It validates the whole input before
evaluation, snapshots bars and supplies fresh close/volume prefixes per callback.
Evaluators must be fresh, exclusively owned trusted in-process objects. No
sandbox, callback authenticity, global alias isolation, reset, concurrent-use,
preemption or settlement guarantee is made.

Evaluation starts at the twentieth close (index19); its earliest action is the
next open (index20). For an existing position, opening stop gap precedes opening
target gap, then queued market exit, then intrabar protection. On an ambiguous
same-bar stop/target touch, stop wins and the fill is flagged ambiguous. A new
entry may hit its frozen protection on the entry bar. Any exit prevents reentry
on that bar. Close-known percentages/high may update protection for the next
bar only; stops ratchet upward. Initially zero protection is disabled and may be
activated later; changing enabled protection to zero rejects the whole run.
No terminal liquidation is invented. The final position is marked at the final
close; a final directional signal lacking a successor is flagged, including when
its next-open action would have been a no-op.

Standalone, plan and component results require canonical evaluator name,
requested symbol, exact supplied evaluation instant (`Time.Equal`) and EQUITY.
Equivalent timezone representations are allowed; nanosecond differences are not.
Plan membership must be a complete unique stable set of 1..16 declared children
with finite weights in[0,1] and positive total weight. Returned consensus is not
recomputed. Missing/duplicate/foreign children, changed membership, hidden child
AGENT_REVIEW and any nonempty AgentPrompt reject. These are consistency checks,
not proof that a trusted callback told the truth. Unsupported warmup/domain
conditions reject; no catalog-wide success is promised.

### Fixed numeric and resource envelope

- 1..10,000 bars; positive strictly increasing Unix-second timestamps through
  253402300799; finite consistent OHLC in[0.01,1,000,000], volume in[0,1e12].
- BUY/SELL/HOLD only; score in[0,100]; stop zero or[0.01,99.99] percent, target
  zero or[0.01,1000] percent. Bounded UTF-8 names <=128 bytes without controls;
  symbol matches `[A-Z][A-Z0-9.-]{0,15}`. Unused threshold metadata is not policy.
- Fixed nominal entry budgetUSD10 divided by actual next-open price; quantities
  in[0.00001,1000]. No invented tick/lot rounding, shorting or leverage.
- Enabled levels positive and <=11,000,000, ordered stop<target and on entry
  stop<entry<target where enabled. Per-fill notional <=1,000,000; each and
  accumulated gross/unrealized PnL/profit/loss remain within absolute1,000,000.
- Float64 calculations with direct touch predicates; no epsilon fills or hidden
  money rounding. Percentage levels use price plus/minus price*percentage/100.
  Oracle tolerances are absolute+relative: prices/levels/PnL1e-8+1e-12*abs(expected),
  quantity1e-12+1e-12*abs(expected), profit factor1e-10+1e-12*abs(expected).
  These tolerances do not change fill or validation predicates.
- At most10,000 evaluations/20,000 fills, one position and pending signal. Profit
  factor is null with a fixed reason for no closed trades or no losing closed
  trades, never infinity. Any failure returns zero result plus sanitized typed
  code/bar index, not a successful partial result. Context is checked before
  each bar and after callback; an uncooperative callback cannot be preempted.

### Separate CSV command and compatibility

`gelt backtest-causal <Target> <Symbol> <DataFile.csv>` requires exactly three
arguments. Exact `BreakoutVol` alone is supported in this CLI via fresh direct
construction and checked initialization with no providers/config/catalog suite.
Other targets, including plan routes, reject `unsupported_target`; the independent
Go API plan support is unaffected. Fixed20-close warmup is not extended to rescue
50-close confluence strategies. Existing `backtest` parsing, synthetic fallback,
output and `Run`/`Result`/constructors remain unchanged.

CSV is read through a max+1 bound of1,048,576 bytes with <=10,000 rows, exact
`Timestamp,Open,High,Low,Close,Volume` header and six unquoted ASCII fields.
LF/CRLF and one final newline are accepted. BOM, embedded blank rows, quotes,
field whitespace, signs, exponents, leading zero integers, malformed numbers,
extra/missing columns and tokens longer than32 bytes reject. Timestamp uses
unsigned integer syntax; other values use ordinary unsigned decimals with a
nonempty fractional part when a dot is present. Parse failures reject rather
than skip; ParseFloat rounding is explicit and domain checks use parsed floats.

Summary is <=4096 bytes with fixed labels, gross metrics, nullable profit factor,
open model position and final directional signal. Scientific display notation
bounds finite figures and rounds display only. Paths, arbitrary names, source
bars, events, rationale, prompts and raw callback/parse errors are not printed.
CLI errors are fixed codes with nonzero exit; no persistence/export is added.

### Changed files, verification and remaining gates

New: `pkg/backtest/causal.go`, `causal_test.go`,
`cmd/gelt/backtest_causal.go`, `backtest_causal_test.go`. `cmd/gelt/main.go` adds
only the separate dispatch; package README, this specification, the audit and
same Phase5 roadmap entry receive additive status/usage clarification.

Synthetic acceptance covers hand-derived gap/order/collision/ratchet oracles,
identity matrices and timezone/nanosecond boundaries, incomplete/changed plans,
whole-input/numeric/resource limits, direct touch/Nextafter separation, prefix
isolation, zero-result errors/cancellation, final open positions, legacy API
compatibility, actual deterministic BreakoutVol next-open lineage, strict CSV
boundaries and sanitized bounded output. No market dataset/campaign was run.

The first core check failed and its full output is preserved privately. Grouped
owner corrections repaired percentage-level arithmetic, clarified queued-exit
fixtures, removed an unapproved unused-threshold restriction and avoided dynamic
interface comparability panic. Session66290 later printed `ok` but its terminal
status was lost; it remains UNKNOWN permanently. The one separately authorized
November1 package command exited0 with Go **cached** success; fresh execution of
its test bodies is not claimed. The initial new CLI targeted check found a test
fixture incorrectly rejecting a permitted final newline; the correction keeps
direct numeric-token rejection and separately accepts the CSV line ending.
Exact current-source validation and independent/distinct adversarial review,
hosted CI, normal merge and remote postmerge checks remain required; working
receipts must not be presented as postreview or hosted proof.

TASK_010-B, fees/slippage, coherent cash/equity/drawdown and cost-aware rebalancing
remain unimplemented and outside A. This candidate does not enable V2/PAMR,
providers, acquisition, inference, qualification, execution or trading. All16 and
C07/C13/C14 remain UNKNOWN; NOT_READY/CLOSED/DEFER remains unchanged.


Local candidate verification (2026-11-01): full `go test -race ./... -count=1`,
`go vet ./...` and CLI build exited0 with unchanged tested source. The built
binary's synthetic positive next-open/open-position summary, unsupported plan
and missing-argument cases each have separately captured expected exit statuses.
`git diff --check` passed. These are pre-review working checks; later exact-head
and hosted results must be recorded separately. V2/scientific/protected-browser
paths are unchanged; the existing hosted V2 workflow path filter does not select
this Go/docs-only change. No V2/browser pass is inferred from that exclusion.
