---
type: specification
title: "Finite SPY253-to-PAMR inert inspection adapter"
status: source-candidate
implementation_status: source-inspection-only
timestamp: 2026-10-28T00:00:00Z
---

# Finite SPY253-to-PAMR inspection

This separately approved Option A source slice connects the existing
[SPY253 inspector](SPY253-Review-Profile.md) to the
[selected PAMR mathematical implementation](Selected-PAMR-Conversion-Fidelity.md).
It produces one inert post-window mathematical artifact. It does not connect
that artifact to the [constructed PAMR consumer](PAMR-Synthetic-Consumer.md),
acquire data, qualify the runtime or run a shadow/trading campaign.

## Original inspection and finite selection

`createSpy253PAMRInspection()` owns one existing private SPY253 lane, original
reservation, producer ticket and acceptance. `inspect(original,binding)` makes
one attempt. It checks the entire connector-issued 253-close original before
local selection; cloned/reconstructed originals and caller verdicts cannot
replace that linkage. No injected verifier, source selector, clock, enable flag,
credential or provider call is exposed. The original lane allocation ceiling
and irreversible original reservation remain unchanged.

The required source vector is C01–C06 and C16 passing, with C07–C15 unknown and
an authenticated incomplete inspection verdict. Calendar declarations must
structurally map all 253 observations to the existing fixed schedule. Missing
mapping rejects; supplied declarations cannot establish actual calendar
compatibility, completion, availability, closure, candidate, reviewer admission
or handling. In particular C07/C13/C14 remain UNKNOWN. This is structural
selection, not admission of eligible market data.

The original collection is newest first. The adapter takes exactly indices
0–64, reverses them to chronological order, and computes 64 adjacent
`later close / earlier close` relatives. The selected session ordinals are
189–253; 188 observations are excluded from the mathematical history. Invalid
or missing intervals are not filtered away to select older substitutes.
Equal initial weights apply at the selected-history start. This is an explicit
short-history adaptation, not equivalence to the full 252-relative history.

The frozen request remains SPY/IEX/all/USD/1Day/descending, start
`2025-10-24T04:00:00.000Z`, end `2026-10-27T04:00:00.000Z`, as-of `2026-10-27`,
with decision `2026-10-28T13:00:00.000Z`. These historical pins are not rolled
forward. The artifact binds the complete observation digest, request, ordered
page identities, receipt, calendar/declaration identities, selected exact
closes/source indices and each adjacent pair. It carries no raw page bodies or
credentials. Digests bind supplied data; they cannot authenticate factual
declarations or reconstruct the complete original from hashes.

## Exact relative and mathematical profile

Both original decimal operands are validated before bounded integer arithmetic.
The reduced ratio must have only powers of 2 and 5 in its denominator and must
render exactly as an ordinary positive decimal of at most 32 characters.
Repeating values such as 1/3, oversized results, zero/invalid operands and
resource excess reject; no floating-point division or rounding is introduced.
For example 1/8 becomes `0.125` and 1.5/1 becomes `1.5`.

The second mathematical asset is explicitly `DECLARED-UNIT-RESERVE`, with relative
literal `1`. It is a mathematical convention, not evidence of cash returns.
The first label is `SPY-CLOSE-RELATIVE`; neither label is an executable instrument.
One post-window artifact contains 64 mathematical updates, zero operational
decisions and zero consumption attempts. It does not retrospectively establish
availability for decisions made during that history.

The internal exact PAMR trace is shared with the original constructed converter;
its equations, epsilon 0.5, zero-norm tau=0, simplex projection and 4096-bit
pre-operation arithmetic guards remain unchanged. Constructed public request,
artifact serialization and digest domains remain unchanged. Inspection uses
separate request/artifact identities and domain-separated bindings, with
`classification:source_inspection_only`. No nested legacy constructed artifact
is emitted for extraction and consumption.

Existing request limits remain 32,768 UTF-8 bytes, 64 rows, parser depth 16 and
20,000 nodes. The entire inspection artifact must fit 180,000 UTF-8 bytes and
the existing parser domain. Exact decimal expansion is bounded before its
limited multiplication steps. Conservative arithmetic and byte rejection are
part of the finite profile. No guarantee is made that every permitted original
or price ratio can produce an artifact. No consumer/evidence capacity rises:
the existing 64-record/8-MiB store is untouched and unused here.

## Private linkage versus data replay

The adapter checks the lane's retained seals, acceptance and actual local clock
around conversion, including after output freezing and serialization. Mutation,
deadline, cancellation, prior uncertainty or a second attempt invalidates its
retained result. `current()` rechecks that retained state; previously returned
immutable data cannot establish current favorable validity. Existing trusted
construction assumptions exclude hostile proxies/runtime interposition; this
is not process isolation or runtime qualification.

`replaySpy253PAMRInspectionRequest` and `verifySpy253PAMRInspectionData` establish
data self-consistency only. Deserializing matching digests cannot restore
connector issuance, private completion lineage, a reservation or effect rights.
The old constructed request parser, `verifyPAMRArtifact` and
`derivePAMRConsumerPrefix` reject the new identities. The PR28 lifecycle remains
constructed-only; no new endpoint, storage, producer activation, order preview,
dispatch, fill, cash/position effect or reopen mutation is added.

Every output retains actual eligibility/handling/authentication unestablished,
provider completion/revision coherence and causal availability unknown,
uncertainty latched, effect scope NONE, dispatch/promotion false, production
CLOSED and operations DEFER. Local ordered collection is not an atomic provider
vintage or immutable-close guarantee. The existing sixteen-check kernel,
private completion rules, R/current-C/immutable-E separation and own
acknowledgement requirements are not modified by this data artifact.

## Changed source and acceptance evidence

- `paper-conversion-contract.ts`: separate strict inspection request and finite
  selection/lineage vocabulary, preserving the old constructed schema.
- `pamr-reference-artifact.ts`: internal shared trace, exact close ratio,
  separate inert inspection replay and whole-object data verification.
- `spy253-pamr-inspection.ts`: fixed original/private-lane adapter.
- `spy253-pamr-inspection.test.ts`: synthetic originals, exact selection/math,
  unknowns, binding failures, rejection, replay and invalidation boundaries.
- `pamr-reference-artifact.test.ts`: independent legacy serialization/hash oracle.
- Import inventory and additive specification/roadmap links account for the slice.

The initial owner candidate passed worker type checking and 108 focused tests.
An original malformed diff was retained; only hunk counts were mechanically
recounted before short-context application. Owner type correction validates the
source request with the strict inspection schema rather than asserting its type.
The working source candidate also passed the complete local verification suite:
1,712 worker/web tests, 18 server tests and 46 script tests; 28 legacy Windows
cases remain unsupported skips. Worker types, Go race/vet/build, full V2 build,
offline smoke, import inventory and diff checks passed. Occupied-port and child
exit diagnostics are asserted negative controls, not successful service starts.
Fresh independent/distinct adversarial source/privacy review of the complete
final diff, followed by exact-head checks and ordinary hosted CI/merge/remote
verification, remain delivery gates for this candidate.
No test result establishes actual input rights, runtime/handling qualification,
provider completion, market coverage, profitable performance or trading readiness.

Actual acquisition, new request/window selection, capacity extension, operational
consumer connection, qualification, shadow/paper/live execution, general automatic
paper conversion and security/credential changes remain excluded. Full remaining
operating effort and real-input representability coverage remain unknown.
