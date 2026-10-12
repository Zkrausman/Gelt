---
type: specification
title: "TASK_010: Interactive Strategy Backtester & Historical Replay Suite"
ticket: ZAR-235
status: implemented
baseline: "3b8b82e1514c341fce092b49e4bbfc8e29599c61"
scope: "Offline V1 historical-bar validation and replay determinism"
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
