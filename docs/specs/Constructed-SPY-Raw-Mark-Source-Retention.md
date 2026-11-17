---
title: Constructed SPY raw-mark source retention
status: implementation candidate
base: cea2447e48c70feb05deea4fd04343ae90d1a594
classification: constructed_offline_test
verification:
  implementation-tests: "105 passed across 8 files in parent-owned working validation"
  parent-working-validation: "worker types, 560-file import audit, Go race and vet passed"
  initial-independent-source-review: accepted-no-findings
  initial-adversarial-source-review: accepted-no-findings
  fresh-final-reviews-and-full-suite: pending
  exact-head-final-gates: pending
  ci-and-delivery: pending
  publication: pending
---

# Constructed SPY raw-mark source retention

## Purpose and boundary

This archive retains one exact constructed raw-mark request beside the complete
result freshly recomputed by the unchanged raw-mark/G05 binding. The existing
constructed source archive stores only the generated G05 projection input. It
cannot recover the supplied trade identifier, capture timestamps, raw mark, or
the exact outer request bytes. This module adds that missing source record in a
separate fixed namespace.

The archive is an internal synthetic fixture API. It does not authenticate a
market source, establish data rights or capture completeness, admit an actual
observation, qualify a fill or campaign, or authorize an order. The PR77 result
continues to say originalMarkPersistence: not_performed_by_this_api; this
archive's independent receipt describes what the separate store retained.
Source and consumer records are not atomically committed together.

## API and binding

ConstructedSpyRawMarkSourceStore accepts bounded owner JSON bytes and an
owned input Buffer; it does not traverse a caller-supplied owner object. The
owner has a closed schema binding the daily epoch, run, source commit,
configuration digest, raw-mark binding, legacy projection, candidate and
exact outer-input SHA-256. UUIDs have the existing ledger validation and a
36-character bound. Fixed-length lowercase hexadecimal IDs are checked as
complete strings, including rejection of trailing line breaks.

Before writing, create copies and validates the owner and raw input, invokes
the unchanged PR77 projector, requires its projected branch, reparses those
same bytes, and joins every declared identity to the recomputed result. The
archive receipt is generated from that result. It binds the complete result,
nested G05 projection, original byte length/hash, mark and evidence hashes,
daily request and assessment, manifest, rule input, candidate and decision.
Receipt and record digests are derived locally; no detached favorable result
is accepted.

The seven-field canonical record contains the closed owner, exact input
base64, complete PR77 result and separate receipt. On every read and readonly
reopen, the store checks the exact file bytes, canonical form, finite-number
leaves, owner, base64 length and encoding, original hash, and a fresh complete
PR77 recomputation. The reconstructed canonical record must match the disk
record byte-for-byte. Returned buffers, results and receipts are fresh values.

The store operates only under the explicit synthetic test gates and in an
already-existing private Linux directory on the shipped local filesystem
allowlist. Its namespace permits exactly raw-mark-source.json and the
.raw-mark-source.pending fence. It checks entry count, logical sizes, file
types, links, ownership, modes, inode identity and file times before and after
bounded nonblocking reads. Reopen is readonly and refuses a pending fence.
There is no takeover, repair, append, replacement, automatic cleanup after an
uncertain write, or restoration of a poisoned handle.

Writer close first replays the complete source, synchronizes the directory,
then unlinks the pending fence as its final fallible filesystem operation.
That ordering does not claim crash durability for the unlink, cross-store
atomicity, universal same-user race protection, or safe concurrent shutdown.
Readonly close changes only in-memory state and performs no filesystem writes.

## Logical storage bounds

All values are logical file-content limits; they are not claims about disk
allocation, physical quota, resident memory or elapsed time.

| Item | Limit |
| --- | ---: |
| Exact outer input | 1,048,576 bytes |
| Canonical base64 input field | 1,398,104 bytes |
| Canonical complete PR77 result | 3,145,728 bytes |
| Canonical owner | 8,192 bytes |
| Canonical receipt | 8,192 bytes |
| Canonical complete record | 5,242,880 bytes |
| Two-entry namespace total | 5,251,072 bytes |

The record has seven fixed top-level fields. Counting the encoded field names,
separators, fixed schema, integer and hash slots, and string delimiters gives
232 bytes of actual framing after the three object-value placeholders are
removed. The defensive calculation uses a larger 1,024-byte allowance:

1,398,104 + 3,145,728 + 8,192 + 8,192 + 1,024 = 4,561,240

That conservative upper bound is below the 5 MiB record guard. It is a static
logical-size calculation, not a promise that a favorable record exactly at the
guard can be produced. Tests exercise reachable exact input and owner bounds,
oversized persisted data, and a combined large valid declared-context case.
They do not claim that large declared portfolio balances are ledger-attainable
capital or that malformed intermediate branches have the same bound.

## Synthetic consumer join

The owned consumer fixture constructs its raw-mark request inside the existing
producer callback from the actual callback configuration and portfolio. A
setup-only portfolio with cash 19 is a deliberate decoy; the callback-owned
portfolio has cash 20 and zero quantity. The archive is created from the
callback's exact bytes and an owner derived from those bytes, then its replayed
result supplies the unchanged consumer's rule input, receipt and observation.
The decoy owner must not bind the callback source.

The test keeps adjusted daily close 2 separate from raw trade price 3 and
independently checks the modeled fill: quantity 1.66, price 3, fee 0.01, and
remaining cash 15.01. It joins the retained source/result/receipt to the
consumer's durable evidence. After stop, a readonly archive reopen preserves
the original bytes and completed fill while leaving files unchanged and
without another producer call. The later execution observation continues to
be supplied under the existing consumer checks; this archive does not
authenticate it.

A sibling fixture covers one modeled submit whose response is deliberately
lost. It checks the consumer's recorded `unknown` outcome and
`dispatchUnknown` history, zero recorded executions, and unchanged synthetic
balances; it does not infer whether a submitted order could exist beyond the
lost response. The fixture then halts the candidate, confirms preview and
confirmation remain unavailable, and compares the full retained source,
result, receipt, consumer history, durable candidate and portfolio across
readonly reopen. Archive file and directory identities, modification times,
bytes and names remain unchanged, and the producer is not called again. This
new acceptance fixture has not been run.

## Acceptance coverage

The owned unit suite implements the contract's A1–A8 cases:

| Area | Synthetic acceptance |
| --- | --- |
| Exact source and copy isolation | Preserve outer and nested daily lexical bytes; return detached input, complete result and receipt. |
| Closed owner | Bind each identity independently; accept exactly 8,192 owner bytes; reject 8,193, duplicate keys, invalid UTF-8, newline suffixes and extra fields before mutation. |
| Reachable input boundary | Accept valid exact 1 MiB outer JSON; reject one byte over before writing. |
| Complete replay | Reject changed input length/hash, owner, result, nested projection, receipt, coherent alternate raw mark, extra fields, invalid base64 and nonfinite numeric leaves. |
| Private namespace | Reject unknown entries, links, wrong file types/modes, unsafe roots, pending reopen and post-prevalidation FIFO substitution without repair. |
| Persistence and close | Inject fence sync, partial record write, record sync, root sync and final unlink failures; preserve uncertain fence evidence and verify directory sync precedes unlink. |
| Poison and readonly | Keep a failed writer poisoned after bytes are restored; require fixture gates; verify readonly reopen/read/close make no writes. |

The separate consumer test implements A9 with the actual guarded loopback
synthetic harness. A10 compatibility suites and full verification gates belong
to the separate parent validation lane, not the unit file. No provider, external
data, credentials, campaign, live capital or order route is used.

## Initial source and adversarial review

The independent source/privacy and adversarial reviews examined frozen
candidate head f3088b90f3ebe76ec28457c407d9aba7fddfc0a2. Both were accepted with
no blocker, high, actionable medium, actionable low, privacy, or indispensable
evidence-gap findings. An initial timing note was retracted by the same
adversarial reviewer after checking runner evidence: a synchronous callback
body runs before an event-loop timeout is armed, so that note did not establish
a current hard deadline or a reproduced flaky test. No code or assertion was
changed for it.

## Verification status

Parent-owned isolated working validation passed 105 tests across eight files:
10 new archive unit tests, one actual-consumer test and 94 unchanged
compatibility tests. The prior 10/10 unit run overlaps that total and is not
additional evidence. Worker TypeScript checking, the 560-candidate import
audit, the full Go race suite and Go vet also passed.

An earlier invocation stopped during fixture parsing before collecting any
tests because of an escaped child-source literal. The fixture was corrected;
the initial zero-tests-collected failure remains part of the history and is
not a product behavior result. The source writer did not run tests or builds.
The fresh final review pair, full required final suite, exact-head CI and
delivery remain pending. Initial review and working validation do not establish
operating readiness or release any existing hold.

## Explicit non-claims

This work does not establish source authenticity, lawful retention rights,
actual capture completeness, timestamps against a trusted clock, market
availability, session or trade eligibility, revision/finality, the first
global execution mark, calibrated costs, profitability, qualification,
provider access, actual observation, orders, campaign authority or year-end
operating readiness. A synthetic IEX trade and a separately declared daily SIP
or IEX signal remain distinct facts. Future-bar ingestion and correction
handling require a separate contract. Existing NOT_READY, CLOSED, and
DEFER outcomes and every historical unknown or denial hold remain in force.
