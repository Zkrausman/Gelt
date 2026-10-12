---
type: specification
title: ZAR-14: Refactor Strategy Evaluate Signature for Context and Deterministic Time
---

# ZAR-14: Refactor Strategy Evaluate Signature for Context and Deterministic Time

## 🎯 Overview
Refactored the core `Strategy` and `TradingPlan` interface signatures in `pkg/strategies` and `pkg/plans` to include `context.Context` and `evalTime time.Time`. This guarantees that strategies querying the `FeatureRegistry` can pass a valid execution context while maintaining 100% offline, deterministic backtesting by receiving explicit historical timestamps instead of invoking `time.Now()`.

## 💡 Implementation Details
1. **Interface Contract Updates**:
   - `Strategy` interface in [pkg/strategies/strategy.go](../../pkg/strategies/strategy.go#L35-L40):
     `Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (StrategySignal, error)`
   - `TradingPlan` interface in [pkg/plans/plan.go](../../pkg/plans/plan.go#L34-L40):
     `Evaluate(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (PlanEvaluation, error)`
   - `PlanRegistry.EvaluateActive` in [pkg/plans/registry.go](../../pkg/plans/registry.go#L80-L99):
     `EvaluateActive(ctx context.Context, evalTime time.Time, symbol string, closes []float64, volumes []float64) (PlanEvaluation, error)`

2. **Strategy & Plan Catalog Migration**:
   - Refactored all catalog strategies (`TrendConfluence`, `MeanReversion`, `MeanReversionBB`, `BreakoutVol`, `VWAPRebound`, `VerticalSpreads`, `LongOptions`) to match the new signature and assign `Timestamp: evalTime` in generated `StrategySignal`s.
   - Refactored `BasePlan` and all built-in ensemble plans (`IntradayAlphaPlan`, `RangeBoundDefensivePlan`, `BreakoutExpansionPlan`, `OptionsAlphaPlan`) to propagate `ctx` and `evalTime` down to component strategies.

3. **Backtest Engine Integration**:
   - Refactored `Engine.Run` in [pkg/backtest/engine.go](../../pkg/backtest/engine.go#L58-L188) to accept `ctx context.Context` and derive `barTime := time.Unix(currentBar.Timestamp, 0).UTC()` for deterministic evaluation.

4. **API & CLI Callers**:
   - Updated telemetry server metrics handler in [pkg/server/metrics.go](../../pkg/server/metrics.go#L20) to pass `r.Context()` and `time.Now()`.
   - Updated CLI backtest command in [cmd/gelt/main.go](../../cmd/gelt/main.go#L808) to pass `context.Background()`.

## ✅ Verification
- All package unit tests (`go test ./...`) pass cleanly.
- `go build -o gelt.exe ./cmd/gelt` compiles cleanly without warnings or errors.
