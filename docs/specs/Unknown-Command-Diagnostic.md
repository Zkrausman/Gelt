---
type: specification
title: Fixed unknown top-level command diagnostics
description: Suppress unmatched CLI operands in ordinary error output while preserving recognized dispatch and bounded global usage.
timestamp: 2026-11-14T00:00:00Z
---

# Fixed unknown top-level command diagnostics

An unmatched top-level operand previously entered stdout through a raw `%s`
prefix. That could echo terminal control bytes, apparent log lines, long operand-sized
text (subject to OS argv limits) or a mistakenly supplied private value. This correction emits fixed
`gelt: unknown_command\n` on stderr and exactly the existing global usage on
stdout, then exits 1. The helper accepts no operand argument, fragment or digest.
This intentionally changes only the unknown-command diagnostic streams.

Recognized commands, help aliases/closed topics, no-argument usage/exit1,
strategies, CSV admission and calculations are unchanged. Global usage retains
its existing UTF-8/16384-byte bound and single-attempt writer handling. Nil,
short or failed usage writes still return failure and may add a fixed help
output-error diagnostic; failed writes can leave prefixes. No retry or atomic
output guarantee is introduced. Arguments already visible to the OS/caller are
not made secret, and other command diagnostics are outside this correction.

## Changed files and verification requirements

The main default calls the operand-free writer in `cmd/gelt/unknown_command.go`.
`cmd/gelt/unknown_command_test.go` specifies fixed streams/exit and nil/short/error
writers, plus actual default dispatch in owned subprocesses. CLI README and an
additive note on the historical help report explain the narrow compatibility
change. No operational handler is invoked by acceptance.

Required synthetic compiled cases include typo, empty token, newline/CR/ESC,
owned private marker, long token and Linux invalid UTF-8 (no NUL argv case), with
unchanged detailed/global help, no-args and harmless recognized routes. All
operands are synthetic; no real secret exposure is asserted. Exact source/privacy
reviews and fresh mandatory Go/V2/scientific/CI gates remain prerequisites to
publication. Source preparation and format/patch checks do not establish that
these unrun tests passed. No source delivery or fixture establishes acquisition,
calibration, qualification, trading or operating authority.

## Working verification (2026-11-15)

The implementation passed focused race-enabled unknown-command tests, the full
Go race suite, Go vet, all-package build and compiled CLI build. Compiled
acceptance passed six unknown-input cases (including invalid UTF-8 and extra
operands) and sixteen safe recognized-route comparisons against the shipped
binary: 38 isolated process cases with exact stream/exit checks. All eleven
detailed offline help bodies, global help, chooser, no-args, version and a
malformed CSV-diagnostic invocation retained their existing bytes and exits.

The first full Go race attempt failed because the isolated test filesystem
omitted the system `awk` symlink target used by an existing deployment fixture.
That failure is retained. Exposing the existing executable read-only inside
the disposable namespace corrected the harness; a separate full race attempt
then passed without a product-source change.

The earlier two static reviews accepted only the unapplied proposal. Complete
postimplementation source/privacy review and fresh final-head gates remain
required. V2 verification is unrun for this increment and remains a mandatory
prerelease gate. No PR, hosted CI, delivery or operating acceptance is established
by these working checks.
