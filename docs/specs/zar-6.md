---
type: specification
title: Feature Specification: Core FeatureProvider Interface & Registry
---

# Feature Specification: Core FeatureProvider Interface & Registry

## 🎯 What
Implemented a unified way to fetch, store, and query data features across the trading engine, rather than having strategies call specific APIs (like FRED or Reddit) directly.
This encompasses defining core data structures, a provider interface, and a thread-safe registry to route requests.

## 💡 Why
To abstract away data sourcing and provide a standard interface for strategies to consume various data streams (e.g., macroeconomic indicators, sentiment scores, market prices).

## 🛠️ Implementation Details
1. **Core Structs (`pkg/data/feature.go`)**:
   - `DataPoint`: Represents a single point in time with `Timestamp`, `Value`, and optional `Meta` map.
   - `FeatureRequest`: Encapsulates a query specifying `FeatureKey`, `Start`, `End`, and `Resolution`.
2. **Interfaces**:
   - `FeatureProvider`: Enforces a standard `Fetch` signature for data sources to adhere to.
3. **The Registry**:
   - `FeatureRegistry`: Thread-safe (`sync.RWMutex`) map of string prefixes to `FeatureProvider`.
   - `Register(prefix, provider)`: Associates a data provider with a key prefix.
   - `Query(ctx, req)`: Routes a query to the longest-matching provider prefix.

## ✅ Verification
1. Created `pkg/data/feature.go` containing all required components.
2. Created `pkg/data/feature_test.go` with mock providers to test concurrent `Register` and `Query` prefix routing logic.
3. All tests pass successfully via `go test ./pkg/data/...`.

## ✨ Result
The architecture now supports registering arbitrary data sources and querying them centrally via `FeatureRegistry`, paving the way to refactor existing direct API calls.
