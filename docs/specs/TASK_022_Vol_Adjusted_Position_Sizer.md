---
type: specification
title: Specification: Dynamic Volatility Position Sizer (TASK_022)
---

# Specification: Dynamic Volatility Position Sizer (TASK_022)

## Overview
This specification details the enhancement to the `pkg/risk` package to include a dynamic volatility-adjusted position calculator. The primary function `CalculateVolAdjustedSize` is introduced to scale position sizes inversely proportional to Average True Range (ATR) expansion.

## Implementation Details

### Function Signature
```go
func CalculateVolAdjustedSize(baseSize int, currentATR float64, baselineATR float64, maxLossCap float64) int
```

### Logic & Math
1. **Volatility Ratio Calculation**:
   The function calculates a `volRatio` by dividing `baselineATR` by `currentATR`.
   `volRatio = baselineATR / currentATR`
   This ratio scales the base size. If the current ATR is double the baseline (e.g., current = 2.0, baseline = 1.0), the ratio is 0.5, effectively halving the target position size.

2. **Volatility Adjusted Base Size**:
   `adjustedSizeFloat = float64(baseSize) * volRatio`

3. **Maximum Allowable Size (Risk Cap Enforcement)**:
   The maximum loss an account takes on a position is capped by the `maxLossCap` (e.g. $10 hard cap). The total risk is computed as the position size multiplied by the current ATR. Therefore, the maximum allowable size based on the risk limit is:
   `maxAllowedSizeFloat = maxLossCap / currentATR`

4. **Final Position Size**:
   The final size is the minimum of the volatility-adjusted base size and the risk-capped size:
   `finalSizeFloat = math.Min(adjustedSizeFloat, maxAllowedSizeFloat)`

   The float value is then rounded down (`math.Floor`) to an integer to ensure partial shares/contracts do not exceed limits.
   `finalSize = int(math.Floor(finalSizeFloat))`

### Edge Cases Handled
- Negative or zero `currentATR`, `baselineATR`, `maxLossCap`, or `baseSize` return `0` shares to prevent division by zero or negative position sizes.

## Completion Report
- Created `pkg/risk/vol_sizer.go` with the `CalculateVolAdjustedSize` function implementation.
- Added comprehensive unit tests in `pkg/risk/vol_sizer_test.go` checking normal scaling, halved/doubled ATR scaling, zero inputs, negative inputs, and enforcement of the $10 max loss cap.
- All tests in `pkg/risk` and the entire module are successfully passing.
