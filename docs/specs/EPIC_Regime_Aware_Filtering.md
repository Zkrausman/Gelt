---
title: "[EPIC] Macro-Regime Signal Filtering & Volatility Circuit Breakers"
status: "Approved"
date: "2026-08-02"
author: "Lead Technical Product Manager & Principal Architecture Engineer"
linear_epic_id: "c028d277-88a2-4cc5-b96c-2c17b9830b42"
linear_epic_url: "https://linear.app/geltagentictrading/project/epic-macro-regime-signal-filtering-and-volatility-circuit-breakers-10b02a70a32e"
---

# [EPIC] Macro-Regime Signal Filtering & Volatility Circuit Breakers

## 1. Executive Summary

Implement trend (EMA) and volatility (ATR/VIX) gates to prevent deterministic strategies from trading in unfavorable market regimes. Deterministic strategies (like `VWAPRebound`) will be muted or blocked if the macro trend is negative (price below 20/50 EMA) or if micro-volatility (ATR) drops too low, indicating chop.

---

## 2. Architecture & Component Topology

```mermaid
graph TD
    subgraph Market_Data_Ingestion["Market Data & Feature Registry"]
        PriceFeed["Price & Candle Feed<br>[pkg/data/provider.go]"]
        EMACalc["EMA 20/50 Calculator<br>[pkg/strategies/ema.go]"]
        ATRCalc["ATR Volatility Engine<br>[pkg/strategies/atr.go]"]
    end

    subgraph Regime_Filtering_Layer["Regime Filtering & Circuit Breakers"]
        EMAGate["Macro Trend Alignment Gate<br>[pkg/strategies/filters.go]"]
        ATRFilter["Volatility Circuit Breaker<br>[pkg/strategies/filters.go]"]
    end

    subgraph Strategy_Execution_Engine["Strategy Execution Engine"]
        VWAPStrategy["VWAP Rebound Strategy<br>[pkg/strategies/vwap_rebound.go]"]
        OrderSignal["Signal Dispatcher<br>[pkg/plans/executor.go]"]
    end

    PriceFeed --> EMACalc
    PriceFeed --> ATRCalc
    EMACalc --> EMAGate
    ATRCalc --> ATRFilter

    VWAPStrategy -->|Raw Signal| EMAGate
    EMAGate -->|Trend Approved| ATRFilter
    ATRFilter -->|Vol Approved| OrderSignal
```

---

## 3. Strict Linear Specification Output

[SCHEMA_START]
Epic Title: Macro-Regime Signal Filtering & Volatility Circuit Breakers
Objective: Implement trend (EMA) and volatility (ATR/VIX) gates to prevent deterministic strategies from trading in unfavorable market regimes.

Ticket 1:
- Title: Macro Trend Alignment Gate (EMA 20/50)
- Linear Key: ZAR-80 (https://linear.app/geltagentictrading/issue/ZAR-80/gelt-150-macro-trend-alignment-gate-ema-2050)
- Scope: pkg/strategies/ and pkg/plans/
- Description: Create a filter that evaluates the underlying asset's price relative to its 20 and 50-period EMA. Reject long signals if the asset is in a downtrend.
- Acceptance Criteria:
  1. Verify `go test -race ./pkg/strategies/...` passes when EMA filter rejects a valid VWAP buy signal during a downtrend (price < 20 EMA & 20 EMA < 50 EMA).
  2. Integration tests in `pkg/plans/...` verify long signals pass when price > 20 EMA & 20 EMA > 50 EMA.

Ticket 2:
- Title: Volatility Circuit Breakers (ATR Chop Filter)
- Linear Key: ZAR-81 (https://linear.app/geltagentictrading/issue/ZAR-81/gelt-151-volatility-circuit-breakers-atr-chop-filter)
- Scope: pkg/strategies/filters.go
- Description: Implement an ATR-based volatility check. If current ATR drops below a configurable baseline threshold, pause mean-reversion entries until volatility expands.
- Acceptance Criteria:
  1. Verify `go test -race ./pkg/strategies/...` passes when low ATR conditions trigger the chop filter and block mean-reversion buy signals.
  2. Configurable ATR threshold defaults to 1.5% of asset price and successfully allows trades when ATR expands above threshold.
[SCHEMA_END]

---

## 4. Engineering Ticket Details

### 🎫 Ticket 1: [GELT-150] Macro Trend Alignment Gate (EMA 20/50)
- **Linear Key:** [`ZAR-80`](https://linear.app/geltagentictrading/issue/ZAR-80/gelt-150-macro-trend-alignment-gate-ema-2050)
- **Scope:** `pkg/strategies/` and `pkg/plans/`
- **Priority:** High (P2)
- **Estimate:** 2 Points
- **Blockers:** None

#### Description
Create a filter that evaluates the underlying asset's price relative to its 20 and 50-period EMA. Reject long signals if the asset is in a downtrend.

#### Acceptance Criteria
1. Verify `go test -race ./pkg/strategies/...` passes when EMA filter rejects a valid VWAP buy signal during a downtrend ($Price < EMA_{20}$ and $EMA_{20} < EMA_{50}$).
2. Integration tests in `pkg/plans/...` verify long signals pass when price > 20 EMA and 20 EMA > 50 EMA.

---

### 🎫 Ticket 2: [GELT-151] Volatility Circuit Breakers (ATR Chop Filter)
- **Linear Key:** [`ZAR-81`](https://linear.app/geltagentictrading/issue/ZAR-81/gelt-151-volatility-circuit-breakers-atr-chop-filter)
- **Scope:** `pkg/strategies/filters.go`
- **Priority:** High (P2)
- **Estimate:** 2 Points
- **Blockers:** Blocked by GELT-150 (`ZAR-80`)

#### Description
Implement an ATR-based volatility check. If current ATR drops below a configurable baseline threshold, pause mean-reversion entries until volatility expands.

#### Acceptance Criteria
1. Verify `go test -race ./pkg/strategies/...` passes when low ATR conditions trigger the chop filter and block mean-reversion buy signals.
2. Configurable ATR threshold defaults to 1.5% of asset price and successfully allows trades when ATR expands above threshold.
