---
type: specification
title: TASK_008: Phase 2 Completion - Autonomous Regime Switching
---

# TASK_008: Phase 2 Completion - Autonomous Regime Switching

## Objective
Engineering Management requires the final integration of Phase 2. The previously built `Regime Detection Alert System` (TASK_004) must be wired into the `Plan State Machine` (TASK_005) to enable autonomous, mid-execution strategy hot-swapping based on macroeconomic volatility.

## Technical Requirements

1. **The Autonomous Trigger:**
   * Upgrade the `Trading Plan Engine` loop to listen to the `Regime Monitor` module.
   * If `EvaluateRegime()` transitions the system state to `HIGH_VOLATILITY_CHOP` (e.g., VIX > 25.0 or 20 EMA slopes negative), the system must autonomously fire the state machine transition to swap the active plan to `RangeBoundDefensivePlan`.

2. **Anti-Thrashing Mechanism (Hysteresis):**
   * Implement a safety lock to prevent rapid, continuous swapping if the VIX is hovering exactly on the boundary line (e.g., bouncing between 24.9 and 25.1).
   * **Rule:** Once an autonomous defensive swap occurs, the system must remain locked in the `RangeBoundDefensivePlan` for the remainder of the current trading session, requiring manual CLI intervention (`gelt plan set IntradayAlphaPlan`) to revert to aggressive posturing.

3. **Validation & Mocking (Offline Requirement):**
   * Since live markets are closed, you must write a dedicated integration test (`TestAutonomousRegimeSwap`).
   * **Test Scenario:** 1. Initialize the engine with `IntradayAlphaPlan`.
     2. Inject mock market data simulating a VIX spike to `28.0`.
     3. Assert that the system automatically acquires the `evalLock`, swaps the active plan pointer to `RangeBoundDefensivePlan`, and emits the transition telemetry without deadlocking.
   * Run `go test ./...` to ensure global stability.