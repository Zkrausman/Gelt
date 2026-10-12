---
title: "[CLI] Add 'gelt shadow cycles' command to log & emit full scan cycle snapshots"
type: specification
ticket: ZAR-67
status: completed
---

# ZAR-67: Shadow Cycles Snapshot & CLI Command

## Overview
This specification details the implementation for saving full scan cycle evaluation snapshots from the `EnsembleEngine` and surfacing them via a new CLI command `gelt shadow cycles`.

## Acceptance Criteria
1. Extend `EnsembleEngine` in `pkg/shadow/ensemble.go` to save complete cycle evaluation snapshots (including `HOLD` scores and `AGENT_REVIEW` prompts across all symbols) into `~/.gemini/gelt_ensemble_cycles.json`.
2. Add CLI command `gelt shadow cycles` (supporting `--latest`, `--symbol=<SYM>`, and `--json` flags) to query and format cycle logs on demand.
3. Verify unit tests pass for cycle log storage and CLI output formatting.

## Architectural Decision Record (ADR)
- **State Lifecycle:** The `EnsembleEngine.RunSession` now persists its immutable result at the end of each cycle. This prevents in-memory growth of cycle logs and guarantees that crash-restarts don't lose the prior agent reviews.
- **Thread Safety & Concurrency:** The cycle store inside `pkg/shadow/shadow.go` utilizes `sync.RWMutex` to enforce atomic read/write locks, preventing race conditions when the CLI reads the JSON output concurrently with the background daemon evaluating cycles.
- **Serialization & File I/O:** The JSON output path is set to `~/.gemini/gelt_ensemble_cycles.json`. A JSON array structure allows appending data logically.

## Mathematical Constraints
To guarantee O(1) latency for cycle appending vs continuous file loading, we limit cycles to the current execution phase, but practically the data complexity bounds are:
$C(n) = \sum_{i=1}^{n} (S_i \times I_i)$
Where $n$ is the number of cycles, $S_i$ is the symbol set size (typically 5), and $I_i$ is the indicator metadata footprint. We tolerate complete unmarshal/marshal up to $N = 1000$ efficiently due to the small struct size of `EnsembleResult`.

## Execution Verification
- [x] Unit Tests passing without race conditions (`go test -race`).
- [x] Concurrency locking verified (`sync.RWMutex` on Store ops).
- [x] JSON path successfully maps to `~/.gemini/gelt_ensemble_cycles.json`.
