---
type: specification
title: ZAR-8: Adapt FRED Macro Ingester to FeatureProvider Interface
---

# ZAR-8: Adapt FRED Macro Ingester to FeatureProvider Interface

## 🎯 What
Implemented a `FredProvider` struct within the `pkg/macro` package that implements the core `FeatureProvider` interface introduced in ZAR-6. The new provider parses generic feature requests (like `Macro.FRED.DFF`), fetches the specified time series from the FRED API across the requested date window, and normalizes the results into a continuous daily sequence of `DataPoint` structs.

## 💡 Why
The generic data architecture requires standardizing data ingestion sources behind the unified `FeatureProvider` interface. This allows Gelt quantitative strategies to blindly query a central `FeatureRegistry` without managing vendor-specific API implementations, pagination, or date gaps directly. The FRED API frequently has weekend and holiday gaps that must be forward-filled to provide continuous time series vectors for machine learning and systematic backtesting.

## ✨ Implementation Details
1. **`FredProvider` Struct**: Implemented a struct holding the `apiKey`, a customized `http.Client`, and the FRED API base URL.
2. **`Fetch` Method**: Satisfies `data.FeatureProvider`.
    - Strips the `Macro.FRED.` prefix to map `req.FeatureKey` to the actual FRED series ID.
    - Constructs the HTTP request to the FRED `/fred/series/observations` endpoint spanning the exact `req.Start` to `req.End` window.
    - Processes the JSON observations.
    - Normalizes the output by iterating daily from `Start` to `End` and explicitly handling missing days by forward-filling the last known data point (or defaulting to `math.NaN()`).
    - FRED explicit missing values `"."` are discarded in favor of forward-filling.
3. **`RegisterProvider` Helper**: Exposes an easy configuration func to attach a `FredProvider` to the `FeatureRegistry` mapped to the `Macro.FRED` namespace during startup.

## ✅ Verification
Created comprehensive unit tests in `pkg/macro/provider_test.go` utilizing `httptest.NewServer` to simulate the FRED API purely offline.
- Verified API mapping.
- Validated prefix trimming and ID extraction.
- Proven the forward-fill engine effectively bridges multi-day gaps in simulated responses.
- Ensures offline registration mapping via `RegisterProvider`.

Tests execute fully offline via `go test ./pkg/macro`.
