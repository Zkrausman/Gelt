---
title: "[GELT-130] Implement Local Context Bridge and Regime Matrix Schema"
status: Done
type: adr
dependencies: []
ticket: ZAR-72
---

# Architectural Decision Record (ADR): Local Context Bridge & Regime Matrix

## Context & Problem Statement
The Heavy Agentic Tier and Fast Decision Nodes need a shared local memory contract. Specifically, the 15-minute `AI_Choice_Crypto` nodes must be able to read local context in sub-milliseconds without network overhead.

## Decision
We define a `RegimeMatrix` struct within the `pkg/macro` package. The structure incorporates:
- **Score**: Macro volatility flag.
- **MarketSentiment**: Market sentiment scores (0-100).
- **VolatilityFlags**: Discrete macro volatility indicators.
- **AssetBiases**: Asset-level bias indicators.

We implemented a function `ReadRegimeMatrix(path string)` to parse a localized JSON representation of this matrix.

### Concurrency & Thread-Safety
To prevent memory leaks or race conditions during live execution across Fast Decision Nodes, we utilize a `sync.RWMutex` to guard the parsing execution `matrixMutex.RLock()`.
This thread-safe read-locking guarantees concurrent accesses correctly serialize around file I/O limitations.

### Fallback Behavior
In scenarios where the file does not exist, the implementation gracefully defaults to neutral regime flags:
- $Score = 50.0$
- $MarketSentiment = 50.0$

## Mathematical Constraints
For sentiment normalization within acceptable bounds:
$$ S \in [0, 100] $$

If a default neutral fallback occurs, the expectation value $\mu_S$ must be centered:
$$ E[S] = 50.0 $$
