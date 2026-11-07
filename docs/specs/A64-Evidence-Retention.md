---
type: specification
title: Offline A64 evidence retention and read-only reopen
status: source-candidate-pending-independent-review
source_baseline: 10128b4cad05539905710dfbb70572d327f60905
scope: evidence retention only; no active consumer or operating admission
---

# Offline A64 evidence retention

The owner approved one separate durable evidence receipt and protected read-only
reopen for the selected engineering evidence-chain case. This implements the
[evidence-family separation](PAMR-A64-Consumer-Contract-Proposal.md#historical-updates-versus-actual-consumption)
without connecting market inspection to PR28's constructed lifecycle. The pure
assessor and its existing agent command remain unchanged. This is a local API,
not a new CLI, server endpoint, runner, qualification procedure or campaign.

## Input, binding and meaning

`A64EvidenceReceiptStore.create(root, binding)` claims a previously empty,
pre-existing private Linux directory. The fixed filename is
`a64-evidence-receipt.sqlite`. A strict binding contains the new
`gelt.a64-evidence-retention-binding.v1` schema, an owner-namespace digest and
the expected case/epoch digest. These are caller-supplied data bindings, not
identity authentication or authority. Trusted caller selection of the dedicated
namespace is required. A hash does not prevent a caller from copying data into
an unrelated directory or establish global uniqueness across namespaces.

`retain(inputText)` accepts the unchanged whole-input assessor request: complete
artifact and context strings. It calls `assessA64InspectionEvidence` directly;
there is no supplied verdict, callback or detached digest shortcut. Rejected,
forged, incomplete or mismatched data cannot create a receipt. The context's
recomputed case/epoch binding must match the fixed owner binding. No new case,
window, calendar, allocation or operating policy is selected.

The immutable outer receipt has a separate hash domain, exact raw-input hash
and length, canonical assessment/artifact/context bindings, receipt sequence1
and no predecessor. The64 mathematical updates remain history. The receipt
records evidence retention only: zero operational decisions, zero consumption
attempts, no effect authority, dispatch or promotion. The nested assessor output
retains `persistence:not_performed`; the outer receipt alone says
`persistence:evidence_record_only`. Neither supplies original issuance, private
completion, current validity, trusted clocks, rights, runtime qualification or
prospective readiness. All sixteen inherited checks and actual unknowns survive
whole-input recomputation. C07/C13/C14 UNKNOWN, NOT_READY/CLOSED/DEFER remain.

The only return from `read()` is the bounded receipt and recomputed assessment;
raw input, root paths, raw owner identifiers and database errors are not returned.
The private database does contain the complete supplied input. Its mode/UID
checks are source controls, not an actual privacy/handling qualification.

## Ownership, persistence and uncertainty

The new module reuses existing `LedgerStorage` and private-file validation,
without changing either helper or any constructed-consumer schema. One empty
namespace supports one binding and one receipt only. There is no append,
replacement, migration, deletion, recovery, lock stealing, second writer epoch
or writable reopen API. A duplicate cannot replace an existing record, even if
its new input is structurally valid. Constructor conflicts do not close or
poison another owner's writer. Invalid input is rejected before retention
mutation; malformed/damaged existing storage is not reported as a benign duplicate.

The existing storage helper owns the exclusive persistent marker, SQLite WAL
transaction, FULL synchronization and clean-close checkpoint. The new receipt
component does not assume the helper always retains its marker after close errors. Initialization,
write, read-validation or close failure fences that instance. Post-mutation
uncertainty retains a receipt-local pending fence and cannot be cleared by
this component. That fence is durably created before receipt mutation, separately
from the inherited SQLite ownership marker. It remains if helper close unlinks
its marker and then fails directory synchronization. Closing an empty writer is uncertain, not a reusable clean store.
Callers must distinguish `retain` returning from a successful `close`; a receipt
is not proof of clean shutdown, own acknowledgement or operating settlement.
External deletion, copying or same-user hostile tampering is not prevented by
this data contract and is never an authorized recovery method.

After successful helper close, the last fallible operation is a direct unlink
of the receipt-local pending fence. No synchronization or other fallible work
follows that unlink. A failed unlink retains the fence under the supported local
Linux syscall contract. A crash can restore the unsynchronized fence, causing
conservative rejection; durable release is not claimed and no repair is provided.

`A64EvidenceReceiptStore.reopen(root, binding)` is read-only. It requires the
expected complete binding, no pending fence or marker/journal/WAL/SHM sidecar, a valid private
checkpoint and exactly the two expected table definitions. It recomputes the
entire stored input and assessment and compares all receipt bindings. It creates
no lock or sidecar and performs no checkpoint, schema creation or repair.

Reopen deserializes a bounded copy into memory with trusted schema disabled and
query-only mode. SQLite documents that checkpointed WAL images require changing
format bytes18/19 to1 before in-memory deserialization; this is performed only
on the copy, after validating the stored header. The on-disk bytes are unchanged.
See [SQLite's deserialize contract](https://www.sqlite.org/c3ref/deserialize.html).
Every subsequent read checks the root/file identities, current checkpoint hash,
private-file properties and expected schema. A stale in-memory copy cannot mask
subsequent disk replacement or corruption. This is bounded data replay, not
operational recovery, authenticity or clearing an UNKNOWN state.

## Finite limits and failures

Existing input262144-byte, artifact180000-byte, context8192-byte, assessment8192-byte
and strict JSON depth16/node20000 limits remain enforced by the unchanged assessor.
The complete outer receipt is at most8192 bytes. One record is permitted; there
is no64-record allowance or sequence allocator. The entire dedicated directory,
including SQLite sidecars and marker, is checked against the existing8MiB ceiling.
A newly created database additionally requires4096-byte pages and limits itself
to128 pages (512KiB); bounded input plus evidence fits below that conservative
internal limit. This grants no second shared-store allowance and does not extend
or share PR28's existing store. The caller must supply a dedicated private
namespace within its separately accepted handling budget.

Linux private directories/files, supported local filesystem semantics, exact UID,
0700/0600 modes, no symlinks/hardlinks, bounded file inventory and stable identities
are required. Local candidate reads reject nonregular metadata before opening,
then use nonblocking/no-follow descriptor validation and identity comparison to
reject FIFO replacement between those checks. Existing helper internals remain
unchanged and assume the trusted exclusive namespace; hostile same-UID changes
outside that ownership contract are not newly qualified. Windows, network filesystems and unknown locking semantics reject.
No packages, global configuration, permissions on existing files, credentials or
access controls are changed by this source increment.

Public failures use `A64EvidenceReceiptError` with fixed text and bounded reasons:
`invalid_input`, `unavailable`, `already_retained`, `readonly` or `uncertain`.
They do not echo supplied data, filesystem paths or raw database/OS exceptions.
An uncertainty failure is a stop, not permission to repeat a retention attempt.

## Changed files and verification boundary

- `a64-evidence-receipt-contract.ts`: strict binding, separate receipt domain,
  disclosures, limits, sanitized errors and bounded receipt parsing.
- `a64-evidence-receipt.ts`: one owned record, full recomputation, existing storage
  fences, clean checkpoint validation and in-memory read-only reopen.
- Their two test files: synthetic complete-input retention, unchanged nested
  assessment, sequence/history separation, PR28 rejection, duplicate/identity
  changes, concurrent ownership, failed mutation/initialization/checkpoint,
  corruption, resource bounds, unsafe filesystem objects and no-write reopen.
- This specification and additive import-inventory entries only. Existing
  assessor/math/inspector/consumer/lifecycle/runtime, dependencies and workflows
  remain byte-identical. The cumulative roadmap is untouched because its earlier
  closeout handoff remains uncertain; this source delivery does not replay it.

The first working compiler run exposed argument-type mismatches and its following
misrooted test command found no tests; neither was a pass. After correction,
reopen tests exposed SQLite's WAL-deserialization restriction. The documented
memory-only header workaround fixed it. A later test fault-injection attempt
could not spy on a native module export; it was replaced by injection through the
existing storage instance/prototype. Original failed receipts are retained.
Working verification is not independent review or final-head acceptance.

Both original reviewers required correction of a close-uncertainty hole: the
inherited helper can unlink its marker before a failed directory sync. A new
regression reproduced that hole and another reproduced blocking FIFO inspection.
The receipt-local fence and nonblocking local reads above address those groups
without changing shared storage. The independent reviewer also requested an
exact-length digest guard. Trailing-terminator acceptance did not reproduce
against the original non-m JavaScript regex on pinnedNode22; an explicit length64
check now makes the contract unambiguous. This is not claimed as a reproduced
LOW defect. Initial working checks used PATHNode24 and retain that qualification;
corrected and final checks use the existing pinnedNode22.23.3. Original-reviewer
closure and post-correction verification remain pending.

Fresh independent and distinct adversarial accuracy/privacy review of the full
diff and named storage/assessor seams, final-head Linux tests/types/Go race/vet/
build, V2 build/smoke/import and applicable scientific/protected gates remain
required before ordinary draft PR/check/merge/remote verification. Formal GitHub
Approve requires separate action-time authority; no force, bypass or auto-merge.

No actual source-inspection artifact, market-data acquisition, runtime/handling
qualification, allocation/sizing/confirmation/order, runner launch, trading or
financial transaction is performed or admitted. This source API reduces the
future durable evidence-consumer implementation gap. It does not satisfy R5,
admit the selected prospective case, or reopen H-WALKTHROUGH. Full remaining
operational effort and observation duration remain unknown.

## Clean-checkout test harness correction

The first draft PR's Node CI found three subprocess tests importing ignored
`worker/dist` output before the workflow's build step. The build-first local
verification had masked that dependency. These tests now load the actual
TypeScript source through the already installed `tsx` test tooling. No dependency,
workflow, product file, assertion or deadline changes are included. The original
failed hosted result remains retained; prior passing results do not verify this
new test-only candidate. Independent correction confirmation and final-head
verification remain required before updating the draft PR or merging.

## Approved startup timing instrumentation — one attempt pending

The corrected receipt source passed local verification and hosted unit/build/
offline smoke, Go and scientific checks. The remaining hosted history-browser
acceptance stopped at its first DevTools HTTP request: Chrome156 was running,
fetch rejected with TimeoutError before a response, Next had not started and
zero acceptance stages completed. The remaining whole-run budget was168682ms.
The underlying reason remains unknown; D-Bus stderr is not a demonstrated cause.

The owner separately approved diagnostic instrumentation in the shared history
startup helper/tests and necessary caller wiring. This is not a functional fix.
The patch records monotonic elapsed port discovery/observation and fetch start,
settlement and duration, configured3000ms timeout and a closed abort-state/reason
snapshot. Fetch settlement means headers or rejection; it does not time JSON/body
completion or establish browser acceptance. Safe unknown values replace invalid
clock or abort observations without changing the original fetch outcome.

One fixed-field timing line is emitted when the existing fetch settles, even on
success, with no PASS marker or URL/body/error text. Failure snapshots retain that
browser observation independently of a later Next request. Numeric fields are
nonnegative safe integers or unknown; reason/outcome fields use closed enums.
The new line is under512 characters; existing1200-character stderr/redaction
limits remain unchanged. The child label is now ipcConnected: it describes Node
IPC only, not CDP. Browser startup uses no Node IPC channel.

Exactly one fetch and its3000ms signal remain. The180000ms global budget,
10000ms browser readiness wait,5000ms WebSocket wait, acceptance assertions,
default sandbox flags, offline confinement, ownership and cleanup are unchanged.
A mechanical caller inverse proof removes only diagnostic wiring and reproduces
its entire prior source byte-for-byte. Controlled-clock/signal tests distinguish
a timeout-aborted fetch, a network failure without abort and HTTP success without
claiming body/browser completion, while preserving rejection identity and privacy.
No browser, provider or held runtime is launched by these unit tests.

After required independent accuracy/privacy review and local verification,
exactly one instrumented hosted CI attempt is authorized. The push automatically
starts the existing workflows; no duplicate manual rerun or retry policy is
released. An uncertain push/run outcome must be reconciled before further action;
a failed attempt consumes this authority. The original failures remain preserved.
No merge, auto-merge, deployment, package/dependency, sandbox/security, credential,
operating or trading changes are authorized by this diagnostics approval.
