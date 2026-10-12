---
type: specification
title: TASK_003: Telemetry Patch & Phase 1 Core Equities Optimization
---

# TASK_003: Telemetry Patch & Phase 1 Core Equities Optimization

## Objective
Fix a critical math error in the newly deployed Shadow Trading Engine telemetry, and officially execute the Phase 1 strategy optimizations for the active `IntradayAlphaPlan`.

## Technical Requirements

1. **Bug Fix (Shadow Engine):**
   * **Issue:** The Profit Factor calculation currently fails to handle a $0.00 Gross Loss, resulting in an incorrect output (mirroring Net PnL).
   * **Resolution:** Implement a divide-by-zero safeguard. If Gross Loss is $0.00 and Gross Profit is > $0.00, output `INF` (Infinity) or `N/A`. If both are 0, output `0.00`.

2. **Weight Tuning (`IntradayAlphaPlan`):**
   * Locate the `BasePlan.Evaluate` configuration for `IntradayAlphaPlan`.
   * Adjust the ensemble weights from the baseline `TrendConfluence` (60%) and `VWAPRebound` (40%) to an even **50% / 50%** split.

3. **Threshold Tightening:**
   * Locate the consensus decision boundaries within the active plan.
   * Tighten the `SignalBuy` requirement. Raise the threshold from `>= 75.0` to **`>= 80.0`**.
   * Leave the `SignalSell` threshold at `<= 35.0` for now.

4. **Validation:** * Run `go test ./...` to ensure no existing functionality is broken.