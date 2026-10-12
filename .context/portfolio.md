---
type: documentation
title: Portfolio Architecture
description: Overview of Gelt's Portfolio Manager, risk management, and capital allocation strategies.
timestamp: 2026-07-27T00:00:00Z
---

# Portfolio Architecture

The `pkg/portfolio` module orchestrates multiple trading strategies concurrently using goroutines, enforcing risk management and capital allocation boundaries.

## Key Concepts

- **Concurrent Execution**: Strategies are run concurrently using goroutines for fast evaluation of market data.
- **Signal Resolution**: The `PortfolioManager` resolves conflicting signals, always prioritizing `SELL` signals over `BUY` signals to minimize exposure and lock in capital.
- **Capital Budgeting**: Buy signals are constrained by available capital. The manager enforces limits based on strategy requirements (`CapitalRequirement()`) and current account values.
- **Trailing Stop Evaluation**: A dynamic trailing stop calculates high-water mark peak prices and triggers exit signals when a position drops by a specified percentage.
- **Pearson Asset Correlation**: Measures the return correlation between holdings to enforce diversification boundaries, preventing over-exposure to correlated assets.
