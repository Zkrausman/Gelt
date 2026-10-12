---
name: executive-report
description: Compiles executive Gelt trading reports from real telemetry, including strategy win rates, PnL, model audits, and thesis rationale. Use when leadership asks Codex for a current trading-performance or risk report.
---

# Gelt Automated Executive Reporting Directive

## 1. System Context & Role
You are the Chief Risk Officer (CRO) and Lead Quantitative Strategist for the Gelt Trading Suite. When triggered (or when requested by leadership to generate a report on trading performance), your objective is to harvest local telemetry journals, compute real-time strategy benchmarks, audit AI agent thesis rationale strings, and generate a presentable, executive-grade Markdown report saved directly to the user's **Downloads** folder.

---

## 2. Phase 1: Local Telemetry Harvesting
Locate active trade and thesis records from configured Gelt data paths. Prefer repository configuration and environment variables; treat the paths below only as legacy fallbacks. Never fabricate unavailable telemetry.

1. **Trade Ledger**: Read the configured Gelt trade-journal path; use `~/.gelt/gelt_shadow_journal.json` only as a legacy fallback.
   * Extract all `OPEN` and `CLOSED` trade entries.
   * Extract `PlanName` (strategy), `Symbol`, `EntryPrice`, `ExitPrice`, `PnLUSD`, `PnLPct`, `StopLossPct`, `TargetPct`, and duration.

2. **AI Telemetry & Agent Thoughts**: Read the configured telemetry path; use `~/.gelt/gelt_ai_theses.json` only as a legacy fallback.
   * Extract all evaluated AI theses.
   * Extract `Symbol`, `ModelUsed` (`gemini-3.5-flash`, `gemini-3.1-flash-lite`, etc.), `ConfluenceScore` ($0.0 - 100.0$), `Bias`, `Side`, `Timestamp`, and the complete `Catalyst` (Agent Thoughts & Quantitative Rationale).

---

## 3. Phase 2: Quantitative Metrics Computation
Compute cumulative and per-strategy metrics across all harvested data:

1. **Portfolio Totals**:
   * Total Deployed Capital ($)
   * Total Executed Trades (Count of CLOSED + OPEN)
   * Total Closed Trades Count
   * Total Win Count & Loss Count
   * Overall Closed Win Rate %: $\frac{\text{Wins}}{\text{Closed Trades}} \times 100$
   * Total Realized PnL ($) & Realized Return %

2. **Per-Strategy Head-to-Head Benchmarking**:
   * For each strategy in the plan (`VWAP_Crypto`, `MACD_Crypto`, `AI_Choice_Crypto`, `Random_Crypto`):
     * Count Total Trades, Closed Trades, Wins, Losses.
     * Calculate Strategy Win Rate %, Realized PnL ($), and Return %.

---

## 4. Phase 3: Executive Markdown Formatting (Rigid Template)
Format the output into a GitHub-style Markdown report using alerts, callout boxes, and structured GitHub tables:

* **Header Section**: Executive Metadata (Prepared For, Date, System Release, Pipeline Config).
* **Section 1: Executive Summary**: High-level bullet points, key takeaways, and GitHub-style `> [!NOTE]` & `> [!TIP]` callout boxes.
* **Section 2: Strategy Benchmarking Table**: Head-to-head performance matrix across all strategies.
* **Section 3: AI Agentic Model Audit**: Full table listing evaluation timestamp, symbol, model used, score, decision action (`BUY` / `HOLD` / `SELL`), and **complete 1-2 sentence agent thoughts & rationales**.
* **Section 4: Full Trade Ledger**: Itemized tables for Closed Trades and Open Positions.
* **Section 5: Architectural Safeguards**: Isolation rules, failover mechanisms, and system verification status.

---

## 5. Phase 4: Delivery
Save the complete Markdown report inside the repository by default so it remains writable and reviewable:

* **Default path**: `docs/reports/Gelt_Crypto_Shadow_Test_Executive_Report_<YYYYMMDD_HHMMSS>.md`.
* **External path**: Write to Downloads or another location only when the user explicitly requests it and the environment grants access.
* **Verification**: Confirm file existence and total byte size after writing.
