---
type: spec
ticket: ZAR-89
title: "Fix Monte Carlo VaR Denominator Hardcoding"
status: implemented
---

## Objective
Remove the hardcoded `$10,000` capital denominator used for Value at Risk (VaR) calculations across the Shadow Evaluator, Shadow Promotion Engine, and Monte Carlo simulator, and replace it with dynamic capital values fetched from `AppConfig`.

## ADR
- Modified `RunSimulation` in `pkg/shadow/monte_carlo.go` to accept an `initialBalance` float64 parameter.
- Modified callers in `pkg/shadow/evaluator.go` (`PromotionEvaluator.EvaluateAt` and `ShadowPerformanceEvaluator.EvaluatePlan`) and `pkg/shadow/promotion_engine.go` to dynamically load `AppConfig.TotalCapitalUSD`. If `AppConfig` cannot be loaded or is `<= 0`, the fallback logic will use the standard `10000.0` value.
- Re-ran tests across the entire codebase.

## Constraints
$$ VaR\% = \frac{| VaR_{drawdown} |}{TotalCapitalUSD} \times 100 $$
The calculation accurately represents the 5th percentile worst-case risk against actual user capital, ensuring VaR constraints (e.g. `< 5%`) properly gate strategies.
