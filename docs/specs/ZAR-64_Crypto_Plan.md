# Architecture Decision Record: Crypto Risk Governance & Plan Isolation (ZAR-64)

## Context
Standard equity strategies in Gelt (e.g. `BreakoutVol`, `MeanReversion`) use tight intraday ATR multipliers (0.4x - 0.5x ATR, yielding ~0.5% - 1.0% stop-loss). Digital assets exhibit higher intraday noise. A tight 0.5% stop-loss causes crypto positions to be prematurely stopped out during normal intraday noise. Additionally, crypto markets run 24/7, meaning the 15:50 ET intraday liquidation sweep designed for equities should not apply to crypto positions.

## Decision
1.  **CryptoPlan implementation**: A new trading plan `CryptoPlan` is introduced. It wraps `BasePlan` and applies a volatility expansion multiplier (`VolMultiplier`) to the `StopLossPct` and `TargetPct`.
2.  **Volatility Bound Scaling**: The multiplier is set to `1.75`. The constraint scales the ATR stop-loss and target bounds for crypto volatility:
    $$StopLoss_{crypto} = StopLoss_{base} \times 1.75$$
    $$TargetPct_{crypto} = TargetPct_{base} \times 1.75$$
3.  **Pre-Close Sweep Bypass**: The shadow trading execution engine (`EnsembleEngine`) has been updated to bypass the 15:50 ET long entry block for signals that carry the `AssetCrypto` tag.
4.  **End-of-Day Sweep Bypass**: The `EnsembleEngine` has been updated to bypass the 16:00 ET End-of-Day force-close for trades executing under the `CryptoPlan`.
5.  **AssetClass Propagation**: The evaluation flow from `Strategy` -> `BasePlan` -> `EnsembleSignal` now explicitly propagates the `AssetClass` string parameter to ensure proper categorization by downstream engines.

## Consequences
- Crypto signals will no longer be artificially rejected at 15:50 ET.
- Crypto open positions will no longer be artificially liquidated at 16:00 ET.
- Crypto paper trades will use mathematically wider stop losses derived from the underlying asset's ATR, preventing false-positive stop-outs.
