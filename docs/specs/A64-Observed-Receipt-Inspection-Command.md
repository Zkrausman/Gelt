---
type: specification
title: Offline agent inspection of existing A64 observed receipts
status: source-candidate-pending-independent-review
source_baseline: 1c2ac4e2a1654da1ad5102de5529940e74f5b140
---

# Offline read-only receipt inspection

This separately approved command exposes PR48's existing observed-receipt reader
to the finite agent stdin/JSON workflow. It does not acquire, retain or repair
evidence. Historical PR35 and PR46 schemas/commands and PR48 defaults are unchanged.

Build the worker, then run `node v2/worker/dist/a64-observed-receipt-inspection-cli.js
--describe` or invoke it without arguments with one complete UTF-8 JSON stdin
document. The input schema is `gelt.agent.a64-observed-receipt-inspection-input.v1`
with exactly `schema`, `root` and `binding`. `binding` is the existing strict
`gelt.a64-observed-evidence-binding.v2`. The explicit root is an absolute normalized
private directory locator, not authentication; OS ownership and the existing
trusted namespace assumptions remain. No environment, filename argument, callback,
provider URL, credential or arbitrary action is accepted.

The response schema is `gelt.agent.a64-observed-receipt-inspection-response.v1`.
`assessed_data` carries the existing stored receipt and recomputed assessment.
`rejected` either reports a stored negative with its original reason, receipt and
null assessment, or rejects input/transport with a fixed reason and no receipt.
`unavailable` uses only `evidence_unavailable` for missing, fenced, corrupt,
mismatched or otherwise unavailable stores. It does not distinguish private
filesystem errors. A stored negative remains a locally reported source failure,
not a newly verified complete source rejection. Successful inspection reports
serialized declarations rather than private-object issuance or authenticity.

Exit 0 means a complete assessment or discovery; exit 2 means rejection or
unavailability; exit 64 means unsupported arguments without stdin consumption;
exit 74 means output unavailable or unexpected transport failure. A complete
response and its actual exit must both be checked; partial output is not evidence.
Discovery exposes these source-defined identities, reasons, statuses and limits.

Input and output are each 8192 bytes, with the output newline/envelope included.
The root is at most 4096 UTF-8 bytes and excludes NUL. Existing strict JSON parsing,
4096-chunk limit and five-second stdin/output bounds are reused unchanged. These
transport timers do not claim preemption of synchronous filesystem/SQLite work.
PR48's complete-input, checkpoint geometry, private ownership, nonblocking FIFO
and 8 MiB store limits remain unchanged. There is no discovery of other stores.

The handler calls only existing `reopen`, recomputing `read`, and read-only
`close`. It returns no success if close fails and does not retry any operation.
The existing read-only store uses an in-memory SQLite image and creates no lock,
checkpoint, repair marker or directory entry. Output excludes raw input pages,
artifact/context preimages, prices, paths and exceptions. Nested receipt
`persistence:evidence_record_only` describes historical retention; outer
`persistence:not_performed` and `inspectionWrites:0` describe this inspection.
All consumption/operational decisions remain 0, supplier completion/vintage/revision
coherence remain unknown, runtime NOT_READY, production CLOSED and operations DEFER.
No sizing, allocation, confirmation, orders, runner, provider or promotion entry
point is added; no operating case or runtime is admitted.

## Changed files and acceptance evidence

New worker CLI and focused tests cover discovery, input/stream/output bounds,
positive and reported-negative stores, repeated read-only inspection, whole-input
forgery, identity and version mismatch, pending/corruption/unsafe namespaces,
close failure, and an actual FIFO substituted after prevalidation in a separate
source-loader child. Existing bounded transport and PR48 storage stay unchanged.
The new compiled-command conformance script joins canonical offline smoke and
checks discovery/rejection/unavailability, positive recomputation, wrong identity
and negative inspection through actual child pipes with an offline egress guard.
Test fixtures alone create/clean their own stores; the product command never does.
The import inventory and worker usage documentation identify the new files.

Focused working results must be recorded before the complete independent and
distinct adversarial source/privacy reviews. Accepted final artifact reviews
precede fresh required exact-head Go/V2/scientific/protected-browser verification
and normal draft PR/CI. Tests are not review or runtime qualification. This scope
stops before marking ready, merging, auto-merge, deployment or actual operation.
Existing uncertain requests, acquisition/trading/security and no-rerun holds stay.


Working verification on Node22.23.3 passed33 new tests plus21 historical CLI
compatibility cases, TypeScript compilation and8 actual compiled-pipe cases.
A source-only isolated fixture also passed33 cases with no worker/dist; a later
discovery-only addition exposes source-derived input/binding field names and
leaves the operation unchanged. Go1.26.1 race tests and vet passed. These are
working checks only: complete final artifact review and fresh exact-head
integration/hosted gates remain pending. Overlapping test runs are not additive
unique-case counts, and no test establishes supplier or runtime qualification.
