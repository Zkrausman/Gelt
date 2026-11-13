---
type: specification
title: Offline Mean20 comparison
status: implemented
---

## Outcome and command

The offline owner or assistant can compare a fresh, owned default MeanReversion strategy with flat cash and one passive lot using the same strict supplied CSV and declared execution costs. The whole-source command is:

`gelt backtest-causal-meanrev-compare MeanReversion SYMBOL CSV CASH FIXED_FEE FEE_BPS BUY_BPS SELL_BPS`

Append exactly `--window START END` for an exact start-inclusive, end-exclusive scoring period. No catalog, plan, configured service, provider, broker, imported receipt, or arbitrary strategy resolver is used. Existing commands and their admission rules remain unchanged.

## Calculation and identities

`RunMean20ComparisonCausal` owns a fresh default MeanReversion, checks its binding before and after one unchanged causal execution run, and computes the existing cash/passive controls. Defaults are Bollinger 20 at two deviations, RSI 14 with thresholds 35/65, ATR-from-closes proxy 14 with stop/target multipliers 0.5/1.5, and the existing chop filter 0.015/14. These are explicit uncalibrated choices, not recovered historical or market-suitable settings. Strategy and indicator calculations are unchanged.

The outer whole identity is `gelt.legacy-go.mean-reversion-20-comparison.v1`; its evaluation policy is `gelt.legacy-go.mean-reversion-fixed20-defaults.v1`. Nested execution and control identities retain their existing generic meanings; the actual reference target is MeanReversion. The private display validator has two closed target bindings. Its existing BreakoutVol wrapper continues to reject MeanReversion; no result is renamed to bypass validation.

Evaluation starts at close index 19, and the first possible fill and passive entry are at open index 20. Cash starts flat. Passive makes at most one buy capped at simulated 10 including its entry fee and holds through the final close without a forced sale. The strategy uses existing reference-trigger versus modeled-fill separation, fixed-point fee and adverse-price accounting, cash insufficiency nonfill, protection order, and terminal position/pending-signal semantics. There is no loan, resizing, rebalancing, double charge for the execution-price effect, or SELL cost without a SELL. Unsupported protection transitions and numeric failures remain errors rather than being clamped.

## Declared period

`RunMean20WindowComparisonCausal` validates the complete original source, including excluded rows, before selecting the period. START must match a supplied timestamp; END must match a later supplied timestamp or equal the last supplied timestamp plus one second. The selected start needs exactly twenty preceding warmup bars. The new window identity is `gelt.legacy-go.mean-reversion-20-declared-window-comparison.v1`, with reset `reseed_at_first_of_exact20_prior_bars_flat_at_score_start.v1`.

For start index s and end-exclusive index e, replay consumes original indices s-20 through e-1. Source index equals replay index plus s-20; scored index equals replay index minus 20. Scored accounting begins from the declared initial cash immediately before the first scored open. Cash, equity, fees, PnL, quantity, drawdown, and source/scored drawdown pointers are reconstructed and checked. Valid excluded history/future prices do not affect the consumed replay; invalid excluded rows reject the full request. No excluded future open can fill the terminal signal.

This is a finite-prefix reseed, not a filtered whole-history replay. Wilder RSI retains prefix memory, so equal final twenty bars do not establish equal whole/window signals, adequate startup history, or convergence.

## Validation, output, and limits

The APIs preserve inherited domains: at most 10,000 valid ordered bars; timestamps 1 through 253402300799; finite OHLC 0.01 through 1,000,000 with valid geometry; finite volume 0 through 1e12; initial cash 0 through 1,000,000 at fixed scale 8; fixed fee below 10; fee basis points through 10,000; and adverse basis points through 9,999. END alone may use 253402300800 as the terminal sentinel. Invalid requests return a zero result and sanitized typed reason, with original-source error indices and cancellation at -1.

The command retains the existing bounded strict CSV grammar, including full six-field validation, a 1 MiB file bound, 10,000 row bound, and 32-byte token bound. Arity is checked first; file parsing precedes trailing window flag/boundary checks and literal target admission. No raw path, input, or internal error text is printed. Failure stdout is empty until an attempted output write. A complete validated summary is bounded to 8,192 UTF-8 bytes and written once; a short or failed write is not retried.

Original OHLC events, normalized evaluations, close marks, cash flows, controls, terminal state, fees, and score projections are checked before display. That check is conditional on normalized signals: it does not independently authenticate indicator decisions, input data, or a coherently replaced signal trace. Source authenticity/finality, intraday/session eligibility, selection history, calibration, edge, profitability, qualification, and operating admission remain unestablished. Exposure duration, protection, and turnover differ between the strategy and controls.

## Changed files and verification

The change adds `pkg/backtest/causal_mean20_comparison.go`, `pkg/backtest/causal_mean20_window_comparison.go`, their owned tests, `cmd/gelt/backtest_causal_mean20_comparison.go`, `cmd/gelt/backtest_causal_mean20_window_comparison.go`, and their owned tests. It makes only a private closed target-binding factorization in `cmd/gelt/backtest_causal_execution_scenario.go`, adds command dispatch in `cmd/gelt/main.go`, and documents the command in `README.md`. The replay core, strategy, indicator, and control production implementations are unchanged.

Owned synthetic tests exercise actual default BUY/SELL/HOLD behavior, independent fixed-point fee/adverse expectations, generic-execution compatibility, warmup and funding, no hypothetical terminal exit fee, exact-window reseeding and excluded-row validation, original-index error mapping, maximum terminal sentinel, display identity/accounting/drawdown mutations, coherent alternate-open and low-only traces against original OHLC, command forms and validation order, cancellation, and one-attempt writer failures. A separate compiled-command acceptance harness checks formatted money, quantity, mappings, terminal state, and error cases; it is not an independent drawdown oracle. Independent final source/privacy review and fresh final-head Go, V2, scientific, and applicable release checks are separate release prerequisites, not implied by this implementation report. Browser UI acceptance is inapplicable to this CLI-only workflow.
