---
type: spec
title: "[Daemon] Background Shadow Trading Service & Robinhood Telemetry Sync"
ticket: ZAR-54
status: implemented
---

# ZAR-54: Background Shadow Trading Service & Robinhood Telemetry Sync

## Overview
Gelt requires a background daemon service (`gelt shadow daemon`) to run the shadow trading engine continuously during Regular Trading Hours (RTH) without blocking the foreground process. This daemon executes a scheduled ticker to scan live Robinhood security feeds, update the paper trade store (`~/.gemini/gelt_shadow_journal.json`), and synchronize telemetry data to a unified brain (`GELT_BEADS_BRAIN_PATH`).

## Architecture

### Daemon Struct (`pkg/shadow/daemon.go`)
The `Daemon` struct wraps the `shadow.EnsembleEngine`. It orchestrates execution and handles lifecycle events.

- **`RunBackground(ctx context.Context)`**: Initiates the background polling loop. It registers handlers for OS signals (`SIGINT`, `SIGTERM`) to trigger a graceful shutdown of the engine by canceling the context.
- **Cycle Tick**: On each scan interval, the engine invokes a callback (`onCycle`) which persists the latest metrics to a local state file and synchronizes the payload to the external telemetry folder.

### Daemon Status Schema
The daemon's health and cycle metrics are persisted locally in `~/.gemini/gelt_daemon_status.json` in a readable JSON format:

```json
{
  "status": "RUNNING",
  "cycle_number": 42,
  "last_scan_time": "2026-07-30T09:45:00Z",
  "total_deployed": 1250.50,
  "pid": 10243
}
```

This file acts as a lightweight communication layer between the background daemon and foreground CLI queries.

### CLI Interface (`cmd/gelt/main.go`)
- **`gelt shadow daemon [--interval=15m]`**: Parses the interval, instantiates the `Daemon`, and blocks on `RunBackground` until interrupted.
- **`gelt shadow status`**: Reads the `gelt_daemon_status.json` file to report the running state, PID, cycle metrics, and total deployed capital to the console.

## Telemetry Synchronization
The `syncTelemetry` function exports the `EnsembleResult` structure on every cycle:
 - **Location**: Explicit `GELT_BEADS_BRAIN_PATH` configuration; no default destination is used.
- **Filename**: `shadow_telemetry.json`.
- **Purpose**: Provides cross-platform synchronization of real-time shadow trading metrics into the external Thneed Beads knowledge base.
