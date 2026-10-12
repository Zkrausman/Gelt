---
type: specification
title: TASK_020_REV: Live Stitch Dashboard & Telemetry API
---

# TASK_020_REV: Live Stitch Dashboard & Telemetry API

## Overview
Replaced the basic mock dashboard generated initially with the professional "Gelt Institutional Trading Terminal" design obtained directly via the Google Stitch MCP. Hooked it up to live backend polling routes pulling data actively from core quantitative and governance modules.

## Architecture

### 1. Web Asset Generation (Stitch MCP)
- Listed projects to find "Gelt Institutional Trading Terminal" (`projects/17435972004047149109`).
- Extracted the HTML representation of the "Gelt Terminal Dashboard" screen.
- Saved into `pkg/server/web/index.html` (embedded via `go:embed`).
- Injected generic DOM walking logic in vanilla JavaScript to overwrite templated text nodes with live API values securely without manipulating layout bounds.

### 2. Live Telemetry API (`pkg/server/server.go`)
Refactored the initial mock endpoints to instantiate live connections with other Gelt packages.

**Endpoints:**
- `GET /api/v1/health`
  - Leverages `health.RunPreMarketCheck` utilizing the local Robinhood MCP configuration to get real ping times, OAuth validity, and BP status.
- `GET /api/v1/regime`
  - Leverages `regime.EvaluateRegime` using simulated recent close prices (configurable in the future) to output true VIX estimates, EMA slopes, and structural regime detection (High Volatility vs Normal).
- `GET /api/v1/risk`
  - Queries `risk.DefaultRiskLimits` to populate active equity allocation caps, stop losses, and trailing ATR triggers.
- `GET /api/v1/shadow`
  - Instantiates `shadow.DefaultStore()` and generates real comparative metrics for the active strategy vs historical paper trades (win rate, gross PnL).

### 3. Asynchronous Operation
- Starts concurrently on `127.0.0.1:8085` using `StartAsync()` via the `gelt dashboard` (or `serve`) command.
- Will not block quantitative routines in future deployments.

## Testing
Unit tests in `server_test.go` have been patched to account for the new `/regime` endpoint. Entire test suite (`go test -v -race ./...`) passes cleanly.
