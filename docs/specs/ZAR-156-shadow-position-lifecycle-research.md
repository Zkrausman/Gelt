---
ticket_id: ZAR-156
title: Shadow position lifecycle research
type: research
status: completed
timestamp: 2026-08-10T00:00:00Z
source_session: sessions/2830514775955865411
---

# ZAR-156: Shadow Position Lifecycle Research

## Scope

This read-only audit covers signal intake, paper-position creation, mark-to-market, closure, journal persistence, daemon lifecycle, and telemetry. It makes no runtime change.

## Findings

1. **Capital can be over-allocated (high).** `pkg/shadow/ensemble.go:475-481` derives a position quantity from a fixed allocation but does not reserve portfolio cash. Repeated entries can exceed the intended aggregate shadow capital, distorting PnL and VaR.
2. **Synthetic fallback can create false volatility (high).** `pkg/shadow/ensemble.go:173-184` and `648-659` fall back to a synthetic random walk when market data is unavailable. A static re-anchor each cycle can create fictitious stop/target exits. Per Gelt's zero-fake-telemetry rule, the preferred remediation is explicit degraded/fail-closed shadow telemetry rather than presenting synthetic results as live.
3. **Store updates are vulnerable to lost writes (medium).** `pkg/shadow/shadow.go:132-140` and `243-255` separate load, mutation, and save across lock scopes. Concurrent append/update paths can overwrite one another.
4. **The engine is long-only (medium).** `pkg/shadow/ensemble.go:362-368` and `509-532` use long-only PnL and stop/target semantics; `SELL` closes an existing position rather than opening a short. This is a product decision, not an automatic parity requirement.
5. **Session mode can stop crypto monitoring at 16:00 ET (medium).** `pkg/shadow/ensemble.go:565-595` returns after the equity close workflow, even when crypto positions remain open.
6. **Telemetry omits portfolio state (low).** `pkg/shadow/daemon.go:214-231` emits cycle results but not open positions, mark-to-market PnL, or available capital.

## Recommended Delivery Order

1. Make market-data provenance explicit and fail closed/degraded when authenticated data is unavailable; add an injected deterministic market-data provider for tests.
2. Make store mutations atomic under one write lock and prove this with race-enabled concurrent tests.
3. Add a `PortfolioState` that reserves capital before shadow entries and restores it on closure.
4. Decide explicitly whether short simulation is a supported product capability before implementing it.
5. Separate equity session scheduling from continuous crypto monitoring.
6. Extend shadow telemetry with open positions, portfolio value, available capital, and data-provenance/degraded status.

## Deterministic Verification

- Inject deterministic price streams and a controlled clock.
- Use `t.TempDir()` journal stores.
- Run `go test -race ./pkg/shadow/...` for concurrent store and portfolio-state paths.
- Assert no synthetic/degraded input is labeled live, removed-universe symbols with open positions remain monitored, and no path initiates a broker order.

## Open Decisions

- Whether shadow trading should model short positions.
- The maximum acceptable portfolio and symbol-universe limits.
- The desired overnight policy for crypto when equity session mode is selected.
