---
type: Specification and Completion Report
title: G03 replacement preview failure provenance
description: Bounded fixture-only phase and outcome receipt before existing browser preview assertions and cleanup.
timestamp: 2026-10-13T00:00:00Z
status: diagnostic-candidate-awaiting-complete-review-and-exact-head-ci
---

## Observed failure and boundary

Diagnostic master `fc0c67d52070e69abb4db4d8dd27b2576bcae817`, tree
`3c4f368d013e75e5ae3f766c44c1d03c965f420c`, passed Go `38331401359`, Linux
and scientific checks. Integrated V2 `38331401323`, native Windows check
`115081713174`, failed the existing browser application-mock test: replacement
preview count was one instead of two at `synthetic-browser-demo.test.ts:328`.
417 worker tests passed, 9 platform skips; build and smoke were skipped.
Both targeted corruption tests passed with replay rejection, no error replacement
and retained mock markers. The older `38318643449` corruption mismatch remains
unexplained; the default absent-storage-diagnostic sentinels do not prove a
helper protocol failure.

Both original reviewers confirmed that equality permits replacement at the
inspected browser/demo/lifecycle/mock boundaries. The count proves only that
the shim did not record a second successful preview. It does not establish a
missing request, HTTP/validation rejection, transport error or deadline. This
increment captures that missing evidence; it does not fix an established cause.

## Implemented diagnostic source

Only the affected existing application-mock test explicitly opts into the
fixture's preview diagnostics. A fresh in-memory collector belongs to that
fixture; no callbacks, files, stores, public response fields or new routes are
added. It requires `NODE_ENV=test` and both exact existing isolated harness/mock
opt-ins. Fallback fixtures cannot select it. The test resets its collector before
the exact replacement attempt and logs a sanitized snapshot before the unchanged
count matcher and cleanup. The browser shim records only request-issued boolean
and HTTP status, or `no-response`; no response body, exception text, path, preview
ID, token, grant or account identity is copied.

Fixed events identify lifecycle preview/storage, harness admission, mock admission,
mock client, demo forwarding and the outer demo handler. The outer handler's
rejection event is not proof of input-validation failure. The lifecycle storage
guard records the existing sanitized diagnostic before returning its unchanged
generic unavailable result. Outcomes distinguish actual
timer callbacks from transport error, non-200, parsing/bounds rejection and
success. A timer outcome records its invocation, not an inferred historical
timeout or proof of remote non-effect. The existing sanitized storage
stage/operation/check/kind is retained where an underlying error is available.
At most 24 immutable entries are returned; truncation is explicit. Reading a
snapshot neither retries nor changes the underlying operation.

Existing expiry, auth, preview-count, admission, bounds, cleanup, corruption and
ownership assertions remain. All exception flattening and request/response
destroy behavior remains; every guard and timeout retains its original value.
The default 5-second mock-client and 45-second forwarding budgets are not changed.
No dispatch/provider behavior, human per-trade gate or production telemetry is
introduced. This is scripted fixture evidence, not autonomous or owner acceptance.

Changed files: diagnostic collector and pure tests; existing browser demo/test,
fixture harness and mock transport; import manifest; this specification.

## Verification and closeout

Static import inventory and whitespace checks precede a complete final review
by the original independent and adversarial owners. The complete diff includes
this specification and named transport/storage/lifecycle callers. No new
exact-head CI executes before both reviews pass. Required Go build/race/vet,
V2 unit/build/smoke, Linux/browser, scientific and native Windows gates remain.
Every accepted remediation requires fresh complete reviews and new exact-head
verification. Candidate and integrated outcomes are recorded separately on the
PR and delivery receipts; earlier passing runs do not override either failure.

Both failed runs remain preserved. No unchanged rerun, local listener/ownership/
cleanup probe, dependency installation or held acceptance action is performed.
If this changed candidate passes without recurrence, it verifies capture on the
observed successful path and leaves the prior cause unknown. A functional
correction requires causal evidence and its own complete review/gates.
