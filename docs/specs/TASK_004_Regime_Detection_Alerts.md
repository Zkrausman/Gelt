---
type: specification
title: TASK_004: Phase 2 - Regime Detection Alert System
---

# TASK_004: Phase 2 - Regime Detection Alert System

## Objective
Engineering Management requires the implementation of a passive market regime detection system. This system will act as a read-only telemetry layer to identify shifting market conditions (e.g., transitioning from trend to chop) and recommend alternative trading plans. **Under no circumstances should this system autonomously execute a plan switch during this sprint.**

## Technical Requirements

1. **Regime Monitor Implementation:**
   * Create a new module or expand existing signals to track lagging macroeconomic indicators.
   * **Primary Indicators:** * Implement tracking for the VIX (Volatility Index).
     * Implement a 20-period Exponential Moving Average (EMA) slope calculation for the primary traded asset.

2. **Alert Thresholds & Logic:**
   * **High Volatility (Chop) Regime:** If the VIX rises above `25.0` OR the 20 EMA slope turns negative/flat during standard market hours.
   * **Action:** The system must generate a standard output console warning. 

3. **Console Output Format:**
   * When the thresholds are breached, print a highly visible alert to the CLI: 
     `[REGIME ALERT] High Volatility Detected (VIX > 25 / EMA Negative). Recommended Action: Switch to RangeBoundDefensivePlan.`

4. **Validation & Risk Control:**
   * Run `go test ./...` to ensure no existing functionality is broken.
   * **Critical Constraint:** This is a read-only alert. Do not modify the `Trading Plan Engine` to accept automated hot-swapping yet. The active live trading plan must remain untouched.