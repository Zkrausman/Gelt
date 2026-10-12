# Configurable Slippage & Spread Simulation Model

## Overview
To close the gap between shadow trading PnL and live trading PnL, Gelt implements a configurable slippage model into the shadow ensemble engine. This simulates real-world bid/ask spread and execution latency that varies by asset class.

## Asset Classes & Defaults
The `SlippageConfig` within `AppConfig` controls the slippage applied. The defaults are:

| Asset Class | Typical Spread | Config Field |
| --- | --- | --- |
| Crypto | 0.15% | `crypto_pct` (0.0015) |
| Equity | 0.03% | `equity_pct` (0.0003) |
| Options | 2.50% | `options_pct` (0.025) |

## Execution Mechanics
Slippage acts as a drag on both entries and exits, ensuring shadow trades accurately model live profitability.

- **On BUY / Entry**:
  - `FillPrice = MarketPrice * (1 + slippagePct)`
- **On SELL / Exit** (including Targets, Stop Losses, and EoD Sweeps):
  - `FillPrice = MarketPrice * (1 - slippagePct)`

The slippage effectively raises the break-even threshold. The specific `SlippageUSD` dollar drag is recorded continuously and incrementally within the `ShadowTrade` struct.

## Auditability
`ShadowTrade` separates the theoretical price from the actual fill price:
- **`MarketPrice`**: The raw last price from the Robinhood MCP at signal generation.
- **`FillPrice`**: The slippage-adjusted execution price (used for PnL).
- **`SlippagePct`**: The slippage rate applied.
- **`SlippageUSD`**: Dollar cost drag (`|FillPrice - MarketPrice| * Quantity`).
- **`SignalTime`**: Timestamp when the signal was issued.
