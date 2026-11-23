---
type: completion_report
title: Supplied-CSV offline command discovery
---

# Supplied-CSV offline command discovery

> Additive unknown-command boundary (2026-11-14): this original help-delivery
> report records its historical raw-prefix compatibility below. The separate
> [fixed unknown-command diagnostic](Unknown-Command-Diagnostic.md) supersedes
> only that unmatched-command prefix: fixed stderr reason, unchanged global
> usage, exit 1, and no operand echo. Help grammar and all recognized dispatch
> behavior remain governed by the existing contracts.

The original delivery exposed nine strict supplied-CSV routes in global help
and a separate offline chooser. The current
[supplied-CSV command table](../../cmd/gelt/README.md#supplied-csv-offline-analysis)
documents eleven entries, including the later
`backtest-causal-aligned-window-compare` and `diagnose-causal-csv` commands.

In the original delivery, `help`, `--help` and `-h` accept no topic, `offline`,
or exactly one of the nine causal names. Each causal name also accepts a sole
`--help` or `-h` operand. Detailed output directly reuses the existing usage
constant and adds purpose, literal target, profile and common input/cost/window
notes. Help never invokes a replay handler or resolves configuration/services.

Unknown help topics return only `gelt help: unsupported_topic\n`; extra topic
tokens return only `gelt help: invalid_arguments\n`, both on stderr with exit 1.
Recognized help succeeds with exit 0. No arguments retain global usage/exit 1;
unknown top-level commands retain the old raw unknown-prefix/usage/exit 1.
Other grammar, including mixed operands, unsupported targets and a full data
invocation whose filename is literally `--help`, goes to the existing dispatch.

Every new help body must be nonempty valid UTF-8 and at most 16384 bytes before
one stdout write attempt. Invalid output makes no stdout attempt and reports
`invalid_output`; nil/short/error stdout reports `output_error`. Diagnostics
are fixed, attempted at most once on stderr, and failures are never retried.
A failed stdout write can already have emitted partial output.

The chooser maps BreakoutVol whole/window and MeanReversion whole/trailing
window to their fixed 20-close profiles (first evaluation 19/fill 20), and
TrendConfluence whole/window to its fixed 50-close profile (49/50). It separates
reference, funding, filled-side fee and adverse-price diagnostics from
strategy/cash/passive comparisons. CSV bounds, exact argument order, declaration
bounds, fee-inclusive entry cap, exact timestamp windows and finite-prefix
reseed limitations are described without adding a strategy or calculation.
The legacy backtest is accurately described as CSV/generated-synthetic.

## Status and telemetry help clarification

Global help describes `status` and `telemetry` as showing sample portfolio
values and notes that they may contact a configured integration. The
dispatcher supplies the example balances and positions regardless of the
integration check. These commands remain outside the supplied-CSV chooser.
The help row and its pure output assertion change without changing dispatch
or telemetry generation.

### Clarification delivery evidence

- `cmd/gelt/offline_help.go` changes the global help description.
- `cmd/gelt/offline_help_test.go` asserts the exact rendered row.
- `docs/specs/Offline-Command-Discovery.md` records the clarification and its
  verification.

Working verification on `3e5edf80417b0be473b3eb759de973f072b6e913` passed.
The focused help race run passed seven tests and 14 subtests. Go 1.26.1
build, vet, and the full race suite passed, with tests in 25 packages.
The existing process test exercised `status` only with isolated temporary
homes and a loopback mock using a fake token. Linux V2 checks passed,
including 2,052 worker/web tests, 77 server and script tests, import inventory,
build, and offline and protected HTTP smoke tests. The worker/web run skipped
28 tests. Scientific verification passed 97 source tests, 97 extracted-package
tests, 18 reference checks, and 27 parity cases.

Independent functional and distinct critical working reviews of the complete
diff found no blocker or high-severity finding. Fresh final reviews and
exact-head verification of this closeout are pending. The clarification does
not affect a protected browser surface. The sections below retain the original
offline command discovery delivery record.

## Changed files

- `cmd/gelt/main.go`: intercept the closed help grammar before dispatch and use
  the bounded renderer for existing global-usage paths.
- `cmd/gelt/offline_help.go`: static chooser/detail/global renderers and bounded
  output, directly using the nine existing usage constants and build version.
- `cmd/gelt/offline_help_test.go`: pure alias, catalogue, topic rejection,
  non-help routing, content, UTF-8/bounds and single-attempt writer checks.
- `README.md` and `cmd/gelt/README.md`: put supplied-data discovery before other
  CLI examples and document inputs, profiles, declarations and limitations.
- `docs/specs/Offline-Command-Discovery.md`: behavior, scope and verification.

All nine handler/usage source files and parser, accounting, strategy, backtest,
notification, configuration, service and telemetry implementations are unchanged.
No live acquisition or operating admission is introduced. Source authenticity,
adequate/converged history, cadence/session eligibility, edge and profitability
remain unestablished.

## Verification and review status

The focused `go test -race ./cmd/gelt -run TestOfflineHelp -count=1` passed.
It exercises all nine name and sole-flag aliases, exact usage retention, catalogue
completeness, fixed topic/argument errors, pass-through of other grammar,
UTF-8/byte boundaries, and nil/short/error writers without retries or global
stdout/environment mutation.

Ordinary working `go test -race ./...`, `go vet ./...` and `go build ./...`
passed with the pinned Go 1.26.1 toolchain, offline module settings and an
isolated environment with the original home hidden and networking disabled.
`git diff --check` passed. Self-review covered the complete source/documentation
diff and found only the six scoped paths above.

Independent and distinct adversarial final review, compiled process integration,
and fresh exact-head delivery checks remain separate gates; these working
checks are not final delivery acceptance. Browser UI acceptance is inapplicable
to this CLI help surface.

## PR #85 hosted Go verification

- The [pull request Go job](https://github.com/Zkrausman/Gelt/actions/runs/45141641341/job/137580816751)
  checked out GitHub's integration commit
  `9e4a82b67def43a13ee0efa947b4e5d535fa5853`. Its tree
  `cf7ed18818aef65e9656e5f2f67a8a9c2bb86448` matches both the reviewed PR
  head and the squash commit.
- The [master Go job](https://github.com/Zkrausman/Gelt/actions/runs/45142171584/job/137582588937)
  checked out the squash commit `b616fb4fcb7e6f91795a0fd4d04648c71717d765`.

Both jobs passed Go build, race tests, and vet.
