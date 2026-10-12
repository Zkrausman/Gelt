---
type: specification
title: "ZAR-239: bounded private synthetic companion transport candidate"
issue: ZAR-239
status: integration-partial-unverified
baseline: "689aba9b6e20a57df15647cdbb057b68f0c88fa3"
runtime: "Additive V2 / Node 22 / TypeScript"
execution_enabled: false
scope: "Explicitly constructed worker-owned loopback HTTP transport around the ZAR-238 synthetic kernel; no startup, BFF or UI integration"
changed_files:
  - v2/worker/src/synthetic-companion-transport.ts
  - v2/worker/src/synthetic-companion-transport.test.ts
  - v2/IMPORT-MANIFEST.json
  - docs/specs/ZAR-219-Integrated-Offline-Trading-Screen.md
  - docs/specs/ZAR-239-Bounded-Private-Synthetic-Companion-Transport.md
verification:
  focused_tests: 21/21-local-node24
  worker_typecheck: passed-local-node24
  v2_build_and_offline_smoke: passed-local-node24
  go_race: passed-local
  import_manifest_refresh: passed-local-node24
  import_verification: passed-local-node24-82-upstream-406-candidate
  independent_review: candidate-p2-follow-up-pending
  operator_ci: pending
---

# 🔒 ZAR-239 bounded private synthetic companion transport integration

## 🎯 What

This separate operator integration of the immutable UNVERIFIED Squire candidate adds `v2/worker/src/synthetic-companion-transport.ts`,
an explicitly constructed HTTP listener around the existing ZAR-238 synthetic
preview kernel. The factory is disabled unless `enabled: true` is passed, and
the listener is not imported by `setup.ts`, `index.ts`, the existing worker
service, BFF or UI. The listener binds only to `127.0.0.1`; its one accepted
operation is `POST /v1/synthetic-companion/preview`. The caller address passed
to the kernel is captured from the accepted socket, never from request JSON.

Provisioning is an in-process, non-HTTP lifecycle seam: after explicit start,
a private caller supplies an opaque owner-session token and its expiry to
`provisionIdentity()`. The worker retains the binding and returns the random
short-lived identity credential only to that caller for out-of-band delivery.
Requests carry the credential only in `Authorization`, with identity and owner
session binding in strict headers; there is no status/provisioning HTTP route.
`revokeSession()` removes the binding on owner-session loss. `stop()` revokes
all provisioned sessions before closing connections; starting the same
transport again cannot reuse previous identities or credentials. State remains
process-local and is dropped on process restart.

The HTTP boundary rejects non-loopback peers, mismatched Host, unknown or
repeated headers, wrong method/path/query, invalid content type/length, chunked
input, oversized bodies, stale owner sessions, malformed schemas and invalid
kernel authentication. Requests and headers have small configured limits;
connections, concurrent handlers, request/header timeouts and keep-alive are
bounded. Operator integration also enforces a hard five-second wall-clock
socket deadline from TCP acceptance, including incomplete headers, after an
independent reviewer found the candidate's pre-header stall gap. A red-before
raw-socket regression failed after 6.5 seconds; it passed after the correction.
A follow-up reviewer noted the initial test did not demonstrate trickle or
all eight accepted slots. The operator expanded it to start trickling before
the ninth probe, require that probe to connect before its subsequent drop
counts as saturation, record all eight closure times within a tolerant bound
from connection, and require observed trickle writes. The strengthened case
passed locally and in three further isolated Windows repetitions. Handled
HTTP failures use one fixed non-revealing JSON body; pre-header parser errors
get an empty 400 and acceptance-deadline expiry closes the socket without a
response. Credentials are not included in responses or logged. Successful
output is only the kernel's strict
synthetic preview with its explicit injected quote/fee facts and exact-decimal
fee-inclusive USD ≤10 calculation. The transport rejects a nonce that would
otherwise echo the bearer credential in the kernel response. No requested quote
or fee fallback is added; all response authority/broker/execution flags remain
false.

## ⚠️ Risk

This is an isolated, unwired partial integration, not production provisioning or an end-to-end M8
companion. The provisioning closure trusts its in-process caller to have
validated the owner session; there is no separately reviewed OS credential
store, CLI, companion process, authenticated IPC, or BFF session revocation
hook. A caller holding the issued credential and owner-session token can use
the transport until expiry/revocation. The credential is returned once to the
provisioner by design and must be delivered out-of-band; no delivery mechanism
is implemented here. Source binding remains the synthetic kernel's in-process
association check, not external source attestation. Multiple independently
provisioned identities for one owner session can still preview the same terms;
there is no durable session-wide one-use intent, reservation, dispatch or
receipt reconciliation.

No production startup route, BFF/UI route, external network exposure,
Pi-fixture takeover, provider, OAuth, broker, `OrderLifecycle.confirm()`, order
state machine or execution capability was added. ZAR-238, ZAR-219 M8 and all
order authority remain open. Do not treat this as an account, quote, fee,
preview, authorization or broker fact.

## 🛡️ Solution

Keep the factory outside production setup and require explicit construction and
start. Bind the transport to IPv4 loopback, validate the peer using the accepted
socket, accept only one named request, and pass no caller-selected peer value to
the kernel. Keep credentials out of URLs and HTTP response bodies, make all
failures non-revealing, bound resources, retain identities only in memory, and
revoke on session loss/stop. Keep all market facts explicitly injected and
synthetic; preserve the kernel's strict schemas, replay guards and exact decimal
cap. Further promotion requires a separately reviewed provisioning and session
integration, complete import accounting, focused and cumulative offline checks,
independent review and operator-owned gates.

## Changed-path inventory

- `v2/worker/src/synthetic-companion-transport.ts` — new default-disabled,
  explicitly started loopback HTTP transport, private in-process provisioning
  and revocation seam, strict bounded request handling, generic failures, and
  process stop/restart invalidation.
- `v2/worker/src/synthetic-companion-transport.test.ts` — focused HTTP/lifecycle
  regressions for default-disabled behavior, wrong peer/identity/
  credential/session/Host, credential-echo prevention, duplicate and stale
  inputs, oversized bodies, independent identity/session expiry, concurrency
  saturation/recovery, revocation, stop/restart and eight saturated,
  trickling stalled pre-header sockets.
  Operator-focused Node24 tests passed 7/7 here; the underlying kernel passed 14/14.
- `v2/IMPORT-MANIFEST.json` — refreshed two new local file hashes with
  scope-specific reasons; operator import verifier passed 82 upstream/406 candidate.
- `docs/specs/ZAR-219-Integrated-Offline-Trading-Screen.md` — identifies the
  ZAR-239 child partial integration while preserving the normative M8-open status.
- This specification — records implemented scope and missing gates.

## Verification evidence

The preserved Squire candidate ran **no** tests, typecheck, build, import or Go
checks, despite the configured command policy. In a separate operator worktree,
local Node24 focused tests initially passed 6 transport and 14 kernel cases;
independent candidate review then identified the five-second pre-header gap.
The operator's new raw-socket regression failed red (one failure, six skipped),
then passed after a connection-acceptance deadline was added. The strengthened
trickle-and-slot regression passed locally, including three isolated repetitions
after its assertion correction. Focused tests passed **21/21**, worker
`tsc --noEmit` passed, import verification passed **82 upstream/406 candidate**,
local V2 build passed and `go test -race ./...` passed. First local offline smoke failed due absent private fixture parent, second
failed because the parent was supplied with forward slashes; using an explicitly
chosen owner-private canonical Windows path allowed the final smoke to exit 0
with both PASS lines. The occupied-port failure printed during smoke is its
expected negative case. Preserve those earlier failures as failed receipts.

The candidate review's P2 pre-header finding is corrected locally but awaits
independent follow-up; supported Node22/native Windows exact-head hosted CI,
full cumulative source tests and merge gates remain pending. This partial
integration is not an M8 acceptance, a production channel, or activation
permission.
