---
type: specification
title: TASK_007: Phase 3 Pre-Requisite - Risk Governance Engine Refactor
---

# TASK_007: Phase 3 Pre-Requisite - Risk Governance Engine Refactor

## Objective
Engineering Management requires a fundamental refactor of the Risk Governance Engine while the markets are closed for the weekend. The system must be upgraded to safely handle standard options contract multipliers ($100 nominal minimums) while preserving the original micro-cap constraints for standard equity trades.

## Technical Requirements

1. **Asset-Class Risk Profiles:**
   * Refactor the `Risk Governance Engine` to accept parameterized risk profiles rather than hardcoded global constants.
   * Create an `EquityRiskProfile`: 
     * Max Trade Size: $10.00
     * Max Daily Loss: $5.00
   * Create an `OptionsRiskProfile`:
     * Max Trade Size: 1 Contract (Requires dynamic nominal calculation based on premium x 100).
     * Max Daily Loss: Abstract this to a percentage-based drawdown limit (e.g., max 20% loss on premium) rather than a flat $5.00, allowing for options volatility without blowing up the portfolio.

2. **Constraint Enforcement Update:**
   * Upgrade the order pre-flight check routine. Before `Robinhood MCP` receives *any* order, the engine must route the order through the correct asset-class profile.
   * If an options order violates the new percentage-based daily loss limit, it must be instantly rejected before network transmission.

3. **Validation & Isolation:**
   * Run `go test ./...` to ensure core systems remain stable.
   * **Critical Constraint:** You must write new unit tests simulating both a $12 equity trade (which should be rejected) and a $1.50 options contract (which should be accepted as $150 nominal exposure).