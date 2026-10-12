---
type: architecture-standard
status: active
dependencies: []
---

# Go Development & Testing Standards

## Purpose
Defines the strict engineering baselines, testing standards, and architectural patterns required for the Gelt trading engine to prevent fatal bugs.

## Core Architecture
- **Go Version:** Go 1.22 or newer is required.
- **Concurrency & State:** Shared state must be protected using `sync.RWMutex` to prevent data races in concurrent polling and execution systems.
- **SQLite Database Layer:**
  - Use the pure Go `modernc.org/sqlite` driver to avoid CGO dependencies.
  - The telemetry server must strictly enforce a single-connection rule using `SetMaxOpenConns(1)` for thread-safe reads and to avoid connection pool exhaustion.
- **Telemetry & Logging:**
  - Mandatory local Thneed daemons are deprecated.
  - The `log/slog` structured telemetry standard must be used for all application logging and trade telemetry events.

## Testing Standards
- **Zero External Calls in Tests:** All API client tests (e.g., inside `pkg/data`) must be entirely offline. Use `httptest.NewServer` to mock HTTP JSON responses and prevent triggering external rate limits during testing.
- **Run the Suite:** The standard command to verify changes is `go test ./...`. Zero regressions are tolerated.
