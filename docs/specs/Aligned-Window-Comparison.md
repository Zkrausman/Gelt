---
type: completion_report
title: Fixed aligned-window family comparison
---

# Fixed aligned-window family comparison

`gelt backtest-causal-aligned-window-compare SYMBOL CSV START END CASH FIXED_FEE FEE_BPS BUY_BPS SELL_BPS`
has exactly nine operands and no target/profile argument. It admits one regular
CSV descriptor, invokes the existing bounded parser once and closes once. It
preserves a complete private original and passes separate copies to native
TrendConfluence50, fresh default BreakoutVol20 and MeanReversion20 selected-period
APIs, once each and sequentially. Failures stop before later families. Their
native histories, indicator/default behavior, admission and accounting remain
unchanged; no common fifty-row pre-slice or new evaluator is introduced.

START/END use the existing canonical timestamp parser and exact native window
selection. START requires at least fifty preceding bars; END may equal the final
complete-source timestamp plus one second. Every original row is admitted,
including excluded rows. Each family's unchanged complete-original summary
validator runs before its result enters cross-family alignment. Its native
identity, policy, passive reason and local mapping remain checked independently.

The private projection compares common original/window/symbol/cash/cost/label
metadata, both controls' complete scored marks, entry facts, final holdings,
principal/fee/basis/value/equity/PnL/peak facts and drawdown economics, plus the
complete common scored summaries. Only native control model/policy/length,
entry reason, flat warmup marks and score model identity are omitted. Entry,
mark and drawdown replay indices become scored coordinates; source/scored
drawdown indices and nil shapes are preserved. Bounds precede translation and
bounded loops check cancellation. Comparisons use exact values with no tolerance
or new account arithmetic. Strategy economics are not compared for agreement.

Only a compact baseline control projection and bounded section strings survive
each phase; three complete strategy traces are not retained together. This
adds no runtime, latency, benchmark or convergence guarantee. Native summary
reference checks remain conditional on normalized signals; indicator decisions
and input authenticity are not independently established.

## Output and cancellation

The sole success write follows all native runs, validators, alignment and a
final context check. It contains a common header and the complete unchanged
native bodies in fixed BreakoutVol, TrendConfluence, MeanReversion order. The
header is at most 2048 bytes, each body at most 8192 and the complete valid UTF-8
report at most 32768. Controls, native exposures, protection, turnover,
terminal/open/pending state and fees remain visible in their separate sections.
Data/authority remain unqualified and assumptions uncalibrated; there is no
ranking, tuning, edge, profitability or operating-admission claim.

Wrong arity precedes cancellation/open and emits usage plus one fixed error.
Parse failure precedes close failure, and both precede post-read cancellation.
Cancellation is attributed to input before native work, the active family after
its call/summary, alignment during projection/comparison, and output at the
final pre-write checkpoint. It does not interrupt blocked I/O or roll back a
write. A valid regular symlink remains supported; one read is not an atomic
snapshot of a concurrently modified file.

Failure exits 1 with one stderr attempt:

```text
backtest-causal-aligned-window-compare: FAMILY: CODE
```

The fixed compatible vocabulary bounds diagnostics, including usage, to 512
valid UTF-8 bytes. Unknown/nil/wrong-family native errors and inconsistent
family/code combinations become `input: replay_failed`; raw errors, paths,
source rows and callback text are never rendered. Nil/short/error stdout means
`output: output_error`, without retry; a prefix may remain and nonzero output
is incomplete. Failed stderr is not retried. Static help retains its separate
16384-byte cap and five existing aliases. Literal CSV filenames `--help`/`-h`
among nine operands remain data. All ten prior detailed-help bodies retain their
bytes; discovery changes only add the new command.

## Changed files

- `cmd/gelt/backtest_causal_aligned_window_comparison.go`: fixed typed runners,
  one input lifecycle, validation, normalized alignment and bounded reports.
- `cmd/gelt/backtest_causal_aligned_window_comparison_test.go`: independent hand
  control facts, native integration, counts/copies, forged result/projection
  checks, admission/cancellation/privacy, help and output attempts/bounds.
- `cmd/gelt/backtest_causal_aligned_window_comparison_linux_test.go`: disposable
  descriptor/FIFO/device/symlink/path-replacement children, watchdog settlement
  and unchanged owned input bytes.
- `cmd/gelt/main.go`, `cmd/gelt/offline_help.go`: direct dispatch and static help.
- `README.md`, `cmd/gelt/README.md`, `skills/gelt-operator/SKILL.md` and this
  specification: exact interface, shared controls and retained limits.

Existing core, parser, validators, public result/API types, strategies,
indicators, accounting, configuration and service source are reuse-only.

## Working verification status

The first focused race run found a fixed-fee hand quantity assertion using the
nearest binary representation of mathematical 0.9. The retained nonzero-scenario
policy instead rounds mathematical 9/10 downward to binary64, with bits
`0x3feccccccccccccc` (0.8999999999999999); all literal monetary expectations in
that failure matched. The owned test uses those explicit bits and an independent
exact rational boundary check. Production sizing and accounting were not changed.

The corrected focused working race command passed:

```text
go test -race ./cmd/gelt -run 'Test(AlignedWindow|OfflineHelp|DiagnoseCausalCSVOldDetailedHelpBytes)' -count=1
```

Complete source-content hashes matched before and after that uncommitted run;
only this verification prose changed afterward. It covers native section bytes
and call/copy order, literal hand control economics, result/projection forgeries,
admission/cancellation/error precedence, diagnostic privacy, output attempts,
synthetic report boundaries and all ten frozen old detailed-help bodies.
Disposable Linux children settled with expected complete outputs; no watchdog
expired, and owned input bytes remained unchanged. Synthetic assembly guards
are distinguished from reachable native reports; native integration and
low-cash fee admission checks do not independently prove strategy/account math.
The complete actual diff self-review and `git diff --check` passed with only
the nine scoped files. Broad checks, compiled real-main integration and
independent/adversarial final-source review remain separate parent-owned
acceptance gates; this working pass does not claim them.
