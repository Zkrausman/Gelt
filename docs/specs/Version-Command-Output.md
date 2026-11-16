---
type: specification
title: Reliable version-command output status
description: Preserve the version line while rejecting incomplete or failed stdout writes.
timestamp: 2026-11-16T00:00:00Z
---

# Reliable version-command output status

The CLI version entry point is used by operators, assistants and integration
tooling. Previously it ignored the result of `fmt.Printf`: a compiled Linux
process with stdout directed to `/dev/full` delivered no version text yet exited
0 with empty stderr. That reproduced a false success, independently of any data,
configuration, provider or operating service.

The version route now succeeds only when one stdout write accepts the complete
unchanged `gelt version <Version>\n` body with a nil error. Nil writers, short or
invalid counts and errors (including a complete count with an error) return 1.
Failure attempts fixed `gelt version: output_error\n` on stderr once when a
writer is present. Diagnostic failure remains failure; writer error strings and
operands are never included. No retry, latency limit, atomic output, persistence
or downstream-consumption guarantee is added. A failed write can leave a prefix.

The successful bytes, compiled version constant, existing version operand
handling and all other dispatch, help, data, strategy and operating boundaries
remain unchanged. This is an output-status correction, not a new version format
or a machine-readable comparison export.

## Changed files and acceptance

`cmd/gelt/main.go` delegates only the version case to
`cmd/gelt/version_command.go`. Its tests cover exact output, writer counts and
errors, single-attempt diagnostics and owned subprocesses through actual main,
including closed stdout and the previously ignored extra operand. The CLI README
documents the narrow semantics; this specification records the correction.

The closed-stdout subprocess test closes the writer after runtime startup.
Go 1.26.1's Unix runtime reopens a standard descriptor closed before program
startup as `/dev/null`; an accepted write there may still return success. This
correction does not override that runtime behavior or certify a receiver.

Required compiled acceptance checks compare successful version and existing safe
offline routes with the shipped baseline, and require failure with the fixed
diagnostic for a failing output sink. Tests use synthetic operands, disposable
homes and isolated offline processes. Full source/privacy reviews and fresh
required Go/V2/scientific checks precede publication and automatic exact-head CI.
Source fixtures do not establish data authenticity, calibrated costs, qualified
runtime, trading or operating admission.

## Working verification

Focused version tests, the full Go race suite, Go vet, all-package build and
CLI build passed in isolated offline resources. Compiled working acceptance
covered 45 distinct process cases: seventeen byte-identical safe-route pairs,
six fixed unknown-command cases and five version sink cases. The failing
`/dev/full` sink returned 1 with the fixed diagnostic; failure of that diagnostic
sink also remained failure. All owned process exits and sandbox lifetimes were
observed, with disposable homes unchanged.

The original compiled fixture incorrectly expected a descriptor closed before
runtime startup to fail. Its failed assertion and actual process results remain
retained; the documented runtime source establishes why the accepted write may
succeed. No passing working case was replayed to correct that oracle. One earlier
harness import failure occurred before any check process was launched and is
also retained. Neither issue required a production correction. These working
results precede the required complete source/privacy reviews and fresh final
verification; they are not publication or operating acceptance.
