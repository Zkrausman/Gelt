---
ticket_id: ZAR-124
title: Replace hard-coded telemetry baseline symbol and ATR multipliers with validated AppConfig values
status: completed
changed_files:
  - pkg/server/server.go
  - pkg/server/metrics.go
  - pkg/server/server_test.go
  - pkg/server/ui_test.go
  - pkg/server/web/static/app.js
  - pkg/server/web/theme_blueprint.html
  - pkg/server/web/theme_cyberpunk.html
  - pkg/server/web/theme_glass.html
  - pkg/server/web/theme_retro.html
  - pkg/plans/plan.go
  - pkg/plans/plans_test.go
---

# ZAR-124: Runtime Configuration Consolidation

## Implemented Behavior
1. **Telemetry & Server**:
   - `NewTelemetryServer` no longer defaults `metricSymbol` to `SPY` if `WatchSymbols` is empty; it accurately sets it to `""`.
   - The `/api/v1/features/query` endpoint returns a `400 Bad Request` with `CONFIG_INVALID` status if no explicit `key` is supplied and no default watch symbols exist.
   - The `/api/v1/metrics` endpoint similarly audits for an empty `metricSymbol`, returning `CONFIG_INVALID` without attempting to evaluate active plans or fabricating metrics.
2. **UI & Presentation**:
   - The `app.js` frontend intercepts the `CONFIG_INVALID` response from `/api/v1/metrics` to toggle a degraded visual state.
   - The frontend themes correctly render the "CONFIGURATION INVALID - DEGRADED MODE" banner when this mode is active.
   - The word "SYNTHETIC" is strictly avoided, and all standard DOM IDs are preserved perfectly to keep dashboards functioning.
3. **ATR Validation**:
   - `BasePlan.Init()` validates explicitly supplied `atr_stop_multiplier` and `atr_target_multiplier` overrides dynamically provided via `StrategyConfig`.
   - Values `<= 0` are firmly rejected via a hard initialization error.
   - Documented behavior for absent `config.json` files remains preserved (`ErrConfigNotFound` correctly ignored).

## Migration Behavior
Users operating with legacy empty `WatchSymbols` who previously relied on the system silently rendering `SPY` will now encounter the explicit `CONFIGURATION INVALID - DEGRADED MODE` banner across the UI. This visual breaking change enforces the mandate that invalid or missing telemetry configurations must fail visibly, never faking a live trading feed. To dismiss this banner, users must simply provide a valid `WatchSymbols` array in their `config.json`.

## Verification Commands & Results
All tests enforce strict `$HOME` filesystem isolation ensuring offline execution stability.
```bash
go test -race ./pkg/config/... ./pkg/plans/... ./pkg/server/...
# Output: ok (No data races detected)

go test -race ./...
# Output: ok (All core packages pass)
```
