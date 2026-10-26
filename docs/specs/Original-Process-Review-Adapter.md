---
type: Specification and Completion Report
title: Original-process review adapter — conditional source integration
description: Fixed original-object review adapter with private completion ownership and closed production admission.
timestamp: 2026-10-26T00:00:00Z
status: conditional-source-only
---

This increment connects a fixed original-acquisition consumer to the existing
byte-review kernel without enabling production. It implements the approved
source-only adapter and synthetic acceptance scope following PR22. The accepted
v1.3 document, consumer revision 1.1, sixteen checks, numeric rules and public
verdict/settlement/status/acknowledgement schemas remain unchanged.

## Implemented interfaces

`productionOriginalProcessReviewPreflight()` accepts no configuration and returns
existing `PRODUCTION_CLOSED`, `dispatchAllowed:false` preflight. It exposes no
capture or reviewer-dispatch method. Extra enable/profile/callback arguments
reject without calling acquisition or allocating a constructed checker.

`createConstructedOriginalProcessReviewAdapter()` is explicitly
`CONSTRUCTED_ONLY`. It supplies:

- `beginCapture()` to reserve one modeled external synthetic capture allowance;
- `reserve(original, binding, candidate)` for one opaque reservation owned by that
  adapter and the exact same-module connector-issued acquisition;
- `completeReview(reservation)` for one privately held fixed-checker production;
- `acceptCompletion(reservation, completion)` for the exact private completion;
- `emitSummary()`, `recipientComplete()` and `acknowledge(completion)` for one
  immutable sanitized emission and a separately linked recipient acknowledgement;
- snapshots, explicit fixture timing/cancellation controls, and local checker
  reference dropping, with no operational settlement or release claim.

The harness supplies synthetic acquisition through the existing connector. The
adapter itself performs no acquisition and does not supervise the external
harness. A modeled capture reservation is not execution or settlement evidence.
No caller-selected producer, registry, trust profile, authority, clock callback,
recipient or production-enable input is accepted.

## Original-object and completion ownership

Issuance is checked before supplied graphs are inspected or cloned. The unchanged
fixed kernel owns original-object reservation, graph seals, revision/binding
checks and completion authentication. Opaque adapter reservations additionally
bind the owning adapter. Matching IDs, copied handles, diagnostic vectors and
verdict-shaped JSON cannot substitute for the private producer completion.

Reservation and invocation consumption are irreversible, including a subsequent
fixed-lane reservation failure. Cancellation, a forged completion, replay or
uncertain ordering cannot reopen capture/review permission. Known uncertainty
before production prevents dispatch. Source errors expose only fixed sanitized
outcomes; original exception text is not retained in receipts or status.

The supported constructed profile remains the compiled two-row BRCFIX fixture.
A genuine connector-issued synthetic SPY253 object is still outside that fixed
profile and is refused. Applying BRCFIX revision labels does not make it
supported. No actual market profile or source-closure/reviewer/handling admission
is introduced. C07, C13 and C14 cannot become passing operational facts here.

## Finite reporting and lifecycle

The adapter maintains a deliberately narrower constructed evidence ledger:
twenty-three fixed internal receipt kinds, each recorded at most once, one
verdict and one recipient completion. There are no renewable positive execution
or release proofs. This bounded subset stays below the existing kernel receipt
and recipient maxima; it does not change public formats or kernel limits.

Receipts remain additive, the current settlement is projected separately, and the
sole emitted status and its source snapshot are immutable. A later adverse event
changes current treatment without rewriting that emission. Independently valid
acknowledgement survives an unrelated invalid acknowledgement or review failure.
Summary failure can coexist with such acknowledgement under the existing tuple
rules and precedence. No callback or asynchronous gap intervenes between the
complete-prefix projection and the fixed local emission handoff.

Local acceptance of an authentic incomplete/negative verdict is not favorable
settlement. The adapter has no positive whole-job execution-settlement or
complete-release producer and accepts no simulated positive evidence. Dropping
its checker references supplies neither complete alias accounting nor
zeroization. Timeout, abort, callback return or foreground completion supplies
no missing settlement evidence.

Every status retains abstain, unverified data/eligibility, no effect authority,
no promotion and no retry. No extra raw data, cursors, exception diagnostics,
invocation IDs or receipt history enter sanitized public status/acknowledgement
schemas. The private constructed snapshot is not a public payload-export API.

## Changed files

- `v2/worker/src/alpaca-original-process-review-adapter.ts`: fixed consumer,
  private reservation/completion ownership, bounded reporting and production guard.
- `v2/worker/src/alpaca-original-process-review-adapter.test.ts`: synthetic
  original-object, unsupported-profile, lifecycle, bounds and reporting cases.
- `v2/IMPORT-MANIFEST.json`: exact hashes for those two added files; prior entries,
  verifier, upstream/license and dependency-lock rules are preserved.
- `docs/specs/Original-Process-Review-Adapter.md`: this specification and closeout.

No kernel source, capture CLI, provider path, raw/all policy, frozen request dates,
dependency, service, security/access setting or Windows guard is changed.

## Verification and delivery boundary

The initial adapter proposal passed 25 focused synthetic tests. The source owner
then added two independent order/one-use cases from the separately prepared
acceptance catalog; all 27 adapter tests pass. Existing kernel conformance cases
are reused as regression evidence, not duplicated as qualification exercises.

The current pre-final source candidate passes 346 focused Node 22 tests across
11 suites, worker TypeScript compilation, Go 1.26.1 race tests/vet/build, the full
V2 server/worker/Next build, import inventory (509 candidate files) and diff check.
These are executed source-verification results, not operational qualification.

The exact final source requires complete independent and distinct adversarial
source/privacy reviews, final repeated focused/Go/V2 verification, and normal
exact-head Linux CI including scientific and applicable protected-browser gates.
PR metadata and retained owner receipts bind the actual reviewed head/base,
checks, merge and remote verification. Source tests never replace those reviews.

Production remains closed and operational adoption remains **DEFER**. This source
increment supplies no real capture, admitted G05/G06 input, simulator/paper/live
execution, credentials or runtime qualification. Linux target selection, static
source hashes and successful fixtures do not establish an operational trust or
handling profile. Those gates require separate supported evidence and authority.
