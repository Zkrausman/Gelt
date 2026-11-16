---
ticket: GENERATED-DEMO-LABEL-DISPLAY
title: Bound legacy generated-demo label display
base_commit: a844ae09024e3460bad1980ae78f9a1439392526
status: implementation-working-verification
---

# Generated-Demo Label Display Boundary

## Behavior

The generated-demo `signals` success heading and existing error prefix, and the
`scan` result row, render their symbol label through one display-only byte
renderer. ASCII letters, digits, period, underscore, colon, slash, and hyphen
remain unchanged. Empty labels and labels longer than 64 input bytes use the
fixed text `label_unavailable`. Each other byte in a nonempty label of at most
64 bytes is rendered as lowercase printable `\xHH`, keeping the output at or
below 256 bytes and preventing control bytes or table delimiters from becoming
output structure.

The change preserves existing symbol defaults and uppercasing, calculations,
configuration loading, command admission, numeric output, and all other command
paths. It is not source authentication, a machine-readable format, or general
CLI/config sanitization. The fixed generated `signals` inputs do not provide a
reachable evaluation-error fixture; the existing error-prefix callsite uses
the same tested renderer but that branch is not claimed as runtime-tested.

## Changed Files

- `cmd/gelt/main.go`
- `cmd/gelt/generated_demo_label_display_test.go`
- `docs/specs/Generated-Demo-Label-Display.md`

## Working Verification

- Focused synthetic formatter and actual-main race tests passed:
  `go test -race ./cmd/gelt -run 'TestRenderGeneratedDemoLabel|TestSyntheticSignalsEscapesDisplayedLabelOnly|TestSyntheticScanEscapesDisplayedLabelOnly|TestSyntheticSignalPresentationProcess' -count=1`
  (exit 0; `ok gelt/cmd/gelt 5.098s`).
- The first focused attempt failed because the scan-output oracle did not
  account for the existing eight-column symbol field. The test expectation was
  corrected to preserve that padding; this was an acceptance-fixture failure,
  not a production behavior change.
- Full working verification passed: `go test -race ./...` (exit 0; all
  packages passed, with `cmd/gelt` completing in 66.378s) and
  `go vet ./...` (exit 0). Formatting and diff checks passed.
- Fresh independent and distinct adversarial source/privacy reviews approved
  candidate `dc75482d2eb1d89f9670628927dda8d78d9ee2d3`, with no actionable or
  privacy findings.
- Fresh final review and final-head verification, followed by hosted CI, remain
  pending. Working checks and initial reviews are not claimed as final gates.

## Limits

Labels are display text only. This change does not establish symbol identity,
market-data provenance, trading eligibility, or operating readiness. It does
not change financial calculations or any provider/runtime path.
