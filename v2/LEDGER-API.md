# M4 ledger API v1 — internal worker contract, no dispatch

`worker/src/ledger.ts` exports `Ledger(explicitPath, ownerId)` and synchronous
methods below. Only the lifecycle-owned worker may construct it. There is no HTTP,
BFF, browser or MCP ledger route. The M4 ledger remains facts-only and adds no
submission authority. ZAR-216 adds a separate internal `OrderLifecycle` contract,
not wired into setup, service or public routes; its production adapter is explicitly
unsupported and its successful adapter exists only in offline tests. No live calls
are made. See the [ZAR-216 candidate specification](../docs/specs/ZAR-216-M5-Preview-Confirmation-Lifecycle.md).

## Inputs and values

Runtime schemas and TypeScript types: `ledger-contract.ts`. All objects are strict;
unknown keys, wrong versions, raw payloads, metadata, comments and provider errors
are rejected. Inputs are decoded facts, never raw MCP results. Identifiers must
come from the caller/provider; the ledger never generates an intent/event/broker ID
or timestamp. Provisioning generates only the local opaque owner ID and storage
ownership token, neither a connected state nor provider fact.

- Local owner/account/intent/event/idempotency/attempt/request/reconciliation IDs:
  UUID strings. Owner is bound to one database; every query requires owner/account.
- Routing: `{provider:'robinhood-official-mcp', ACCOUNT, RHS, RHC?}`. Each route
  string is 1..64 ASCII alphanumeric/hyphen characters, excluding obvious credential
  labels. Each namespace is independently unique per owner. ACCOUNT is not RHS or
  RHC; coincident strings in *different* namespaces are not aliases. Future M3
  adapter maps `account_number`, `rhs_account_number`, `rhc_account_number`
  explicitly; ephemeral browser handles are not persistent account IDs. No mapping
  or provider invocation is wired in M4.
- Times: supplied UTC ISO timestamps with exactly millisecond precision and real
  calendar dates. Storage sequence, **not timestamp**, orders facts; late observations
  are allowed. No timestamp defaults or clock-derived execution facts.
- Decimal: `{value:'0.010', precision:4, scale:3}`. Unsigned ordinary decimal text,
  no exponents, signs, whitespace, leading integer zeros or binary numbers. Precision
  is lexical digit count (including the integer zero), 1..38; scale 0..18 must match
  exactly. Trailing fractional zeros are significant for scale and round-trip intact.
  Requested/observed quantity and price must be nonzero; observed fee may be zero.
  No monetary JS/SQLite numeric arithmetic, rounding, averaging or inferred totals.
- Initial order contract: explicit RHS/RHC route, instrument ID, buy/sell, positive
  requested quantity and **limit** price, USD only. RHC requires a supplied RHC ID.
  Unsupported order forms/currencies need a new reviewed contract, not extra metadata.

`Intent` includes version 1, owner/account/intent IDs, intent idempotency key,
`recordedAt`, routing and requested order. Initial projection has **zero facts**.
Events include version 1, same scope/intent, independent event/idempotency IDs and
`occurredAt`, plus exactly one payload:

| type | payload | meaning |
| --- | --- | --- |
| dispatch-attempted | attemptId | caller reports attempt, not successful request |
| order-requested | requestId | caller reports request, not acknowledgement |
| broker-acknowledged | brokerOrderId | observed provider acknowledgement, not fill |
| reconciliation-observed | reconciliationId, observation: unknown/not-found/present | observed reconciliation result, not execution |
| execution-observed | execution | actual independently supplied execution fact |
| preview-confirmed (M5) | previewId, confirmationId, fee, feeCurrency: USD, expiresAt, termsHash | internal exact terms confirmation; no dispatch by itself |
| dispatch-claimed (M5) | dispatchId, previewId, confirmationId, termsHash | durable single-use claim, committed before any injected adapter call |
| dispatch-outcome-unknown (M5) | outcomeId, dispatchId | local ambiguous outcome fact; not a broker status |
| reconciliation-unavailable (M5) | reconciliationId, dispatchId | local read failure; not a provider observation |
| broker-status-observed (M5) | observationId, status, optional brokerOrderId | explicit adapter observation; vocabulary is not an official provider contract |
| cancel-requested (M5) | cancelId, brokerOrderId | durable request fact, not cancellation success |
| cancel-acknowledged (M5) | cancelId, brokerOrderId | acknowledgement only; never terminal canceled by itself |

M5 event variants are append-only facts validated by the same transaction-local
replay. They contain no raw provider body, confirmation token or credential. The
internal lifecycle separately verifies terms binding and account-level in-flight
state; the public read-only timeline masks M5 identifiers and fees.

Execution contains executionId, brokerOrderId, observedQuantity, observedPrice,
optional observedFee and USD. An absent fee remains absent; it is not zero.
Never copy requested price/quantity to supply missing observed fields. No position,
connected state, submission, fee total or synthetic fill is derived.

## Methods and envelopes

All operations return `{version:1,ok:true,value}` or
`{version:1,ok:false,error}`; errors are closed `invalid`, `conflict`, `not_found`,
`capacity`, `unavailable`, with no paths, values, SQLite/provider diagnostics.
Constructor/close failure throws only `ledger unavailable`. Schemas for result,
projection, receipt, timeline and history are exported for future consumers.

- `recordIntent(unknown)` -> WriteReceipt. **IMMEDIATE transaction COMMIT precedes
  return**. Receipt is `{disposition:'committed'|'duplicate', projection}`. A future
  caller must not dispatch before a successful receipt. M4 has **no dispatch**.
- `append(unknown)` -> WriteReceipt. Reports a supplied fact, not permission to
  perform an operation. The M4 projection remains facts-only; when an M5 event is
  present, the transaction-local M5 validator additionally checks its strict claim,
  observation and account in-flight invariants.
- `getIntent({ownerId,accountId,intentId})` -> Projection. The read-only history
  boundary may instead use `{ownerId,intentId,routing}`; the same fully validated
  read resolves the intent only when its persisted route matches the worker's
  currently selected, independently validated provider account.
- `timeline(sameQuery,{after,limit})` -> events in contiguous stored sequence.
- `history({ownerId,accountId},{after,limit})` -> projections sorted by intent UUID.
  Read-only selected-account history may use `{ownerId,routing}` instead of a
  browser-supplied account ID; replay-valid projections are filtered by the exact
  provider/ACCOUNT/RHS route (and matching RHC when persisted). Both forms retain
  the same complete relational replay and bounded paging.
- `ownerHasUnresolvedLifecycle(ownerId)` (M5 internal only) -> owner-wide replay-validated
  boolean. A shared halt cannot be cleared by changing the selected account while
  any account retains an unresolved/ambiguous order; no public endpoint exposes it.
- `close()` -> deterministic close; clean close idempotent. Failed close retains
  ownership. `available()` is only current handle availability, not connectivity.

Projection v1 is `{version:1,intent,eventCount,facts}`: deterministic facts-only replay.
`after` is a zero-based offset 0..1000, limit 1..100. Each call is a consistent read
snapshot, **not a multi-page snapshot token**. Inserting intents can shift history
pages; UUID order is deterministic, not chronological. Timeline order is contiguous
storage sequence, never timestamp order. The protected history UI uses pages of at
most 50 and does not sort late observations by occurredAt. Global MVP capacity is 1000
accounts/intents and 1000 events/fact identifiers per database, no eviction. Capacity
requires an explicit future design; never discard audit data to make space.

Intent IDs/keys and event IDs/keys are independently unique within owner/account.
Identical duplicate intent returns the *current validated* projection. Identical
event reuse returns it without appending. Any mismatching reuse (including another
intent) is conflict without mutation. Fact identifiers are unique by
owner/account/order-route/event-type; repeated brokerOrderId in different executions
is allowed, while repeated executionId is not. No silent last-write-wins.

## Atomicity, reads, corruption

Every operation loads the complete bounded database under a transaction. Stored
intent/event bodies must match strict schemas and byte-for-byte canonical sorted-key
JSON. All scope, IDs, idempotency, type, sequence, account routing, hash chain and
fact-index relations are checked. Replayed projections must equal persisted bytes.
Every append performs this **inside its IMMEDIATE transaction, before duplicate
resolution or derivation**, then atomically inserts event/fact index and updates
projection. Post-write validation also runs before commit. Timeline is sliced only
*after* the same full canonical/relational validator; it cannot bypass validation.

Any corruption, SQLite/disk/constraint/busy/uncertain failure poisons the handle.
Further reads/writes return unavailable; there is no partial success or automatic
retry. M5 semantic replay also checks terms hashes, claim ordering, cancellation
ack/request correspondence and at most one unresolved M5 intent per account.
An unknown dispatch remains open even after any uncorrelated status or execution.
No such response may be attributed to its intent or used as a cancellation ID;
automatic release requires a separately reviewed correlation contract. COMMIT
uncertainty is not a failed-order verdict: preserve identifiers for future
stopped-process inspection. Hashes detect inconsistent records, not malicious
coordinated rewriting by the OS owner. Same-user compromise is outside this model.

Strict schemas cannot decide whether an arbitrary plausible identifier is actually
a credential. Future trusted adapters must supply only allowlisted identifier facts;
never pass tokens, codes, PKCE, sessions, raw MCP bodies or provider errors here.
No public endpoint accepts these inputs. See [operations](LEDGER-OPERATIONS.md).

## Internal diagnostic evidence (not an API contract)

Ordinary result envelopes and constructor/close messages remain generic. The
worker-only `storage-diagnostics.ts` module retains frozen allowlisted tuples in a
WeakMap, not properties serialized with results/errors. Synthetic tests may use
`storageDiagnosticForTest` / `formatStorageDiagnosticForTest` on a caught error or
failed Ledger instance. They emit only stage, operation, check and optional object
kind; arbitrary or missing evidence becomes PROTOCOL. These are not stable
lifecycle/history fields, HTTP/CLI output, telemetry, or persisted events. Never
route them to the browser or log inputs/native exception text. A poisoned handle
retains its first failed operation evidence; a new available operation clears it.

## Native storage ownership prerequisite

Main database, marker, secrets, directories and explicitly created private objects
require current-user ownership. Only SQLite-created WAL/SHM/journal may have an
owner in the existing closed trusted set (current user, SYSTEM, Administrators,
TrustedInstaller). This is gated by SQLite context and the internally assigned
wal/shm/journal kind; unknown kinds fail closed. Single-file validation classifies
only the canonical final filename, case-sensitively: exact endings `.sqlite`,
`.sqlite-wal`, `.sqlite-shm` and `.sqlite-journal` map to main/wal/shm/journal.
Generic `-wal` names, case variants, confusables, extra suffixes and directory-only
matches fail before any sidecar owner exception. Local NTFS, canonical/no-reparse/
single-link, private DACL/no untrusted allow ACE and current-user FullControl checks remain.
No owner/ACL repair or public write authority is added. See [operations](LEDGER-OPERATIONS.md)
for provisioning and exact-head native verification prerequisites.
