# Gelt Equity Risk Governance Engine (`pkg/risk`)

The `pkg/risk` package provides position sizing validation, adaptive asset guardrails, daily loss caps, and pre-close window detection for Gelt.

## Architecture

```mermaid
graph TD
    CLI["cmd/gelt/main.go"] --> Risk["pkg/risk/risk.go (RiskLimits)"]
    Order["Order Request ($USD Notional)"] --> Validate["ValidateTrade"]
    Risk --> Validate
    Adaptive["GetAdaptiveRiskGuardrails (SPY/QQQ/TSLA)"] --> Profile["AssetRiskProfile"]
    Validate --> Pass["Approved Order"]
    Validate --> Fail["Risk Violation Rejection"]
```

## Features

- **Adaptive Guardrails**: Tailors intraday stop-loss and profit target percentages based on asset class volatility (e.g. SPY: 0.35% / 0.70%, TSLA/NVDA: 1.50% / 3.00%).
- **Account Scaling**: Calibrates trade size and daily loss limits between production accounts and $50 paper test accounts.
- **Pre-Close Execution Window**: Detects 3:50 PM - 3:59 PM ET intraday exit windows.
