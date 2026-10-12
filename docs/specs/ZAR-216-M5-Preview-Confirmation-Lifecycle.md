---
type: specification
title: "ZAR-216: M5 bounded preview, confirmation and fail-closed order lifecycle"
ticket: ZAR-216
status: offline-candidate-review-and-hosted-ci-pending
baseline: "6296bfba3779d6fd2e74a4b6886f739b505ac12f"
runtime: "Node 22 / TypeScript, additive under v2/worker"
provider_capability: "ZAR-212 feasibility GO; later read-only historical known-ID detail/fill observed; unknown-ID correlation and replay still unverified; no live authority"
execution_enabled: false
verification_scope: "Raw Squire phase unverified; separate Windows Node24 offline checks passed; Node22 hosted/review pending"
changed_files:
  - docs/specs/ZAR-216-M5-Preview-Confirmation-Lifecycle.md
  - v2/worker/src/history-contract.ts
  - v2/worker/src/ledger-contract.ts
  - v2/worker/src/ledger.ts
  - v2/worker/src/order-history.ts
  - v2/worker/src/order-lifecycle.test.ts
  - v2/worker/src/order-lifecycle.ts
  - v2/web/app/history/page.tsx
  - v2/LEDGER-API.md
  - v2/LEDGER-OPERATIONS.md
  - v2/README.md
  - v2/IMPORT-MANIFEST.json
import_inventory: "Refreshed in separate integration worktree; 82 upstream paths, 392 candidates; verifier passed"
---

# ZAR-216 / M5 candidate contract and completion report

## Authority and stop condition

This ticket delivers a bounded **internal** M5 lifecycle. ZAR-212 is
**Done** with an owner-reviewed feasibility GO dated 2026-09-18; that decision
superseded the historical HOLD recommendation, but did not establish server replay
retention, unambiguous unknown-outcome correlation, cancellation finality, or
live-order authority. A later owner-authorized read-only MCP probe showed
historical order detail and executions by a known broker order ID, and Robinhood's
public Agentic Trading overview confirms read access to order history. Neither
proves that a particular timed-out submission can be identified automatically. Authenticated
preview/place/status/cancel *input* schemas were inspected in ZAR-212, not
implemented or proven interoperable by this candidate. No live provider request,
credential, OAuth browser flow, production fake,
network adapter, V1 fallback, order route, dispatcher registration, M6 Submit
control, funding, deployment, merge, or live order/cancel action is added. The existing
M6 UI continues to label its fixture as simulated and keeps submission disabled.

The internal lifecycle in `worker/src/order-lifecycle.ts` is not wired into
`setup.ts`, `service.ts`, the worker HTTP surface, the BFF, or the browser. A caller
must inject a narrowly typed adapter. `UnsupportedOrderAdapter` performs no IO and
fails closed; the only successful adapter exercised in candidate tests is an
explicitly synthetic offline test adapter. This implementation therefore does not
claim that a production order can be previewed, submitted, read, or canceled.
The owner accepted fail-closed halt and human-reviewed history investigation for
unknown outcomes as the M5 boundary. ZAR-216's written exit criteria explicitly
require blocking new submissions on timeout/unknown, not automatic recovery or
blind retry. Real-backend integration and the cross-lane offline acceptance gate
belong to ZAR-219/M8 under the ZAR-211 DAG; live orders require separate
ZAR-220/M9 authorization and ZAR-221/M10 supervision. Merging this internal
module must not be represented as activating production execution.

## Contract and invariants

- Preview binds the selected owner/account and exact routing identity to BUY LIMIT
  order terms, fee explicitly denominated in USD, preview identity and millisecond
  expiry. The adapter's returned order must exactly equal the requested order. No
  preview is made up by production
  code; fee is required and supplied explicitly by the injected adapter.
- Money is canonical decimal text. A non-USD or missing fee denomination is rejected.
  Fee-inclusive notional is calculated with
  `BigInt` coefficients and decimal scales, never JS floating point, and is rejected
  above USD 10. The request stays a BUY LIMIT in USD; unknown fee, changed terms,
  expired terms, unsupported route/schema, and account-selection changes fail
  closed.
- The explicit confirmation token is random, process-local and one-use. Its terms
  digest binds owner, account, complete routing, instrument, side, exact quantity,
  limit price, fee, preview ID and expiry. The token is consumed on attempted
  confirmation, including changed/expired terms. It is not persisted or returned
  outside the internal worker module.
- Confirmation commits the M4 intent, exact confirmation fact and a durable
  `dispatch-claimed` fact before the single injected `dispatch` invocation. A claim
  is keyed by the durable intent identity. Duplicate clicks or duplicate receipts
  cannot re-invoke dispatch. An uncertain provider or persistence outcome stops new
  submissions; there is no blind write retry.
- Ledger replay checks M5 event sequencing, exact terms digest, confirmation/claim
  identity, cancel-request/ack correspondence, and no more than one unresolved M5
  order per account. These checks are invoked by the M4 ledger's transaction-local
  full replay on every read/write. Existing canonical body/hash/fact-index/projection
  validation, poison-on-corruption, and writer ownership remain in force.
- Reconciliation remains available while new orders are halted. Explicit adapter
  status and separate observed execution facts are recorded; local transport/parser
  failures use a distinct `reconciliation-unavailable` fact and never manufacture a
  provider status. Any successfully parsed but uncorrelated result, including
  nonterminal partial status and executions, records no false read-failure,
  status, or execution against this intent; the durable unknown and global halt
  remain. An ambiguous dispatch uses `dispatch-outcome-unknown`, not a
  fabricated broker status. `unknown`, `not-found`, partial status, and cancel acknowledgement do not release the account
  lock. A cancel request is durably recorded before calling the adapter; repeated
  cancellation is not retried. A cancel acknowledgement is not final canceled.
  Actual observed fees stay optional; requested values never supply an execution.
- Lifecycle serialization and halt/generation state are shared across manager
  handles on one worker-owned ledger. Halting invalidates outstanding previews.
  Each new ledger lifecycle starts halted. An internal caller must explicitly resume
  only after owner-wide transaction-local replay shows no unresolved M5 order in
  **any account**, nor ambiguous pre-M5 dispatch/request/acknowledgement/
  reconciliation/execution fact. Selecting an empty account B cannot bypass an
  unknown dispatch in account A. Every **reconciliation** status and execution
  requires a previously acknowledged matching broker ID; cancellation may use
  only that proven ID. An explicit rejection returned directly by dispatch is
  a separate terminal outcome and needs no broker acknowledgement.
  An unknown dispatch cannot be auto-resolved by an asserted ID without a
  separately reviewed correlation/recovery contract. Restart recovery never re-dispatches
  a claimed identity and unknown outcomes remain unresolved pending reconciliation.
  The active M3 selection is still required to scope the worker operation.

The status vocabulary is an internal closed test contract, **not** a claim about the
official provider's status enum or finality semantics. A `filled` status can only be
stored when supplied as an explicit adapter observation; this candidate fabricates
no fill or fee. Because no official schema/finality evidence is available, the
production adapter remains unsupported and the module is not runtime-active.

## Changed-path inventory

- `v2/worker/src/order-lifecycle.ts` — internal bounded terms, exact cap, one-use
  confirmation, durable claim, serialization, reconciliation/cancel behavior,
  restart-safe stop, and fail-closed adapter.
- `v2/worker/src/order-lifecycle.test.ts` — synthetic offline contract tests for
  cap, expiry/changed terms, one-use/repeated and simultaneous confirmations,
  selection changes, unknown/restart, rejection, partial fill, cancel race, halt,
  unsupported adapter, poisoned durable-claim failure and semantically corrupted replay.
- `v2/worker/src/ledger-contract.ts` — append-only strict M5 event variants.
- `v2/worker/src/ledger.ts` — M5 replay validation in existing transactions and
  stable fact indexing for new events.
- `v2/worker/src/order-history.ts`, `history-contract.ts`, and
  `v2/web/app/history/page.tsx` — safe read-only M6 timeline projections and
  truthful descriptions for M5 events; preview identifiers, terms digest, fee,
  confirmation ID, dispatch identity, cancel ID and broker order ID remain masked.
- `v2/LEDGER-API.md`, `v2/LEDGER-OPERATIONS.md`, and `v2/README.md` — additive
  internal M5 event and recovery boundaries; explicitly distinguish the unintegrated
  candidate from the running execution-disabled services.
- This specification — candidate scope, authority boundary, changed paths and
  verification limitations.

No worker service/API capability enum, setup, provider transport, web/BFF route,
M6 simulated-submit control, dependency, package lock, Go code or runtime activation
was changed. The M6 read-only history contract remains read-only; new timeline items disclose only
fixed event kinds/time and observed status. During the Squire phase the named ZAR-217 M6 spec file was not locatable
through its constrained file interface. The operator subsequently inspected
`docs/specs/ZAR-217-M6-Connection-Card-Order-Preview.md` from the clean merge
baseline during integration. The M6 simulated submit button remains disabled.

## Verification receipts and pending gates

**No Squire-phase verification command completed.** Initial bash inspection invocations were blocked as
`unlisted_command`; the user explicitly prohibits aliases or nested shells to bypass
the command gate. A blocked command is not a test receipt. No Go race, V2 test,
build, smoke, import verification, whitespace check, or status/diff command is
claimed as passed. The tests listed above were authored but are unexecuted.

**Separate operator integration worktree (2026-09-26, host Node24.14.0):** The
raw Squire candidate and its blocked-command receipts remain untouched. The
patch was applied to an isolated clean Gelt worktree at the original source
commit. `node v2/scripts/update-local-import.mjs` refreshed hashes and new
entries; historical reasons were preserved and explicit ZAR-216 attribution was
added. `node v2/scripts/verify-import.mjs` passed with 82 upstream paths and
392 candidate files. Offline `npm --prefix v2 ci --offline --no-audit --no-fund`
passed. Focused real-private-SQLite M5 Vitest initially passed 11/11; the full
`GELT_WINDOWS_PRIVATE_PARENT='C:\' npm --prefix v2 test` exited 0. Production
V2 build and offline smoke both exited 0; expected occupied-port negative
probe logs are not overall failures. `GOTOOLCHAIN=go1.26.1 GOPROXY=off go test
-race ./...` exited 0 on Windows. Logs are retained privately outside the
repository. These host Node24 receipts do **not** replace supported Node22 CI.

**Independent full-diff review and correction:** The read-only reviewer inspected
all 1125 lines of the first cumulative patch and blocked merge on two P1 safety
findings: unknown order in account A could be bypassed by selecting B to clear
the shared halt, and uncorrelated `filled` status could release an unknown
submission. The internal owner-wide ledger check and conservative terminal
correlation guard now keep these states unresolved. Focused tests for both
scenarios passed 13/13 on host Node24. After correction, the full V2 suite,
production build, offline smoke and import verification were rerun and exited 0;
expected occupied-port negative-test output is not a failed gate. The earlier
Windows Go race pass still applies because no Go source changed. The review
also found the
outdated ZAR-212 HOLD wording; this report now records the dated owner GO
without implying live compatibility. The original BLOCK verdict is **not** a
sign-off on the corrected diff.

**Follow-up independent review:** The reviewer confirmed the two P1 paths and
ZAR-212 correction against the full corrective diff, but identified a P2:
a parsed uncorrelated terminal response was mislabeled as
`reconciliation-unavailable`. The subsequent local correction halts without
recording either a fake read failure or unverified terminal/execution fact;
the focused regression asserts this distinction. The targeted independent
review returned **code-review OK with notes**, finding no new safety defect but
noting that the two uncorrelated responses used empty execution arrays. The
synthetic unproven-ID terminal response now includes a valid execution that
must not be attributed to the intent; the targeted regression passed 1/1 on
host Node24. The full suite/build/smoke have not been rerun after this final
P2 code correction, and the reviewer did not execute tests.

**Final cumulative review correction:** The independent read-only reviewer of the
1,276-line cumulative diff BLOCKED merge on a P1: a nonterminal uncorrelated
`partially-filled` response could append an execution for an unknown dispatch
or seed a broker ID used for cancellation. The lifecycle now requires a previously
acknowledged matching broker order ID for **every reconciliation** status and
execution before writing an observation; a direct dispatch rejection remains
separately valid. Cancellation uses only that acknowledged ID and rejects
unknown dispatches. A new offline regression covers partial read with a fill,
partial read without a fill, and forbidden cancellation. After the correction,
focused lifecycle tests passed 14/14; the full V2 suite, build, offline smoke,
import verifier and whitespace check exited 0 on Windows Node24. The earlier
Go race pass applies because no Go source changed. A follow-up independent
review and supported exact-head hosted CI remain mandatory. The targeted
independent follow-up found no further code-safety defect (**OK with notes**);
its documentation note about direct dispatch rejection is corrected here.

**Delivery decision and remaining gates:** The owner accepted the written M5
fail-closed unknown-outcome boundary and directed shipment of this internal ticket.
A separate owner-requested Squire follow-up (`squire-1790446809431-c2f6fcbfbf`)
produced an UNVERIFIED patch for known-ID offline read hardening but explicitly
did not resolve unknown-ID lookup; that patch is **not** part of this integration
head and its blocked inspection is not a test receipt. Do not conflate absence
of automatic unknown recovery with a failed M5 acceptance criterion. The final external Windows Node24 full V2 tests, production build, offline
smoke, import verification and Go race all exited 0 after the test-only
`395ba7e` correction and scope documentation update. Expected occupied-port
negative-test output is not a failed gate. Fresh cumulative review and
supported exact-head Node22 Linux/Windows V2 and Go hosted CI still precede
merge. Real provider replay
retention, ambiguous-outcome correlation and cancel finality remain unverified;
there is no production adapter, dispatch activation, UI submit authority or live
execution proof. Those limitations remain explicit for ZAR-219/M8 and later gates.
