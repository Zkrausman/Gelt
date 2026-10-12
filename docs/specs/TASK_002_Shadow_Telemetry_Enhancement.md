---
type: specification
title: TASK_002: Shadow Trading Engine Telemetry Enhancement
---

# TASK_002: Shadow Trading Engine Telemetry Enhancement

## Objective
Before initiating Product Phase 1 (Core Equities Optimization), Engineering Management requires enhanced diagnostic telemetry from the Shadow Trading Engine. We must establish deeper statistical analysis on virtual PnL to accurately measure the delta of future strategy modifications.

## Technical Requirements

1. **Extend Metrics Tracking:** Upgrade the Shadow Trading Engine's internal data structures to track, calculate, and store the following new metrics for all paper trades:
   * **Profit Factor:** Gross virtual profit divided by gross virtual loss.
   * **Average Win / Average Loss:** The average dollar amount of winning trades versus losing trades.
   * **Max Drawdown:** The largest peak-to-trough drop in the shadow portfolio's virtual PnL.

2. **CLI Output Enhancement:** Modify the standard output of the `.\gelt.exe shadow` command. It must now display these new granular statistics alongside the existing leaderboard view.

3. **Validation & Isolation:** * Run `go test ./...` to ensure no existing functionality is broken.
   * **Constraint:** Do not modify any logic within the `Robinhood MCP Integration` or the `Risk Governance Engine` during this sprint. This is strictly a Shadow Engine telemetry upgrade.