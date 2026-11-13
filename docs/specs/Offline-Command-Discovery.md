---
type: completion_report
title: Supplied-CSV offline command discovery
---

# Supplied-CSV offline command discovery

The CLI exposes its nine existing strict supplied-CSV routes in global help and
a separate offline chooser. `help`, `--help` and `-h` accept no topic, `offline`,
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
