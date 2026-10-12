---
type: Specification and Completion Report
title: Protected reference-computation evidence inspection
description: Read-only Paper2Agent evidence UI and named owner-authenticated store reads.
timestamp: 2026-10-07T00:00:00Z
---

# Scope

This additive ZAR-209/ZAR-231 slice displays a bounded reference computation. It
is not acceptance of the full research-to-shadow epic, historical evaluation,
market edge, broker execution, shadow observation, or permission to promote.

## Implemented boundary

`/research` is a separate read-only view. Public HTML contains no private evidence;
owner-session authenticated POST reads use the existing ConnectionBff ingress,
exact Host/Origin, cookie and CSRF checks. The narrowly named `research-list` and
`research-detail` operations call core `listResearch`/`readResearch` directly.
They do not contact the worker transport, broker, artifact URLs or any provider.
A broker account/connection is not required. The existing owner bootstrap is
still required and its credential/config policy is unchanged.

The explicit `GELT_RESEARCH_ROOT` reaches only the web role in configured runtime
mode. No browser input selects a filesystem root, and startup does not provision,
import, repair ACLs or execute artifacts. Core private-root marker, separation,
original-byte SHA-256, strict original JSON and schema checks remain authoritative.
Missing configuration returns unavailable, an empty provisioned store returns an
empty library, and missing/corrupt reads do not become valid evidence.

List responses expose at most 100 IDs and read states. Detail responses use the
shared record schema. Both include authoritative owner-session expiry and the BFF
rechecks expiry immediately after the core read. Browser responses are size-bounded,
schema checked and detail identity checked; duplicate list IDs are rejected.
The shared 512 KiB response limit accounts for compact numeric literals expanding
during serialization. Canonical evidence is capped at 508 KiB before import, with
4 KiB reserved for Gelt/session metadata. The BFF also enforces the full wire
limit. An actual import-to-BFF-to-client regression covers this expansion, with
exact-boundary client checks and oversized-canonical-evidence rejection.

## Display and request safety

All artifact fields are inert React text; source identifiers are not navigable
URLs. Paper/code/Paper2Agent source pins and licenses, data assumptions, actual and
expected numbers, explicit absolute/relative tolerances, dependency versions, hash
metadata, limitations and insufficient_evidence recommendation are displayed.
Producer claims are visually separate from Gelt local schema/integrity/numeric
checks. Numeric comparison only compares producer-supplied numbers/tolerances;
scientific reproduction remains not_run. Inner hashes, source authenticity and
execution claims are explicitly not independently verified. Historical, shadow
and costs stay not_run, and promotionAllowed remains false.

The page has no upload/run/promote/trade controls. Every new request supersedes and
aborts the prior generation. Late success/error/finally handlers cannot restore
old evidence. Editing/restoring CSRF, Clear evidence, navigation/page restoration,
read failure and known session expiry clear evidence. Browser visibility restoration
checks the expiry deadline. No evidence or CSRF is written to local storage. The focusable main container
owns viewport-height vertical scrolling with border-box sizing, preserving access
to long numerical/provenance/recommendation sections despite global hidden
document overflow. Hosted Playwright must demonstrate real wheel and keyboard
reachability at desktop and narrow widths; full-page screenshots alone do not
prove scroll access.

## Changed files

- `v2/web/app/research/{page.tsx,evidence-detail.tsx,research.module.css}`
- `v2/web/lib/{research-response.ts,research-requests.ts}`
- `v2/web/lib/{research-bff.test.ts,research-requests.test.ts,research-view.test.ts}`
- `v2/web/lib/connection-bff.ts`: named authenticated local read branches only
- `v2/web/app/page.tsx`: additive navigation link only
- `v2/scripts/runtime.mjs` and `runtime.test.mjs`: web-only explicit root seam
- `v2/scripts/running-next-research-read-smoke.mjs`: explicit offline HTTP integration
- `v2/IMPORT-MANIFEST.json`: final assembly must reconcile all lane hashes

## Verification and remaining acceptance

Local Node 24: 12 focused research tests passed; 10 runtime tests passed; web
TypeScript passed; production server/worker/web build passed. The protected BFF
unit integration imports the exact real MCP-produced 12,160-byte artifact with
SHA-256 `c386b43d907f3375563422f27c5313268337f7f399821c318a69261f0731bb96`
and verifies its 18 results without running research code or a broker.

The explicit offline HTTP smoke exercises the real production Next route, ingress,
owner bootstrap, denied reads, actual artifact import/read, restart/new owner
session, missing evidence and tamper rejection. Its evidence is HTTP integration,
not browser/visual acceptance. Run after the full build:

`NODE_ENV=test GELT_OFFLINE_RESEARCH=fixture-only node scripts/running-next-research-read-smoke.mjs --offline-test-only`

Final integrated Go race/vet/build, full V2 tests/build/smoke/import accounting,
fresh final reviews, supported Node 22/native Windows and real sandboxed browser
interaction/visual acceptance remain assembly gates. No unsupported local browser
sandbox bypass or unperformed visual test is claimed here.

## P1.3 temporary owner viewer source addition

The opt-in local launcher at v2/scripts/research-owner-demo.mjs makes the
accepted protected read view inspectable for a bounded owner session. It uses
the existing random private temporary-directory helper, store provisioning and
import/read APIs, guarded web.mjs entry, offline guard, and /connect bootstrap
flow. It adds fixed, allow-listed bootstrap diagnostic headers and Connect shows
the HTTP status plus those safe stage/outcome details on failure; authorization
policy for grants, sessions, cookies, Host/Origin/ingress and CSRF is unchanged.
The launcher is separate from the
normal three-role supervisor and requires an explicit --owner-demo-only flag.

Only the fixed retained artifact is admitted: exact original byte length,
SHA-256, and evidence ID are checked before import and the private store readback
is checked before serving. The temporary grant lasts at most 30 minutes. The
web-only child binds 127.0.0.1:3000 and receives only the temporary BFF and
research paths plus the existing minimal offline environment. Both loopback
ports 3000 and 4100 must be free before startup; port 4100 is checked but no
worker process is started. The launcher also refuses missing prebuilt output
and never installs dependencies or builds the app. It does not start market,
worker, V1, a browser, or any provider; it does not execute the artifact. The owner manually opens the
existing /connect and /research pages. Session and evidence remain subject to
the existing protected UI and BFF behavior.

Shutdown waits at most one second for the web child's IPC send callback, then
uses bounded TERM/KILL escalation against that owned child if sending fails or
times out. After confirmed exit, the launcher re-reads the store through the
existing validated read function and checks the owned BFF directory for
`bootstrap.json.lock` using the existing private-directory check and a
no-follow marker inspection. It removes only its own temporary roots if both
research readbacks bind the exact imported digest and length and no bootstrap
consumption marker remains. It retains and reports roots if store mutation,
either inspection, or child termination is uncertain. It never repairs
store markers, discovers or kills processes by port, or changes persistent
owner settings. The browser tab
must be closed after stop to clear its protected in-memory view.

The web entry sends the temporary launcher's bind acknowledgement only from
the successful `server.listen` callback. The launcher waits for that message
before probing HTTP, so a competing loopback listener cannot satisfy readiness.
If the child exits or errors while readiness HTML is being read, startup fails
before publishing the owner grant. Existing `scripts/web.mjs` callers without
an IPC channel continue to serve normally; the acknowledgement is sent only
when IPC is connected. Synchronous or asynchronous acknowledgement-send errors
close the owned web server through its existing shutdown path.

## P1.3 changed files

- v2/scripts/research-owner-demo.mjs — explicit temporary web-only launcher
- v2/scripts/research-owner-demo.test.mjs — synthetic isolation, grant expiry,
  bind acknowledgement, grant publication, port/startup failure, and bounded-stop cleanup cases
- v2/scripts/web.mjs and v2/scripts/web-ipc.mjs — successful-listen IPC
  acknowledgement with owned shutdown on acknowledgement-send failure
- v2/RESEARCH-OPERATIONS.md — owner start/inspect/stop recipe
- v2/IMPORT-MANIFEST.json — local added-file identities
- docs/specs/ZAR-231-Research-Evidence-Read-View.md — source behavior and limits

## P1.3 verification status

The `evidence/...` paths below refer to the private task evidence archive, not
files included in this repository or PR. These candidate-run receipts are
historical evidence only; they do not establish acceptance of the current
source. Current acceptance depends on fresh source review and exact-head CI.

The earlier candidate's single focused built-in-only run on approved Node
22.23.3 reported 8 passed and 2 failed due to the child-error observer helper
return contract; that correction is recorded in the later candidate. Preserve
its output at evidence/P1.3-owner-demo-tests-r2.log. The repaired candidate
then ran the suite once with the same approved Node 22.23.3: all 12 tests
passed, including bootstrap lock presence and inspection-failure retention.
Preserve that output at evidence/P1.3-owner-demo-tests-r3.log. Neither
candidate's suite was retried. No dependency install, build, app/server/browser
launch, real temporary fixture, or owner session was performed. Accepted PR483
results remain historical foundation evidence only. A fresh source review,
full supported target setup/build, and actual owner inspection are still
required; M1 remains incomplete.

After the first adversarial P2 on readiness, candidate r4 added the owned-child
listen acknowledgement and pre-bind, bind-failure, and timeout-cleanup
synthetics. Its one focused run passed 15/15; preserve
evidence/P1.3-owner-demo-tests-r4.log (SHA-256
b8915ecbf894d84f246af813b9af4e6dfeb08652b084a445e696f48405fb4ceb). Historical
r2 (8 passed / 2 failed) and r3 (12/12) receipts remain unchanged. A fresh
independent review of r4 found additional P2 issues, so those results do not
establish source acceptance; the repaired candidate requires a new focused run
and both fresh reviews.

The temporary-store exclusions are five newly created private synthetic roots
for key, worker, BFF, owner-bootstrap, and ledger roles. The launcher does not
read or use any existing owner directory or persistent store.

## G01 simulation entry diagnostics and regression

The G01 bootstrap diagnostic is enabled only in the explicit temporary
research-owner launcher. For bootstrap responses it reports numeric HTTP status
from the actual response, plus fixed stage/outcome headers. The normal UI shows
only status and allow-listed stage/outcome values. Regular app environments emit
no diagnostic headers. Grant bytes, digests, request bodies, cookies, CSRF values,
exception text and process logs are never included. The existing one-use grant,
Secure cookie, owner session lifetime, host/origin/ingress/CSRF checks, and
read-only research route are unchanged.

The isolated synthetic Chromium regression covers a mismatched grant,
expired grant, successful owner bootstrap and protected research detail read,
then replay the consumed grant and confirm the existing session still permits a
protected read. It asserts actual HTTP statuses and visible failure categories,
records cookie and CSRF shape as booleans, blocks and counts external browser
requests, exercises a non-JSON bootstrap error with a preserved HTTP status,
cleared submitted grant and active CSRF state, and preserved saved CSRF for a
possibly existing session. It confirms a consumed-grant replay retains the
current session's saved CSRF, restores it on the protected research page, and
continues the protected read. Each displayed response is matched
against its complete expected text so an earlier 403 cannot satisfy a later
403-case assertion. Installed source inputs must exist as regular files and
match the source hashes. Launcher shutdown escalates only inside its isolated
process group; browser profiles are removed only after confirmed browser close,
and uncertain roots are retained with an explicit cleanup receipt. The browser
regression requires POSIX process-group isolation and exits before fixture
creation on Windows. This does not establish the original owner's first-response
cause or owner acceptance. No scientific/Python reproduction is part of G01.

Changed G01 files are `v2/scripts/research-owner-demo.mjs`,
`v2/web/lib/connection-bff.ts`, `v2/web/app/connect/page.tsx`,
`v2/web/lib/connection-bff.test.ts`, and
`v2/tests/research-owner-entry/run.mjs`, with updated import accounting in
`v2/IMPORT-MANIFEST.json` and `.github/workflows/v2.yml`. Candidate r4 was
reviewed against base `a4d7c946f94372a0753fc87b410507e35a5c755a` with no
actionable findings. Its retained Node 22 build passed, focused BFF tests passed
11/11, and five synthetic Chromium session cases plus protected research detail
passed with zero external browser requests. Those receipts remain tied to that
reviewed candidate and are not rerun as part of this integration.

The sanitized publication root is `9debdf6d055137d4f4f6e0121bd5930a43e18755`. The G01 browser runner pins
that root and verifies it is an ancestor of the checkout; CI fetches full history
for this check and keeps isolated private temporary storage and synthetic owner
auth. Fresh
review and new branch-specific build, tests, browser regression and hosted CI are
required before shipment. The original owner failure cause remains unknown;
owner visual acceptance is unclaimed. This remains a research reference entry,
not a simulation trading terminal or completed agent workflow.
