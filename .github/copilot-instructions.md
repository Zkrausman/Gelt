# Gelt Copilot Instructions

When generating code, autocompleting, or providing suggestions in this repository, GitHub Copilot (and other AI assistants) must adhere to the following rules:

1.  **Idiomatic Go:** Generate idiomatic Go code targeting Go 1.22+. Follow standard formatting (`gofmt`).
2.  **Concurrency & Thread Safety:** When interacting with shared state, caches (e.g., in `pkg/data`, `pkg/macro`), or metrics injection, *always* utilize `sync.RWMutex` to ensure thread safety.
3.  **Database Guidelines:** Assume SQLite via the pure Go `modernc.org/sqlite` driver. Do not create new connection pools for the telemetry server; it is restricted to a single connection (`SetMaxOpenConns(1)`).
4.  **Zero-Fake-Telemetry:** Do not generate mock or randomized telemetry data for production endpoints. All metrics must trace back to legitimate state.
5.  **Backtesting Boundaries:** Code generated inside or interacting with `pkg/backtest` must be strictly deterministic and offline. Do not include external HTTP calls or Robinhood MCP interactions in this module. Use the `Engine` struct.
6.  **Dashboard Elements:** When modifying HTML templates for the web dashboard, preserve the specific DOM element IDs required by the JavaScript poller (`broker-status`, `buying-power`, `latency`, `vix-level`, `regime-status`, `daily-cap`, `shadow-pnl`, `shadow-winrate`).
7.  **Testing Offline:** API clients and HTTP interactions should use `httptest.NewServer` to mock JSON responses, ensuring tests do not hit live network limits.
