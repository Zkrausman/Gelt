# Gelt Pre-Market Health Diagnostics (`pkg/health`)

The `pkg/health` package provides pre-market health and latency diagnostic checks for Gelt, inspecting Robinhood MCP server reachability, OAuth token validity, and account status prior to market open.

## Architecture

```mermaid
graph TD
    CLI["cmd/gelt/main.go (gelt test-suite)"] --> Suite["pkg/health/diagnostic.go (RunPreMarketCheck)"]
    Suite --> MCP["MCP Server Reachability Ping"]
    Suite --> OAuth["OAuth Bearer Token Validation"]
    Suite --> Account["Account Health Inspection"]
    MCP --> Report["HealthReport (LatencyMs, CheckResults)"]
    OAuth --> Report
    Account --> Report
```

## Features

- **Pre-Market Diagnostics**: Runs automated health checks on MCP connection, authentication, and API latency.
- **Latency Monitoring**: Tracks millisecond round-trip response times to Robinhood trading servers.
- **Health Report Payload**: Returns structured `HealthReport` details for telemetry and CLI health dashboards.
