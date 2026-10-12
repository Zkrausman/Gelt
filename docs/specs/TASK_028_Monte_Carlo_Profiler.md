---
type: specification
title: Completion Report: TASK 028 Monte Carlo Shadow Profiler
---

# Completion Report: TASK 028 Monte Carlo Shadow Profiler

## Overview
This specification details the completion of the Monte Carlo simulation profiler for the Shadow Engine. The profiler is designed to analyze a strategy's expected value (EV) and probability of ruin by running 1,000 randomized permutations of its historical shadow trade PnL.

## Changes Implemented

1. **Created `pkg/shadow/monte_carlo.go`:**
   - Designed a `SimulationResult` struct containing `ExpectedValue`, `ValueAtRisk`, and `ProbabilityOfRuin`.
   - Created the `RunSimulation(trades []Trade, iterations int)` function.
   - For each iteration, the function samples trades from the input `trades` slice with replacement up to `len(trades)` times.
   - It tracks the cumulative PnL, peak cumulative PnL, maximum drawdown, and tests whether the overall balance (assuming an initial capital of \$10,000) falls to or below zero.
   - Once all iterations complete, it computes:
     - **Expected Value (EV):** The mean of the final cumulative PnLs across all iterations.
     - **Value at Risk (VaR):** The 5th percentile worst-case maximum drawdown (calculated by sorting all max drawdowns and picking the 95th percentile).
     - **Probability of Ruin:** The fraction of iterations that resulted in the balance dropping at or below zero.

2. **Created `pkg/shadow/monte_carlo_test.go`:**
   - Wrote a unit test (`TestRunSimulation`) passing in a mock array of winning and losing trades to verify the calculation behavior of the simulator.
   - Ensured Expected Value falls within expected bounds based on the population sum.
   - Checked that VaR behaves correctly given negative PnLs.
   - Built a separate test (`TestRunSimulation_Ruin`) with highly negative mock trades to ensure the Probability of Ruin formula correctly identifies and reports cases that trigger a ruin state (reaching <= $0 balance).
   - Added an empty trades edge-case test (`TestRunSimulation_Empty`).

3. **Testing:**
   - Validated functionality by running `go test -race ./...`. All unit tests passed without race conditions.

## Outcome
The Shadow engine now has the statistical profiling capabilities requested via the Monte Carlo method, which will empower strategy authors to more clearly evaluate theoretical strategy bounds such as expected returns and drawdowns before moving from shadow testing to live money.
