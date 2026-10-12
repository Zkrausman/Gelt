# Gelt Synthetic Demo Trading Plan & Example Operations Protocol

> This document is a fictional engineering example. The demo account, limits,
> schedule, and market data below are synthetic and do not describe a real
> brokerage account, order, position, or trading result.

## 1. Executive Strategy & Risk Profile

| Parameter | Operational Rule |
| :--- | :--- |
| **Account Type** | `SYNTHETIC-DEMO-ACCOUNT` (not connected to a broker) |
| **Starting Balance** | `$1,000.00 USD` (fictional fixture) |
| **Max Concurrent Positions** | `2` demo positions |
| **Max Single Trade Amount** | `$100.00 USD` (fictional fixture) |
| **Position Allocation Cap** | `15.00%` of demo equity |
| **Daily Loss Cap** | `$25.00` in the demo scenario |
| **Asset Class** | Synthetic sample symbols only; no live orders |
| **Minimum Entry Confluence** | **`62.0%`** illustrative threshold |
| **Stop-Loss Trigger** | Trailing stop at **`4.0%`** in the example |
| **Target Profit** | **`+8.0%`** in the example |
| **Memory Audit** | 100% of Trade Rationales & Evidence synced to **Thneed** (`GELT_BEADS_BRAIN_PATH`) |

---

## 2. Dual-Speed Execution & Monitoring Protocol

Gelt operates a dual-speed monitoring model to optimize signal quality while protecting capital:

```
┌────────────────────────────────────────────────────────────────────────┐
│                   DUAL-SPEED OPERATING PROTOCOL                        │
├───────────────────────────────────┬────────────────────────────────────┤
│  ENTRY SCREENING & SIGNALS        │  CAPITAL PROTECTION & STOPS        │
│  • Timeframe: 15-Minute Candles   │  • Timeframe: 1 to 5 Minutes       │
│  • Frequency: Every 15 Minutes    │  • Frequency: Continuous Background│
│  • Purpose: Filter market noise,  │  • Purpose: Instant execution if   │
│    prevent fake-out entries       │    3% trailing stop is breached    │
└───────────────────────────────────┴────────────────────────────────────┘
```

---

## 3. Herdr 3-Tab Command Center Architecture

```
┌─────────────────────────┬─────────────────────────┬─────────────────────────┐
│ TAB 1: MAIN DRIVER      │ TAB 2: SCHEDULED RUNNER │ TAB 3: LIVE DASHBOARD   │
│ (Interactive Chat)      │ (15-Min Trade Polls)    │ (5-Sec PnL Auto-Refresh)│
├─────────────────────────┼─────────────────────────┼─────────────────────────┤
│ • Strategy chat & Q&A   │ • 15m Watchlist Scans   │ • `while ($true) {      │
│ • Custom ticker lookup  │ • Signal Evaluations    │     Clear-Host;         │
│ • Order authorizations  │ • Stop-Loss Audits      │     .\gelt.exe status;  │
│                         │                         │     Start-Sleep 5 }`    │
└─────────────────────────┴─────────────────────────┴─────────────────────────┘
```

---

## 4. Illustrative Demo Session Protocol

The times below describe a fictional walkthrough and are not a schedule or
record of a real trading session.

### Phase A: Setup & Diagnostics (9:20 AM – 9:28 AM ET)
1. **9:20 AM ET**: Launch Herdr Terminal with 3 tabs.
2. **9:25 AM ET**: In Tab 1, run the pre-market health check:
   ```powershell
   cd /path/to/Gelt
   .\gelt.exe test-suite
   ```
   *Verify result: 6/6 PASS.*
3. **9:28 AM ET**: In Tab 3, start the live dashboard loop:
   ```powershell
   cd /path/to/Gelt
   while ($true) { Clear-Host; .\gelt.exe status; Start-Sleep -Seconds 5 }
   ```

### Phase B: Market Open & Screening (9:30 AM – 9:35 AM ET)
4. **9:30 AM ET**: At market open bell, run the high-threshold screener in Tab 1:
   ```powershell
   .\gelt.exe scan 75.0
   ```
5. **9:35 AM ET**: Activate the 15-minute background schedule (`/schedule`) in Tab 2 to automate 15m interval scanning and management alerts.

### Phase C: Active Trading & Governance (9:35 AM – 4:00 PM ET)
6. Every 15 minutes, inspect Tab 2 scan updates for candidates with Confluence Score $\ge 75.0$.
7. For any candidate trade, verify pre-trade risk validation, review trade thesis self-doc, and authorize placement.
8. Observe live PnL and risk metrics updating in Tab 3 dashboard.
