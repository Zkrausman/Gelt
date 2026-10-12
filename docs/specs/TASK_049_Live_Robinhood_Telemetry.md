---
type: specification
title: TASK_049: Live Robinhood Account Telemetry Hydration
---

# TASK_049: Live Robinhood Account Telemetry Hydration

## Objective
Replace placeholder dashboard telemetry data with account data queried dynamically from the configured Robinhood MCP client (including the configured balance, buying power, and active positions). Any examples in this specification must use clearly synthetic fixture values.

## Execution Details

1. **Created `pkg/broker/telemetry.go`:**
   - Implemented `GetAccountTelemetry(cfg *robinhood.MCPConfig) (*AccountTelemetry, error)` which calls the Robinhood MCP via `tools/call` for the `get_account` method.
   - It parses `total_equity`, `cash_buying_power`, and `positions` from the JSON-RPC response.
   - Created robust JSON type parsing using type switches to handle either string or float64 responses safely.

2. **Updated `pkg/server/server.go`:**
   - Modified `handleRisk` to query the new `broker.GetAccountTelemetry(cfg)` function instead of relying entirely on mocked response maps.
   - Dynamically mapped the live Robinhood positions into the `"active_positions"` field returned by `/api/v1/risk`.
   - Preserved fallback structure if the MCP configuration fails to load.

3. **Frontend DOM Verification in `web/static/app.js`:**
   - Updated `fetchRisk()` to clear and populate the `<tbody id="positions-body">` element with live active positions from `data.active_positions`.
   - Used appropriate formatting (color mapping for Unrealized PnL).
   - Iterated all HTML themes to inject `id="positions-body"` so `app.js` can correctly locate and overwrite the mocked rows with live values.

4. **Testing and Verification:**
   - Added `TestGetAccountTelemetry` mock server unit test in `pkg/broker/telemetry_test.go` to simulate live broker responses and ensure telemetry serialization occurs seamlessly.
   - Ran `go test -race ./...` which successfully passed across all packages.
