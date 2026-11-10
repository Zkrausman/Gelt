---
type: specification
title: "BreakoutVol descriptive accuracy correction"
status: source-candidate-awaiting-independent-review
baseline: "5d1f29206cf670277ef65aff40ff5496af91efd7"
scope: "Comments, exported description and documentation; evaluator calculations unchanged"
---

# BreakoutVol descriptive accuracy

The exported `Description()` is shown by `gelt strategies`/`gelt catalog` and
plan metadata displays. Its prior claim of >1.5x ATR range expansion and volume
confirmation did not describe the current evaluator. This source correction
changes descriptive text, not the strategy. It does not establish why the old
wording existed or whether volume confirmation was intended.

Current behavior compares signed latest close change against
`CalculateATRFromCloses(closes, period) * ATRExpansionMultiplier`. Defaults remain
period 14, expansion multiplier1.25, stop multiplier0.5 and target multiplier1.5.
The unchanged ATR-from-closes helper returns 1.5 times the mean absolute change
across the selected close differences; it is a proxy, not observed OHLC true
range. The strategy does not read `volumes`. A strictly positive/negative
threshold crossing gives BUY/SELL with score 90; otherwise HOLD has score 50.
Those constants are diagnostic branch values, not calibrated probabilities or
profitability/qualification evidence. Parameters remain configurable, so wording
identifies1.25 as a default rather than every run's effective value.

## Exact source boundary

`pkg/strategies/breakout_vol.go` changes only comments and the `Description()`
return string. Its struct, constructor values, Name, Init, SetParams, Evaluate,
capital and intraday metadata remain byte-identical outside those exact edits.
Exported descriptive output intentionally changes; signal calculations/results
and identities do not. No volume rule, threshold change, new strategy profile,
indicator repair, historical evidence relabeling or fallback change is included.

`pkg/strategies/breakout_vol_description_test.go` adds focused deterministic
metadata, defaults, independent hand-protection/score oracles, complete-signal
volume independence and configured-threshold compatibility assertions. Existing
strategy tests and comparison tests are retained. `pkg/strategies/README.md`
clarifies the same boundary and links this report. No other product component,
workflow, dependency, security setting or runtime is changed.

## Verification and review disposition

Focused Go1.26.1 `go test ./pkg/strategies ./pkg/backtest ./cmd/gelt -run
"BreakoutVol|Comparison" -count=1` passed. The new volume-independence checks use
fixed closes/time/symbol and compare complete signals across different volume
inputs; they do not claim validation of volume data at other system boundaries.
A mechanical baseline comparison separately proves that only the listed comments
and description literal changed in the evaluator source. Working full `go test -race ./...` and `go vet ./...` passed. Diff/YAML and
complete artifact independent/adversarial source/privacy review remain
required before publication; working tests are not independent review or fresh
postreview final-head proof. Required final repository gates and normal CI must
follow accepted final reviews. Windows remains unsupported with legacy skip
qualifications retained.

No market data, provider, live runtime, experiment/model campaign, Qlib/RD-Agent
installation, generated-code execution, trading or operating admission is added.
The subsequent structured comparison/experiment contract is private preparation,
not part of this product patch. Q1/Q2 behavior remains separately scoped. All
original uncertain outcomes and privacy/security/source ownership holds remain;
qualification NOT_READY, production CLOSED and operations DEFER are unchanged.
