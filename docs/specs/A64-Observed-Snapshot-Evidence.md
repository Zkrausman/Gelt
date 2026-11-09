---
type: specification
title: "A64 observed-snapshot evidence and read-only reopen v2"
status: source-candidate-awaiting-original-pair-correction-review
source_baseline: c8350f7251033b8f634d8c01fdccf1fb7cc2de0c
scope: "Offline evidence only; no provider operation or runtime/trading admission"
---

# A64 observed-snapshot evidence, version 2

This source-only worker library extends the selected
[GELT-PAMR-A64-EVIDENCE-001 engineering case](PAMR-A64-Proposed-Case-Registration.md).
It implements a separate observed-data contract, not admission to historical
profiles or operating policy. The existing constructed consumer, historical
inspector, pure assessor and PR46 receipt/store schemas remain unchanged and
reject the new identities. No CLI, service, scheduler, global-fetch default,
provider invocation or trading consumer is added.

## Explicit construction and one-shot flow

`createA64ObservedSnapshotChain` takes an existing empty private directory, strict
v2 profile and owner binding, explicit credentials, and mandatory injected
transport/UTC/monotonic callbacks. Tests supply only synthetic credentials and
responses. The trusted owner must exclusively control construction, directory
selection, inputs and callbacks; this is not a callback sandbox or authenticated
custodian. A separately authorized future orchestrator would still need actual
rights, handling, clock/supervisor and finite operation policy. Source delivery
provides none of those facts or permissions.

The closed profile fixes SPY/IEX/all/USD/1Day/descending and exactly 253 explicit
New York-midnight timestamp/date declarations, including DST compatibility.
These are structural mappings, not proved exchange sessions or completed bars.
Start/end bind the mapping; `asof` means symbol identity only. Completion, vintage,
revision coherence and provider atomicity remain unknown/not established. Reported
supplier daily-end guidance is not empirical endpoint testing or a finality
policy. No actual dates, collection window or cadence are selected here.

One explicit chain run initializes owner-bound storage, collects at most three
sequential pages with `limit=min(100,253-count)`, reserves the exact module-issued
frozen object, inspects, assesses, retains one terminal receipt and closes.
Short pages may require a third limit greater than 53. Missing/extra/cyclic
cursors, incomplete totals, malformed bars or mismatched identities reject;
there is no fourth request, retry, resume, re-query or fallback. Private issuance
cannot be recovered from JSON, a pipe or read-only reopen. The low-level injected
connector/replay functions do not authenticate custody or grant operating rights;
one namespace/epoch and fresh exclusive construction remain caller obligations.

## Full-byte and mathematical reconstruction

The original contains complete ordered raw pages, exact decimal close tokens,
request/page/cursor metadata, profile and local timing. The inspector chooses the
newest 65 closes, reverses them to chronology, excludes 188, and computes exactly
64 adjacent ratios using the unchanged exact-rational arithmetic. Initialization
is equal weights at the selected-history start; the unit reserve is a declared
mathematical relative, not cash return evidence. No full 252-step-history claim,
market allocation, sizing or consumed decision is introduced.

The pure v2 assessor re-decodes every raw page and independently checks all
requests, token hashes, observations, mapping, selection, math, artifact, context
and owner/case/epoch bindings. Serialized timing establishes declared order only,
not authenticated clock trust or historical availability. Assessment reports
`consumptionAttempts:0`, `operationalDecisions:0`, `persistence:not_performed`;
serialized declarations never regain private issuance. All sixteen actual checks,
including C07/C13/C14, remain UNKNOWN.

Caps remain: 262144 aggregate UTF8 bytes including raw-page base64; 32768 request,
180000 artifact, and 8192 each context/assessment/receipt; three pages, 253 rows,
524288 bytes/page, 1024-character opaque tokens and 10000 ms per response/body.
Parser depth/node/number-token bounds, 32-character exact ratios, 64 updates and
4096-bit temporary arithmetic remain. Legal provider pages may not fit complete
retention: reject rather than truncate, omit bytes or substitute hashes.

## Receipt, uncertainty and reopen

`A64ObservedSnapshotReceiptStore` is a sibling codec with a distinct file/schema,
not a migration or relaxation of PR46. An assessed receipt retains the complete
input plus recomputed assessment. A known validation/math/resource rejection may
instead retain a visibly reported negative with `fullEvidenceRetained:false`,
zero history updates and no artifact/context/assessment hash. Its finite reason
is a local report; omitted source bytes do not become a verified source failure.
One bound epoch has one terminal receipt, sequence 1, independently of 64 updates.

Transport/body/clock/settlement uncertainty and storage/read/write/close failures
cannot become clean negative receipts. Timeout abort is not settlement proof;
late callbacks cannot inspect or retain success. Ownership/pending fences latch
uncertainty, with no repair, retry, lock reclamation or epoch reset. A durable
pending fence survives a lock-removal/directory-sync failure. Final fence removal
is the last successful operation; a crash may conservatively restore it, never
authorize recovery. Empty or uncertain writers cannot reopen cleanly.

Read-only reopen copies a clean bounded checkpoint into memory, validates its
schema, binding and exact original preimages, and recomputes the assessment. It
performs no filesystem/network writes, repair, collection, issuance restoration
or qualification upgrade. SQLite sidecars and active ownership are refused.
Storage remains Linux/private-namespace only, at most 8 MiB total with the stricter
128 x 4096-byte SQLite page ceiling. Trusted exclusive namespace and native SQLite
I/O assumptions remain; there is no arbitrary-hostile-runtime or total I/O bound.

The new store explicitly opts into nonblocking transitive storage validation.
Every affected regular-file read uses nonblocking/no-follow opens and fstat
checks, including main/sidecars, marker reads and removal's internal read.
Opted-in directory sync uses directory/no-follow/nonblocking flags. Existing
callers retain their defaults and permissions. Synthetic children replace a real
file with a FIFO after prevalidation immediately before each affected open;
an external boundary watchdog treats blocking as failure, not an accepted retry
or production timeout. No favorable extra precheck substitutes for this oracle.

## Changed files and verification boundary

Four v2 components and focused tests implement contract, chain, whole-input
assessment and receipt; a synthetic test-support module is not imported by an
application entry. Narrow seams in the historical connector and mathematical
module reuse parsing and arithmetic without changing historical schemas.
`ledger-storage.ts`/`private-files.ts` add only explicit opt-in nonblocking
validation; defaults, permissions and unrelated callers are preserved. Import
inventory and the existing case/consumer/roadmap record this versioned scope.

Independent contract review identified the transitive blocking-open race; its
four-field opt-in seam/oracle clarification was confirmed by the original
reviewer. Working synthetic checks cover the new complete join, exact arithmetic,
forged/cross-version data, pagination, late callbacks, resource caps, reported
negatives, ownership, corruption, partial writes, directory-sync failure and
read-only reopen. Historical compatibility and working Go checks precede source
review. Complete independent and distinct adversarial accuracy/privacy artifact
reviews and required fresh final-head Linux Go/V2/scientific/applicable browser
checks must pass before normal draft PR/exact-head CI publication. Working tests
are not independent review or runtime qualification; new PR merge is separate.

Qualification NOT_READY, production CLOSED and operations DEFER remain. No live
provider acquisition, financial transaction, trading decision, runner activation,
credential/access/security configuration, calibration or profitability claim.
Historical uncertain handoffs and unrelated metadata corrections are untouched.


## Implementation review corrections and working evidence

The first complete independent/adversarial source reviews required profile
reservation to validate and recompute the supplied profile, instead of trusting
its fingerprint. Invalid attempts remain consumed. Each request now enforces
`bodyComplete.mono - start.mono <= 10000` milliseconds both at collection and
whole-input reconstruction. A same-process overrun latches uncertainty even if
the timer callback has not yet run; the exactly-10000-ms boundary remains valid.
This neither qualifies the clock nor adds a live operation.

Checkpoint reopen validates 4096-byte pages, a matching physical/header page
count in 1–128, and at most 524288 image bytes before SQLite deserialization.
The aggregate directory ceiling remains 8 MiB. Synthetic negative controls on
the original source reproduced acceptance of a padded oversized image and valid
8192/65536-page-size databases; a genuine 128-page/4096-byte image remains the
positive boundary control. The FIFO oracle additionally covers sibling snapshot,
pending-fence and checkpoint/reopen reads, retaining writer fences or read-only
unavailability without creating a repair marker.

Before these source-review corrections, working checks passed 280 tests across
14 files, TypeScript compilation, Go 1.26.1 `go test -race ./... -count=1`,
`go vet ./...`, import inventory and diff checks under Node 22.23.3 and owned
Linux fixture directories. The correction's new regressions were first run as
negative controls against the reviewed source. Those expected failures remain
historical results; they are not acceptance passes. Corrected working checks,
original-pair finding closure and then the full fresh final-head verification
suite are distinct required gates. No working test is operating evidence.


The corrected focused run passed all 60 cases under pinned Node 22.23.3,
including 25 real-FIFO substitution cases and the exact timing/page-ceiling
controls. TypeScript compilation and YAML metadata parsing passed. These are
working correction results, not original-reviewer closure, full final-head
integration, hosted CI, runtime qualification or operating admission.


### Completion measurement before known-negative classification

A subsequent adversarial correction review found that completed credential-echo
and invalid-response cancellation paths could throw a known rejection before
reaching the outer completion-clock check. Six synthetic negative controls on
the reviewed correction reproduced skipped completion observations and clean
reported negatives despite over-budget or unavailable completion-clock evidence.
The private fetch helper now routes every internally completed outcome through
the same local completion-clock/duration gate before classifying it. Exactly
10000 ms remains permitted; overrun or unavailable completion observations latch
uncertainty and preserve pending ownership rather than retaining a negative.
Unsettled errors, aborts and late callbacks remain uncertain. This changes no
historical v1 path, timeout, request count, public schema or operating authority.
Original-reviewer confirmation and fresh final-head verification are still
required before draft PR/CI; no new successor merge is authorized here.


### Unbuilt checkout child-process regression

The first draft-PR CI run failed 30 child-process cases before their storage
assertions because those cases imported an unbuilt `worker/dist` module. Local
verification had compiled first and therefore did not detect that prerequisite.
The test children now use the already-locked `tsx` source loader, matching the
existing receipt tests. No workflow order, production code, watchdog, FIFO
boundary, geometry assertion, storage permission or dependency is changed.
All 34 receipt cases pass in an isolated checkout containing source and the
existing dependencies with no `worker/dist`, using a private Linux fixture
parent. An initial isolated attempt correctly rejected group-writable fixture
ancestors; that failure remains recorded. These are focused working results;
original-pair correction review, fresh final-head verification and automatic CI
on the corrected head remain required. No browser acceptance or operating
qualification is inferred from the earlier failure or these focused tests.
