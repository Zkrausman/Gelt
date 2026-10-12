---
type: documentation
title: Telemetry Architecture
description: Overview of the Gelt unified telemetry interface, global registry, and backend integrations.
timestamp: 2026-07-27T00:00:00Z
---

# Telemetry Architecture

The `pkg/telemetry` package provides a unified telemetry and logging interface for the Gelt trading engine, decoupling core logic from hardcoded logging dependencies.

## Key Concepts

- **Unified Interface**: The `TelemetryLogger` interface defines standard methods (`Log`, `LogTrade`, `Flush`) used across the application.
- **Global Registry**: A thread-safe global registry allows any component to access the active logger using `telemetry.GetLogger()`.
- **Default `slog` Backend**: By default, an `slog` backend (`SlogBackend`) is active, outputting structured JSON to `os.Stdout`.
- **ThneedLogger Integration**: An optional `ThneedLogger` backend can be activated using the `GELT_TELEMETRY_BACKEND=thneed` environment variable. This backend delegates to `pkg/thesis` to format trade events as self-documenting RATIONALE and EVIDENCE blocks.
