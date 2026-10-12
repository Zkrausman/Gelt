---
title: "[GELT-156] User-Level Config Binder for Strategy Parameters & Indicator Thresholds"
status: "Approved"
date: "2026-08-03"
author: "Lead Technical Product Manager & Principal Architecture Engineer"
linear_issue_id: "ZAR-86"
linear_issue_url: "https://linear.app/geltagentictrading/issue/ZAR-86/gelt-156-user-level-config-binder-for-strategy-parameters-and"
git_branch: "zkrausman/zar-86-gelt-156-user-level-config-binder-for-strategy-parameters"
---

# [GELT-156] User-Level Config Binder for Strategy Parameters & Indicator Thresholds

## 1. Objective

Bind all strategy indicator parameters and threshold options (`MeanReversion`, `BreakoutVol`, `TrendConfluence`, `VWAPRebound`) directly to user-level configuration files (`~/.gelt/config.json` and trading plan YAML files) to ensure 100% user-level configurability.

---

## 2. Scope & Target Packages

- **`pkg/config/app_config.go`**: Add `StrategyConfig` map to `AppConfig` struct allowing per-strategy configuration parameters loaded from `~/.gelt/config.json`.
- **`pkg/strategies/`**: Update `MeanReversionStrategy`, `BreakoutVolStrategy`, `TrendConfluenceStrategy`, and `VWAPReboundStrategy` to expose configurable parameter fields with sensible defaults.
- **`pkg/plans/`**: Allow plan YAML configurations to specify custom strategy thresholds under the `strategies` list.

---

## 3. Detailed Acceptance Criteria

1. **User Configuration Binding**:
   - `~/.gelt/config.json` parses strategy-specific overrides under `"strategies"`.
2. **Strategy Field Expansion**:
   - `MeanReversionStrategy`: `RSIOversold`, `RSIOverbought`, `BollingerPeriod`, `BollingerStdDev`.
   - `BreakoutVolStrategy`: `ATRExpansionMultiplier`, `ATRPeriod`.
   - `TrendConfluenceStrategy`: `BuyScoreThreshold`, `SellScoreThreshold`.
3. **Verification**:
   - `go test -race ./pkg/config/... ./pkg/strategies/... ./pkg/plans/...` passes with custom configured values.
