---
name: gelt-operator
description: Use Gelt's supplied-CSV offline replay/comparison commands, or its operational CLI when that separate task is authorized.
---

# Gelt CLI workflow

For a supplied-data simulation, use the closed causal commands below. They do
not acquire data or enter configured services. Operational command references
later in this skill are a separate workflow, not offline prerequisites.

## Supplied-CSV replay and comparison

Start with the installed binary's source-defined chooser and exact command help:

```bash
./gelt.exe help offline
./gelt.exe help backtest-causal-compare
```

Choose the existing comparison that matches the requested strategy and period:

| Strategy | Whole supplied input | Selected scoring period |
| --- | --- | --- |
| BreakoutVol | `backtest-causal-compare` | `backtest-causal-window-compare` |
| TrendConfluence | `backtest-causal-trend50-compare` | `backtest-causal-trend50-window-compare` |
| MeanReversion | `backtest-causal-meanrev-compare` | The same command with `--window START END` after its cost declarations |

Use `help NAME` for the selected command before constructing its positional
arguments. Its target must be the exact literal strategy name in the table;
plans and other catalog targets are not admitted by these routes. Separate
BreakoutVol diagnostics are `backtest-causal`, `backtest-causal-funded`,
`backtest-causal-fees` and `backtest-causal-execution`; they are not the
strategy/cash/passive comparison.

Use an explicitly supplied CSV and symbol declaration. No causal route silently
substitutes generated data. The symbol declaration does not authenticate the
file's origin. On Linux, the input must be a regular file or a symlink resolving
to one; FIFO, directory and device inputs are rejected. The complete UTF-8 file
must have the exact header `Timestamp,Open,High,Low,Close,Volume`, strictly
increasing Unix-second timestamps and canonical unsigned numeric tokens.
Limits are 1 MiB, 10,000 data rows and 32 bytes per numeric token. LF and CRLF
are supported. Use the help's price, OHLC, volume, timestamp and declaration
bounds; CSV prices use float64 parsing, not exact-decimal arithmetic.

Declare initial simulated cash, fixed filled-side fee, fee basis points and
BUY/SELL adverse basis points as the selected help requires. For example, this
is one **uncalibrated zero-cost synthetic scenario**, not realistic execution:

```bash
./gelt.exe backtest-causal-compare BreakoutVol TEST owned.csv 100 0 0 0 0
```

Replace the example file, symbol and assumptions with the task's actual supplied
inputs and declarations. Comparisons use flat cash and one passive buy capped
at simulated $10 including its entry fee. There is no funding resize, loan,
rebalancing, forced terminal sale or SELL cost without a SELL.

For selected periods, START is inclusive and END exclusive. Both must match
supplied timestamps, except END can be the complete source's last timestamp
plus **one second**, not the next cadence interval. The selected replay consumes
exactly twenty preceding warmup rows for BreakoutVol/MeanReversion or fifty for
TrendConfluence.
All source rows, including excluded rows, are validated. Finite-prefix indicator
reseeding is a separate simulation, not a filtered full-history replay.

Read the bounded human summary with its exposure, protection, turnover, fee and
terminal-state disclosures. Original-OHLC event checks are conditional on
normalized signals; they do not independently establish indicator decisions,
authenticity, adequate/converged history, cadence/session eligibility, calibrated
costs or profitability. MeanReversion's 0.5/1.5 protection multipliers are
explicit uncalibrated defaults. No machine-readable comparison export is implied.

Retain the command's exit status and diagnostic. Nonzero means the command
failed; stdout may contain a prefix after an output failure and must not be
treated as a complete result. Do not automatically replay an uncertain action.
Source delivery and synthetic results leave NOT_READY / CLOSED / DEFER intact.

## Legacy and operational references

Legacy `backtest <PlanOrStrategy> <Symbol> [DataFile.csv | Days]` is a different
CSV/generated-synthetic diagnostic. Without a CSV it generates wall-clock-seeded
data; it is not deterministic historical evidence or a substitute for the
supplied-CSV comparison workflow. Its registry and parser behavior also differ.

Commands such as `health`, `test-suite`, `risk`, `scan`, `macro`, `shadow`,
`telemetry`, `dashboard`, authentication and trading can access configuration,
integrations or operating state. Use them only within the actual task's existing
authority. They are not verification steps for an offline CSV comparison, and
loading this skill grants no acquisition, credential, shadow or trading scope.

For separately authorized shadow execution, retain the existing requirement to
record shadow logs and trade theses through `GELT_BEADS_BRAIN_PATH` with
`[bd-3qwe self-doc]` anchors.

For source changes, follow repository `AGENTS.md` and
`.agents/skills/ticket-delivery/SKILL.md` with scoped tests and owned offline
fixtures. Do not substitute the integration `test-suite` or a configured
dashboard for those checks. Preserve any stricter current operating, access and
unknown-outcome holds.
