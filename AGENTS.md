---
type: AI Instructions
title: Agentic Rules and Guardrails
description: Core rules, constraints, and instructions for AI agents interacting with the Gelt codebase.
timestamp: 2026-07-27T00:00:00Z
---

# Agent Instructions

Welcome to the Gelt Trading Engine repository. This document provides core architectural constraints and engineering guardrails for AI coding assistants and autonomous agents interacting with this codebase.

## 1. Core Language & Tooling
*   **Go Version:** This is a Go-based project requiring **Go 1.22 or newer**.
*   **Testing:** Use `go test ./...` for standard tests. Use `./gelt.exe test-suite` for integrated test suites.
*   **Execution Environment:** Autonomous agents run in a cloud VM where the repository is cloned directly into the `/app` directory. All relative paths and tests must assume `/app` as the root working directory.

## 2. Concurrency & State Management
*   **Thread-Safe Metrics & Caching:** All shared state, particularly metrics injection and cached data (e.g., in `pkg/data` and `pkg/macro`), must be protected using `sync.RWMutex`.
*   **Database:** The telemetry server maintains a single embedded SQLite database connection (`SetMaxOpenConns(1)`) initialized via the `DB_PATH` environment variable. Do not create new connection pools per request.

## 3. Telemetry & Web Dashboard Guardrails
*   **Zero-Fake-Telemetry Rule:** Never mock telemetry data in production. Telemetry metrics must reflect the actual database/logic state.
*   **Frontend Constraints:** Web dashboard templates use `go:embed`. DOM elements require specific IDs (`broker-status`, `buying-power`, `latency`, `vix-level`, `regime-status`, `daily-cap`, `shadow-pnl`, `shadow-winrate`) to allow decoupled JavaScript polling.
*   **Standard Telemetry Only:** Local logging daemons (like Thneed) are completely deprecated. All services must use Go's native `log/slog` package configured to output structured JSON to `os.Stdout`.

## 4. Backtesting Constraints
*   **100% Offline & Deterministic:** The `pkg/backtest` module must be strictly 100% offline and deterministic.
*   **No Live Execution:** `pkg/backtest` must **never** initiate network calls to the Robinhood MCP or attempt live broker execution.
*   **Struct Definitions:** The backtest engine uses an `Engine` struct (not `BacktestRunner`) returning a `Result` struct with performance metrics (NetPnL, WinRate, MaxDrawdownPct). *(Note: older files may still refer to BacktestRunner; do not rewrite them randomly unless fixing a direct bug)*.

## 5. Security & Risk
*   **Anomaly Guard:** The `DetectAnomaly` in `pkg/risk` uses rolling Z-scores. Do not include the tested point in the window calculation.
*   **Circuit Breakers:** `SignalBuy` requests are automatically downgraded to `SignalHold` when portfolio drawdown exceeds thresholds, while `SignalSell` requests continue to permit liquidation.

## 6. PR & Documentation Conventions
*   **Specification Reports:** When implementing new features, write a full specification and completion report in `docs/specs/`.
*   **Title Formats:**
    *   `🧹 [description]` for code health. Sections: 🎯 What, 💡 Why, ✅ Verification, ✨ Result.
    *   `⚡ [description]` for performance. Sections: 💡 What, 🎯 Why, 📊 Measured Improvement.
    *   `🔒 [description]` for security. Sections: 🎯 What, ⚠️ Risk, 🛡️ Solution.

## Verification & Pre-PR Requirements

*   **Race-Enabled Tests:** Every task and pull request must pass `go test -race ./...` with no test failures or detected data races before submission.
*   **Mandatory Self-Review:** Review the complete diff against these trading, risk, backtest, telemetry, test, and documentation guardrails before submission. Every unresolved finding is a shipping blocker.
*   **Specification Update:** Every implementation pull request must update its applicable specification in `docs/specs/` with valid YAML frontmatter, implemented behavior, changed files, and verification evidence.
*   **Closed-Loop Correction:** Inspect complete terminal output and exit statuses from required checks. Treat each failure as actionable feedback: fix the root cause and rerun the failed verification until it passes cleanly.

## Context Linking

-   See [Architecture](.context/architecture.md) for system design details.
-   See [Product](.context/product.md) for product goals and features.

## ZAR-213 additive V2 supplement (2026-09-18)

The rules above continue to govern all V1 Go code; Go 1.26.1 build/race/vet CI
is preserved. V2 alone uses Node 22/TypeScript, Next.js/React `v2/web`, upstream
market/analysis `v2/server` and separate non-executing `v2/worker`. This approved
supplement does not migrate or erase V1 language/telemetry/concurrency policy.
Use repository-relative paths (the Squire worktree is `/ticket/workspace`), not
an assumed host `/app`, for these additive checks. Install via the retained
`v2/package-lock.json`; run V2 unit tests/build/offline smoke alongside Go checks.
See `docs/specs/ZAR-213-V2-Baseline.md` and `v2/README.md` for the precise commands.

Market/analysis data is not broker execution truth. Future worker alone owns the
execution ledger; UI/BFF is not execution authority. No generic MCP proxy or V1
order fallback. Exact decimals, explicit user confirmation, fee-inclusive ≤$10,
fail-closed unknown outcomes/manual reconciliation and protected-route
session/Origin/Host/CSRF controls are downstream requirements, not M2 features.
Keep M2 local-only and disabled; do not introduce provider/broker credentials,
order routes, deployment activation or fabricated telemetry. Never treat optional
upstream AI/portfolio API-key controls as execution security.

## ZAR-215 durable execution ledger constraints

M4 uses one lifecycle-owned worker `better-sqlite3` connection, explicit separate
private provisioning, WAL/FULL and a persistent non-stealable writer marker. No
public ledger write route, dispatcher, provider invocation or order state machine.
Monetary values are bounded exact decimal strings, never JS/SQLite floating point.
Requested order values must never stand in for actual observed executions/fees.
Every read and append must use transaction-local canonical/relational replay of
stored facts and compare the persisted projection; neither cached projections nor
schema-only timeline decoding are safe. Corruption/uncertain persistence poisons
the handle and retains ownership. See `v2/LEDGER-API.md` and
`v2/LEDGER-OPERATIONS.md`; preserve all M3 security and native Windows tests.
