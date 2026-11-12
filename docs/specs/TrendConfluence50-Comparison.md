---
title: TrendConfluence fixed-50 causal comparison
status: implemented-pending-review
created: 2026-11-12
---

# TrendConfluence fixed-50 causal comparison

The separate offline comparison constructs a fresh default TrendConfluence
strategy (buy threshold 75, sell threshold 0), evaluates each complete prefix
from 50 closes, and compares its modeled result with flat cash and one passive
lot. There is no runtime window, strategy, or parameter selector. Valid input
contains 1–10,000 strictly ordered bars; short inputs remain flat. Evaluation
starts at index 49; the first possible fill and passive entry are at index 50.
The existing fixed-20 APIs and declared-window comparison retain their modes.

Costs use the existing fixed-eight-decimal fee-inclusive $10 cap and declared
adverse-price scenario. Protection and next-open ordering, terminal open value,
fee accounting and close-mark drawdown follow the existing causal replay. The
CLI parses the complete bounded CSV before resolving its literal target. Its
dedicated display checker reconstructs event opportunities and nonfills from
the original OHLC and normalized signal records, and reconciles controls,
cash flows, marks, fees and diagnostics before one bounded output attempt. It
does not independently verify indicator calculations or authenticate the CSV.

Cadence and session, selection history, and intraday eligibility are
unestablished. Results are unqualified offline arithmetic under uncalibrated
assumptions, not rankings, operating admission, evidence of edge or trading
readiness. The shipped Q1 CLI's coherent alternate-open H1 limitation is
unchanged; the stronger source-OHLC event reconstruction applies only here.

Changed files: private profile and accounting/control seams in
`pkg/backtest/causal.go`, `causal_execution_scenario.go`, and
`causal_comparison.go`; the new Trend50 API and tests; the new dedicated CLI
and tests; the command dispatch and backtest README; and this specification.
Working verification and independent reviews are recorded in the delivery
packet; final-head review and verification remain separate requirements.

## Working verification

On the development candidate based on `d1ac5d9acc64a4eb80e0830592f89a14b04e201e`,
focused Trend50 backtest and CLI tests passed. An exact-base export and the
candidate produced matching typed-result digests for the exercised fixed-20
APIs, plan and Q1 window; compiled old comparison and Q1 CLI outputs also
matched. Compiled Trend50 commands passed on 1, 49, 50 and 51 constant bars,
including the fixed-fee passive case; malformed CSV and unsupported target
were rejected. With pinned Go 1.26.1, offline dependencies and explicit linked
worktree Git environment, `go test -race -count=1 ./...`, `go vet ./...`, and
`go build ./...` passed as working checks. Earlier full-suite attempts failed
at the nested presentation-test build before the linked-worktree environment
was corrected; their logs remain in the private working receipt. Independent
source reviews and a fresh final-head verification are still required.
