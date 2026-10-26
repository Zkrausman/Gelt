---
type: specification
title: "Conditional same-process byte-review kernel"
description: "Bounded byte checks, private completion linkage and evidence-linked lifecycle for constructed verification."
timestamp: "2026-10-26T00:00:00Z"
status: "conditional-source-only"
---

# Conditional same-process byte-review kernel

This delivery implements the structural and conditional source machinery for
reviewing original input bytes before discard. Operational adoption remains
**DEFER**. Production preflight returns `PRODUCTION_CLOSED` and
`dispatchAllowed:false` before capture or reviewer dispatch. Operational input,
handling, settlement and recipient qualification require separate admission.

## Interfaces and authority

The accepted consumer specification document is revision **1.3**; its public
consumer revision remains **1.1**. Binding, invocation and verdict schemas retain
v1; settlement, status and acknowledgement schemas retain v2.

| Interface | Implemented scope |
| --- | --- |
| `productionByteReviewAvailability()` / `productionByteReviewPreflight()` | Unavailable admission; no caller enable switch or dispatch API. |
| `createConstructedByteReviewLane()` | Fixed compiled BRCFIX fixture; original-object reservation and privately linked completion acceptance. |
| `inspectConstructedByteReview()` | Diagnostic check vector; parsing or equality alone grants no authentication. |
| `createConstructedByteReviewCoordinator()` | Capture reservation, linked fixed checker and incomplete/negative completion; no positive whole-job settlement or complete-release producer. |
| `createSimulatedByteReviewCoordinator()` | Explicit `SIMULATED_ONLY` lifecycle conformance, including conditional favorable evidence. |

The constructed checker profile uses two BRCFIX rows. The separate SPY253 fixture
uses synthetic fetch responses and a receipt/context adapter to exercise the
existing connector. Prices, calendar, availability, rights and costs in these
fixtures are constructed declarations. Neither fixture establishes an eligible
market window, corporate-action evidence or calibrated economic costs. The
capture command, provider request path, original-object ownership and admission
policy are unchanged.

Every emitted status retains `decision:abstain`, `reason:unverified_data`,
`eligibility:unverified`, `effectAuthority:none`, `promotionAllowed:false` and
`retryAllowed:false`. C07, C13 and C14 remain unknown without actual closure,
reviewer-admission and handling evidence.

## Original bytes and the closed check vector

The private lane checks same-module connector issuance before inspecting or
cloning supplied graphs. A reconstructed acquisition cannot substitute for the
original object. The checker independently examines ordered page bytes,
canonical base64, digests, cursor linkage, exact decimal tokens, OHLC predicates,
timestamps and original observations. Calendar, availability, context and
candidate predicates are checked against owned evidence. Existing G05 canonical
input and receipt algorithms remain separate from private comparison encoding.

| Check | Subject |
| --- | --- |
| C01 | Original connector issuance |
| C02 | Page bytes and digests |
| C03 | Request and cursor linkage |
| C04 | Rows and exact decimals |
| C05 | Original observations |
| C06 | Receipt consistency |
| C07 | Closure and revisions |
| C08 | Calendar |
| C09 | Availability |
| C10 | Context and policy |
| C11 | Candidate |
| C12 | Authority fences |
| C13 | Reviewer admission |
| C14 | Handling |
| C15 | Lifecycle |
| C16 | Immutability |

The vector keeps its fixed order and closed reasons. Missing or unestablished
checks remain unknown. Established semantic defects map to their corresponding
checks rather than being labeled temporal mutation. Ordinary unsupported graph
construction and subsequent seal failures remain distinct from semantic defects.

Completion acceptance binds the fixed producer, original acquisition, binding,
invocation and single completion through private same-process identities.
Verdict-shaped JSON, matching IDs or successful structural parsing cannot supply
that linkage. Trusted construction excludes hostile proxies and prototype
interposition; ordinary descriptor checks establish no process isolation.

## Comparison and work bounds

Private comparison sorts keys by Unicode scalar sequence and applies its fixed
escaping rule. Binary64 values use the shortest round-tripping representation by
byte length, fixed notation before exponent notation on ties, then ASCII lexical
order. Exact provider and monetary decimal strings retain their separate format.

Generic values retain depth 12, 5,000 visited values, 64 object members, 253 array
elements and 4,096 Unicode scalars per string/key. Candidate canonical input has
its separate 262,144-byte limit; other evidence has a 262,144-byte envelope and
binding comparison has a 786,432-byte limit.

The generic decoder's conservative **245,800,000-byte** ceiling covers its entire
generic vocabulary: `5000 * (2 * (6 * 4096 + 2) + 4)`. Intrinsic view extent is
checked before copying. A fresh base view uses intrinsic backing-store metadata,
avoiding caller-owned length, constructor or species properties. A bounded
syntax/structure scanner precedes whole-tree JSON parsing. Invalid diagnostics
are sanitized. The over-ceiling unit test uses controlled intrinsic-length
instrumentation, rather than allocating an oversized payload.

These are source work/domain bounds. Runtime memory qualification, retention
entitlement, complete copy accounting and secure erasure remain unestablished.

## Finite evidence-linked lifecycle

Each attempt retains additive evidence receipts **R**, a current settlement
projection **C**, and at most one immutable emission snapshot **E**. Reservations
are irreversible. Execution settlement, reference release and acknowledgement
each need their own linked evidence; a verdict or local return supplies neither
of the other dimensions.

Known queued evidence and commit-capacity effects are folded before final
projection and the single synchronous handoff. Later adverse receipts update C
and latch uncertainty while preserving E, receipt history and independently valid
acknowledgement evidence. A specific contradiction invalidates the evidence it
targets. Reporting failure can coexist with an independently valid acknowledgement.
Post-reservation pending/conflicting evidence yields a defined unknown projection.

Release proofs, assessments and applicable disposal failures follow the current
execution-proof generation. Renewed settlement after lost execution evidence
requires fresh applicable release accounting before reportability. Corroborating
settlement observations while execution remains settled preserve independently
supported release facts. A stale release contradiction remains adverse history
but cannot assess a renewed execution proof.

`disposal_not_established` requires settled execution and unestablished disposal.
When current complete release is established, the historical failure receipt and
uncertainty remain retained, while selection uses another supported adverse
outcome or the defined unknown fallback. Both settlement and emitted-status
validators reject incompatible tuples. Receipt precedence never fabricates a
missing acknowledgement, execution or release fact.

Limits remain **64 ordinary receipts, 40 protected receipts and two recipient
completions**. Constructed coordinators share the separate 256-lane checker
allocation limit; simulated and production coordinators share a 4,096-allocation
limit per module instance. The combined coordinator upper bound is 4,352. Overflow preserves adverse effects and prevents
new favorable proof admission. Each attempt has one capture, reviewer invocation
and emission allowance, with no resend or retry. Dropping local checker references
supplies no whole-job settlement or complete-release evidence.

## Changed files

All worker paths below are relative to `v2/worker/`:

- `src/alpaca-byte-review-contract.ts` and `.test.ts`: structures, canonical
  comparison, bounds and necessary tuple predicates.
- `src/alpaca-byte-review-checker.ts` and `.test.ts`: independent checks and fixed
  private invocation/completion linkage.
- `src/alpaca-byte-review-coordinator.ts` and `.test.ts`: finite lifecycle,
  evidence applicability, emission and acknowledgement.
- `src/alpaca-byte-review-coordinator.regression.test.ts`: five independent
  regressions reproducing the initial coordinator findings.
- `src/alpaca-byte-review-release.regression.test.ts`: nine independent release
  outcome/generation/acknowledgement/capacity regression cases.
- `src/alpaca-byte-review-state-matrix.test.ts`: eight bounded simulated matrices,
  exercising 992 fresh model instances.
- `src/alpaca-byte-review-fixtures.test.ts` and
  `test-fixtures/alpaca-byte-review.ts`: explicitly constructed connector fixtures.
- `v2/IMPORT-MANIFEST.json` (repository-relative): inventory entries and exact hashes
  for all eleven added V2 source/test/fixture files.
- `docs/specs/Alpaca-Byte-Review-Kernel.md` (repository-relative): this report.

## Verification and review evidence

On Linux with Node 22, ten focused suites pass **319 tests**: 228 new kernel tests
and 91 adjacent synthetic Alpaca regressions. Worker TypeScript compilation,
Go 1.26.1 race tests, vet and build, and `git diff --check` pass. The current
full V2 server/worker/Next production build also passes. The first five independent
coordinator regressions failed before their correction and passed unchanged
thereafter. The nine release regressions recorded eight failures and one pass
before correction, then nine passes unchanged afterward. The finite matrix is
bounded test coverage, rather than exhaustive proof or runtime qualification.

Fresh independent and distinct adversarial static source/privacy reviews both
approved the complete eleven-file source patch
`3b37c7adc641c8fcba83912514a9ac5a31053bee9a0dd1aa13cf4983645d5dec`,
with no actionable finding or unresolved blocker/high finding. Both read all 116
bounded inputs, including the complete source patch and original invariants.
Their original report SHA-256 values are respectively
`4a8eaf18e4f74652a253ee8a4f1eca7ff905b0a8d77d87bbf2dcaf3a4bb7d06c`
and `ab0418e7a4a846552dfb96837bb17341fcdaf79c38eb0e986ec9c9cb32a5d77e`.
These were static reviews; executed checks are separate verification evidence.

The complete source and this report require final fresh independent/adversarial
review and repeated verification before delivery. Normal Go/V2, scientific and
applicable protected-browser CI gates remain required on the exact PR head.
The PR records final reviewed head/base and actual CI results. Production
admission, actual handling and market acquisition remain **DEFER**.

The first exact-head remote CI attempt passed Go and scientific verification,
and all 1,336 active worker tests plus 46 script tests passed. Import completeness
then rejected the eleven unlisted kernel files. The inventory amendment records
those existing files and hashes without changing verifier rules, upstream pins,
source behavior, dependencies or operational authority. Browser/build/smoke
steps in that failed job were not reached; they remain delivery gates.
