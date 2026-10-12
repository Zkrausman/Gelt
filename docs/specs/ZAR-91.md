# ZAR-91 Specification & Completion Report

## 🎯 What
Extracted hardcoded screener symbol universes (`DefaultScreenerUniverse`) and fallback synthetic base prices (`basePrices`) out of internal logic into a centralized, user-configurable schema within `AppConfig`.

## 💡 Why
The engine was previously relying on static fallback tables within `pkg/signals/screener.go` and `cmd/gelt/main.go`, meaning users could not dynamically adjust the core synthetic prices or default scan universes without modifying source code. By lifting these to `AppConfig`, users can now define custom tickers and synthetic price bases directly via `config.json`.

Furthermore, `pkg/shadow/ensemble.go` was previously experiencing a regression where any missing live price on a cryptocurrency or options ticker would silently fall back to exactly `$100.0` (rather than a symbol-specific default or a properly populated map), resulting in massively skewed initial balances and PnL percentages for Shadow cycles.

## ✅ Verification
1. **Fallback Resilience:** Added explicit nil and zero-length map/slice checking. Modified `config.LoadAppConfig()` to automatically inject `DefaultScreenerUniverse()` and `DefaultSyntheticPriceMap()` if the JSON config is missing or sets these maps to explicit empty values (e.g. `{}`).
2. **Backward Compatibility:** Maintained the variadic parameter footprint for exported API paths like `FetchTopScreenerSymbols` or safely modified signatures to ensure existing integration tests compiled successfully.
3. **No Memory Drift:** `DefaultSyntheticPriceMap()` returns a newly instantiated clone on every call, preventing global state pollution where mutating `cfg.SyntheticPriceMap` for one ensemble would leak to others.
4. **Test Suite:** Ran `go test -race ./...` across all packages without regressions. Added `TestLoadAppConfig_EmptyMapFallback` in `app_config_test.go` to explicitly verify the `{}` JSON parsing fallback.

## ✨ Result
`ZAR-91` is fully completed. Synthetic prices now robustly fallback through `e.cfg.SyntheticPriceMap` matching the user's config file (or the safe runtime defaults) rather than collapsing to $100.
