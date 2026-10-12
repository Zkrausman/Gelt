---
ticket_id: ZAR-182
title: Runtime configuration consolidation research
type: research
status: completed
timestamp: 2026-08-10T00:00:00Z
source_session: sessions/10415893150370639643
related_tickets: [ZAR-124, ZAR-133, ZAR-135, ZAR-136, ZAR-138, ZAR-159, ZAR-160]
---

# Runtime Configuration Consolidation Research

## Goal

Make `pkg/config/app_config.go` the typed source of truth for runtime configuration. Operational code must receive validated configuration or safely refuse/degrade; it must not silently choose unrelated symbols, capital, strategies, or live-looking telemetry.

## Inventory

- `pkg/server/server.go:49-50` and `237` fall back to `SPY` / `Equity.SPY` when the configured watchlist cannot be used.
- `pkg/robinhood/mcp.go:495`, `pkg/data/x_api.go`, `pkg/data/reddit.go`, and `pkg/macro/macro.go` contain divergent request-timeout handling.
- `pkg/plans/plan.go` can swallow configuration-load errors and restore hard-coded buy/sell thresholds.
- Strategy implementations retain local score and ATR defaults.
- `pkg/shadow/get_initial_balance.go`, `pkg/shadow/evaluator.go`, and `pkg/shadow/promotion_engine.go` retain `$10,000`/Monte-Carlo fallback values.
- `pkg/risk/risk.go` has symbol-specific risk fallback behavior that only partially honors configured per-symbol overrides.

## Validated Policy

1. **Ownership:** `AppConfig` owns defaults, validation, and documented precedence. Runtime packages receive validated config or a narrow typed dependency rather than reloading config ad hoc.
2. **Precedence:** explicit approved plan parameter → validated `AppConfig` → conservative fail-closed/degraded behavior. Do not use a default `SPY`, `$10,000`, arbitrary strategy, or synthetic source as a substitute for unavailable required runtime configuration.
3. **Validation:** validate numeric ranges, symbol lists, capital, timeout bounds, promotion/risk gates, and fallback strategy lists during initialization.
4. **Telemetry:** configuration/data-source failure must be observable and must not be described as live shadow performance.

## Non-Conflicting Migration Sequence

1. Centralize schema/default validation in `pkg/config` and add exhaustive config tests.
2. Wire plan thresholds and shadow capital/Monte-Carlo parameters through explicit typed configuration.
3. Remove server/UI symbol fallbacks; render a safe degraded state for an empty or invalid watchlist.
4. Make risk-guardrail and ATR policies use validated configured overrides.
5. Consolidate provider/MCP timeout policy without broad provider behavior changes.

## Deterministic Verification

- Config parser tests for invalid bounds and missing required configuration.
- Shadow tests that inject explicit capital and Monte-Carlo values.
- Risk tests proving per-symbol configuration wins over legacy branches.
- Server/UI tests proving an empty watchlist never presents `SPY` or live data by default.
- `go test -race ./...` after each isolated implementation PR.

## Open Decisions

- Which values are optional safe defaults versus required fail-closed inputs.
- Whether timeout policy is global or provider-specific.
- The compatibility/migration policy for existing user configuration files.
