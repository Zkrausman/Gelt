---
type: specification
title: Task 056/049: Injecting Active Trading Plan Engine into TelemetryServer
---

# Task 056/049: Injecting Active Trading Plan Engine into TelemetryServer

## Objective
Eliminate the per-request instantiation of `plans.DefaultPlanSuite()` inside `/api/v1/metrics` and instead bind the `TelemetryServer` struct to accept or access the active running trading plan registry reference.

## Changes Made
- Updated `TelemetryServer` struct in `pkg/server/server.go` to include `activePlanEngine *plans.PlanRegistry`.
- Refactored `NewTelemetryServer` to accept `activeEngine *plans.PlanRegistry` and assign it to the struct.
- Created `pkg/server/metrics.go` to hold `handleMetrics` and removed it from `server.go`.
- Updated `handleMetrics` to evaluate strategy confidence scores using the injected `s.activePlanEngine` gracefully.
- Wired the live global plan registry into the `NewTelemetryServer` call in `cmd/gelt/main.go` and `pkg/server/server_test.go`.
- Cleaned up duplicate code, build artifacts, and fixed syntax errors that were caused by previous `awk` patches.

## Verification
- Verified code builds (`go build ./...`) without errors.
- Test suite executed with `go test ./...` passed smoothly.
- Tested and removed all leftover shell script build artifacts.
