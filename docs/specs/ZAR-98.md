# Specification: ZAR-98 Daemon Auto-Spawn Orchestrator Bridge

## Overview
This specification details the design and implementation of the **Auto-Spawn LLM Orchestrator Bridge** within the Gelt Shadow Trading Daemon (`pkg/shadow/daemon.go`).

## Problem Statement
Previously, when running non-deterministic AI trading strategies (`AI_Choice_Crypto`), `AGENT_REVIEW` signal events required the LLM Agent Orchestrator (`cmd/orchestrator`). Users had to manually launch `orchestrator.exe` or set up stdout piping (`gelt shadow | orchestrator`).

## Solution
1. **Configurable Auto-Spawn Option:** Added `AutoSpawnOrchestrator bool` to `AppConfig` in `pkg/config/app_config.go` (default `true`).
2. **Daemon Lifecycle Integration:** `Daemon.RunBackground()` resolves the orchestrator binary or `go run ./cmd/orchestrator` fallback, spawns the orchestrator child process asynchronously, and records `OrchestratorPID` in `DaemonStatus` (`status.json`).
3. **Graceful Subprocess Cleanup:** When the daemon receives a termination signal or context cancellation, `stopOrchestratorBridge()` terminates the child orchestrator process cleanly.

## Verification
- Unit tests added in `pkg/shadow/daemon_test.go` (`TestDaemon_AutoSpawnOrchestratorOption` and `TestDaemon_AutoSpawnOrchestratorLifecycle`).
- Race-enabled verification: `go test -race ./pkg/shadow/...`
- Binary build verification: `go build -o gelt.exe ./cmd/gelt`
