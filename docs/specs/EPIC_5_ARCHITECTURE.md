---
type: spec
title: "Epic 5: Live Brokerage Sandbox Validation & Multi-Strategy Portfolio Rebalancing"
---

# Architectural Dependency Graph & Briefing Note

## Blocker Tree
- **Ticket ZAR-47:** Broker Sandbox Integration (Hard Prerequisite / Blocker)
  - Must complete before Ticket ZAR-48 and Ticket ZAR-49.
- **Ticket ZAR-48:** Dynamic Portfolio Rebalancing
  - Blocked by Ticket ZAR-47.
  - Must complete before Ticket ZAR-50.
- **Ticket ZAR-49:** Fail-Safe Integration Drills
  - Blocked by Ticket ZAR-47.
  - Must complete before Ticket ZAR-50.
- **Ticket ZAR-50:** Operational Runbook
  - Blocked by Ticket ZAR-48 and Ticket ZAR-49.

## Briefing Note
**State-Propagation Pathways Across Broker Boundaries:**
The execution path originates from the OAuth PKCE token manager (`pkg/robinhood/mcp.go`), authenticating with the sandbox. Order execution payloads are formatted and routed to the `TelemetryServer` for dry-run JSON-RPC logging without real capital execution. The `PortfolioManager` (`pkg/portfolio/manager.go`) coordinates concurrent strategy evaluations, applying weight adjustments by consuming real-time metrics from the SQLite trade journal (`gelt_journal.db`).

**Thread-Safety Invariants for Dry-Run JSON-RPC Logging:**
To avoid write-lock bottlenecks during concurrent multi-strategy evaluation, the `TelemetryServer` strictly enforces a single-connection rule (`SetMaxOpenConns(1)`) to the SQLite database. Goroutines in `PortfolioManager` use `sync.RWMutex` to protect the unexported `availableCapital` state, ensuring safe reads and preventing race conditions while SQLite handles concurrent read/write isolation sequentially via the single connection constraint.
