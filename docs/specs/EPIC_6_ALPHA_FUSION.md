---
type: specification
title: EPIC 6 - Multi-Source Alpha Signal Fusion & Social Sentiment Weighting
---

# EPIC 6: Multi-Source Alpha Signal Fusion

## Objective
Establish a unified alpha fusion architecture that synthesizes crypto volume ticks, FRED macro data matrices, and local VADER social sentiment scores. This will provide a weighted confidence score for trading strategy execution.

## Architectural Design

### 1. Data Normalization Schema (`pkg/alpha/normalization.go`)
*   **Source Data:** Asynchronous payloads from disparate sources (crypto volume, FRED economic indicators, social sentiment).
*   **Normalization Pipeline:**
    *   Ingest raw data via independent goroutines.
    *   Map incoming timestamps to a common Unix epoch resolution.
    *   Normalize values to a standard 0-1 scale or z-score depending on the indicator type.
*   **Thread-Safety Invariants (SQLite):**
    *   All time-series data MUST be written to SQLite using a single connection or connection pool with explicit `sync.RWMutex` locks to prevent `database is locked` contentions under high concurrent injection.
    *   Write operations should be batched where possible.

### 2. Sentiment-Weighted Confidence Adjuster (`pkg/alpha/sentiment_weight.go`)
*   **Mathematical Weighting Function:**
    *   Calculate a base score derived from pure momentum/trend indicators.
    *   Apply a scalar multiplier based on social sentiment (VADER scores) and macro indicators.
    *   **Scaling:** The final confidence score must deterministically scale between `0.0` (minimum confidence, halt trades) and `100.0` (maximum confidence, full allocation).
*   **Signal Amplification/Dampening:**
    *   Boost (e.g., `1.2x`) when social sentiment and crypto momentum align.
    *   Dampen (e.g., `0.5x`) during macro uncertainty or diverging sentiment.

### 3. Alpha Fusion Integration & Guardrails (`pkg/alpha/fusion_exec.go`)
*   **Live Execution Integration:**
    *   Wire the fusion engine into Gelt's execution pipeline (`pkg/portfolio/manager.go`).
*   **Signal Override Boundaries (Guardrails):**
    *   If cross-asset sentiment diverges sharply from the active trading plan (e.g., strong bearish sentiment during a long momentum play), a protective trade-hold state must be triggered.
    *   **Latency:** The override circuit breaker must evaluate and halt trades within 30ms of a significant divergence detection.

## Sequential Dependency Chain
1.  **Ticket 1:** Data Normalization (Hard Prerequisite).
2.  **Ticket 2:** Sentiment Weighting (Blocked by Ticket 1).
3.  **Ticket 3:** Live Alpha Fusion Execution (Blocked by Ticket 2).
