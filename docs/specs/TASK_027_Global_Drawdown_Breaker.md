---
type: specification
title: TASK_027: Global Drawdown Circuit Breaker
---

# TASK_027: Global Drawdown Circuit Breaker

## Objective
Implement a Global Drawdown Circuit Breaker that monitors the live trading engine's peak-to-trough equity curve and automatically halts all new entry signals if a critical threshold is breached.

## Implementation Details

1. **`pkg/risk/circuit_breaker.go`**:
   - Created the `EquityCurveMonitor` struct to track the high-water mark (HWM) and monitor drawdown.
   - Implemented `CheckDrawdown(currentEquity, maxDrawdownPercent)` to evaluate the current drawdown percentage against the threshold. If breached, the global `haltState` is triggered.
   - Exposed a singleton `GlobalBreaker` to be accessed by the trading engine orchestration.
   - Added `IsHalted()` to safely check the current circuit breaker state.
   - Added `ResetHalt(newInitialEquity)` to manually reset the state.

2. **Integration (`pkg/plans/registry.go`)**:
   - Updated the `EvaluateActive` function in the Trading Plan Registry to check the state of `risk.GlobalBreaker.IsHalted()`.
   - If the system is halted and the evaluated composite signal evaluates to `strategies.SignalBuy`, the request is intercepted and downgraded to `strategies.SignalHold`.
   - Appended a rejection notice to the evaluation rationale to surface the blockage for monitoring tools.
   - `SignalSell` requests remain unaffected, allowing positions to liquidate.

3. **Testing**:
   - Added `pkg/risk/circuit_breaker_test.go` to validate HWM updates and accurate threshold triggering/halting.
   - Updated `pkg/plans/plans_test.go` to simulate a global halt constraint and verify that a generated `SignalBuy` is successfully suppressed.
   - Evaluated `go test -race ./...` with a 100% pass rate.

## Result
A robust circuit breaker is integrated into the core `TradingPlan` execution pipeline, providing automated safety guardrails against out-of-control drawdown events.
