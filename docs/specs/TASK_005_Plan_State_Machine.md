---
type: specification
title: TASK_005: Phase 2 - Trading Plan State Machine (Hot-Swapping)
---

# TASK_005: Phase 2 - Trading Plan State Machine (Hot-Swapping)

## Objective
Engineering Management requires the implementation of a thread-safe State Machine within the Trading Plan Engine. This will allow the user to manually hot-swap the active live trading plan (e.g., from `IntradayAlphaPlan` to `RangeBoundDefensivePlan`) via the CLI without restarting the application or dropping live Robinhood broker connections.

## Technical Requirements

1. **Thread-Safe State Management:**
   * Upgrade the `Trading Plan Engine` to utilize a mutex-locked state or atomic pointer for the currently active `BasePlan`.
   * Ensure that if a signal evaluation is mid-process, the swap waits for the evaluation tick to complete before applying the new plan (preventing race conditions).

2. **CLI Command Expansion:**
   * Expand the existing `gelt plan` subcommand.
   * Implement `gelt plan set <PlanName>` (e.g., `gelt plan set RangeBoundDefensivePlan`).

3. **Transition Telemetry:**
   * Upon a successful hot-swap, print a clear timestamped notification to the console:
     `[STATE CHANGE] Active Plan seamlessly transitioned from <OldPlan> to <NewPlan>.`

4. **Validation & Isolation:**
   * Run `go test ./...` to ensure core systems remain stable.
   * **Critical Constraint:** Do NOT wire this state machine into the `Regime Detection Alert System` created in TASK_004. The hot-swap must strictly remain a **manual** CLI operation for this sprint. We will authorize automated switching only after manual testing is verified.