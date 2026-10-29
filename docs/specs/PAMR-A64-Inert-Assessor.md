---
type: specification
title: "Pure PAMR A64 inspection-evidence assessor"
status: source-completion-report
implementation_status: inert-source-conformance-only
timestamp: 2026-10-29T00:00:00Z
---

# Pure A64 inspection-evidence assessor

This source revision implements the bounded data-only increment proposed in
[PR32's consumer contract](PAMR-A64-Consumer-Contract-Proposal.md). It connects a
complete existing inspection artifact to an explicit proposed case context and
returns a data assessment. It does not connect that artifact to the constructed
consumer, a durable store or an active lifecycle. The
[engineering case](PAMR-A64-Proposed-Case-Registration.md) remains unadmitted.

**Case and qualification NOT_READY; production CLOSED; operations DEFER;
C07/C13/C14 UNKNOWN.** Source conformance does not establish actual inputs,
suppliers, rights, private completion, current original validity, handling,
runtime qualification, economic policy or permission to observe or trade.

## Entry points and bounded input

`assessA64InspectionEvidence(aggregateText)` accepts only primitive text. Its
strict versioned envelope contains `artifactText` and `contextText`; no callback,
verifier, source selector, file path, owner, clock or completion handle is accepted.
The aggregate text, including embedded strings and JSON escaping, is limited to
262,144 UTF-8 bytes. Artifact text is at most 180,000 bytes; context and serialized
assessment are each at most 8,192 bytes. Whitespace counts toward these limits.
No separate input allowance or storage allowance is allocated.

Character checks, surrogate validation and UTF-8 byte checks precede Buffer
allocation. The unchanged strict JSON parser rejects duplicate keys, including
escaped names, and enforces depth 16/node 20,000 limits for each parsed text.
Strict schemas reject unknown fields and malformed identities or timestamps.
Excess or invalid data returns a small frozen rejection with a bounded reason;
raw input, exception detail, private paths and credentials are not returned.
Conservative rejection is valid; the code does not promise every original fits.
Exported raw schemas establish structure only; the bounded text entry points
and whole-input assessor are required for the stated resource/binding behavior.

The new context fixes the proposed case/revision to
`GELT-PAMR-A64-EVIDENCE-001` / `proposal-2`. Its separate proposed epoch identifier
and source profile bind the exact historical inspection schema, source request,
recipe and finite adaptation. Facts that lack actual evidence have mandatory
`unknown` values, including issuance, private completion, current original,
supplier, rights, clock, causal availability, handling, admission, own
acknowledgement and release/settlement. Missing or favorable substitutions reject.

## Whole-artifact and context verification

The assessor calls existing `verifySpy253PAMRInspectionData`, which replays the
complete mathematical request and compares the whole artifact. Caller summaries,
rebound final-weight/pair hashes, missing or duplicate pairs, a forged pass vector
or an injected nested legacy artifact cannot substitute for this verification.
Existing math, strict parser, original inspector and fixed request dates are
unchanged. No connector, private inspector/lane or acquisition function is called.

New domain-separated hashes bind the case/epoch, complete source profile,
history/selected observations and pairs, source and inspection requests, calendar
reference, declarations, original lineage data, recipe/adaptation and entire
artifact. Relevant values are recomputed and compared with the supplied context.
Calendar/original hashes remain references to unavailable preimages; matching
data cannot authenticate an original, reconstruct its raw pages or recover
current private validity. Recomputed hashes bind data, not effect rights.

Input identity binds the parsed envelope and its embedded text. Context, timing
and artifact bindings separately capture their specified canonical values.
Lexical changes can change the input identity without creating any consumed
attempt. A changed epoch with a correctly rebound context is another pure data
assessment, not a new owner, permission or way to clear spent/uncertain state.

## History, timing and unchanged unknowns

Every favorable **data** assessment still reports `historyUpdates:64`,
`operationalDecisions:0`, `consumptionAttempts:0`, `persistence:not_performed`,
`effectAuthority:none`, dispatch/promotion false and NOT_READY/CLOSED/DEFER.
The original 253→65→64 selection, source ordinals 189–253, exclusion of 188,
equal initialization and exact-ratio rejection remain explicit. This is neither
full 252-relative fidelity nor 64 trades, observations or consumed decisions.
No sequence 1 or 64, predecessor record, store reset or ordinal allocator is added.
Legacy constructed request/artifact/prefix routes continue rejecting inspection.

The fixed historical start/end/as-of/source-decision pins remain unchanged.
Context receipt, source decision, source review completion and source declared
availability must equal the complete artifact's corresponding data. Proposed
assessment/decision/evaluation and asserted availability are named separately.
No wall clock is read and no freshness duration or future profile is selected.

Declared ordering requires receipt no later than source decision or source review
completion; source decision and review completion no later than proposed
assessment; assessment no later than proposed decision, which is no later than
evaluation. Optional source availability lies between receipt and source decision.
Optional asserted complete-input availability cannot precede receipt, source
decision or review completion, cannot exceed assessment, and must be strictly
before proposed decision. Equality at the last boundary rejects. These are
consistency checks on declarations, not evidence of actual causal availability.

Absent availability remains `unknown`; a supplied valid assertion becomes only
`declared_only_not_authenticated`. A later proposed assessment of historical data
remains prospective NOT_READY. Actual calendar completion, provider completion
and revision coherence, independent reviewer/handling admission and current
private validity stay unestablished. No immutable-provider-vintage guarantee is
invented. All sixteen inherited checks are copied with an explicit
`serialized_structure_not_current_private_validation` interpretation. No favorable
result, digest or immutable output replaces R/current-C/immutable-E, actual
private completion, own acknowledgement or uncertainty/ownership fences.

## Output and detached readback

The result is a deeply frozen, bounded `assessed_data` object or sanitized
`rejected` result. The assessment contains domain-separated bindings, fixed
history/disclosures/holds, the complete inherited check vector and every
unresolved reason. It omits full artifact/context text, selected raw observations,
steps, proposed epoch identifier and source attempt/invocation identifiers.
There is no order/proposal ID, allocation recommendation, owner capability,
private acceptance, persisted record, release fact or broker fact.

`parseA64InspectionEvidenceAssessment` checks detached text structure, bounds
and its own assessment data hash only. It is not whole-input verification or
authentication. `matchesA64InspectionEvidenceAssessment` re-runs the full assessor
against the supplied aggregate input and compares the entire expected assessment.
A rehashed detached input or readiness field cannot replace that recomputation.

## Changed files and source verification

- `pamr-a64-inspection-evidence-contract.ts`: strict domains, context/history/
  timing/binding/output schemas, fixed unknowns/holds and bounded text parsers.
- `pamr-a64-inspection-evidence.ts`: complete existing inspection verification,
  context recomputation, frozen data-only assessment and whole-input matching.
- Their two `.test.ts` files: pure synthetic replay fixtures, no actual original
  acquisition, calendar/rights evidence, private inspection or provider call.
- `v2/IMPORT-MANIFEST.json`: four exact added source/test entries; existing source,
  upstream and dependency pins are preserved. This specification is the only
  documentation change; no existing roadmap/history is rewritten.

The initial proposal passed worker type checking and 124 focused/regression
tests. Owner negative controls then reproduced three failures covering review
completion before receipt, asserted complete-input availability before review,
and a non-string limit-kind coercion. The new contract's declared timing and
primitive-kind guards were corrected; the expanded focused set passed 127 tests.
Valid boundary declarations still retain UNKNOWN and zero effects. These are
source-level regressions, not new actual clock or handling guarantees.

Additional synthetic coverage checks complete pair sets, source/context/recipe/
trace mutations, forged favorable checks, honest exact-ratio rejection,
historical-versus-proposed timestamps, duplicate keys, character/UTF-8/depth/node
and embedded/aggregate/output limits, pure deterministic repetition, detached
readback, legacy rejection and sanitized output. Tests use constructed declared
hashes and check vectors; these do not establish a real original or admission.

The working candidate also passed the complete local suite: 1,761 worker/web
tests, 18 server tests and 46 script tests; 28 legacy Windows cases remain
unsupported skips. Worker types, Go race/vet/build, full V2 build, offline smoke,
import inventory and whitespace checks passed. Occupied-port and child-exit
diagnostics are asserted negative controls, not successful service starts or
operating evidence. These supplied owner results precede the final reviewed head.

Delivery requires fresh independent and distinct
adversarial accuracy/privacy reviews of the complete final source/specification/
inventory diff, exact-head verification and ordinary hosted CI/merge/remote and
post-merge proof. No test, static privacy
review or repository merge establishes qualification, trading readiness or case
acceptance. The approved future publication workflow grants no formal GitHub
Approve action without its separately required specific confirmation.

## Remaining scope boundary

The separate prospective-window/revision decision is not implemented here.
Actual input entitlement/availability, source/reference/dependency limitations,
operating suppliers, finite handling/exposure/lifetime, economic/terminal policy,
runtime qualification and a compatible durable/active consumer remain unresolved.
No new engine, store, migration, dependency, endpoint, provider/API invocation,
acquisition, G06 activation, campaign, shadow/paper/live trade, credential or
security/access change is supplied. No uncertain effect is replayed. Full
remaining integration, qualification, observation effort and real-input coverage
remain UNKNOWN; one pure assessment is not the end-to-end engineering case.
