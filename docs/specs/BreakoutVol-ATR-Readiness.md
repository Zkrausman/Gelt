---
title: BreakoutVol ATR history readiness
type: specification
status: implemented
---

BreakoutVol retains its existing 20-close minimum and its fallback to period 14 for a nonpositive period. After that minimum, it now returns the ATR helper's error and a zero signal if the configured period lacks the period + 1 closes needed by the helper. A computed zero ATR remains valid. Existing valid signal calculations, defaults, and parameters are unchanged.

The fixed-20 offline causal family first evaluates a 20-close prefix. Configured periods 20 and above therefore produce the existing bounded `evaluator_error` at that evaluation rather than waiting for more history. Declared-window replay maps the error to the source index. This change introduces no new API, error code, indicator formula, scheduler, cost model, or CLI behavior.

Changed files: `pkg/strategies/breakout_vol.go`, `pkg/strategies/breakout_vol_atr_readiness_test.go`, `pkg/backtest/causal_atr_readiness_test.go`, `pkg/strategies/README.md`, `pkg/backtest/README.md`, and this specification.

Working verification used Go 1.26.1 offline: focused strategy and backtest tests, focused race tests, `go test -race ./...`, `go vet ./...`, `go build ./...`, and a candidate CLI build passed. Synthetic default CLI comparisons for causal, funded, fee, execution, whole comparison, window comparison, and Trend50 returned identical stdout, stderr, and exit status to the retained base-tree binary. Detailed working evidence is retained in the owner’s private task artifacts. Independent and adversarial source review and final-head verification remain subsequent delivery gates.

This is synthetic offline correctness evidence, not validation of indicator quality, input authenticity, profitability, or operating readiness.
