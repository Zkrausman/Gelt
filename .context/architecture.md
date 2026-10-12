---
type: Technical Architecture
title: Gelt System Architecture
description: Overview of the Gelt trading engine architecture, components, and design patterns.
timestamp: 2026-07-27T00:00:00Z
---

# Gelt System Architecture

## Overview

Gelt is an institutional-grade, zero-cost local algorithmic trading suite built in Go. It connects directly to live brokerage accounts via the official Robinhood Agentic Trading MCP Server.

## Key Components

- **CLI Engine (`cmd/gelt`)**: The entry point and command router.
- **Trading Plan Engine (`pkg/plans`)**: High-level ensemble tier combining weighted strategies.
- **Strategy Catalog (`pkg/strategies`)**: Modular quantitative strategy library.
- **Risk Governance (`pkg/risk`)**: Enforces position sizing caps, trade limits, and stop-loss rules.
- **Robinhood MCP Client (`pkg/robinhood`)**: Connects to the Robinhood Agentic Trading MCP Server.
- **Shadow Trading Engine (`pkg/shadow`)**: Parallel paper forward-testing engine.
- **Data & Macro Engine (`pkg/data`, `pkg/macro`)**: Ingests market and macroeconomic data.
- **Telemetry Server (`pkg/server`)**: Local dashboard and metrics server using embedded SQLite.

## Core Architectural Guardrails

- **Language:** Go 1.22+
- **Concurrency:** Use `sync.RWMutex` for all shared state.
- **Database:** Single embedded SQLite connection (`SetMaxOpenConns(1)`).
- **Offline Backtesting:** `pkg/backtest` must be strictly offline and deterministic, using `Engine` and `Result` structs.
- **Risk:** `DetectAnomaly` uses rolling Z-scores excluding the tested point. Circuit breakers downgrade `SignalBuy` to `SignalHold`.
- **Zero-Fake-Telemetry:** Telemetry must reflect actual database/logic state.
- **UI:** Web dashboard templates use `go:embed`.
