# Gelt Strategy Catalog (`pkg/strategies`)

The `pkg/strategies` package implements Gelt's quantitative Strategy Catalog, Strategy Interface, and dynamic Strategy Registry.

## Architecture

```mermaid
graph TD
    CLI["cmd/gelt/main.go"] --> Reg["pkg/strategies/registry.go"]
    Reg --> S1["pkg/strategies/trend_confluence.go"]
    Reg --> S2["pkg/strategies/mean_reversion.go"]
    Reg --> S3["pkg/strategies/breakout_vol.go"]
    Reg --> S4["pkg/strategies/vwap_rebound.go"]
    S1 --> Sig["pkg/signals/indicators.go"]
    S2 --> Sig
    S3 --> Sig
    S4 --> Sig
```

## Available Strategies

1. **`TrendConfluence`**: Multi-indicator momentum strategy combining 20/50 EMA, MACD, and RSI levels.
2. **`MeanReversion`**: Oversold bounce strategy combining 20-period Bollinger Bands and RSI < 35.
3. **`BreakoutVol`**: Volatility expansion breakout strategy confirmed by >1.25x ATR range expansion.
4. **`VWAPRebound`**: Intraday institutional support pullback rebound strategy.
   - **Opt-in Trend Filter (`EnableTrendFilter`)**: Optional EMA 20/50 Macro Trend Alignment Gate (`.WithTrendFilter(true)`). Rejects `SignalBuy` if price < 20 EMA or 20 EMA < 50 EMA.
   - **Configurable Thresholds**: `MinDiffPct` (default `-0.2%`), `MaxDiffPct` (default `+0.3%`), `EMAFastPeriod` (20), `EMASlowPeriod` (50).
