---
title: TrendConfluence fixed-50 declared-window comparison
status: implemented-pending-review
created: 2026-11-13
---

# TrendConfluence fixed-50 declared-window comparison

The additive offline API and command validate the complete bounded source and select exact start-inclusive and end-exclusive timestamps. The end may also be the last timestamp plus one. A valid nonempty interval requires 50 predecessor bars. A private slice from the first predecessor through the last scored bar feeds one unchanged Trend50 comparison. Indicators reseed at that first bar; this is not a filtered full-history simulation. The first possible strategy and passive entry occurs at the first scored open. The terminal position and pending directional signal remain modeled facts, with no forced sale or future fill.

Scores start from declared cash and use only scored close marks, including fees. Maximum drawdown uses the initial baseline and earliest exact-ratio tie; replay indices map to source by adding the warmup offset and to scored indices by subtracting 50. The CLI independently checks source selection, invokes the existing original-OHLC checker conditional on normalized signals, recomputes score projections and writes one bounded summary. It does not independently verify indicators or authenticate input. Cadence, session, selection history, intraday eligibility and cost calibration remain unestablished; this startup policy does not establish convergence, statistical adequacy or operating readiness.

The implementation adds `pkg/backtest/causal_trend50_window_comparison.go` and its tests, `cmd/gelt/backtest_causal_trend50_window_comparison.go` and its tests, the explicit main dispatch, the backtest README section, and this specification. Existing fixed-20 and whole Trend50 entry points remain unchanged.

## Working verification

Focused synthetic API and CLI tests exercise exact selection, finite-prefix reseeding versus a different full-history signal, excluded data, terminal pending and open state, fee/adverse accounting, drawdown mapping, errors and forged display fields. Working offline checks passed with Go 1.26.1: focused synthetic tests, `go test -race ./...`, `go vet ./...`, `go build ./...`, and `git diff --check`. The race run completed in 33 seconds; the focused tests took 1 second, vet less than 1 second, and build 1 second. Independent source review and fresh final-head checks remain necessary; no operating or qualification claim follows from these checks.
