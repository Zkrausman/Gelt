# Package portfolio 📈

`pkg/portfolio` provides trailing stop evaluation, asset correlation analysis, and dynamic risk management for Gelt.

```mermaid
graph TD
    PositionData["Position (Entry, Peak, Current Price)"] --> TrailingStopEngine["CheckTrailingStop(Position, StopLossPct)"]
    PriceReturns["Multi-Asset Price Return Series"] --> CorrelationEngine["CalculatePearsonCorrelation(returnsA, returnsB)"]

    TrailingStopEngine --> ExitSignal["ExitSignal (ShouldExit, Reason, PnLPct)"]
    CorrelationEngine --> CorrelationMatrix["Asset Correlation Matrix (-1.0 to 1.0)"]
```

## Features

- **Dynamic Trailing Stop**: Calculates high-water mark peak price and triggers exit signals on percentage drops.
- **Pearson Asset Correlation**: Measures return correlation between holdings to enforce diversification boundaries.
- **Zero-Cost Local Computation**: Ultra-fast Go mathematical evaluation.
