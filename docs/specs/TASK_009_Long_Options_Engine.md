---
type: specification
title: TASK_009: Phase 3 - Long Options (Calls & Puts) Strategy Engine
---

# TASK_009: Phase 3 - Long Options (Calls & Puts) Strategy Engine

## Objective
Engineering Management requires the implementation of our revised options strategy module: the **Long Options Engine**. This module will evaluate directional momentum and generate confidence scores specifically for purchasing long calls or long puts, utilizing Robinhood's `place_option_order` interface under the strict governance of our `OptionsRiskProfile`. **No short options (writing calls/puts or credit structures) are permitted.**

## Technical Requirements

1. **Long Options Strategy Module (`gelt/pkg/strategies/long_options.go`):**
   * Implement a quantitative strategy conforming to the standard `Strategy` interface, outputting confidence scores ranging from `0.0` to `100.0`.
   * **Scoring Logic:** * **Long Call Setup:** High upward momentum + moderate implied volatility (avoiding IV crush).
     * **Long Put Setup:** Strong downward momentum + rising volatility.

2. **Risk Governance & Debit Enforcement:**
   * Before an option order is packaged for execution via the `Robinhood MCP`, it must invoke `ValidateOptionsTrade()` from the `risk` package.
   * **Strict Constraint:** The system must only execute *long* debit orders (net negative cash flow to open, buying contracts). Any attempt to route a short credit order must be blocked locally.
   * Enforce the `OptionsRiskProfile`: Maximum 1 contract per trade, minimum 14 Days to Expiration (DTE), and an Implied Volatility cap of `80.0%`.

3. **Validation & Testing:**
   * Write comprehensive unit tests (`long_options_test.go`) to verify that long call/put signals trigger correctly based on directional momentum.
   * Run `go test ./...` to ensure core systems remain 100% stable.