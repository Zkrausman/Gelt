---
id: ZAR-217
title: "M6 connection card and exact-order preview/confirmation UI"
status: candidate-unverified
scope: M6 UI only
authority: "Owner-approved serial ticket ZAR-218 → ZAR-217 → ZAR-216"
source_commit: "7ca31b73fed2c228c77d0ea8dc1cd6d0f998b467"
verification_status: "Squire phase unverified; separate local Node24 checks passed; Node22 hosted CI pending"
---

# ZAR-217 — M6 connection card and exact-order preview/confirmation UI

## Authority and scope

This is a bounded implementation candidate for ZAR-217, based on the source and
M3 protected connection boundary identified by the ticket. It does not amend the
ZAR-214 API or grant additional authority. The status, discover, select, initiate,
and disconnect controls call only the named protected M3 endpoints. M3 has no
preview, confirmation, submission, or cancellation endpoint. M5/ZAR-216 owns
lifecycle authorities; real-backend integration belongs to M8/ZAR-219.

The UI is intentionally read-only with respect to execution. It must never present
an M3 `connected` status as proof of live provider interoperability, trading
readiness, funds, balance, instrument support, or permission to trade. Unknown,
expired, unavailable, disconnected, unselected, stale, invalid-decimal, unknown-fee,
and over-cap conditions fail closed for the local acknowledgement. No broker
credentials, provider calls, order/cancel routes, grants, execution receipts,
telemetry, deployment, or activation are added. V1 and Go sources remain outside
scope.

## Implemented behavior

### Protected M3 connection card

- The initial state is explicitly unknown until a user requests protected status.
  Successful responses are parsed against the closed M3 v1 state shape, including
  `execution: false`, expiry/account consistency, opaque handles, and masked labels.
  Invalid responses and request failures become unknown/unavailable rather than
  being displayed as connected.
- The card displays only M3-returned state and masked account labels. Before a
  successful status read, selection is **unknown**, never displayed as a known
  `None`; an actual response with no selection may show `None`. A successful
  status observation is treated as fresh for at most 30 seconds; stale status is
  labeled stale, hides actionable selection, and blocks local acknowledgement until
  the owner reads status again. Selection is exposed only for a coherent connected
  response; local expiry hides the selection controls and removes the selected label.
- Initiation and discovery controls are constrained to their expected M3 lifecycle
  states. Selection controls require a current unexpired connected state. Every
  status-changing API action clears the UI acknowledgement before the request.
- Copy explains that connected is not trading readiness, funds, or live-provider
  proof. Local disconnect is not represented as remote revocation.

### Simulated BUY ticket

- BTC-USD and ETH-USD values are fixed local offline development fixtures. The UI
  labels the whole ticket as simulated, not live, not a broker preview, and not
  production telemetry. No market/provider request supplies fixture values.
- The user enters a bounded exact USD decimal string. Invalid input is displayed
  as an invalid/unknown amount, not as `$<unparsed text> USD`; valid input is
  formatted from parsed cents. Money parsing, simulated fee addition,
  fee-inclusive $10.00 cap checks, and quantity truncation use integer
  cents/BigInt; no floating-point money arithmetic is used. The preview shows pair,
  BUY side, exact amount, masked selected account, indicative fixture price,
  estimated quantity, fixture fee, total, local fixture age/expiry, and warnings.
- The sample fixture fee is `$0.05` and is explicitly simulated; actual fees remain
  unknown. A null/invalid fee produces an unknown total/cap and disables local
  acknowledgement. A known simulated total above $10.00 also disables it.
- Fixture age is measured only from the local fixture creation clock. It is not
  represented as observed market quote age. Fixture expiry is 60 seconds and stale
  terms cannot be acknowledged.
- Changing amount or pair immediately clears acknowledgement. M3 requests clear it
  before invocation (including account selection); selected-account changes and
  M3/fixture expiry prevent a retained acknowledgement from remaining active.

### Non-authoritative exact-terms acknowledgement

- A user may locally acknowledge the displayed simulation only when the returned
  M3 status is connected, has a selected masked account and has not expired, and
  the fixture terms are valid, fresh, known-fee, and within the simulated cap.
- The acknowledgement is one idempotent local boolean. Repeated clicks do not mint
  a second state, grant, token, or authority. It is reset when terms or connection
  state change or become stale.
- The Submit BUY control is permanently disabled. No handler, preview/confirmation
  API, submit/cancel call, confirmation grant/token, or execution receipt exists.
  The UI explicitly states this limit alongside the terms being acknowledged.

## Focused offline tests added

`v2/web/lib/m6-ui.test.ts` covers coherent/invalid/unknown status, selection,
30-second status freshness and expiry gates, changed pair/amount/account/expiry terms, idempotent repeated
acknowledgement, unknown fees, stale fixture values, exact cap behavior, and
truthful simulated labels/age/fee/quantity. The web-library test glob was added to
the existing V2 Vitest configuration; no new dependency was added. These tests ran in the separate Windows integration worktree on host Node 24;
supported Node 22 evidence still requires hosted CI.

## Changed-path inventory

| Path | Disposition |
| --- | --- |
| `v2/web/app/connect/page.tsx` | Updated M3 card, status gating, offline-only simulated BUY ticket, exact terms and permanently disabled submission. |
| `v2/web/lib/m6-ui.ts` | Added closed status parsing, exact decimal fixture preview/cap/expiry and idempotent local acknowledgement helpers. |
| `v2/web/lib/m6-ui.test.ts` | Added focused offline M6 state/truth tests. |
| `v2/worker/vitest.config.ts` | Included the V2 web library test glob in existing Vitest execution. |
| `docs/specs/ZAR-217-M6-Connection-Card-Order-Preview.md` | Added this specification, completion report, path inventory and evidence status. |
| `v2/IMPORT-MANIFEST.json` | Refreshed separately in the operator integration worktree: changed local hashes, explicit ZAR-217 provenance for both added files and modified entries, original upstream evidence unchanged; import verifier passed. The raw Squire patch remains unverified and unchanged. |

No V1, Go, worker authority/API, M3 protected-boundary route, dependency/lockfile,
credential, provider, ledger, deployment, or activation path was changed.

## Verification and completion report

### Actual phase evidence

No tests, build, smoke, import verification, or Go checks were run. The initial
`pwd && ls` shell request was rejected by the Squire command gate as
`unlisted_command`; it was **not run** and is not verification. The operator-declared
allowed command list was not available in the task text, so no retry, alias, or
nested-shell workaround was attempted.

| Check | Phase result |
| --- | --- |
| Dependency install (`npm --prefix v2 ci --no-audit --no-fund`) | Not run |
| Focused M6 Vitest tests | Not run |
| Full V2 tests (`npm --prefix v2 test`) on supported Node 22 | Not run |
| V2 production build (`NEXT_TELEMETRY_DISABLED=1 npm --prefix v2 run build`) | Not run |
| V2 offline smoke (`npm --prefix v2 run test:smoke`) | Not run |
| V2 import verification (`npm --prefix v2 run verify:import`) | Not run; import manifest is known stale as listed above |
| Go race suite (`GOTOOLCHAIN=go1.26.1 go test -race ./...`) | Not run; V1 source was not changed |
| Go vet/build (`GOTOOLCHAIN=go1.26.1 go vet ./...`; `GOTOOLCHAIN=go1.26.1 go build ./...`) | Not run |
| Native Windows private-storage/API acceptance | Not run here; parent-owned hosted Node 22 CI remains pending |
| `git diff --check` / complete diff review | Not run; no permitted shell command was available |
| Independent full-diff review | Pending outside this phase |
| Hosted Node 22 exact-head CI and verified merge | Pending and not claimed |

### Separate operator integration-worktree checks (2026-09-26)

The raw Squire candidate patch and failed preflight evidence were retained. It
was applied to a separate clean Gelt worktree at the original merge baseline,
without altering the Squire result. On Windows host Node **24.14.0**, offline
`npm --prefix v2 ci --offline --no-audit --no-fund` exited 0. Full
`GELT_WINDOWS_PRIVATE_PARENT='C:\' npm --prefix v2 test` exited 0, including
`web/lib/m6-ui.test.ts`; expected occupied-port negative-test `EADDRINUSE`
output in the log is not an overall test failure. `GELT_WINDOWS_PRIVATE_PARENT='C:\'
NEXT_TELEMETRY_DISABLED=1 npm --prefix v2 run build` exited 0, including the
`/connect` route. `GELT_WINDOWS_PRIVATE_PARENT='C:\' npm --prefix v2 run
test:smoke` exited 0 with expected occupied-port negative-probe errors.
`GOTOOLCHAIN=go1.26.1 GOPROXY=off go test -race ./...` exited 0. Refresh of the
local import inventory and `node v2/scripts/verify-import.mjs` passed with 82
upstream paths and 390 candidate files. Logs are retained privately outside
the repository.

**Independent full-diff review and correction:** A fresh read-only reviewer
inspected the complete original cumulative patch and blocked merge on two
truthfulness P2 findings: unknown selection was displayed as known `None` before
a valid M3 status, and invalid amount text such as `1e2` was rendered as `$1e2
USD`. Both display paths now use tested pure helpers: unknown status stays
unknown, known unselected stays `None`, and only parsed cents render as money.
The added focused UI tests passed on host Node24. The original BLOCK verdict
is not approval of this corrective commit; follow-up confirmation is pending.

**Still pending:** independent confirmation of these fixes, supported Node 22
hosted Linux/Windows exact-head V2 tests/build/smoke and Go CI, and verified
merge. A Squire `UNVERIFIED` candidate and local Node 24 tests do not
establish shipping approval. No live provider/browser login, broker execution,
deployment, or Node 24 production compatibility is claimed.
