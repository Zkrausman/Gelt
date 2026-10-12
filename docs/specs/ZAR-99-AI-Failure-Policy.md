---
title: "[ZAR-99] Configurable Mid-Run AI Bridge Failure Policy"
status: "Completed"
author: "Jules"
date: "2026-08-04"
---

# ZAR-99: Configurable Mid-Run AI Bridge Failure Policy

## 1. Architectural Decision Record (ADR)
**Context**: AI strategies such as `AI_Choice_Crypto` can encounter mid-run API failures due to limits or network outages. We need a configurable failure policy to handle these exceptions gracefully without crashing the whole daemon unless desired.

**Decision**:
- Added `AIFailurePolicy` and `AIMaxRetries` to `AppConfig` to dictate system behavior.
- Added corresponding properties to `EnsembleConfig`.
- Wrapped `evaluateStrategyLive` calls within `scanSymbol` with an exponential backoff circuit breaker (up to `AIMaxRetries`).
- If failures persist, the configured `AIFailurePolicy` is triggered:
  - `disable_strategy`: Safely removes the strategy from `EnsembleConfig.StrategyNames` via `e.disabled` map to avoid concurrent data races when evaluating signals across multiple symbols.
  - `alert_and_hold`: Emits log alert, sets signal to `HOLD`.
  - `exit`: Safely returns an error from scanSymbol which aborts RunSession.

**Constraints**:
- `AIMaxRetries` operates on $\mathcal{O}(N)$ bounds per scan interval to bound maximum latency introduced by retry limits.
- Memory constraint handling required shifting from slice mutation (e.g. shrinking `StrategyNames`) to mapping `disabled[string]bool` guarded by a new `sync.RWMutex`. This prevents concurrent mutations against immutable capital distributions (`caps`), mitigating index out-of-bound errors and preventing state corruption.

## 2. Requirements Met
- `go test -race ./...` passes globally.
- Setting `ai_failure_policy: "disable_strategy"` properly marks `disabled[stratName] = true`.
