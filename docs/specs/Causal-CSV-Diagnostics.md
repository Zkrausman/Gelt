---
type: completion_report
title: Supplied causal CSV input diagnostics
---

# Supplied causal CSV input diagnostics

`gelt diagnose-causal-csv <DataFile.csv>` checks one explicitly supplied file
through the existing regular-descriptor admission and bounded CSV parser, closes
it once, then checks complete common bar-domain admission. It does not construct
an engine, resolve a strategy/symbol, interpret money or costs, select a scoring
window, replay, acquire input, modify input or initialize configured services.
A valid single row can pass; success establishes only unqualified input syntax
and common domain admission, with no source, warmup or operating qualification.

The existing parser signature and its directly comparable `causalCSVError`
constants are retained. A single detailed syntax primitive supplies fixed
reasons/physical coordinates to the new command and projects its code to the
old parser. Accepted/rejected bytes, LF/CRLF behavior, final-ending handling,
float64 conversion, resource bounds and stage precedence remain unchanged.

`backtest.DiagnoseCausalBars([]OHLCV) *CausalInputIssue` independently exposes the
same pure domain primitive used by `causalValidateBars`. It returns nil for
admitted input, otherwise only fixed Code/BarIndex/Field/Reason. BarIndex is
zero-based or -1 for whole-input failure. The caller owns immutable access
during the call; there is no snapshot/concurrency guarantee. The old
`CausalError`, result/error schemas and admission code/index stay unchanged.

Domain predicate order is empty input, over-10000 input, then each original row:
Timestamp range, strict increase, Open/High/Low/Close ranges, Volume range and
combined OHLC geometry. Timestamp is 1..253402300799; finite prices are
0.01..1000000 and finite Volume 0..1e12. Geometry failures use field `OHLC`
without assigning a culprit price. All rows are admitted before any future
window selection; the diagnostic itself selects no window.

## Text and failure precedence

Wrong arity emits fixed usage plus invalid_arguments in one stderr attempt,
without opening. Correct arity with an already canceled context returns canceled
before opening; nil context becomes Background. Max+1 bounded read/byte cap,
reader error, UTF-8, line/data count, then header/row syntax precede domain.
Within each row, field count and all canonical token checks in column order
precede Timestamp and float conversion. A conversion fault in an earlier row
still precedes a lexical fault in a later row. Parse failures precede close
failure; successful parse/close precedes cancellation, domain and final
cancellation checks. Context cannot interrupt a blocked read or set an I/O SLA.

Failure exits 1 with empty stdout and one fixed diagnostic on stderr:

```text
diagnose-causal-csv: CODE line=LINE field=FIELD reason=REASON
```

Physical line 1 is the header; bar index 0 maps to line 2. Unlocated issues use
literal `none` for both line and field. The renderer validates closed compatible
code/reason/field combinations and bounded coordinates, with domain indices
checked against actual parsed length. Unknown or inconsistent issues produce
only `diagnose-causal-csv: diagnostic_unavailable`. No values, source rows,
headers, filenames, paths or reader/OS/conversion/writer errors are formatted.

Success exits 0 with empty stderr and the exact three-line body:

```text
Causal CSV syntax/domain check: passed
Data rows: N
Scope: unqualified input only; symbol, costs, warmup, strategy and operating admission not checked.
```

Reports, including combined usage/error, are complete valid UTF-8 and at most
512 bytes before one write attempt. Nil/short/error stdout returns 1 and attempts
only `diagnose-causal-csv: output_error` once on stderr. Failed stderr is not
retried; an attempted success can have left a prefix. No atomic-output guarantee
or retained receipt is added.

Static chooser/global listings add the command. Existing help dispatch provides
`help diagnose-causal-csv` and sole `--help`/`-h` aliases. Its new detail documents
literal filenames as `./--help`/`./-h`. All nine older detail bodies and other
data/help grammars retain their bytes; established help uses its 16384-byte cap.
The operator skill adds a bounded recovery sentence with no operating authority.

## Changed files

- `cmd/gelt/backtest_causal.go`: one detailed parser plus old fixed-error wrapper.
- `cmd/gelt/diagnose_causal_csv.go`: file lifecycle, issue validation and reports.
- `cmd/gelt/diagnose_causal_csv_test.go`: coordinates, boundaries, precedence,
  compatibility, domain projection, cancellation and output/privacy assertions.
- `cmd/gelt/diagnose_causal_csv_linux_test.go`: FIFO/device children and admitted
  inode replacement, close ownership and unchanged owned bytes.
- `pkg/backtest/causal.go`, `causal_input.go` and `causal_input_test.go`: shared
  domain primitive, public issue/API and independent original-predicate oracle.
- `cmd/gelt/main.go` and `offline_help.go`: early offline dispatch/static discovery.
- `README.md`, `cmd/gelt/README.md`, `skills/gelt-operator/SKILL.md` and this
  specification: input-repair usage, scope and output behavior.

## Verification status

Two focused race checks passed for `./cmd/gelt ./pkg/backtest` with
`-run 'Test(DiagnoseCausal|BacktestCausalCSV|OfflineHelp|OfflineCSVFile|Causal.*Admission)' -count=1`.
The second pass included all final Go code/tests, with matching content hashes
before and after execution; only this verification prose changed afterward.
These are uncommitted working-source results. The tests cover physical first/
last-row coordinates, LF/CRLF/final endings, independent increasing-timestamp
byte-limit positives, stage precedence, fixed old parser errors, old detailed
help hashes, the frozen original domain predicate, nonfinite API boundaries,
combined geometry, descriptor ownership, canceled contexts and bounded writer
attempts. FIFO/device child processes settled with their expected complete
diagnostics; no watchdog expired. The complete-diff self-review and
`git diff --check` passed with only the listed files.

Parent-owned broad checks, independent/adversarial reviews, compiled main
integration and exact-final-source acceptance remain separate gates; none are
claimed by these working passes.
