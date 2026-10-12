---
type: runbook
title: Operational Runbook - Epic 5 Live Brokerage
---

# Operational Runbook: Live Brokerage Sandbox Validation & Multi-Strategy Portfolio Rebalancing

## 1. Sandbox Deployment Procedures
- **Sandbox Environment:** Configure Gelt for sandbox mode by setting `IsSandbox=true` in `MCPConfig` within `pkg/robinhood/mcp.go`.
- **OAuth Management:** Ensure PKCE token managers are appropriately loaded and have valid authorization prior to submitting simulated test orders.
- **Dry-Run Sinks:** Sandbox order payload requests are captured and persisted using JSON-RPC dry-run logging via `ExecuteSandboxOrder`. All dry-run payloads are persisted locally in `gelt_journal.db`.

## 2. SQLite Telemetry Thread-Safety Guidelines
- **Single Connection Context:** SQLite database layer components in `pkg/telemetry` should only utilize a single dedicated connection pool as explicitly initialized by `store.NewStore()`.
- **Concurrency & Write-Locks:** Write locks to the SQLite journal MUST be isolated and sequenced. Do not allow multi-goroutine concurrent writes to the core feature tables without wrapping in `sync.RWMutex` locks, ensuring metrics inserts don't create `database is locked` runtime panics.

## 3. Multi-Strategy Rebalancer Monitoring Requirements
- **Available Capital Tracking:** Monitoring of total portfolio capital and sub-strategy available capital must be managed explicitly via `GetAvailableCapital()`, shielded by the PortfolioManager's `sync.RWMutex`.
- **Dynamic Weight Adjustments:** The PortfolioManager must listen to historical SQLite trade journal metrics to score active dynamic strategies, dynamically adjusting portfolio allocation weights without read-lock starvation.
- **Fail-Safe Integration:** The `FailSafe` monitor (`pkg/risk/failsafe.go`) counts consecutive failures across strategy evaluation. If it passes the configured threshold (e.g., 3 consecutive failures), it acts as an emergency circuit breaker, instantly halting the sandbox deployment and reverting all signal outputs to nil.
