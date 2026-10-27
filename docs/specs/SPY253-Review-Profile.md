---
type: Specification and completion report
title: SPY253 original-byte inspection profile
status: Source candidate; independent reviews and exact-head delivery gates pending
date: 2026-10-26
---

# SPY253 original-byte inspection profile

This increment lets the original-process adapter inspect a supplied, connector-issued
SPY253 object whose prices and page partitions are not the fixed BRCFIX fixture.
It authenticates a private, single-use checker completion and reports established
structural contradictions or missing evidence. An authenticated incomplete verdict
is a successful inspection exchange, not an eligible input or permission to operate.
Production remains closed. No acquisition, provider invocation, qualification,
simulation, paper/live trading, credential, security or retention change is included.

## Interfaces and ownership

`alpaca-spy253-review-profile.ts` exports the fixed profile/revisions,
`parseSpy253ReviewBinding`, `encodeSpy253ReviewBinding`, `inspectSpy253Review`
and `createSpy253ByteReviewLane`. The separate private envelope is
`gelt.spy253-review-binding.v1`; the legacy strict binding domain and public
verdict/status/ack formats are unchanged. Canonical comparison encoding reuses
the existing bounded formatter with a separate digest domain.

The binding contains attempt, source/revisions, exact request, receipt, ordered
page lengths/digests and evidence. Completion, close compatibility and adjusted
pagination have only `unknown` or `contradicted` states. Calendar, availability,
context and provider revision declarations can be absent. Candidate is `null`;
an operational candidate producer is not supplied by this increment. Caller
declarations, even matching hashes or revision labels, do not establish truth.

`createSpy253OriginalProcessReviewAdapter()` accepts no options, callbacks, enable
switches or caller verdicts. It exposes the bounded existing reserve/complete/
accept/emission/recipient-ack lifecycle with `SPY253_INSPECTION_ONLY` snapshot
scope. The private lane uses `source_inspection_only`. The legacy zero-argument
constructed facade retains its original literal scope and return types; a private
shared implementation does not widen that public API.

Original issuance is checked before ordinary payload access. Reservation binds the
original object, ordered original pages and evidence identity. The shared weak
reservation registry prevents reuse across profiles. A private ticket must come
from that lane, invocation and binding; forged, cloned, foreign, reused and mutated
completions cannot authenticate. Descriptor/seal checks do not isolate hostile
same-process code or prove arbitrary Proxy safety.

## Frozen policy and evidence treatment

The declared policy is SPY/IEX/USD, adjustment `all`, `1Day`, descending,
start `2025-10-24T04:00:00.000Z`, end `2026-10-27T04:00:00.000Z`,
asof `2026-10-27`. It retains the separately proposed 253-session schedule and
checkpoint `2026-10-28T13:00:00.000Z`, maximum declared age 61,200,000 ms.
The schedule digest is
`05974c8aa8ffbf448b746ee04ae1d24c83505b8b9bcf476b691577a8abba512d`.
This does not roll the earlier window forward or establish eligibility of an
actual dataset. A scheduled close or a declared completedAt is not observed
provider completion. IEX daily aggregation is not a consolidated auction price.

| Checks | Treatment |
| --- | --- |
| C01–C06 | Inspect issuance, exact bytes, request/cursors, lossless rows/count and receipt consistency; established defects fail. |
| C07 | Unadmitted closure/revisions remain unknown; incompatible fixed revision tuple fails. |
| C08 | Validate supplied reference calendar consistency and scheduled dates; absent or internally consistent declarations remain unknown without close compatibility evidence. |
| C09 | Completion/pagination/revision uncertainty remains unknown; explicit contrary declarations and established internal contradictions fail. Matching per-page labels do not prove atomic vintage. |
| C10 | Frozen checkpoint and supplied context-policy contradictions fail; unavailable factual policy dependencies remain unknown. An absent context cannot conceal the wrong checkpoint. |
| C11/C12 | Candidate and effect-authority dependencies remain unknown; malformed or contrary supplied binding fields can fail their corresponding checks. |
| C13/C14 | Reviewer admission and handling remain unknown. No runtime profile is invented. |
| C15 | Qualified clock/order evidence remains unknown. Local observed time is only a fail-closed deadline/backwards-clock boundary. |
| C16 | Established seal/construction/identity failure fails; semantic defects are not automatically relabeled mutation. |

All 16 existing names and closed failure/unknown reason vocabularies remain intact.
This profile cannot produce an operational all-pass admission. No permanent vendor
immutability guarantee is imposed as a universal requirement; locally bound pages
still do not establish provider-atomic pagination or a coherent adjustment vintage.
The implementation follows the accepted v1.3 lifecycle and v4 documentary decision;
selected documentation evidence is not independent account/legal qualification.

## Limits, emission and failure behavior

Existing collection limits remain three pages, 100 rows/page, 512 KiB/page and
253 required observations. Short pages can exhaust the bound; there is no fourth
request or retry. The private binding uses the existing bounded structural and
canonical domains and a 262,144-byte encoded ceiling. SPY253 and BRCFIX share the
existing 256 process-local source-inspection lane allocation budget; adding this
profile does not create another 256 slots.

Observed local time must not move backwards and completion must precede the
60,000 ms deadline measured from receipt. This is not a qualified clock guarantee.
Unknown, cancellation, provenance failure and duplicate completion are latched.
Each closed adverse kind is retained once, independently of the selected reason.
Retained seals and observed time continue to be checked after invalidation; the
adapter imports every observed kind and uses existing outcome precedence. A final
boundary check and fact import precede the local-reference-drop receipt. That
drop does not erase prior facts or create release/settlement evidence.
The sole emission is immutable E; subsequent receipts are additive R and current
state is C. Known queued adverse events are folded before commit. Own valid ack
evidence is retained unless its own evidence is contradicted. No retry or second
emission follows a failure. Dropping local references is not complete disposal;
process completion is not whole-job settlement. Execution remains unknown and
disposal not established. Summary/status outputs exclude raw bodies, cursors,
credentials, evidence sidecars and exception text.

## Changed files

- New profile and its authored synthetic tests.
- New independent regression tests for variable partitions/38-digit decimals,
  checkpoint, calendar tamper, byte identity, issuance-before-getter, unadmitted
  revision declarations, late mutation/ack, backwards clock, authority and budget.
- Checker: bounded private inspection helpers and shared original/allocation state.
- Adapter: inspection facade and private shared lifecycle; legacy facade preserved.
- Import inventory: exact local source hashes/new paths; upstream/license/lock unchanged.
- This source specification. Connector, normalizer, capture path, coordinator,
  public contract, candidate mode, dependencies and CI definitions are unchanged.

## Verification and review boundary

Preparation used distinct source-author and independent fixture contexts. The
45-case fixture catalog is a proposed acceptance oracle, not 45 executed tests.
The implemented checks comprise 21 authored profile tests and 24 independent
regressions, alongside 346 prior focused tests. Existing lifecycle/contract tests
cover shared ticket, receipt, capacity and state-transition invariants; this does
not claim every catalog permutation was executed or actual provider behavior seen.

The initial independent regression exposed a wrong-checkpoint contradiction hidden
by absent context; the source now rejects it. A separate compile-only probe exposed
three legacy facade type widenings; the zero-argument legacy facade now retains
its original scope/snapshot/acceptance types. Earlier malformed proposal hunk counts
were mechanically reconstructed against the frozen base before application;
those failed apply checks did not alter source. No test was deleted or weakened.

Pre-review verification completed 2026-10-26T23:16:29Z, all nine checks exit 0:
377 focused tests across 13 suites, worker TypeScript, legacy API compile-only
compatibility, Go race tests, Go vet/build, full V2 build, import verification
(82 upstream/512 candidate paths) and diff whitespace. These are working-candidate
results, not exact-final-head hosted CI or runtime qualification.

The first fresh complete review pair requested changes: an adversarial HIGH
overlapped an independent MEDIUM on first-failure suppression of later adverse
evidence; a second independent MEDIUM covered losing the final boundary before
reference drop. Root accepted both defects and grouped their correction. Ten new
regressions failed against that candidate and pass after correction: cancellation
then mutation/deadline/clock uncertainty plus mutation, and mutation/deadline then
reference drop, both before emission and after emission/own acknowledgement.
They verify immutable E, additive R, retained own acknowledgement and precedence.
The original review findings and failed tests are preserved; no reviewer executed
tests or certified an operating runtime.

Post-remediation working-candidate verification passed all nine checks, including
387 focused tests across 13 suites, legacy API compatibility and the unchanged
82-upstream/512-candidate inventory. The next complete review pair confirmed the
earlier fixes but found two MEDIUM classification defects: deliberate deadline
rejection could also invent a higher-priority acceptance failure, and unreserved
forged acceptance could invent provenance mismatch without a retained original.
Both were accepted and corrected together. Reservation preserves an already known
boundary reason through its sanitized error; production and acceptance return
their established boundary failure directly. Provenance comparison runs only
where a retained payload exists, while the acceptance attempt remains consumed.

Four additional regressions cover all three deadline boundaries and unreserved
forgery. The first three failed against the reviewed source; the related
reservation case separately failed before correction. They also preserve timeout
classification through emission/own ack and subsequent cancellation/mutation.
The adversarial review's initial five-read capacity stop is preserved; the same
recorded context subsequently completed all remaining original parts without
replaying reads. Neither review was replaced or treated as clean while incomplete.
The resulting working candidate passed all nine checks, including 391 focused
tests across 13 suites and the unchanged import inventory.
A fresh complete pair must assess the resulting source and this closeout;
closure is not inferred from passing tests.
Exact final-head post-review checks,
Linux CI/scientific/applicable protected-browser gates, ordinary PR/merge and
remote verification remain required. Source review is bounded static review;
actual exposure/copies/cancellation/settlement, account rights and provider input
facts remain unqualified. C07/C13/C14 unknown, production closed, operations defer.
