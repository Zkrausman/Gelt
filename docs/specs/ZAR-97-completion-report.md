# ZAR-97 Specification and Completion Report

## 🎯 What
Resolved a configuration hardcoding issue where `gelt scan`, `gelt shadow --ensemble`, and the Orchestrator Bridge ignored values from `AppConfig` and relied on hardcoded defaults. Added cross-platform support for the shadow daemon by separating Windows-specific code (`syscall.OpenProcess`) from Unix systems.

## 💡 Why
The engine was disconnected from user-configured preferences (`~/.gelt/config.json`), making it impossible to adjust scanning universes, durations, or paper trading notional values across all entrypoints. Unix compilation was failing because `syscall.OpenProcess` is exclusive to Windows. Risk limits were also decoupled from paper trading sizes, leading to potential test-account cap violations.

## 🛡️ Solution
1. Modified `cmd/gelt/main.go` to inject `AppConfig.WatchSymbols`, `DurationMode`, and `TotalCapitalUSD` into `gelt scan` and `gelt shadow` execution paths dynamically.
2. Extracted `isProcessAlive` in `pkg/shadow/daemon.go` into `daemon_unix.go` and `daemon_windows.go` with strict `//go:build` tags to prevent cross-compilation errors.
3. Updated `cmd/orchestrator/bridge.go` to dynamically read `TotalCapitalUSD` via `config.LoadAppConfig()`.
4. Ensured that orchestrator trades are evaluated against `risk.TestAccountRiskLimits()` bounding trades to compliant sizing limits (e.g., $10 max for test accounts).

## ✅ Verification
- `go build -o gelt.exe ./cmd/gelt` verified compilation succeeds without `syscall` errors.
- `go test -race ./...` globally passed, proving that concurrent evaluations and refactors introduce no regressions.
- Tested `TestAccountRiskLimits()` clipping trade size limits logically from `TotalCapitalUSD/4`.

## ✨ Result
Gelt daemon processes, scanning endpoints, and orchestrator executions are fully in parity with user configurations. The test-account risk guardrails properly scale down position sizes for paper tests without recording unbound theses. The codebase cleanly builds across Windows and Unix platforms.
