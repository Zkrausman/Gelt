# Gelt Strategy Catalog Technical Plan 🏛️

## Overview
The **Gelt Strategy Catalog** (`pkg/strategies`) converts Gelt from a single-algo bot into a modular, multi-strategy quantitative trading engine. It allows Gelt to maintain a catalog of distinct, battle-tested algorithmic trading strategies, evaluate market regimes dynamically, and select optimal strategies per ticker/regime.

---

## 🏗️ Architecture & Interfaces

### 1. Strategy Interface (`pkg/strategies/strategy.go`)
```go
package strategies

import (
	"time"
)

// SignalType defines the directional bias of a strategy signal.
type SignalType string

const (
	SignalBuy  SignalType = "BUY"
	SignalSell SignalType = "SELL"
	SignalHold SignalType = "HOLD"
)

// StrategySignal holds the output of a strategy evaluation.
type StrategySignal struct {
	StrategyName string     `json:"strategy_name"`
	Symbol       string     `json:"symbol"`
	Signal       SignalType `json:"signal"`
	Score        float64    `json:"score"`         // 0.0 - 100.0 confidence score
	StopLossPct  float64    `json:"stop_loss_pct"` // Dynamic ATR-calibrated stop loss %
	TargetPct    float64    `json:"target_pct"`    // Dynamic ATR-calibrated target %
	Rationale    string     `json:"rationale"`     // Key technical triggers
	Timestamp    time.Time  `json:"timestamp"`
}

// Strategy defines the core contract for all Gelt quantitative trading strategies.
type Strategy interface {
	Name() string
	Description() string
	Evaluate(symbol string, closes []float64, volumes []float64) (StrategySignal, error)
}
```

---

## 📊 Strategy Catalog Suite

### 1. `TrendConfluenceStrategy`
- **Focus**: Trending markets (SPY, QQQ, TSLA, NVDA).
- **Indicators**: 20 EMA, 50 EMA, MACD (12/26/9), RSI-14.
- **Triggers**: Price > 20 EMA, 20 EMA > 50 EMA, MACD Histogram > 0, RSI > 50.

### 2. `MeanReversionStrategy`
- **Focus**: Range-bound / choppy markets (IWM, DIA, XLE).
- **Indicators**: 20-period Bollinger Bands (2.0 std dev), RSI-14.
- **Triggers**: Price <= Lower Bollinger Band AND RSI < 30 (BUY bounce), or Price >= Upper Bollinger Band AND RSI > 70 (SELL exit).

### 3. `BreakoutVolStrategy`
- **Focus**: High-volatility expansion & catalyst breakouts.
- **Indicators**: ATR-14, 20-period Volume Moving Average.
- **Triggers**: Current Candle Range > 1.5x ATR AND Volume > 2.0x 20-period Volume MA.

### 4. `VWAPReboundStrategy`
- **Focus**: Intraday institutional liquidity pullbacks.
- **Indicators**: Intraday VWAP, 9 EMA.
- **Triggers**: Price touches VWAP from above AND 9 EMA slope is positive (BUY dip).

---

## 🔄 Strategy Registry (`pkg/strategies/registry.go`)
- Maintains a thread-safe map of registered strategies: `map[string]Strategy`.
- Exposes `Register(strategy)`, `Get(name)`, `List()`, and `EvaluateAll(symbol, closes, volumes)`.

---

## 💻 CLI Integration
- `gelt strategies` — Lists all catalog strategies and descriptions.
- `gelt scan --strategy=<name>` — Screens watchlist using a specific strategy.
- `gelt scan --regime` — Evaluates market regime and runs the top strategy automatically.
