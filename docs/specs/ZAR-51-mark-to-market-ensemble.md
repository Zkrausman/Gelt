---
type: spec
title: "[Engine] Real Fill Price & Mark-to-Market Evaluation in Ensemble Engine"
status: implemented
---

# Architectural Decision Record & Specification

## Problem Statement
The shadow ensemble engine currently uses synthetic pricing on new `BUY` signals and fails to dynamically mark-to-market open trades in subsequent cycles. This leads to inaccurate performance estimates for shadow strategies relative to the live Robinhood endpoints.

## Technical Implementation Trade-offs

1. **Signal Generation (`EnsembleSignal`)**:
   We will enrich `EnsembleSignal` to carry the actual `LastPrice` calculated by `fetchLiveIndicators` across the concurrency boundary in `scanSymbol`. This ensures the entry price relies exactly on the condition snapshot, preventing micro-drifts between indicator evaluation and trade execution.

2. **Mark-to-Market Loop (`RunSession`)**:
   Instead of launching a separate goroutine which would necessitate complex lock synchronization (and potential race conditions violating Gelt architecture), we embed the Mark-to-Market evaluation inside the main synchronous `RunSession` cycle immediately before the sweep evaluation.

## Mathematical Constraint

Floating PnL strictly maps to:
$$PnL_{USD} = (P_{current} - P_{entry}) \times Q$$
$$PnL_{\%} = \frac{P_{current} - P_{entry}}{P_{entry}} \times 100$$

## Acceptance Criteria
- [x] Paper trade entries capture real live Robinhood fill prices.
- [x] Floating PnL is updated on every cycle from live Robinhood quote data.
- [x] Unit & smoke tests pass (`go test ./pkg/shadow/...`).
