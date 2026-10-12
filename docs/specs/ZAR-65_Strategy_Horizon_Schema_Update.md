---
type: spec
title: Strategy Horizon Schema Update (ZAR-65)
status: Implemented
---

# ZAR-65: Strategy Horizon Schema Update

## Context
The Gelt system uses `DynamicStrategyDefinition` schema and `Strategy` interface. To support different time horizons, specifically distinguishing between intraday execution constraints and longer-term holds, we need a flag indicating whether a strategy is explicitly limited to intraday operations.

## Architecture Decision Record (ADR)
We updated the `Strategy` interface and `DynamicStrategyDefinition` structure to include a boolean flag for `IntradayOnly`. By default, this property must evaluate to `true` to fail-safe against unintentional overnight risk exposure.

**Decisions:**
- Modify `DynamicStrategyDefinition` struct to include `IntradayOnly bool` field with a custom `UnmarshalJSON` method to set it to `true` by default when parsing strategy config payloads.
- Modify `Strategy` interface to include `IsIntradayOnly() bool`.
- All standard Go-implemented strategies implement `IsIntradayOnly()` returning `true`.
- The `DynamicStrategy` dynamically returns `s.Def.IntradayOnly`.

## Mathematical Constraints
This update enables logic to enforce the execution time constraint:
Let $T_{exec}$ be the time a trade is executed, and $T_{close}$ be the market close time.
For a strategy where `IsIntradayOnly()` evaluates to $true$, the system must ensure that the position is liquidated prior to $T_{close}$, resulting in an effective holding time constraint $H \le T_{close} - T_{exec}$.
