---
type: "specification"
title: "Broker Sandbox Integration"
status: "completed"
dependencies: []
---

# ZAR-47: Broker Sandbox Integration

## Context
We need to implement an OAuth PKCE token manager for Robinhood/Tradier sandbox environments and establish dry-run telemetry execution pathways to avoid real capital deployment.

## Architectural Decision Record (ADR)
- **Problem**: Live automated trading carries risk of runaway errors deploying real capital if logic goes awry. The system requires a mechanism to test trading strategies against live market data while recording executions in a sandbox database instead of routing them to a real broker.
- **Solution**: Implement `IsSandbox` flag within the `MCPConfig` struct. Create `ExecuteSandboxOrder` function which mocks Robinhood order IDs and fill prices. It records a dry-run payload directly into the `gelt_journal.db` via `store.Store.InsertTrade()`.
- **Trade-offs**:
    - **Pros**: Zero-risk execution environment for validating new strategies. No API rate limits for order submission.
    - **Cons**: Fill prices are idealized, lacking real-world slippage and spread assumptions.
- **Thread Safety**: `store.Store.InsertTrade` uses a `sync.WaitGroup` and executes asynchronously via a new goroutine to insert records into the local SQLite database. SQLite open connections are limited to 1 in `store.NewStore` to prevent `database is locked` race conditions. Thus, calling `ExecuteSandboxOrder` from multiple parallel strategies is thread-safe.
- **Mathematical Constraint**: $SR = \frac{\mu - R_f}{\sigma}$. The sandbox must record expected portfolio variance ($\sigma$) effectively by persisting simulated executions to correctly analyze the sandbox Sharpe Ratio before transitioning a strategy to live money.

## Acceptance Criteria
- Verified `go test -race ./pkg/robinhood/...` passes.
- Dry-run payloads write successfully to `gelt_journal.db` via the testing environment's memory database.

## System Impact
The `pkg/robinhood` package is updated to natively support dry-runs without making HTTP POST calls to the real agent broker endpoints.
