# Ticket ZAR-96: [Config] Hardcoded MCP Timeout (15min) in pkg/robinhood/mcp.go and Telemetry Symbol (SPY) in metrics.go

## Objective
Eliminate hardcoded values in `pkg/robinhood/mcp.go` and `pkg/server/metrics.go` by parameterizing them with the application configuration.

## Implementation Details

1. **AppConfig (`pkg/config/app_config.go`)**
   - Added `MCPTimeoutMins` (`int`, json `mcp_timeout_mins`) to `AppConfig`.
   - Updated `LoadAppConfig` and `InitUserConfig` to apply a fallback default value of 15 if unconfigured.

2. **Robinhood MCP (`pkg/robinhood/mcp.go`)**
   - Replaced hardcoded `15 * time.Minute` timeout in `AuthenticateInteractive` with `cfg.MCPTimeoutMins`.
   - Formatted the timeout error message to dynamically display the configured timeout duration.

3. **Telemetry Server (`pkg/server/server.go`, `pkg/server/metrics.go`)**
   - Updated `TelemetryServer` struct to maintain state of a loaded `metricSymbol`.
   - Populated `metricSymbol` during `NewTelemetryServer` initialization by dynamically loading the first symbol from `AppConfig.WatchSymbols` (falling back to "SPY" if unavailable or empty).
   - Removed the runtime `config.LoadAppConfig` dependency inside the high-frequency `handleMetrics` endpoint to maintain performance.
   - Refactored `s.activePlanEngine.EvaluateActive` to use the cached `s.metricSymbol`.

## Validation
- `go build ./...` passes successfully.
- `go test -race ./...` passes globally without regression.
