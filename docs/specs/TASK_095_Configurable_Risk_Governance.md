---
title: Configurable Risk Governance Guardrails
ticket: ZAR-95
status: Completed
type: ADR & OKF Specification
---

# ZAR-95: Configurable Risk Governance Defaults

## Architectural Decision Record (ADR)
Previously, the `pkg/risk` module hardcoded all risk parameters (`MaxPositionPct`, `DefaultStopLossPct`, and `AssetRiskProfile.StopLossPct`) dynamically assigned per symbol. This required a recompile for users to adjust risk thresholds.

To address this, the `RiskConfig` struct was added to `AppConfig`, exposing `max_position_pct`, `default_stop_loss_pct`, and `per_symbol_stop_loss`. These values are now optionally injected into `risk.DefaultRiskLimits`, `risk.TestAccountRiskLimits`, and `risk.GetAdaptiveRiskGuardrails` while maintaining strict fallback behavior if the values are omitted from `config.json`.

Thread safety: Configuration reads load static structs during the initiation phase of the engine execution sequence, which poses no race condition issues. Backtesting loops dynamically cache the risk configuration before execution loops to minimize filesystem I/O locks and performance hits.

## Mathematical Constraints
Risk sizing mathematically evaluates position impact to enforce the following limits:
1. $Position Size \% = \left(\frac{Trade Amount}{Total Portfolio Capital}\right) \times 100$
2. Constraint: $Position Size \% \le Config.MaxPositionPct$
3. Target Stop Loss Thresholds: $P_{Exit} = P_{Entry} \times \left(1 - \frac{Config.StopLossPct}{100}\right)$

## OKF Verification
- Replaced static defaults with overrides derived from `config.json`.
- `gelt risk` command parses and outputs current dynamic variables.
- System passes `go test -race ./...` after replacing Windows syscalls for PID validation to fix cross-platform compilation issues.
