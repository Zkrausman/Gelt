---
type: specification
title: TASK_006: Phase 4 - Macro Data Ingestion & Thneed Logger Upgrade
---

# TASK_006: Phase 4 - Macro Data Ingestion & Thneed Logger Upgrade

## Objective
Engineering Management requires the initiation of Phase 4. We must establish asynchronous data ingestion for macroeconomic indicators (FRED API) and upgrade the Thneed Brain Logger to stream our enhanced Shadow Engine telemetry directly into the central GraphRAG.

## Technical Requirements

1. **Asynchronous FRED API Ingestion:**
   * Create a new module (`gelt/pkg/macro`) to fetch data from the Federal Reserve Economic Data (FRED) API.
   * **Critical Constraint:** This ingestion must occur asynchronously (e.g., via goroutines) to ensure network latency does not block the main `Trading Plan Engine` or `Robinhood MCP` execution threads.
   * Initial focus: Fetch the Effective Federal Funds Rate (EFFR) or standard macro interest rate indicators.

2. **Thneed Brain Logger Upgrade:**
   * Locate the `Thneed Brain Logger` module.
   * Expand the logger's payload capabilities to ingest the Shadow Trading Engine telemetry created in TASK_003 (Net PnL, Profit Factor, Avg Win, Avg Loss, Max DD).
   * Format this new shadow telemetry into the standard Thneed architecture blocks: `[bd-3qwe self-doc] RATIONALE and EVIDENCE`.
   * Ensure this structured data is properly routed for syncing to the target directory (`GELT_BEADS_BRAIN_PATH`).

3. **Validation & Isolation:**
   * Run `go test ./...` to ensure core systems remain stable.
   * Write specific concurrency tests for the FRED ingester to guarantee it operates in a non-blocking manner.