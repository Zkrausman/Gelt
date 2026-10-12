# Gelt Intelligent Data Suite & Analytical Tools Implementation Plan

## Executive Summary
This technical implementation plan describes architectural additions for Gelt as a data-driven strategy suite. All components adhere to the **Single Subscription Constraint** (operating zero-cost local data ingestion, local caching, and token-saving AST/text compression via Pith/Whet).

---

## Target Architecture & Package Layout

```
/path/to/Gelt
├── cmd\
│   └── gelt\
│       └── main.go                  <-- CLI interface with new commands (scan, backtest, macro, thesis)
├── pkg\
│   ├── robinhood\                   <-- Live Robinhood MCP client & order execution (Completed)
│   ├── risk\                        <-- Local financial governance & position caps (Completed)
│   ├── data\                        <-- Market & macroeconomic data ingestion (FRED, SEC EDGAR, News)
│   ├── signals\                     <-- Technical indicator engine (EMA, MACD, RSI, VWAP) & screeners
│   ├── backtest\                    <-- Historical strategy simulator & performance analytics
│   ├── portfolio\                   <-- Asset correlation matrix & Value-at-Risk (VaR) calculations
│   └── thesis\                      <-- Structured trade thesis logging & Beads brain sync
└── docs\
    ├── ROADMAP.md
    └── techPlans\
        └── gelt_datasuite_and_tools.md
```

---

## Subsystem Specifications

### 1. Market Data Suite (`pkg/data`)
*   **Macroeconomic Data Ingestion**: Zero-cost API adapter for FRED (Federal Reserve Economic Data) to track 10Y/2Y Treasury yield curve, CPI/PPI inflation indices, and Fed funds rate.
*   **Fundamental & Filing Engine**: Direct SEC EDGAR RSS & 8-K/10-K filing parser for real-time event triggers and earnings surprise tracking.
*   **News & Sentiment Ingester**: Headless headline scraper and local text sentiment scorer (Bullish/Bearish rating).

### 2. Quantitative & Technical Signal Engine (`pkg/signals`)
*   **Technical Indicators**: Multi-timeframe trend & momentum metrics (20/50/200 EMA, MACD, RSI-14, VWAP, Bollinger Bands).
*   **Dynamic Screener**: Universe scanner to filter equities matching volume breakouts, relative strength against SPY, and oversold bounce setups.

### 3. Historical Backtesting Simulator (`pkg/backtest`)
*   **Backtest Engine**: Event-driven historical market replay simulator.
*   **Performance Metrics**: Automated calculation of Win Rate, Profit Factor, Sharpe Ratio, Sortino Ratio, and Max Drawdown.

### 4. Risk & Correlation Governance (`pkg/portfolio`)
*   **Asset Correlation Matrix**: Multi-ticker correlation guardrail to prevent over-allocation to co-moving equities.
*   **Dynamic Trailing Stops**: ATR (Average True Range) trailing stop calculations and mandatory >2:1 Risk-to-Reward ratio enforcement.

### 5. Trade Thesis & Beads Brain Sync (`pkg/thesis`)
*   **Structured Trade Logging**: Automatically generates written trade rationale (catalyst, entry, exit, stop-loss) before order placement.
*   **Beads Brain Integration**: Logs execution history directly into `GELT_BEADS_BRAIN_PATH`.

---

## Execution Milestones

| Milestone | Subsystem | Focus Area |
| :--- | :--- | :--- |
| **M1** | `pkg/signals` | Technical indicator pipeline & basic equity screener |
| **M2** | `pkg/data` | FRED Macro adapter & SEC EDGAR filing event stream |
| **M3** | `pkg/backtest` | Historical strategy simulator & performance metrics |
| **M4** | `pkg/portfolio` | Asset correlation matrix & dynamic trailing stops |
| **M5** | `pkg/thesis` | Beads brain thesis logger & local feature cache |
