---
type: proposed-consumer-contract
title: "PAMR A64 inspection evidence consumer — contract decision"
status: proposed-unaccepted-not-ready
implementation_status: not-implemented
source_snapshot: da66b090f3ee250e7c7781f62ebc51326697c79a
---

# Proposed A64 evidence consumer, revision 1

This is the consumer-contract planning successor to the
[proposed engineering case](PAMR-A64-Proposed-Case-Registration.md), whose
selected objective is engineering evidence-chain integrity. It resolves a
**proposed source design**, not case admission, operating policy or actual
supplier identity. No implementation, input inspection, acquisition, inference
campaign, qualification or execution is performed by this document.

**Case NOT_READY; qualification NOT_READY; production CLOSED; operations DEFER;
C07/C13/C14 UNKNOWN.** All sixteen checks, original-object/private-completion
rules, R/current-C/immutable-E separation, own acknowledgement and uncertainty
fences remain unchanged. The [prospective protocol](Prospective-Shadow-Promotion-Protocol.md)
R0–R5 requirements cannot be satisfied by filling a proposed contract.

## Decision and useful next increment

Recommend a **separate inert inspection-evidence assessor**, before any lifecycle
connection. Its first bounded source increment would validate one complete
existing PR29 artifact and a separately identified proposed epoch context, then
emit a bounded data assessment preserving every unknown. It would not emit a
PR28 decision, order preview, consumed attempt or persisted manifest. It would
accept neither a claimed authority token nor a caller-supplied favorable verdict.
Existing constructed consumers continue rejecting inspection identity.

This advances the selected case by making the identity/history/time boundary
testable without pretending the missing runtime, custody or market policy exists.
It does **not** complete the case's durable consumer or simulated outcome chain.
The later active/durable bridge remains a separately scoped dependency.

| Alternative | Consequence | Proposed disposition |
| --- | --- | --- |
| Rename inspection data to legacy constructed input | Loses origin/classification and treats historical update count as consumed decision sequence. | Reject. No label substitution, nested legacy artifact or validation relaxation. |
| Immediately connect market inspection to PR28 lifecycle | Requires accepted economic/allocation/observation policy, private admission, a new sequence meaning and qualified actual suppliers. Those prerequisites are missing. | Defer. Do not reuse constructed activation as admission. |
| Separate inert evidence assessor | Can verify data identity and record proposed context incompatibilities, while preserving unknown authenticity and zero effects. | Recommended bounded source proposal; **not yet approved for implementation**. |

## Existing evidence and known incompatibilities

Source is pinned by [PR31 merge](https://github.com/Zkrausman/Gelt/commit/da66b090f3ee250e7c7781f62ebc51326697c79a);
the code below is unchanged from accepted PR29. These links identify source,
not a deployed closure, actual original or runtime result.

| Evidence | What it establishes | What it does not establish |
| --- | --- | --- |
| [PR29 inspector](https://github.com/Zkrausman/Gelt/blob/da66b090f3ee250e7c7781f62ebc51326697c79a/v2/worker/src/spy253-pamr-inspection.ts) and [artifact replay](https://github.com/Zkrausman/Gelt/blob/da66b090f3ee250e7c7781f62ebc51326697c79a/v2/worker/src/pamr-reference-artifact.ts) | The private inspector owns its lane/reservation/completion. Pure replay verifies a distinct `gelt.spy253-pamr-inert-inspection.v1`, `source_inspection_only` data object. It carries 64 updates, zero operational decisions and zero consumption attempts. | Serialized data does not restore issuance/private lineage, current validity or effect rights. The whole original cannot be reconstructed from digests. |
| [PR28 pure consumer](https://github.com/Zkrausman/Gelt/blob/da66b090f3ee250e7c7781f62ebc51326697c79a/v2/worker/src/pamr-consumer-adapter.ts) | Only the legacy constructed schema, `SYNTH-RISK`/`SYNTH-RESERVE`, literal reserve relative `1` and fixed synthetic mapping are supported. Prefix ordinal is mathematical row count; previous prefix is replayed from one fewer row. | It cannot consume the PR29 artifact, establish a market allocation policy or equate update 64 with a first operational attempt. |
| [PR28 durable evidence](https://github.com/Zkrausman/Gelt/blob/da66b090f3ee250e7c7781f62ebc51326697c79a/v2/worker/src/synthetic-sizing-binding-evidence.ts) | Consumption starts at ordinal 1, advances contiguously and binds actual prior manifest/prefix. Time checks apply even to abstention. Reopen is read-only. | No 63 earlier consumptions may be invented, skipped, imported from a mathematical trace or cleared by a fresh store. |
| [Inspection schema](https://github.com/Zkrausman/Gelt/blob/da66b090f3ee250e7c7781f62ebc51326697c79a/v2/worker/src/paper-conversion-contract.ts) | Fixed historical request, decision and finite 253→65→64 mathematical adaptation, including exact representability rejection. | Caller metadata cannot roll its dates forward, turn declared availability into observed causal availability or certify completion/revision coherence. |

These are intentional source boundaries, not newly reproduced defects. No
source or reference execution is proposed as evidence for this planning decision.

## Proposed typed data contract, not an implemented API

The following names are **proposed documentation vocabulary**. They are not
accepted schemas, endpoints, authenticators or permission-bearing handles.
Strict text parsing, duplicate-key/depth/node rejection and whole-value
recomputation would be required in a future implementation.

| Proposed type | Required meaning and fields | Fail-closed boundary |
| --- | --- | --- |
| `A64InspectionEvidenceContextV1` | New domain `gelt.pamr-a64-inspection-evidence-context.v1`; case/revision, proposed epoch ID, complete source-profile identity, exact request/window/calendar/declaration digests, expected canonical inspection artifact digest, original lineage digest, selected-pair digest, recipe/adaptation digest and explicit evidence-only purpose. | Domain-separated from all constructed input/decision/consumption IDs. Hash agreement binds supplied data only. Unknown actual IDs are not generated by this document. No callback, file path, module selector, quantity, authority or verifier injection. |
| `A64HistoryBindingV1` | Exactly 253 original closes, newest 65 reversed into chronology, 64 ordered adjacent pairs, source ordinals 189–253, 188 excluded observations, equal initialization at selected-history start. Bind the entire artifact, not a caller's final weight or summary. | Preserve 32-character ordinary-positive-decimal ratios, exact arithmetic, no rounding/skipping/imputation, no capacity extension or full-252-history claim. Recompute pairs and complete artifact through existing inspection verification. |
| `A64ProspectiveTimingProposalV1` | Proposed epoch purpose, exact source-profile revision, source decision time copied from verified artifact, separately named proposed assessment/decision/evaluation times and required factual-evidence slots. Missing fields have explicit `unknown` state, not fabricated timestamps. | An asserted time or matching clock digest never supplies causal availability. No future dates are selected here. Existing artifact remains historical; changing outer context cannot revise it. |
| `A64InspectionEvidenceAssessmentV1` | New data-only assessment domain; context/artifact/history binding, all unresolved reasons and inherited disclosures, `historyUpdates:64`, `operationalDecisions:0`, `consumptionAttempts:0`, `persistence:not_performed`, `effectAuthority:none`, dispatch/promotion false. Distinguish structurally consistent data from rejected input and prospective readiness gaps. | Data consistency is not case admission. An existing well-formed historical artifact can be assessed as data while its proposed prospective use stays NOT_READY. Never emit a favorable operating status, restored capability, order/proposal ID or manufactured broker/settlement fact. |

There is no new allocation rule in this increment. The PR28 quarter-scale mapping,
fees, synthetic price observations and portfolio snapshots are **not** imported
as real-input policy. The assessor does not call the private inspector, acquire
an original, create a lifecycle owner or accept a completion object.

## Historical updates versus actual consumption

Use three separate quantities in future design and review:

1. **Historical mathematical update:** pair ordinal 1–64 inside the verified
   post-window artifact; this describes model initialization/history only.
2. **Evidence assessment:** recomputable pure data assessment, with no spent or
   durable sequence. Repeating an assessment cannot be called a new consumed
   attempt or be used to bypass a future owner admission.
3. **Actual owner-consumed decision:** a future compatible, versioned owner must
   issue and durably consume its own sequence, independent of history count.
   For the proposed first finite epoch, recommend one post-window decision at
   sequence 1 with no predecessor, only if that future operation is separately
   accepted. The full history binding still says 64 updates. This is **not** the
   legacy PR28 `ordinal` field or a current permission to consume.

Recommend no rolling history/reset or second decision in that first proposed
epoch. A later design must define the next epoch's continuity and outstanding
exposure; a new epoch ID cannot clear old ownership, uncertainty or spent facts.
Single-use reservation, consume-before-effect, no-action/abstention accounting,
immutable evidence, full-chain replay and read-only reopen remain requirements
for a later bridge. Actual decision cadence, terminal condition, cancellation,
settlement and position management are unresolved operating decisions. A single
decision proposal does not justify an exit, a fixed duration or economic adequacy.

The proposed pure assessor has **no persistence or sequence allocator**. Adding
an evidence family to the existing owned store would need a separate reviewed
delta with its own domain and actual owner-issued sequence, preserving at most
64 records/8 MiB aggregate limits rather than allocating a second allowance.
Compatibility of that extension is not established here; no new store, recovery
engine, migration, restart replay or stronger recovery guarantee is authorized.

## Prospective timing and revision decision

Keep PR29's frozen start `2025-10-24T04:00:00.000Z`, end
`2026-10-27T04:00:00.000Z`, as-of `2026-10-27` and source decision
`2026-10-28T13:00:00.000Z` intact. No actual artifact is supplied here. A
hypothetical object matching those pins remains historical even if assessed
later. It cannot be relabeled an untouched prospective decision or prove
availability at any earlier time.

For any later **operationally admissible** decision, require qualified evidence
for the complete input's availability before decision, decision no later than
evaluation, compatible observation availability and policy freshness, and
continued applicable original/clock checks. Strict availability-before-decision
is consistent with existing PR28 validation; this document supplies no new
freshness threshold or economic policy. Provider timestamps, receipt times,
caller declarations and source completion are distinct quantities.

If any required causal timing, calendar, completion/revision, handling or actual
admission evidence is unknown, retain NOT_READY. Keep every original and actual
current-state receipt; a fixed immutable output cannot establish current validity.
Local collection is not a provider-atomic vintage or permanent finality guarantee.
The future policy must identify its revision/completion treatment and evidence
basis; it need not require universal immutable vendor history. A revised input
must have a distinct binding and explicit disposition. Never overwrite an old
artifact, silently recapture, relabel a rejection or replay an uncertain effect.

A future date/window change needs a separately versioned source/profile delta
and its calendar/availability/decision basis. The pure assessor proposal cannot
accept an arbitrary profile registry or bypass the fixed inspector by trusting
context metadata. Such a delta and actual policy/admission are **excluded** from
the first implementation proposal below.

## Known components, unknown suppliers and minimum decisions

| Responsibility | Known binding | Minimum evidence or decision still needed |
| --- | --- | --- |
| Technical preparation | Gelt source owner owns the proposal, exact source packet and future code delivery. | No new owner question merely to prepare this contract. A bounded implementation needs specific approval after this proposal's review. |
| Original producer/custodian | Existing `acquireAlpacaIexDailyBars` and private inspection lane are source components only. | Actual permitted producer/operator, capture identity, rights/exposure/copy/lifetime, clock and closure evidence remain unadmitted. Source owner prepares the smallest supported evidence request after actual interfaces are identified; do not assign these facts to the provider by assumption. |
| Evidence consumer | Proposed pure assessor above; PR28 remains constructed-only. | Proposed design recommendation is evidence-only. Actual consumer/acceptor and deployment do not exist in this record. Digests or a public source merge cannot appoint them. |
| Future operation/research/risk acceptor | Engineering integrity objective is selected; no economic-performance claim. | Actual finite operation, permitted recipients, time/event/byte/copy budget, economics/observations and terminal/exit/cancellation policy still require applicable evidence and accountable acceptor. No fixture defaults, return cutoff or blanket paperwork request. |
| Runtime/handling reviewer | Linux hardware target is known from prior planning. | Supported deployed closure, actual handling/trust profile, independent reviewer admission, release/settlement and own-ack evidence remain UNKNOWN. Linux selection and static privacy review do not qualify runtime. |

All protocol R0–R5 prerequisites and sixteen-check unknowns remain operative.
The case cannot qualify its own prerequisites. No finite operation, supplier,
consumer, threshold or handling policy is accepted here.

## Exact next implementation proposal and synthetic acceptance

**Proposed, needs new implementation authority:** one pure evidence assessor and
strict context/assessment contracts around existing inspection data verification.
Expected new paths are `v2/worker/src/pamr-a64-inspection-evidence-contract.ts`,
`pamr-a64-inspection-evidence.ts` and their two `.test.ts` files, plus the
applicable specification and import inventory. These are expected paths, not
files created by this planning change. Reuse existing parser, canonical digest
and `verifySpy253PAMRInspectionData` helpers. No change to accepted math,
original inspector, legacy constructed consumer, durable evidence/store,
lifecycle, transport, API, policy selector or current request dates is included.
If exact reuse needs a broader source seam, stop with that mismatch for scope
disposition before implementing it.

The proposed aggregate input bound is 262,144 UTF-8 bytes including embedded
artifact/context; artifact remains at most 180,000 bytes, context and assessment
each at most 8,192 bytes, with existing strict parser depth 16/node 20,000 work
limits and bounded checks before allocation. These are conservative **proposed
source resource ceilings**, borrowed from the existing consumer family, not
established representability of every artifact or whole-job handling permission.
Reject excess without partial assessment, pagination, compression or a second
budget. The function has no retained mutable owner or effects; records/custody
outside its bounded input/output remain separately unqualified.

Synthetic acceptance would require:

- Complete PR29 artifact recomputation, identity and pair binding; any changed
  request, selected close/pair, recipe, final weight, context digest or nested
  legacy artifact rejects. Construction through a synthetic fixture cannot
  establish issuance, authenticity, current private validity or data rights.
- A valid historical data object can return a consistent **data** assessment
  with prospective NOT_READY and all inherited unknowns. Null availability,
  missing factual slots and completion/revision uncertainty never become pass.
  Forged favorable check vectors or classifications reject rather than launder
  inspection identity through the legacy schemas.
- Exactly 64 history updates with zero actual decisions/consumption/persistence;
  no prefix slicing into 64 pretend consumed events, no sequence 64 admission,
  fake 63 predecessors, store reset or replay. Existing constructed consumer
  rejection of inspection identity remains an explicit regression assertion.
- Historical/source/proposed timestamps remain distinct; equal/later asserted
  availability, invalid ordering, outer date roll, unsupported future profile,
  revision substitution and unknown freshness never support prospective use.
  Test complete expected-vs-observed bindings, not matching counts alone.
- Byte/character/depth/node boundaries, duplicate keys, unknown fields,
  nonterminating/oversized exact ratios and overlarge output reject honestly.
  Full-input validation must not short-circuit into a favorable partial result.
- Repeated pure evaluation has no effects or sequence claims; no acquire,
  reserve, private acceptance, write, owner creation, preview/confirm/dispatch,
  provider call, lifecycle mutation or capability restoration is reachable.
  All disclosures and NOT_READY/CLOSED/DEFER/C07/C13/C14 limits survive output.

These are **proposed tests, not executed results**. Future source delivery needs
fresh independent and distinct adversarial accuracy/privacy review of the entire
diff and relevant full invariants, required exact-head Linux tests/types/build/
inventory/Go/scientific/protected gates as applicable, ordinary draft PR/CI/merge
and remote/post-merge verification. Formal GitHub Approve still requires its own
specific action-time confirmation if required. Passing tests or source merge
would establish a bounded data-consumer capability only, not case operation.

## Remaining effort, next planning output and publication boundary

Full remaining source/review/integration, qualification and observation effort
is **UNKNOWN**. No measured decomposition supports a reliable new range; old
estimates overlap and cannot be added. The pure assessor omits the durable and
active bridge, future-window policy and actual supplier/qualification work, so
its delivery must not be reported as end-to-end case readiness or an EOY promise.

After this reviewed contract proposal, the independently useful next planning
output is one **versioned prospective-window/revision decision packet**: distinguish
current historical pins from a proposed future profile, name the actual required
calendar/availability/completion evidence and supplier gaps, and give exact
source-delta/acceptance alternatives without selecting unsupported dates or
calling a provider. Existing planning authority covers preparation; implementation,
input capture and qualification remain separately held. Do not create another
generic case, duplicate issue or inference campaign. The finite qualification
proposal remains held until actual custodian/interfaces and policy exist.

This document and one additive case link are the only proposed repository
changes. Prior case wording and selected objective remain intact outside that
link; no code, test, dependency, workflow or operating record is changed.
Focused scope/history/link/privacy/source-pin checks, required Go race/vet,
whitespace/status, fresh independent/adversarial review and normal docs
publication gates apply. No public review result is asserted before it exists.
