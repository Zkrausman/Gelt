---
type: skill
title: "[GELT-155] Dynamic Mid-Day Promotion & Plan Hot-Swapper"
status: active
dependencies: []
command: "N/A"
---

# ZAR-85: Dynamic Mid-Day Promotion & Plan Hot-Swapper

## Architectural Decision Record (ADR)

### Context & Problem Statement
The shadow-to-live promotion engine requires a safety mechanism to transition a qualifying shadow plan into the live engine. To do this mid-session without dropping ticks or causing duplicate position allocations, a hot-swapper state machine must be developed. It must acquire locks, verify active positions, and be configurable via an auto-promote flag to differentiate between live-mutating auto-promotion and alert-only modes.

### Multi-Hop Architectural Analysis
1. **Thread Safety & Concurrency Locking:**
   - The `PlanHotSwapper` wraps `PlanRegistry` and accesses its state transitioning mechanisms (`PromotePlan`).
   - We utilize the existing `sync.RWMutex` locking on `PlanRegistry` (`evalLock` and `mu`) to block concurrent market tick evaluations (`EvaluateActive`) during a hot-swap via `PromotePlan`.
   - The swapper uses its own internal mutex to prevent concurrent promotion proposals.

2. **State Transition Safety:**
   - A critical requirement is to prevent hot-swaps while there are active, open positions to avoid dangling states or duplicated capital allocations.
   - The `ProposePromotion` method expects an `activePositions` integer parameter (fetched from telemetry/portfolio manager in higher-level calls).
   - If `activePositions > 0`, the state machine instantly rejects the promotion and logs a warning.

3. **Notification & Mode Handling:**
   - The `AutoPromote` boolean drives the mode.
   - If `AutoPromote=false`, it logs the proposal via structured `log/slog` to `os.Stdout` (which can be intercepted by alerting systems).
   - If `AutoPromote=true` and conditions are safe, it triggers `registry.PromotePlan(planName)`.

### Mathematical Constraints
- **Concurrency Guarantee:**
  Let $P$ be the number of active open positions.
  $$ P = 0 \implies \text{Promotion Eligible} $$
  $$ P > 0 \implies \text{Promotion Rejected} $$

## OKF Specification Compliance
- The core orchestrator implementation is in `pkg/plans/promoter.go`.
- Implements `PlanHotSwapper` with `ProposePromotion(ctx, planName, activePositions)`.
- Rejects promotion if $P > 0$.
- Unit tests (`pkg/plans/promoter_test.go`) explicitly verify zero-position success, active-position failure, and alert-only non-mutation conditions.
