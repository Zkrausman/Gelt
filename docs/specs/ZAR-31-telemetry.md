---
type: spec
title: GELT-101 Genericize Gelt Telemetry
---

# ZAR-31: Genericize Gelt Telemetry & Implement Default slog Backend

## Problem Context
Decouple core logging from local daemons by abstracting trade logging and error handling into a unified telemetry interface. The previous codebase used `fmt.Printf` for logging, which wasn't structured and created tight coupling.

## Implementation Details
1. **Core Structs / Interfaces**: Developed `TelemetryLogger` interface with methods `Log`, `LogTrade`, and `Flush`. Added `SlogBackend` that outputs structured JSON logging to `os.Stdout`.
2. **Logic Flow**: Replaced hardcoded `fmt.Printf` and `fmt.Println` logging statements with `telemetry.GetLogger().Log()` calls across `cmd/gelt/main.go`, `pkg/robinhood/mcp.go`, `pkg/server/server.go`, and `pkg/plans/registry.go`.
3. **API / CLI Surface**: Enabled zero local daemon requirement for tests.
4. **Testing**: Implemented 100% test coverage for the `pkg/telemetry` package verifying the JSON structure of `Log` and `LogTrade` methods and proper parsing of severities.

## Validation
- `go test ./...` passes locally.
- Clean binary compilation confirmed.
