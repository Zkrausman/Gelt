---
type: specification
title: "ZAR-219: integrated offline trading screen and safety acceptance"
ticket: ZAR-219
status: partial-foundation-merged-m8-open
baseline: "ad51dabbe2f8e4d9e01354edffb90f2eee03ae20"
runtime: "Additive V2 / Node 22 / TypeScript"
execution_enabled: false
verification_status: pr467-exact-head-hosted-gates-passed-offline-companion-and-m8-pending
acceptance: "M8 not satisfied; execution-disabled foundation merged with exact-head hosted checks, but authenticated offline companion and full acceptance remain open"
candidate_update:
  ticket: ZAR-237
  base: "6631ac6ea3a5a334bec9dcdd9b028261ce1cd7ed"
  status: scoped-execution-disabled-fix-m8-open
  changed_paths:
    - v2/worker/src/pi-handoff.ts
    - v2/worker/src/service.test.ts
    - v2/IMPORT-MANIFEST.json
    - docs/specs/ZAR-219-Integrated-Offline-Trading-Screen.md
  local_verification: "red-before reproduced; focused private HTTP 7/7, worker/web tsc, V2 build/smoke, import 82/402 and Go race passed on Windows Node 24"
  import_hash_refresh: local-pass
  external_operator_gates: "see PR #471 for current exact-head review, CI and merge receipts"
---

# ZAR-219 — integrated offline trading screen and safety acceptance

## ZAR-237 development update — owner-session revision invalidation (M8 open)

Squire v0.2 produced an **UNVERIFIED** isolated candidate. The operator applied
its retained patch on a separate clean Gelt worktree at merged base `6631ac6`,
then ran the bounded local checks below. The integrated change fixes the
fixture-only single-floor defect without changing
its execution boundary. `offlinePiHandoff()` now keeps a monotonic revision floor
per opaque owner session, bounded at 64 distinct sessions. Floors are never
silently evicted. A new invalidation arriving after the table is full poisons
that fixture instance for its remaining lifetime, clears the one pending record,
rejects later prepare/review/invalidate calls, and reports a disabled status.
Updates to already-known sessions remain monotonic while the table is full but
before overflow. Strict DTO schemas, the `NODE_ENV=test` plus
`GELT_OFFLINE_PI_HANDOFF=fixture-only` gate, the at-most-one pending record,
and all-false execution/broker capability fields remain unchanged.

The private HTTP regression uses the named `POST /v1/pi-handoff/invalidate`,
`prepare`, `review` and `status` operations to encode the A@3, B@1, delayed
A@2 interleaving; it also asserts fresh A@3 succeeds, B cannot review A's
record, a newly started worker rejects review, the floor table accepts exactly
the configured bound, and overflow clears pending state and remains disabled.
No dispatch operation, broker action, live Pi account, generic proxy or
production execution capability is introduced.

### ZAR-237 changed-path inventory

- `v2/worker/src/pi-handoff.ts` — replace the single revision floor with the
  bounded per-session map and permanent fail-closed overflow state.
- `v2/worker/src/service.test.ts` — add private named-operation coverage for the
  lost-floor interleaving, fresh revision, session separation, restart and
  capacity/overflow conditions.
- `v2/IMPORT-MANIFEST.json` — annotate ZAR-237 provenance and refresh hashes
  for changed local source entries; local import verification passed 82 upstream
  paths and 402 candidate files at the local integration checkpoint.
- `docs/specs/ZAR-219-Integrated-Offline-Trading-Screen.md` — record scope,
  Squire candidate limits, changed paths and independent local checks.

### ZAR-237 bounded verification evidence at local integration checkpoint

This section records the **pre-publication local checkpoint**, not a live PR/CI
status table. See [PR #471](https://github.com/Zkrausman/Gelt/pull/471) for
later exact-head hosted checks and merge disposition; neither changes the
historical local receipts or closes M8.

- **Squire source:** run `squire-1790607325695-bc3bb1cef0` ended as
  `candidate: UNVERIFIED` with one `unlisted_command` inspection attempt that
  was **NOT RUN**. Squire ran no tests or build. The prior run
  `squire-1790607279540-061c7e8653` failed source-HEAD preflight before Plan;
  it supplied no candidate. Both receipts remain retained separately.
- **Red-before/green-after:** on clean merged base, an operator-owned disposable
  Vitest probe for A@3, B@1, delayed A@2 failed as expected (`expected [Function]
  to throw an error`). After applying the Squire patch it passed 1/1; the
  disposable probe was preserved privately, then removed from this PR. The
  committed regression instead exercises the named private HTTP worker path.
- **Integrated local Windows Node 24.14.0:** focused `service.test.ts` passed
  **7/7** including A/B/A and capacity cases; worker and web `tsc --noEmit`
  passed; V2 build and offline smoke passed (smoke includes an expected negative
  occupied-port start); `verify:import` passed 82 upstream paths/402 candidate
  files after hash refresh; `go test -race ./...` and `git diff --check` passed.
  None of these is Node 22 or an independently verified full V2 suite.
- **External gates at this local checkpoint:** fresh full-diff independent
  review, exact-head hosted Go/Ubuntu Node 22/native Windows checks and merge
  had not yet occurred. Consult PR #471 for their later receipts instead of
  reading this snapshot as the current check state. The original Windows
  Node 24 ledger 33/34 failure remains unresolved. M8 and actual broker
  preview/order permission remain open; no companion was implemented.


## Completion report, outcome and authority boundary

The merged PR #467 partial foundation replaces the V2 home-page placeholder with a local
production-disabled trading workspace, adds narrowly named protected backend
status and fixture-only Pi-handoff operations on the actual Next/BFF/worker path,
and also retains a **separate opt-in test-only synthetic browser laboratory**
backed by isolated private SQLite and `OrderLifecycle`. The demo is
not the production Next workspace or its authenticated worker BFF. It **does not
close M8**. The production adapter remains unsupported, and the order lifecycle remains
unwired into worker setup/service. No broker login, credential use, provider request,
preview/place/cancel, order dispatch, funding, deployment, runtime activation or
live action was performed. No fixture is represented as a quote, account, broker
order, execution, fee or fill.

## Post-merge disposition and evidence (2026-09-28)

PR [#467](https://github.com/Zkrausman/Gelt/pull/467) merged to `master` at
`2026-09-28T05:47:34Z`: reviewed/published head
`31690b8fbb85f91196f66e2b7701d176c068e1cf`, merge commit
`ad51dabbe2f8e4d9e01354edffb90f2eee03ae20`. The merge tree
`28f9ecaf08f993baf29f583cc0b9b203e7c6079e` matches the reviewed
head's tree; this is the **execution-disabled partial foundation**, not M8
acceptance. Exact-head hosted checks passed: [Go build-and-test](https://github.com/Zkrausman/Gelt/actions/runs/36379656684/job/108792587837),
[Ubuntu Node 22 node-foundation](https://github.com/Zkrausman/Gelt/actions/runs/36379656678/job/108792588055),
and [native Windows](https://github.com/Zkrausman/Gelt/actions/runs/36379656678/job/108792587786).
These CI results supersede only the *pending hosted gate* claims in the
historical pre-merge candidate snapshot below. They do not erase its failed
local receipts or establish the still-unimplemented companion. In particular,
the original Windows Node 24 ledger partition failed **33/34** near 702 seconds
with `secure storage unavailable` and its outer command timed out at 720
seconds. A separate diagnostic copy passed 34/34 in 751.06 seconds; that copy
is neither a pass of the original full suite nor a root-cause explanation.
The original failure remains open for the applicable cumulative safety gate.

## First bounded offline Pi prepare/review slice (implemented, non-authorizing)

`v2/web/app/page.tsx` now reads protected `pi-status` and, only when a test
runner explicitly injects `offlinePiHandoff()` into `createWorker` with
`NODE_ENV=test` and `GELT_OFFLINE_PI_HANDOFF=fixture-only`, offers fixture-only
prepare/review controls. Production `setup`/`index` never inject the fixture;
production status stays disabled with all order capabilities false, and prepare,
review and invalidate fail closed. This is not broker preview, Pi OAuth or a
live Pi companion. The distinct synthetic account selector cannot claim the M3
OAuth-selected account. `pi-prepare`, `pi-review`, `pi-invalidate` and `pi-status`
are named POSTs through the existing protected Next BFF route, not a generic
proxy. BFF Host/Origin/CSRF/cookie/ingress checks and private worker
secret/loopback/session-expiry/body checks apply unchanged; both boundaries
validate strict DTOs and return no-store responses.

The worker holds one process-local, at-most-one pending 30-second fixture record.
The random 128-bit ID and canonical SHA-256 digest bind the opaque owner session,
synthetic account, route, instrument, exact BUY LIMIT text, revision and expiry.
Review checks the complete draft and stored digest; it returns the *same* inert
fixture record (`authority:false`, `brokerFacts:false`), never a confirmation
or dispatch token. Draft edits/account switch clear the UI record and request
invalidation; worker revision-floor checks also reject delayed pre-edit
prepares if invalidate arrives first, while UI revision and complete-term
checks prevent an in-flight stale response from being displayed. Expiry and worker restart drop the record;
BFF session loss rejects old requests. Repeated reviews only reread fixture
terms and cannot dispatch. No ledger facts or credentials are created; actual
fees, fee-inclusive cap, quote and account eligibility remain unknown. A
separate Pi approval, execution and observation design remains unimplemented.

## Owner-directed Pi MCP execution boundary (execution not implemented)

The owner now directs that the supervised trade be executed through an
owner-present **Pi session using the official Robinhood MCP**, rather than by
copying Pi OAuth credentials into Gelt or silently activating the unsupported
worker adapter. This is a future M9/M10 architecture direction, **not** an
exact-order authorization or evidence that Gelt is connected. The present M3
Gelt OAuth connection (when separately registered and provisioned) is distinct
from the Pi MCP session; neither status may stand in for the other.

The intended Next UI → named protected BFF → private worker path now has
reproducible fixture-sourced, non-authorizing prepare/review responses under
explicit test-only injection. This does not make M8 complete: no eligible Pi
account or fee-inclusive broker preview is available; duplicate clicks cannot
dispatch because there is no dispatch operation. The existing `OrderLifecycle.confirm()` is **not** this
handoff: it durably claims and immediately invokes the adapter, and its
process-local preview token is not restart-safe Pi authorization. Do not
call it from the prepare flow. A later safe Pi handoff needs an explicit,
reviewed contract for one owner-selected broker account matched to the Pi MCP
account, supported instrument, exact terms, fee-inclusive cap, expiry and
one-use approval. A later Pi-side read/preview or order response must enter the ledger only
through a separately reviewed authenticated private local companion, not
browser-pasted JSON or a generic MCP proxy. It needs attributable source,
bounded original facts, verified account/intent association, deduplication and
conservative unknown-outcome handling. Companion authentication alone is not
a broker signature, and Gelt's M3 OAuth-selected account cannot establish the
Pi session's eligible account. Until that contract exists and passes offline tests,
the UI may display a draft and a **handoff unavailable** reason, not a live
Robinhood connection, actionable Confirm button or broker fill. No Squire or
Pi candidate is a broker receipt. ZAR-220 must present fresh terms and obtain
separate owner approval; ZAR-221 requires owner presence and fresh one-use
confirmation immediately before any Pi MCP placement. Unknown outcomes halt
new orders, never trigger blind redispatch, and cannot be marked terminal from
an empty order search. Cancellation/funding require separate authority.

The UI requests the existing protected M3 status and M4 history/detail reads,
plus read-only order-surface status and named fixture Pi-handoff operations. Exact BUY LIMIT fields are editable as
a draft; quantity×limit notional is calculated from decimal strings using `BigInt`.
The UI identifies unverified instrument/route support, displays fee and
fee-inclusive cap as unknown when no broker preview exists, and keeps preview,
confirmation and cancellation disabled. The durable history panel separates
requested terms from stored timeline events and individual observed executions.
It includes the unsupported chart/provenance fallback.

The BFF operation `POST /api/connection/order-status` retains the owner-session,
exact Origin/Host, CSRF, ingress-proof, no-store and private worker-service
boundary. It forwards only to `POST /v1/orders/status`, whose closed response
always reports all execution/order capabilities false and names the unsupported
production adapter. The response is not authority to trade. The worker does not
construct or invoke `OrderLifecycle` from this operation.

## Changed-path inventory

- `v2/web/app/page.tsx` — replace static landing placeholder with the responsive
  workspace, protected status/history reads, exact-decimal draft display, disabled
  action causes, provenance notices and timeline/fill presentation; add strictly
  synthetic, test-injection-only prepare/review UI with revision invalidation.
- `v2/web/lib/connection-bff.ts` — add named protected `order-status` and
  `pi-status/prepare/review/invalidate` forwarding with strict DTO validation;
  no generic proxy or order mutation route.
- `v2/web/lib/connection-bff.test.ts` — cover exact private worker path/body and
  rejection of an unsafe capability response.
- `v2/worker/src/contract.ts` — add the closed execution-disabled order-surface
  response and advertise only the read-only status operation when protected.
- `v2/worker/src/service.ts` — add private, versioned `POST /v1/orders/status`
  and named inert Pi-handoff operations; require worker service secret, opaque
  session, expiry, bounded JSON, exact loopback Host and reject query/arbitrary paths.
- `v2/worker/src/service.test.ts` — cover authorization, closed disabled response,
  invalid body/query plus forged, oversized, cross-session, expired, stale draft,
  repeated review, invalidation and restart handoff rejection.
- `v2/README.md` — document the usable screen and the still unsupported order path.
- `v2/CONNECTION-API.md` — document the exact BFF/worker status operation and its
  no-authority contract.
- `docs/specs/ZAR-219-Integrated-Offline-Trading-Screen.md` — this specification,
  inventory, limits and honest verification record.
- `v2/worker/src/synthetic-order-harness.ts` and `.test.ts` — separate opt-in
  synthetic-only SQLite/lifecycle HTTP fixture and focused safety/restart tests;
  source-tagged history projects each stored synthetic execution's observed
  quantity, price and optional fee, never requested amounts; never imported
  into production setup/service.
- `v2/worker/src/synthetic-browser-demo.ts` and `.test.ts` — test-runner-owned
  loopback UI bridge, strict synthetic DTOs (including per-execution exact
  decimal observations), private server-to-server harness credentials,
  one-use preview confirmation and focused HTTP/security tests.
- `v2/scripts/synthetic-browser-demo.mjs` — explicit test-only launcher and
  teardown, not part of `v2/scripts/start.mjs`.
- `v2/docs/SYNTHETIC-BROWSER-DEMO.md` — reproducible offline demo commands and
  non-broker provenance boundaries.
- `v2/worker/src/pi-handoff-contract.ts`, `pi-handoff.ts` — browser-safe strict
  DTOs and separately injected test-only process-local canonical handoff fixture.
- `v2/web/lib/pi-handoff-page.test.ts` — render actual Next home component and
  assert default-disabled fixture and order controls.
- `v2/scripts/running-next-pi-acceptance.mjs` — bounded opt-in running Edge/Next
  acceptance with test-injected private worker, exact browser-to-BFF-to-worker
  path and ephemeral owner session; neither imported nor launched by production.
  The offline test also restarts the worker while a prepared fixture is visible,
  rejects its stale review under the still-valid owner session, clears it on
  browser review failure, and prepares/reviews a distinct inert record afterward.
- `v2/scripts/runtime.mjs` and `runtime.test.mjs` — require the current trading-desk safety banner for offline smoke readiness; old homepage copy must not count as ready.
- `v2/worker/src/order-lifecycle.ts` — pre-existing local lifecycle correction;
  inspect cumulatively in the final diff rather than attributing it to the demo.
- `.llm-wiki/wiki/concepts/zar-219-integrated-offline-trading-screen.md` — cumulative,
  source-specific project disposition if included in final branch.
- `v2/IMPORT-MANIFEST.json` — local candidate hashes refreshed with
  `node v2/scripts/update-local-import.mjs`, ten new entries given explicit
  ZAR-219 source-specific reasons, and `node v2/scripts/verify-import.mjs`
  passed locally. Final review must still inspect the inventory and provenance.

No V1/Go, provider transport, OAuth/vault, **production** SQLite schema, worker
setup, dispatch adapter, dependency, lockfile, deployment, credentials or runtime
activation files were changed. The synthetic test harness has its own deliberately
incompatible private SQLite schema.

## Next M8 increment: authenticated offline companion contract (still open)

This remains the normative M8 acceptance contract; it is not fully implemented.
The separate ZAR-239 partial integration adds an isolated, default-disabled
loopback HTTP transport around the ZAR-238 synthetic kernel, but does not wire
startup, BFF, UI or trusted external provisioning. It has only focused operator
checks; independent final review and exact-head hosted CI remain pending. See
`docs/specs/ZAR-239-Bounded-Private-Synthetic-Companion-Transport.md` for its
limits and pending gates. No part of this slice closes M8.

The intended running Next home workspace must
exercise named, bounded operations through the existing owner-session-protected
BFF and a private worker to a separately authenticated **offline** companion.
The companion must be unavailable by default in production, reachable only
through a private local channel, with an independently provisioned short-lived
identity and replay-resistant, size-bounded messages. The browser cannot supply
companion credentials, arbitrary MCP tool names, raw broker JSON or execution
authority. Origin/Host, ingress, CSRF, owner session and worker secret controls
must remain enforced end-to-end; companion authentication does not certify a
broker fact or link Gelt OAuth to a Pi MCP account.

For an offline preview/approval record, bind a single owner session, separately
selected and attested **simulated** Pi account, route, supported instrument,
side, order type, exactly one quantity/amount expression, exact limit and time
in force, quote/fee source, fee-inclusive total no greater than $10, revision,
short expiry and one-use logical intent. No hardcoded eligibility, price or fee
fallback may turn unknown into approved. Altering any term, switching account,
expiring either session/preview, process restart or an already-used intent must
invalidate approval and keep the UI disabled until a fresh attributable preview.
Never call the pre-existing `OrderLifecycle.confirm()` as a handoff shortcut:
that method immediately invokes an adapter. Offline simulation must retain a
source tag at every boundary, must never write requested amounts as observed
executions/fees, and cannot mint a production broker capability.

The companion/worker contract must durably reserve a unique logical intent
*before* any simulated send, reject duplicate clicks and replay, and record
attributable response identity, exact account/order association and per-fill
exact decimals. A timeout after simulated send, unknown result, conflicting
receipt, lost companion or restart halts new intents for that account until
explicit attributable reconciliation; an empty search is not proof of no order
and automatic retry is forbidden. Forged or browser-pasted receipts, mismatched
account/order, unverified fees, and disconnected companion must fail closed.
Cancellation and funding are outside this increment. Do not treat an offline
companion signature as a Robinhood signature.

Acceptance requires independently reviewed contract and private-channel
implementation; running Next → named BFF → private worker → offline companion
UI/API tests for missing/forged/stale/cross-session credentials, wrong account,
changed terms, fee cap, expiry, concurrent/duplicate clicks, replay, restart,
timeout after send, unknown outcome, contradictory and partial-fill receipts,
and safe recovery; evidence of default-disabled production behavior; a full
cumulative safety suite on supported platforms, import manifest verification,
Go race checks and exact-head hosted CI. Preserve failed/timeout receipts and
never infer a full pass from focused or diagnostic reruns. A read-only official
MCP account/preview probe is separately authorized later under M9; any
owner-present exact order is a separate M10 approval. Neither is authorized
by this offline contract, CI, a Squire candidate, or M8 documentation.

## Unimplemented acceptance and concrete remaining work

The separate browser laboratory now exercises a named test-only bridge to the
synthetic adapter and private SQLite lifecycle. Its HTTP tests cover synthetic
preview/confirm/history and runner-only partial/cancel scenarios, with isolated
harness restart/unknown tests. The production Next UI still cannot preview or
place a supported broker order; its protected backend status is explicitly disabled.
The following M8 acceptance remains outstanding:

1. The **intended production workspace** now has an explicit test-only inert
   prepare/review seam on its actual protected path, but no supported provider-backed
   preview/confirm/cancel bridge; `OrderLifecycle` is not wired to production worker
   setup/service. The test-only browser service is a reproducible proof, not an
   owner/account-scoped production trading route. M9/M10 approvals remain separate.
2. A test-only Edge headless flow covered resume, preview, draft-edit
   invalidation, fresh preview, explicit confirmation and source-tagged
   synthetic history. Its screenshot is a local laboratory artifact, **not**
   the production workspace or broker evidence. Demo PID 61576 was later
   confirmed exited; fixture teardown/deletion was not independently accepted.
   Full UI/API integration and timeout-after-send, duplicate-click, production
   process death/restart, token expiry, stale-quote, chart-mismatch, account-switch
   and credential isolation still need explicit end-to-end evidence where applicable;
   focused tests and one browser path alone are partial. A cumulative read-only
   reviewer also found that synthetic browser history omitted per-execution
   quantity, price and fee. This candidate now displays and tests bounded,
   source-tagged synthetic per-execution exact decimals and observed fees in
   event order; this does not establish broker execution or M8 acceptance.
3. The production ledger history panel shows stored facts, not broker
   interoperability; the synthetic history is never forwarded into it.
4. Refreshed `v2/IMPORT-MANIFEST.json` passed local verification; confirm its
   provenance and hashes again against the final reviewed head.

A subsequent **running actual Next home-page** test now exercises the inert Pi
fixture slice in headless Edge, not the separate browser laboratory. With compiled
worker and a current Next build, run from `v2/` using an explicitly provisioned
trusted Windows private parent (see operations):

```sh
GELT_WINDOWS_PRIVATE_PARENT='C:\\' NODE_ENV=test GELT_OFFLINE_PI_HANDOFF=fixture-only node scripts/running-next-pi-acceptance.mjs --offline-test-only
```

The script refuses occupied web/worker ports, provisions a disposable private
BFF owner grant, starts the *existing raw-ingress-gated* `scripts/web.mjs` and a
`createWorker()` instance (first without, then with an explicitly test-injected
`offlinePiHandoff()`). It opens actual `/` in a disposable Edge CDP profile,
bootstraps the browser session via the named BFF, reads protected disabled and
enabled status, prepares, edits/invalidate, checks that the prior record is
rejected with 409 by the worker under the same valid session before preparing
again, reviews, restarts the worker while that fixture remains visible, checks
the displayed complete draft equals the first worker's prepared DTO, and observes
in test memory that the restarted worker receives and rejects the same old review
while the protected BFF returns 409 under the valid owner session. Browser review
clears the stale record; then the runner prepares/reviews a distinct record on the new worker,
asserting its full displayed account/route/instrument/terms/revision matches the prior
draft before waiting for its 30-second expiry. It asserts all three named
preview/confirm/cancel controls exist and remain disabled through restart/recovery,
and checks the protected order-status DTO remains all-false. CDP connection,
pending calls and socket close are individually bounded, including teardown. Host, Origin,
forwarding, cookie, CSRF, default-disabled prepare and expired review denials are
checked against running routes. It closes the browser/listeners and deletes
fixture storage/profile; no screenshots or broker/provider calls. This exercises
inert fixture terms only, not a live broker preview, account, quote, fee,
confirmation, fill or order. Local Windows Node **24.14.0**, Edge
**154.0.4258.37** passed after correcting the test's too-early disabled-state
poll and Edge process cleanup. A follow-up local Windows run passed after
bounding CDP calls/close, validating worker-side edit invalidation and checking
all three disabled controls; one preceding run failed on a 5-second CDP call
timeout and cleaned both test listeners, so the call bound was raised to 12
seconds (within the global deadline). A subsequent bounded offline-only Windows
Node **24.14.0** run passed the added worker-restart stale-review/recovery checks
with fixture storage, Edge profile and listeners removed by the runner. A read-only
review then found that 409 alone could have been BFF transport rejection or a
mismatched hard-coded draft; the first passing receipt remains limited evidence.
The test now compares the entire visible draft to the first worker's prepared DTO
and asserts the restarted worker's `review` method was called once and threw
before crediting that 409. The corrected running Edge/Next/BFF/private-worker
fixture-only run passed on Windows Node **24.14.0** with 155-second outer bound
and private receipt `gelt-zar219-window-20260926/running-next-restart-verified-worker-20260928.log`.
A follow-up review noted the recovery assertion compared only quantity, price and revision;
the runner now compares the complete recovered draft including account, route and
instrument. A second bounded Node **24.14.0** Edge/Next/BFF/worker run passed with
private receipt `gelt-zar219-window-20260926/running-next-restart-full-draft-20260928.log`.
After this test-only script changed, `v2/IMPORT-MANIFEST.json` was refreshed for
local candidate hashes and `npm --prefix v2 run verify:import` passed: 82 upstream
paths and 402 candidate files; this remains a local provenance check, not final
hosted head verification. Pre-draft `go test -race ./...` passed on the unchanged
Go tree (private receipt `gelt-zar219-window-20260926/go-race-pre-draft-20260928.log`).
This covers only process-local fixture loss, not production restart, provider outcomes,
or an owner-session expiry. At that pre-merge candidate snapshot, Node 22/native
hosted gates were pending; PR #467's later exact-head results are linked above.

Before M8 can pass, independently review the full cumulative offline-companion increment, exercise the
remaining full UI/API lifecycle with visible provenance, close the remaining safe-failure scenarios,
retain verified import accounting and pass supported Node 22, native Windows and Go gates. If those constraints cannot be satisfied,
keep production disabled and M8 open. M9 exact-order authorization and M10
owner-present supervised live acceptance remain separate; neither is implied here.

## Verification receipts and limitations (historical pre-merge candidate snapshot)

The local evidence and table below record the candidate **before PR #467
merged**. Thus references below to a local HEAD, pending hosted Node 22/Windows
checks, no final cumulative review or an unmerged candidate are dated
snapshots, **not** the current PR state. The post-merge section above is the
current hosted/merge disposition; M8 and the original local failure remain open.

After the focused P2 synthetic-history correction, Windows Node 24 worker
`tsc -p worker --noEmit` passed; harness 7/7 and browser 3/3 passed in separate
native Windows runs with an explicit private parent. Browser tests assert the
shipped page renders synthetic observed decimals and the HTTP bridge preserves
both partial executions in order, with fees distinct from the preview fee.
A combined focused run printed browser 3/3 then timed out at 300 seconds
before harness completion; it is a failed combined receipt, not a pass.
`node scripts/verify-import.mjs` passed 82 upstream paths/402 candidate files
following local hash refresh, and `git diff --check` passed. The separate
running Edge/Next inert-fixture script was subsequently rerun successfully
with `execution false`; the added restart/recovery flow passed in a later bounded
Windows Node 24.14.0 run with the same explicit fixture-only flags. Supported
Node 22, complete suite, full cumulative
review and M8 remain open.

After the bounded Pi slice, Windows Node 24 focused `tsc -p worker --noEmit`
and `tsc -p web --noEmit` passed. Focused Vitest across `service.test.ts`,
`connection-bff.test.ts` and `pi-handoff-page.test.ts` passed 16/16, including
an authenticated BFF round-trip to an actual loopback private worker, default
disabled status and server-render of the real Next home component. An initial
page render test failed (`React is not defined`) and the first post-split tsc
failed (missing type-only `z` import); both root causes were corrected and the
combined checks rerun successfully. Earlier candidate receipts below refer to
the pre-Pi slice. The later bounded running-Next/Edge fixture acceptance above now covers
home/BFF/private-worker prepare/review only; a web build passed locally.
No complete suite, Go/race or supported Node 22 gate was run for this latest
candidate; the full cumulative independent review remains pending. M8 remains open.

**This is a partial integration candidate; M8 remains open.** The initial Squire
phase blocked its first bash inspection command as `unlisted_command`; no tests
ran then. Subsequent isolated operator work added the test-only harness and
browser bridge. On Windows Node 24 (not the supported Node 22 hosted gate),
worker `tsc` passed. The first browser+harness runtime attempt without
`GELT_WINDOWS_PRIVATE_PARENT` failed private storage preflight; an OS temp parent
also failed. With the explicitly provisioned `GELT_WINDOWS_PRIVATE_PARENT='C:\\'`,
the harness suite passed **7/7**; the browser suite initially passed 2/3, with
confirm failing 409 because the bridge's five-second upstream wait expired
during native SQLite replay. Raising only that bounded wait to 45 seconds
(still fail-closed and shorter than the five-minute session) yielded **3/3**
browser HTTP tests. This timeout failure is retained, not called a pass.
Independent targeted review found draft edits could leave a stale confirm
enabled; after a follow-up fix, the reviewer passed the in-flight Preview race
specifically, not the full cumulative diff. A real Edge headless run reached
synthetic history and saved a screenshot to the repository-relative fixture path
`./.test-artifacts/synthetic-history.png`. Teardown was unconfirmed; the demo process
was later confirmed exited, but isolated fixture deletion was not independently verified.
A later combined Vitest invocation printed harness 7/7 before its 240-second
command deadline, then timed out before browser completion; it is **not** a
passing combined receipt. A separate final browser-only invocation passed 3/3,
worker `tsc` passed and `git diff --check` passed. Fresh cumulative read-only
review confirmed the production Next/BFF/worker lifecycle gap as a P1 M8 blocker
and the lab's missing per-fill amount/price/fee as a P2. The reviewer did not
attest cumulative approval. The checkout HEAD is
`6118c26d59943fbb3a90fe3886afa0f7adbe675e`; all changes remain local.
A subsequent `npm --prefix v2 test` command with the explicit native Windows
private parent reached server 18/18 and printed Windows-storage 22 passed,
1 skipped plus order-lifecycle 14/14, but the command **timed out at 1,200s**
while the worker suite was still running. Its exact leftover Vitest process was
stopped; this is **not** a passing full-suite receipt. No unsupported gate is
inferred from these results.

| Gate | Current evidence |
| --- | --- |
| Focused synthetic HTTP tests | After per-execution history edits, native Windows Node 24 harness 7/7 and browser 3/3 passed separately. One combined invocation printed browser 3/3 then timed out at 300s before harness completion; it is not a combined pass. |
| Worker `tsc` | Passed locally after latest UI edit (Windows Node 24) |
| Edge headless test-only browser flow | Previous separate synthetic lab: resume → preview → edit → confirm → history; old screenshot not evidence of production. Running Next home → raw-gated BFF → private worker inert Pi fixture flow independently rerun locally on Windows Node 24 after latest history/readiness edits: disabled/status/prepare/edit/review/expiry/security passed, `execution false`. Later bounded Node 24.14.0 offline fixture run also passed visible prepare → worker restart → valid-session stale review 409 → UI clears stale fixture → distinct prepare/review recovery, all-false order status and disabled order controls; teardown checks passed. No broker evidence. |
| Targeted independent browser review | In-flight Preview race fix passed. Later running-Next fixture reviews found and then cleared CDP/HTTP cleanup bounds, valid-session edit invalidation and non-vacuous disabled-control assertions; **bounded fixture slice only**, not cumulative M8 approval. |
| `npm --prefix v2 test` on supported Node 22 | Not run on Node 22. A native Windows Node 24 full attempt timed out at 1,200s after partial output; later standalone `order-lifecycle.test.ts` and `ledger.test.ts` timed out at 360s and 240s without summaries. None is a passing full gate. Separately rerun server 18/18, runtime scripts 10/10, Windows preflight 11/11, native Windows storage 22 passed/1 skipped, account-integration/history 70/70 (synthetic stored-account isolation, not broker mapping), mocked provider/connection 38/38 (no real broker calls), private worker service 1/1, and focused Next/BFF/worker 16/16 on Node 24. |
| V2 production build and offline smoke | Complete `npm run build` passed locally on Windows Node 24. First offline smoke failed at the stale `Offline baseline` readiness marker after the home page changed; a new test now rejects that obsolete marker. `npm run test:smoke` passed after requiring the trading desk and safety banner (its occupied-port failure is an expected negative case). Supported Node 22 hosted build/smoke pending. |
| Import manifest refresh and verifier | Candidate hashes refreshed; local verifier passed 82 upstream paths, 402 candidate files after the raw HTTP fix; final-head check and review pending. |
| Go `go test -race ./...`, vet and build | `go test -race ./...` passed locally on Windows Go 1.26.1 after the raw HTTP fix; vet and standalone build not run. |
| Native Windows storage/security/build/smoke | Focused fixture tests, Windows preflight 11/11, complete V2 build and offline smoke passed locally on Node 24 after the readiness-marker correction; full worker/security suite on supported Node 22 remains pending. |
| `git diff --check`, complete diff/status inspection | `git diff --check` passed after latest UI edit; complete diff/status review pending |
| Independent full-diff review and hosted exact-head CI | Targeted test-only seam reviews passed after bounded cleanup fixes, but prior cumulative review **blocked M8** on absent production broker-backed lifecycle integration (P1) and omitted synthetic per-fill values/fees (P2, corrected in this later candidate with source-tagged fixture DTO and HTTP assertions). No final cumulative approval or hosted exact-head CI. |

Do not represent the test-only page, source-tagged synthetic facts or local tests
as a live broker execution path. Preserve **M8 OPEN** until the remaining
independent and exact-head gates actually pass.

## 2026-10-07 linked read-only history request-safety refinement

The bounded [ZAR-218 refinement](ZAR-218-Offline-Ledger-Order-History.md#2026-10-07-request-safety-refinement)
adds current-request generation guards, draft-token invalidation, explicit
owner-session-denial handling, account/intent/cursor checks and reload-on-overlap
history pagination. It preserves exact decimal facts, missing fees, unknown
outcomes, non-snapshot offset semantics and all-false production order controls.
Draft CSRF changes are not authenticated-session changes. This is a read-only
history refinement, with no home/Pi, synthetic-companion, broker/provider or
production execution activation. The linked closeout records actual local checks,
the local sandboxed-browser/Go limitations, and mandatory exact-head hosted
Ubuntu/native-Windows/Go/browser plus independent/adversarial review gates.
It does not close M8, live validation or explicit owner acceptance.
