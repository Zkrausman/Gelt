---
ticket: ZAR-218
title: Offline ledger-backed order history and execution timeline
status: candidate-unverified-pending-independent-gates
baseline: d231c524a78f605841b918cb09da09cad777d08f
runtime: V2 worker-owned SQLite ledger and protected BFF
live_actions: none
---

# Scope and implementation

Adds a read-only V2 order-history table and persistent intent detail/timeline backed
by the worker's existing validated `history`, `getIntent` and `timeline` ledger
operations. The protected BFF has only named history/detail POST operations. The
worker resolves the active selected-account handle to validated in-memory provider
identifiers; browser input never contains an account ID, owner ID, SQL, provider
request or write/dispatch operation. Existing Host/Origin/raw-ingress/session/CSRF,
private service authentication, no-store and bounded-body controls are retained.

The UI distinguishes exact requested quantity/limit price from each separately
observed execution quantity/price/optional fee. Exact decimal strings are not
converted to JS numbers or aggregated. Missing fees stay absent. Attempt, request,
acknowledgement and reconciliation labels state only their recorded meaning; they
never imply a fill or final no-fill. Worker timeline pages are storage-sequence
ordered and include explicit sequence markers, independent of late event timestamps.
Zero history is rendered as an empty result; invalid, malformed, unauthorized and
unavailable results fail closed with generic UI errors. Safe routing is masked.
Current ledger facts support USD only; no USD/USDT equivalence is introduced.

There is no candle source in V2 history. UI retains the timeline and displays an
unsupported-chart fallback. A pure compatibility gate rejects candle overlay unless
independent-source, exact instrument, exact quote currency and compatible time
bucket/observation evidence all match. No candle data, synthetic production events,
telemetry, broker/provider access or account data are added. Test fixtures are
explicitly synthetic and offline; tests seed private real SQLite through `Ledger`.

## Changed paths

- `v2/worker/src/ledger-contract.ts`, `ledger.ts`: strict route-scoped history and
  detail lookup forms; full existing transactional replay validation remains used.
- `v2/worker/src/connection.ts`: atomic selected-account and opaque handle scope.
- `v2/worker/src/history-contract.ts`, `order-history.ts`: bounded DTO schemas,
  masked routing and worker-side read-only assembly.
- `v2/worker/src/service.ts`, `index.ts`, `setup.ts`, `contract.ts`: authenticated
  named private history endpoints and owner-bound ledger wiring.
- `v2/worker/src/history.test.ts`: offline synthetic, private real-SQLite restart,
  account scope, sequence, decimal, missing-fee and no-invented-fill tests.
- `v2/web/lib/connection-bff.ts`, `history-bff.test.ts`: protected named BFF reads,
  closed output parsing and chart fallback/currency compatibility tests.
- `v2/web/lib/history-chart.ts`: conditional independent candle evidence gate.
- `v2/web/lib/history-pagination.ts`, `history-pagination.test.ts`: account-bound
  page merging and synthetic account-switch/empty-page regression tests.
- `v2/web/app/history/page.tsx`, `v2/web/app/connect/page.tsx`: read-only table,
  persistent detail timeline, fallback copy and account selection controls.
- `v2/CONNECTION-API.md`, `v2/LEDGER-API.md`: updated protected and ledger contracts.
- `v2/worker/vitest.config.ts`: include history BFF and pagination tests in the full suite.
- `v2/scripts/update-local-import.mjs`: preserve historical provenance reasons on rehash.
- `v2/IMPORT-MANIFEST.json`: externally refreshed local candidate hashes, restored historical reasons and explicit ZAR-218 provenance; original upstream hashes unchanged.
- `docs/specs/ZAR-218-Offline-Ledger-Order-History.md`: this implementation report.

No dependency, lockfile, Go/V1, provider, broker, ledger-write or dispatch changes.

## Limitations and security notes

- History is only available after an authenticated owner session and worker-side
  account selection/discovery; it is never an all-account browser query. Worker
  restart requires the existing M3 rediscovery/selection flow. Ledger page offsets
  are not snapshot tokens; insertion may shift pages, as documented in M4.
- Existing M4 contracts accept USD order/execution values only. Unsupported
  currencies fail validation instead of being converted or treated as equivalent.
- No actual market candle stream exists, so chart overlay remains disabled. The
  compatibility helper is not evidence of an upstream candle feed.
- The Squire Implement phase correctly left `v2/IMPORT-MANIFEST.json` stale because its
  strict bash allowlist omitted updater/verification commands. An external operator
  applied the successful Squire patch in a separate worktree, refreshed the local
  inventory with the repository script, reviewed new-file provenance and verified it.
  The immutable original Squire candidate was not altered; these are integration
  worktree gates, not Squire phase results.
- Local host checks below use Node 24, not V2's supported Node 22. Independent
  full-diff security review, supported Node22 hosted gates, PR/exact-head CI and
  merge remain pending. No broker/browser live compatibility or shipping approval is claimed.

## Verification evidence (candidate only; not shipping approval)

Environment: `node --version` reported **v24.14.0**, not the supported Node22 target.
The following final candidate commands and statuses were observed:

| Command | Exit | Result |
| --- | --- | --- |
| `npm --prefix v2 ci --offline --no-audit --no-fund` | 0 | 309 packages installed from cache; existing Recharts deprecation warning only |
| `cd v2 && npx vitest run --config worker/vitest.config.ts worker/src/history.test.ts` | 0 | 1 focused test passed; synthetic facts seeded via the real private SQLite ledger, reopened, then exercised through authenticated worker HTTP; account isolation, empty/unavailable reads, unknown reconciliation, sequence-vs-timestamp, exact decimals, absent fee, USD-only rejection and no invented fill covered |
| `cd v2 && npx vitest run web/lib/history-bff.test.ts` | 0 | 4 tests passed; protected BFF allowlist/session controls/output validation and chart source/instrument/currency/time fallback covered |
| `cd v2 && npx tsc -p worker --noEmit` | 0 | Worker typecheck passed |
| `cd v2 && npx tsc -p web --noEmit` | 0 | Web typecheck passed |
| `git diff --check` | 0 | No whitespace errors |
| `git status --short` | 0 | Only the intended V2 history/API/UI/tests and this ZAR-218 specification are modified or new |

Closed-loop corrections: an initial focused worker run failed because its synthetic
fixture assigned one provider route to multiple ledger account UUIDs; the fixture was
corrected to preserve ledger route uniqueness. A subsequent worker run exposed an
escaped content-length regex in the new private endpoint; that was corrected and the
final focused worker test passed. The first web typecheck reported an inferred empty
Vitest mock-call tuple; its test typing was corrected and the final web typecheck
passed. These failed attempts are not counted as passes.

**Separate integration-worktree gates, not Squire phase results (2026-09-26):**
`node v2/scripts/update-local-import.mjs` and `npm --prefix v2 run verify:import`
passed (82 upstream paths, 386 candidate files; unchanged upstream inventory).
Offline `npm --prefix v2 ci --offline --no-audit --no-fund` passed on host Node
24.14.0. Full `GELT_WINDOWS_PRIVATE_PARENT='C:\' npm --prefix v2 test` passed
with exit 0 (the log contains expected occupied-port negative-test errors).
`GELT_WINDOWS_PRIVATE_PARENT='C:\' NEXT_TELEMETRY_DISABLED=1 npm --prefix v2 run build` passed, including the
`/history` route. `GELT_WINDOWS_PRIVATE_PARENT='C:\' npm --prefix v2 run test:smoke` passed; its occupied-port
negative probe likewise emits expected errors. `GOTOOLCHAIN=go1.26.1 GOPROXY=off
go test -race ./...` passed on Windows without a reported race. Logs retained
outside the repository under the private `.squire` directory. These local Node24
receipts do not replace Node22 hosted Linux/Windows evidence.

**Independent full-diff review and correction (2026-09-26):** The read-only reviewer
inspected the complete cumulative patch and blocked merge on mixed-account UI
pagination: after account selection changed in another tab, a subsequent page
could append rows from the new account under its heading while retaining old
rows. The response now carries the worker-issued opaque selected-account handle
(already exposed by connection status), never a browser-supplied account ID.
The UI clears previous history/timeline and asks for a fresh load if handles
change between pages, including an empty second page; matching handles can
append. Worker HTTP and pure UI pagination regression tests cover these cases.
The reviewer also found that the manifest rehash rewrote historical M3/M4
provenance to a generic M4 reason. Historical reasons were restored with
explicit ZAR-218 attribution; the rehash tool now preserves existing reasons.
A fresh independent, read-only follow-up inspected the entire corrective commit and
returned **OK with notes** for code review. Its P2 note about omissions in this
changed-path list is addressed above. Neither review ran the hosted CI gates.

**Post-review integration-worktree checks (host Node24, 2026-09-26):** The new
web history BFF and pagination tests are now included in the full V2 Vitest
configuration (the prior full run omitted them). Focused worker history and UI
pagination tests passed. Full `GELT_WINDOWS_PRIVATE_PARENT='C:\' npm --prefix v2
test`, production V2 build, and offline smoke all exited 0. The first direct
focused test invocation without the required Windows private fixture parent
failed setup; the corrected invocation passed. A pre-correction newly included
BFF test initially failed because its mock lacked `accountHandle`; the fixed
mock passed. Expected `EADDRINUSE` negative-test output in the full suite and
smoke logs does not mean those commands failed. `verify:import` passed with
82 upstream paths and 388 candidate files. Go race passed before this
review-only TypeScript change and will run again in hosted CI.

**PENDING:** exact-head draft PR #464 hosted CI with supported Node22 V2
tests/build/smoke (including Windows native gates) and Go CI, then verified
merge. Independent code review is OK with the documented P2 correction. The
Squire candidate itself was UNVERIFIED; the integration worktree's independent
review and external gates, not the Squire run, govern merge. No merge or real
broker/browser operation has occurred here.

## 2026-10-07 request-safety refinement

This bounded refinement is based on master
`9e4622146efeac390c2bf8a99be91529ab7827cd`. It does not include the separate
synthetic-companion PR #480, change a provider or ledger schema, enable an order
operation, or claim M8/live acceptance.

### Implemented behavior

- Every browser history/detail read captures its generation, operation, draft
  CSRF token, opaque account handle when known, intent, limit and cursor. Starting
  another read invalidates the previous one. Response success, error and busy-state
  cleanup apply only to the current request. Abort is a best-effort optimization;
  the identity guard remains decisive if transport finishes after cancellation.
- New initial loads clear active data. A different detail selection supersedes an
  old detail request. Editing or restoring the CSRF draft invalidates outstanding
  reads, retains only a labeled previous partial snapshot and disables detail/page
  append until a fresh initial read. Draft-token edits do not revoke or replace an
  authenticated owner session. Client-side navigation uses Next Link; unmount
  invalidates pending reads without later component state updates.
- Only the BFF's explicit `401 { version: 'v1', error: 'unauthorized' }` clears
  active data as a confirmed owner-session denial. The same classification is
  returned for history/detail when the authoritative BFF session expires or is
  replaced while the worker response is awaited. Existing authentication decisions
  and lifecycle are unchanged. CSRF/Host/Origin errors, private-worker denials,
  malformed responses and transport failures remain generic; they do not imply
  logout or a broker outcome. A stale denial cannot clear a newer successful read.
- A page must match the requested offset/sequence cursor, limit, opaque account
  and intent. Duplicate intent IDs, cross-page overlap, duplicate/reversed/gapped
  timeline sequences, inconsistent continuation and timeline-count regression
  fail closed and require reload. No silent deduplication or snapshot-completeness
  claim is made. Offset pagination remains non-snapshot; concurrent insertion can
  shift offsets, and undetectable omissions are not ruled out.
- Account-handle mismatch clears the old account's list and detail. Exact decimal
  strings, missing fees, unknown/reconciliation labels, storage-sequence order,
  candle fallback and all-false production order capabilities remain unchanged.

### Changed files and acceptance contract

- `v2/web/app/history/page.tsx`: current-request application, freshness labels,
  generic versus confirmed-session errors, and client-navigation cleanup.
- `v2/web/lib/history-requests.ts`, `history-requests.test.ts`: immutable request
  identity, abort/invalidation, deterministic deferred-response races and typed
  error classification, with no dependency on cooperative cancellation.
- `v2/web/lib/history-pagination.ts`, `history-pagination.test.ts`: strict
  request/account/intent/cursor checks and duplicate/contiguity regressions.
- `v2/web/lib/connection-bff.ts`, `history-bff.test.ts`: late authoritative
  owner-session denial classification, plus expiry/replacement and private-worker
  error distinction tests. No session creation/revocation or access policy change.
- `v2/scripts/running-next-history-acceptance.mjs`: explicit test-only real
  Chromium/Next/raw-ingress/named-BFF/private-worker/SQLite acceptance. It uses
  synthetic in-memory provider setup and real seeded ledger facts; selected actual
  HTTP responses are delayed, never replaced with fabricated backend responses.
- `.github/workflows/v2.yml`: required Ubuntu sandboxed-browser acceptance after
  full tests/build/smoke, with private synthetic screenshot artifacts. Missing
  browser or unmet assertions fail the job; there is no skip-to-pass fallback.
- `v2/IMPORT-MANIFEST.json`: local candidate hashes/additions only; historical
  provenance, upstream hashes, locked dependencies and license notices preserved.
- This specification and the ZAR-219 linked refinement note: behavior, boundaries,
  implementation and verification receipts. No home/Pi or companion code changes.

### Verification receipts and remaining gates

The assistant cloud workspace materialized all V2 source at the stated master,
checking each Git blob hash before use. Retained-lock installation passed on
Node24.19.0 after directing node-gyp's writable cache to an explicit temporary
path. The first installation attempt failed because the default cache location
was unavailable; no dependency or security-policy relaxation was applied.

Focused history/request/pagination/BFF/real-worker checks passed **32/32** on
Node24.19.0. Web TypeScript checking passed. The pre-review aggregate candidate passed
all 18 upstream server tests, 279 worker/web tests (28 native-Windows-only tests
unperformed on Linux), 10 lifecycle scripts and import inventory (82 upstream
paths, 413 candidate files). An earlier production build and offline smoke also
passed, before the late-session BFF classification. Expected occupied-port
negative probes in those successful aggregate/smoke logs remain visible. The
final candidate requires the complete rerun after fresh
independent and adversarial full-diff review; earlier receipts are not substituted
for that final verification.

A deterministic deferred-response probe of the pinned master's actual
`loadHistory` handler reproduced both old success and old failure overwriting a
newer success. The new generation tests reject those completion orders. Review
also led to adding the existing offline-egress preload to the test-owned Next
child, matching supported runtime startup; browser interception alone does not
cover server-originated traffic. A further review caught a native-Windows test
fixture defect: successful bootstrap consumption retains a grant tombstone, so
the session-replacement regression must reissue its test-owned grant through
the existing `replacePrivate` primitive rather than exclusive new-file creation.
The fixture was corrected without changing storage or session policy. Fresh
review and verification are required after these remediations and manifest
refreshes; local Linux results do not substitute for the native Windows gate.

Local Chromium154 is installed, but a sandbox-preserving launch failed at
`process_singleton_posix` socket creation with `Operation not permitted`.
No `--no-sandbox`, unconfined browser, route bypass or security setting change was
used. Therefore local running-browser acceptance is **unperformed**, not passed.
The installed `/usr/bin/go` is not a Go compiler (`go version` rejects the option),
so local Go build/race/vet are also unperformed. Required supported Node22 Ubuntu
and native Windows, Go build/race/vet, and actual hosted browser evidence must
pass for the exact reviewed head before ordinary merge. The final PR/CI receipts
are the authoritative post-review gate results; this dated pre-publication record
must not be read as a shipping or live-compatibility claim.

Fresh independent and adversarial reviewers must inspect the entire final diff,
including this closeout and CI/browser evidence, with no unresolved blocker/high
finding. Head/base changes or any artifact remediation restart final review and
verification. No automated merge, force push, live endpoint, real credentials,
trade, public export, benchmark or owner-acceptance claim is part of this slice.

## 2026-10-07 addendum: bounded startup diagnostics

The running-history acceptance now reports bounded startup/discovery diagnostics
for its existing phases: elapsed time and remaining global deadline, owned browser
and Next process state, the latest startup HTTP outcome/status, and a bounded
stderr tail. Diagnostic output omits exception messages, response bodies and
URLs, and redacts known fixture secrets and common credential forms, including
common bare credential keys. Quoted structured-assignment lines in stderr retain
their key but mask the rest of the line. Preflight failures use fixed categories
so invalid invocation, missing local browser and the existing non-root
requirement remain distinguishable.

Browser DevTools target discovery is provided by the importable
`v2/scripts/history-startup-diagnostics.mjs` helper. It retains the existing
3,000ms request timeout and reports the response's actual status. No browser
launch, browser/security flag, startup retry, accepted history assertion,
ownership check, or overall/per-operation deadline was expanded.

Changed files for this refinement:

- `v2/scripts/running-next-history-acceptance.mjs`: bounded startup/discovery
  reporting and request/process observations; fixture and acceptance flow stay
  the same.
- `v2/scripts/history-startup-diagnostics.mjs`: importable bounded formatter,
  testable browser target discovery helper, and a bounded line buffer that only
  emits completed sanitized units; unfinished lines are omitted from failure
  snapshots.
- `v2/scripts/history-startup-diagnostics.test.mjs`: deterministic fake-fetch and
  fake-clock cases for 3,000ms discovery, HTTP/network failures, secret edge and
  chunk splits, incomplete bare/JSON credential snapshots, overlong-line omission,
  pretty-printed JSON credential redaction, escaped-quote credential tail masking,
  single-quoted key coverage, missing child wrappers, deadline-time cleanup
  reporting, pre-registration standalone-alias tail truncation, and preserved
  timeout and ownership invariants.
- `v2/IMPORT-MANIFEST.json`: refreshed local hashes and entries only; upstream
  provenance is unchanged.

Focused syntax checks and `node scripts/history-startup-diagnostics.test.mjs`
passed (17/17). The tests import the diagnostic helper and inspect the acceptance
source; they do not start Chromium/Edge or Next. This addendum does not replace or
extend the separately recorded Windows/browser run result above.
