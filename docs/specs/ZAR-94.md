# ZAR-94: [Config] Hardcoded ATR Multipliers and Stop/Target Fallback Defaults in Strategies

## Problem Statement
Every strategy had hardcoded ATR multipliers for stop-loss and target profit. This meant that the values were fixed and could not be tuned without recompiling the application. The goal is to allow parameters `atr_stop_multiplier` and `atr_target_multiplier` to be set via configuration and parsed inside the strategies' `SetParams` methods.

## Architectural Decision Record (ADR)
- **Constraint Checklist:**
  - Gelt strategies should be pure evaluators.
  - Multipliers can be parsed via `SetParams`, falling back to previous hardcoded logic (e.g., MACD uses `ATRStopMultiplier: 0.5`, `ATRTargetMultiplier: 1.25`) for backward compatibility.
  - Strategies should properly initialize these fields in their `New<Strategy>` constructors.
- **Implementation Strategy:**
  - Add fields `ATRStopMultiplier` and `ATRTargetMultiplier` (both `float64`) to `MACDCryptoStrategy`, `VWAPReboundStrategy`, `MeanReversionStrategy`, `BreakoutVolStrategy`, `MACDStrategy`, `AIChoiceStrategy`, and `RandomCryptoStrategy`.
  - Parse `atr_stop_multiplier` and `atr_target_multiplier` in `SetParams` implementations.
  - Use these fields when calculating `stopPct` and `targetPct` within the `Evaluate` method, dynamically scaling off the ATR and the symbol's last close.

## Mathematical Constraints
- Target stop percentage logic:
  $$ stopPct = \frac{ATR \times ATRStopMultiplier}{LastClose} \times 100 $$
- Target profit percentage logic:
  $$ targetPct = \frac{ATR \times ATRTargetMultiplier}{LastClose} \times 100 $$

## Verified Tests
`go test -race ./...` was executed inside the virtual machine. All tests passed, ensuring concurrency safety (`sync.RWMutex`) and memory integrity.

## OKF Compliance
The ticket implementation strictly addresses the exposure of dynamic parameters through configuration parsing without disrupting backward compatibility or live configurations.
