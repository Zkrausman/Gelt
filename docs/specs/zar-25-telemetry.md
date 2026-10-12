---
type: spec
title: ZAR-25 Genericize Gelt Telemetry
timestamp: 2026-07-27T17:50:00Z
---

# ZAR-25: Genericize Gelt Telemetry and Implement Default slog Backend

## 🎯 What

This PR decouples logging and metrics in Gelt into a unified `pkg/telemetry` package, providing an enterprise-grade structured logging foundation using Go's `log/slog`.

## 💡 Why

Currently, trade events, errors, and system status updates in Gelt rely on direct `fmt.Printf`, standard `log.Printf`, or localized string outputs. Standardizing telemetry with structured logging ensures high-signal stdout events for cloud orchestration, headless automated agents, and CI/CD testing pipelines without forcing external system dependencies.

## ✅ Verification

- `pkg/telemetry/slog_backend_test.go` has been added, verifying JSON output formatting, `LogTrade` field output, and concurrency safety of the global logger.
- The `go test ./pkg/telemetry/...` test suite passes with 100% clean execution.
- The binary compiles cleanly with `go build ./...`.

## ✨ Result

The `pkg/telemetry` package now provides a `TelemetryLogger` interface with a thread-safe global provider. The `SlogBackend` implementation maps fields and trade telemetry events to `slog.Attr` dynamically for structured context tracing to standard output.
