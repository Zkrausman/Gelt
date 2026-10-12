# Package signals 📊

`pkg/signals` provides high-performance technical indicator calculations and multi-indicator confluence evaluation for Gelt.

```mermaid
graph TD
    PriceBars["Price Series / OHLCV Bars"] --> SMAEngine["SMA / EMA Calculation"]
    PriceBars --> RSIEngine["Wilder's RSI (14-period)"]
    PriceBars --> MACDEngine["MACD Line & Histogram (12, 26, 9)"]
    PriceBars --> BollingerEngine["Bollinger Bands (20, 2.0)"]

    SMAEngine --> ConfluenceEvaluator["EvaluateConfluence(symbol, closes)"]
    RSIEngine --> ConfluenceEvaluator
    MACDEngine --> ConfluenceEvaluator
    BollingerEngine --> ConfluenceEvaluator

    ConfluenceEvaluator --> ConfluenceSummary["ConfluenceSummary (Score 0-100 & Bias)"]
```

## Features

- **Calculations**: `SMA`, `EMA`, `RSI`, `MACD`, `BollingerBands`.
- **Confluence Scoring**: Evaluates 5 technical parameters to assign a 0.0–100.0 score and market bias (`BULLISH`, `NEUTRAL`, `BEARISH`).
- **Zero-Cost & Local Execution**: Sub-millisecond Go math without external paid API dependencies.
