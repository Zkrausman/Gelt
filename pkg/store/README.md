# `pkg/store`

This package encapsulates the embedded SQLite database used by Gelt for local trade journaling and time-series data caching.

## Architecture

```mermaid
graph TD
    App["Gelt Application"] --> Store["Store\nNodeID[pkg/store/sqlite.go]"]
    Store --> TradesTable[("trades\n(Trade Journal)")]
    Store --> CacheTable[("feature_cache\n(Time-Series Data)")]
    Store --> MetaTable[("feature_meta\n(Cache TTL Limits)")]
```

## Features

- **Embedded SQLite**: Relies on `modernc.org/sqlite` pure-Go driver (no CGO dependencies).
- **Single Connection**: Actively limits connections (`SetMaxOpenConns(1)`) to avoid locking issues across background goroutines.
- **Asynchronous Writes**: Supports non-blocking `InsertTrade` executions to avoid stalling the core trading engine.
