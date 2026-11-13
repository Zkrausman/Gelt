---
type: completion_report
title: Linux supplied-CSV regular-file boundary
description: Descriptor-based input admission for the nine existing causal CSV commands.
---

# Linux supplied-CSV regular-file boundary

The nine supplied-CSV causal handlers now admit only opened regular files on
Linux. This includes both whole-input and trailing-window MeanReversion forms.
Each handler uses one private helper to open read-only with `O_NONBLOCK`, then
checks `Stat().Mode().IsRegular()` on the actual descriptor before any CSV read.
There is no pathname precheck, second open, `O_NOFOLLOW`, create/truncate/write
flag, permission change, retry or background I/O worker. Symlinks resolving to
regular files remain supported.

The helper owns an acquired descriptor until admission. It makes exactly one
close attempt for a rejected descriptor and never returns it to parsing. Open,
descriptor-stat and rejected-close errors cannot yield success. An admitted
`*os.File` transfers to the existing handler, preserving its original bounded
parse, close, error precedence and output-suppression branches. Unsupported
non-Linux builds retain the previous `os.Open` behavior in a separate constrained
helper; this is not a portability or platform-support claim.

FIFO, directory, device and other nonregular inputs now intentionally fail on
Linux, including streams that previously happened to parse. The result is exit
1, empty stdout and exactly the existing route-specific `NAME: input_file\n`
diagnostic. Missing/broken paths retain that diagnostic. No raw path, payload,
descriptor type or syscall error is printed. Argument count still precedes
context and input; an already canceled context returns `canceled` before open.
The complete admitted input is parsed and closed before target, window or cost
resolution. Empty/malformed regular files retain `invalid_csv`, and oversized
regular files retain `resource_limit`.

The pure `parseBacktestCausalCSV(io.Reader)` API, grammar, byte/row/token bounds,
domain checks, calculations, profiles, defaults, usage constants, summary bytes
and checked summary-write behavior are unchanged. Dispatch, strategy, backtest,
accounting, notification, configuration and telemetry code are unchanged.

## Guarantees and limits

Nonblocking open followed by descriptor admission avoids FIFO peer/EOF waits
at this Linux boundary. It does not establish a universal wall-clock deadline
for device-driver opens, metadata or stalled regular filesystems. Virtual
filesystems may report regular files, and admission does not authenticate data
or freeze concurrent writes to the same inode. Later context cancellation does
not gain filesystem-I/O interruption semantics. Existing bounded reading and
validation continue to apply.

A controlled pre-change full-input invocation over an owned unwritten FIFO did
not complete within a fixed 30-second deadlock watchdog. Its owned process was
killed and joined, with empty streams and no observed fixture/home changes.
That expected old completion failure is retained separately from candidate
results; it is not a candidate pass or a universal filesystem-cause claim.

Supplied-data authenticity, adequate/converged history, cadence/session
eligibility, statistical edge, profitability and operating admission remain
unestablished. No data acquisition, live/paper trading, credential, security,
promotion or operating permission is added. Existing NOT_READY / CLOSED / DEFER
states and held scopes remain unchanged.

## Changed files

- `cmd/gelt/backtest_causal.go`, `backtest_causal_funded.go`,
  `backtest_causal_fee_scenario.go`, `backtest_causal_execution_scenario.go`,
  `backtest_causal_comparison.go`, `backtest_causal_window_comparison.go`,
  `backtest_causal_trend50_comparison.go`,
  `backtest_causal_trend50_window_comparison.go` and
  `backtest_causal_mean20_comparison.go`: only replace their input-open call and
  remove the unused `os` import.
- `cmd/gelt/offline_csv_linux.go`: nonblocking read-only open and actual
  descriptor admission/ownership.
- `cmd/gelt/offline_csv_other.go`: retain unsupported non-Linux opening behavior.
- `cmd/gelt/offline_csv_linux_test.go`: owned real-file and subprocess tests.
- `cmd/gelt/offline_help.go` and `cmd/gelt/README.md`: brief Linux regular-file
  policy and compatibility/limit notes.
- `docs/specs/Offline-CSV-File-Boundary.md`: implemented contract and evidence.

## Working verification and review status

The new Linux tests cover all nine full handlers and both MeanReversion forms
over actual unwritten FIFOs, with exact exit/stream expectations and owned
kill/join cleanup under a 30-second deadlock watchdog. The watchdog is a failure
detector, not a latency SLA. Every FIFO fixture deterministically replaces a
previously observed regular pathname before the real handler opens it. The
same forms verify pre-cancellation before open.

All ten regular and regular-symlink forms compare complete exit/stdout/stderr
against unchanged typed execution/summary seams over independently constructed
synthetic bars. Actual descriptor tests cover regular admission left open for
the caller, directory/FIFO/device rejection and closure, and closed-descriptor
stat failure. An admitted descriptor parses its original inode after its
pathname becomes a FIFO, without reopening. Empty, malformed, oversized,
missing, directory and device inputs exercise fixed private errors and input
precedence over target/window/cost resolution; wrong-arity cases retain actual
usage text before cancellation. Existing pure-reader tests are unchanged.

Focused `go test -race ./cmd/gelt -run '^TestOfflineCSVFile' -count=1` passed
with exit 0. Ordinary working `go test -race ./...`, `go vet ./...` and
`go build ./...` each passed with exit 0; the complete logs and source-pin
guards were inspected. The full working race command did not specify `-count`.
These checks used the pinned Go 1.26.1 toolchain, offline modules, hidden real
home, unchanged HOME value and disabled networking/integration access.
New subprocess tests do not mutate global stdio/environment or override HOME;
they execute one real handler and join every child. The specification's
verification text was completed after those checks without further Go changes.

Self-review confirmed that each of the nine handler diffs consists exactly of
its open-call replacement and unused import removal. YAML frontmatter is valid.
The scoped complete diff and clean candidate state are checked before freeze.

Fresh independent and distinct adversarial final source reviews, followed by
fresh exact-head delivery checks and the separately frozen 29-case compiled
campaign, remain required gates. Working evidence does not replace final
acceptance. Browser UI acceptance is inapplicable to this CLI input boundary.
