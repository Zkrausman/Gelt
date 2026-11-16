---
type: specification-closeout
title: G05 stop/reopen synthetic conformance
status: implementation-awaiting-validation-and-review
date: 2026-11-16
---

# G05 stop/reopen synthetic conformance

## Scope

This change adds constructed-offline integration assertions for stop and reopen
behavior in the existing synthetic sizing-bound harness. It changes no runtime
or production code and does not qualify a shadow operation or market workflow.

## Required behavior

- A prepared confirmation halted before confirmation is rejected without a
  lifecycle history entry or portfolio change. After close and reopen, its
  token remains rejected, history remains readable, write-like operations stay
  unavailable, and the candidate producer is not called again.
- A committed synthetic fill remains equal as a parsed value in its joined
  history and portfolio through halt and reopen. The committed execution is
  retained once, with no flattening or new producer invocation; the reopened
  harness remains read-only.
- A dispatch with an unknown outcome remains unknown in the joined history and
  preserves the portfolio through halt and reopen. Resume, preview, and
  confirmation stay rejected without another producer invocation.

These are test assertions only. They do not establish actual dispatch, fill,
settlement, strategy, data, or operating qualification.

## Changed files

- `v2/worker/src/candidate-shadow-integration.test.ts` adds two
  stop/reopen integration cases and extends the existing unknown-outcome case.
- `v2/IMPORT-MANIFEST.json` updates the source inventory digest and description
  for that test file.
- This specification records the intended assertions and current verification
  status.

## Verification status

Historical pre-remediation working evidence: the focused
`candidate-shadow-integration.test.ts` suite passed 47 tests in an isolated
disposable ext4 namespace with external networking disabled (exit 0; namespace
sync EOF observed). That run predates the added post-rejection assertions. The
current assertion-only remediation has **NOT RUN**. Full final checks and
independent source reviews remain pending. This synthetic test result does not
establish operating qualification.
