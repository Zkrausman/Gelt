---
type: specification
title: TASK: ZAR-11 Expose FeatureRegistry via API Endpoints
---

# TASK: ZAR-11 Expose FeatureRegistry via API Endpoints

## What
Added REST API endpoints in the Telemetry Server (`/api/v1/features`) to query the global `FeatureRegistry` caching and fetching system.

## Why
Users need to visualize macro and sentiment data. The backend already collects and standardizes this data using `FeatureProvider` modules and maps them to a generic `FeatureRegistry`. We needed a way to bridge this memory layer to the frontend.

## Implementation
- Added `ListRegisteredPrefixes()` to `FeatureRegistry` (in `pkg/data/feature.go`).
- Modified `NewTelemetryServer()` to inject a `*data.FeatureRegistry`.
- Implemented `/api/v1/features` route supporting `GET` requests with `?key=`, `?start=`, and `?end=` parameters.
- Wrote tests mocking a feature provider and verifying HTTP responses inside `pkg/server/server_test.go`.
- Ensured efficient JSON serialization using custom structs.
