# Gelt Operator Skill Package (`gelt-operator`)

Operational skill for running backtests, multi-strategy ensemble shadow engines, risk governance limits, macro matrix polling, and telemetry dashboards in the Gelt Trading Engine.

## Architecture

```mermaid
graph TD
    OperatorMD["skills/gelt-operator/SKILL.md"] --> CmdMain["cmd/gelt/main.go"]
    OperatorMD --> Scripts["skills/gelt-operator/scripts/"]
    OperatorMD --> References["skills/gelt-operator/references/"]
    OperatorMD --> Examples["skills/gelt-operator/examples/"]

    CmdMain --> EnsemblePkg["pkg/shadow/ensemble.go"]
    CmdMain --> BacktestPkg["pkg/backtest/backtest.go"]
    CmdMain --> RiskPkg["pkg/risk/risk.go"]
```

## Description
Provides CLI execution instructions and diagnostic workflows for Gelt trading engine operations.
