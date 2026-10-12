---
ticket_id: ZAR-152
title: Dynamic universe discovery and screener-feed research
type: research
status: completed
timestamp: 2026-08-10T00:00:00Z
source_session: sessions/14571152331258817315
---

# ZAR-152: Dynamic Universe Discovery & Screener-Feed Research

## Purpose

Define a safe, implementation-ready boundary between a read-only screener and Gelt's shadow-engine universe. This is a research artifact only; it introduces no runtime behavior.

## Existing Seams

- `pkg/shadow/ensemble.go:31-32` defines `EnsembleConfig.WatchSymbols` as a static `[]string`.
- `pkg/shadow/ensemble.go:450` iterates that static list in `RunSession`.
- `pkg/shadow/ensemble.go:359-369` marks existing open trades to market from the store rather than `WatchSymbols`; removing a symbol from the screening universe must not stop management of its open position.
- `pkg/signals/screener.go:9` provides synchronous one-off symbol retrieval rather than an event stream.

## Proposed Contract

Define a narrow, read-only feed boundary in `pkg/signals` or `pkg/data`:

```go
type ScreenerUpdateEvent struct {
    Timestamp  time.Time
    Universe   []string
    BasePrices map[string]float64
    AssetClass string
}

type ScreenerFeed interface {
    Subscribe(ctx context.Context) (<-chan ScreenerUpdateEvent, error)
}
```

`EnsembleConfig` may eventually accept an optional `ScreenerFeed`. `WatchSymbols` remains the initial, static seed. ZAR-165 may implement this interface later, but ZAR-152 must not depend on its internal implementation.

## Ownership and Safety

- `EnsembleEngine` owns an internal active universe guarded by `sync.RWMutex`; it must not mutate `EnsembleConfig.WatchSymbols` concurrently.
- The feed consumer is bounded by the `RunSession` context and must exit on cancellation.
- Reject stale events, deduplicate symbols, validate asset class, and impose a fixed maximum universe size before any evaluation work begins.
- A feed update changes only the next scheduled shadow scan. It must not trigger an immediate scan, place an order, enable promotion, or alter live-trading watchlists.
- Existing open positions remain subject to mark-to-market and exit management even after their symbol leaves the active universe.
- Persist cycle-level universe metadata (for example `UniverseSize`) with `EnsembleResult` for later auditability; do not persist unvalidated feed payloads as authoritative configuration.

## Implementation Sequence

1. Add locked active-universe getter/setter helpers to `EnsembleEngine`.
2. Add the feed interface and update-event type without wiring a provider.
3. Consume the feed in the shadow session loop using the session context; apply only validated, fresh updates for the next cycle.
4. Add a ZAR-165 adapter only after its event contract and tests are stable.

## Deterministic Verification Plan

- Use a controlled mock feed in `pkg/shadow/ensemble_test.go`.
- Prove deduplication, stale-event rejection, maximum-universe enforcement, cancellation, and no race under `go test -race ./pkg/shadow/...`.
- Verify that removing a symbol does not strand an existing open position.
- Verify a feed update never initiates a broker order or an out-of-band scan.

## Open Decisions

1. Set the maximum dynamic-universe size before implementation; the research recommendation is a conservative cap such as 50 symbols.
2. Confirm whether base prices belong in the feed contract or should remain exclusively sourced by the market-data provider.
3. Confirm the canonical package for the shared interface (`pkg/signals` versus `pkg/data`) after checking import direction; do not create an import cycle.

## Result

ZAR-152 is ready to be decomposed into a small shadow-engine state-management foundation followed by a separately integrated screener adapter. No implementation should start until the universe cap and package ownership decisions are made.
