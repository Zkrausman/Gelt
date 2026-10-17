---
type: specification
title: G06 constructed selection to paper sizing
status: local-source-review
date: 2026-10-17
---

# Constructed selection-to-sizing composition — exact contract v1

Canonical repository ID1415613140; retained accepted remote base
09b7d2281acd22a2df44be6a24fb4a5b2fe5b493. Root is sole Gelt source/check
writer. Active ownership reconciliation found only this Gelt delivery thread
active; Squire and all other Gelt threads idle, reviewers read-only. No parallel
execution interrupted. Parent explicitly requests exact contract review and
implementation if this bounded pure precursor is independently ready.

## Outcome, dependencies and reserved paths

Compose reviewed supplied-batch selection and exact supplied-calendar binding
with existing pure proposePaperSizing. This is roadmap item3 advancing the PR16
deferred selection/calendar obligations, not a producer, feed, runner, order,
admission, G07 control API, new strategy/framework/store or market evaluation.

Precursor frozen identities remain unchanged:

- selector candidate863c3632b6a190bd80155e7c59134f572a7289268561e2a1eca8db5380c41a07
- calendar candidate45ee0bb212433b19e15bcfdcd8a760babe6922cf49956cbb141eec653aea0915

Both have clean contract/source/final reviews and scoped pure verification;
their four-file candidates are retained separately from later inventory changes.
Use existing matching functions and schemas without modifying either precursor.

Exactly four reserved repository paths:

- v2/worker/src/paper-selection-sizing.ts
- v2/worker/src/paper-selection-sizing.test.ts
- docs/specs/G06-Paper-Selection-Sizing.md
- v2/IMPORT-MANIFEST.json (only two new source/test entries)

## Exact input and bounds

`composePaperSelectionSizing(bytes: Buffer)` accepts at most existing
shadowRuleMaxBytes (256KiB), with existing parseResearchJSON UTF8/duplicate-key/
depth/node bounds. No widening, truncation, new dependencies or callback injection.
One shared original context avoids repeating the253-bar window three times:

```ts
{
  schema: 'gelt.paper-selection-sizing-input.v1';
  policyId: 'gelt.spy-long-cash-paper-policy.v1';
  config: PaperSizingConfig;
  mapping: PaperInstrumentMapping;
  ruleInput: ShadowRuleInput;
  ruleReceipt: ShadowRuleReceipt;
  calendar: AlpacaSessionCalendar;
  observations: PaperSizingObservation[]; // 0..64, supplied order
  evaluationAt: string; // existing paper canonical nonnegative millisecond UTC
  selectionReceipt: PaperObservationSelection;
  calendarBindingReceipt: PaperCalendarBinding;
  portfolio: existing paperPortfolioReadSchema;
  lifecycleDisposition: 'settled' | 'unknown';
  buyLimitPrice: existing positive decimalSchema;
  sellLimitPrice: existing positive decimalSchema;
}
```

Root is strict. All nested context schemas are existing strict schemas. The two
receipt fields are initially unknown in the bounded parser and must pass their
existing strict full-replay matchers before any use; no new permissive receipt
schema substitutes for them. No caller-selected `observation`, quantity, quote
filter, cap or effect/admission field is accepted. Input must fit the total byte
budget including any portfolio history; oversized valid-shaped history refuses
instead of truncating or extending limits. A representative253-bar/calendar
constructed case must fit and be covered by tests.

## Binding and deterministic branch order

1. Parse bounded strict root and nested context schemas.
2. Reconstruct selector original bytes from exactly schema/policyId/config/
   mapping/ruleInput/ruleReceipt/evaluationAt/observations, using canonical JSON.
   Require matchesPaperObservationSelection on the supplied selectionReceipt.
3. Reconstruct calendar original bytes from exactly schema/policyId/config/
   mapping/ruleInput/ruleReceipt/calendar; require matchesPaperCalendarBinding
   on the supplied calendarBindingReceipt. Both matchers must pass even when
   selection says not_selected. Shared original objects enforce same run/source/
   decision/config/mapping/calendar linkage; mismatched old receipts reject.
4. If the valid selection receipt is not_selected, return the fixed uncorrelated
   not_composed result below. Do not synthesize an observation or call sizing.
   Portfolio/limits have been schema checked, not semantically certified for a
   sizing operation. No identity or sizing-validity claim leaves this branch.
5. If selected, reconstruct the existing paper sizing input using the shared
   original context, exact selected receipt.observation, portfolio/lifecycle/
   buyLimitPrice/sellLimitPrice/evaluationAt and existing sizing schema/policy.
   Validate with existing paperSizingInputSchema, then call proposePaperSizing
   **once per compose invocation**, with its exact canonical derived bytes.
   No sizing callback or injectable alternative is accepted. A returned proposal
   with inputValidation invalid produces the fixed rejected result; do not leak
   rejected sizing bytes/digests/partial correlations. Preserve any valid
   proposal, no_action or abstain output byte-for-canonical-byte, with no
   quantity, fee, liquidation or UNKNOWN rewrite and no later-observation retry.

Pure replay in the outer matcher repeats this same computation for that separate
invocation; it is not a persistent freeze/one-use claim. The composer does not
call matchesPaperSizingProposal internally, since that would evaluate sizing a
second time; tests may independently prove the exact derived sizing replay.

Limits, portfolio, costs and sizing outcome cannot influence selector reconstruction
or index. They can invalidate/refuse composition or produce a sizing abstention,
never cause choosing another quote. First unaffordable/high-price observation
remains selected even when a later affordable observation exists.

## Exact results

Any malformed/oversized input, receipt mismatch, calendar/context failure or
invalid derived sizing context returns only:

```ts
{ schema: 'gelt.paper-selection-sizing.v1', status: 'rejected', reason: 'invalid_input' }
```

Valid not_selected context returns only:

```ts
{ schema: 'gelt.paper-selection-sizing.v1', status: 'not_composed', reason: 'no_selected_observation' }
```

These two uncorrelated results contain no raw values/errors/digests or partial
identities; neither result matches in matchesPaperSelectionSizing. The latter
does not assert that a sizing operation or full sizing validation occurred.

For valid selected context with a valid existing sizing proposal:

```ts
{
  schema: 'gelt.paper-selection-sizing.v1'; status: 'composed';
  reason: 'selected_observation_sized';
  compositionId: `paper-selection-sizing-${string}`; // hash of full body without ID
  inputSha256: string; inputDigestKind: 'canonical_validated_input';
  sizingInputSha256: string;
  selectionId: string; calendarBindingId: string;
  selectedIndex: number; observationSha256: string;
  runId: string; sourceCommit: string; decisionId: string; evaluationAt: string;
  proposal: PaperSizingProposal; // exact existing output, including abstentions
  classification: 'constructed_offline_test';
  selectionBasis: 'first_eligible_in_supplied_batch';
  globalFirstObservation: 'not_established'; durableFreeze: 'not_established';
  calendarAuthenticity: 'not_established'; marketEvaluation: 'not_established';
  sourceAndProvenance: 'caller_assertions_not_independently_verified';
  effectAuthority: 'none'; promotionAllowed: false;
}
```

All hashes use existing canonical/simulationDigest. Returned proposal is detached
from input bytes and caller objects through the existing parse/replay boundary.
No receipt is a production dispatch permit or portfolio/market truth proof.

`matchesPaperSelectionSizing(bytes, result)` strictly parses all result fields
including existing paperSizingProposalSchema, requires composed status and valid
nested proposal inputValidation, replays the complete original bounded input
and canonical-compares the entire receipt. Changed observations/calendar/receipt/
portfolio/limits/context/time/result fields invalidate old replay. Rejected or
not_composed inputs/results never match; composed valid sizing abstentions may.

## Proposed pure acceptance and review

Tests must prove representative253-window fits total byte budget; exact original
selection/calendar/sizing replay; first high/unaffordable selected observation
remains selected with later cheap alternatives; quantity/limit/UNKNOWN/portfolio
failures cause no fallback; valid cash-exit/no-action/abstention semantics are
unchanged. Cover not_selected (freshness/window), empty batch with valid calendar,
tampered/foreign/replayed receipts or context, middle-calendar mismatch, strict
extra fields, result/decimal tampering, duplicate/UTF8/depth/size bounds and
detached output. Include actual function spy evidence that the existing pure
sizer is called exactly once for selected context passing pre-sizing validation,
including selected context that the sizer rejects as semantically invalid, and
zero for pre-sizing refusal/no-selection; no injected product callback. Such pure module spies introduce no runtime/effect authority.
No actual data, provider, model, store, listener or execution probe.

Both fresh read-only contract reviews must confirm this exact independent scope
and identify any product/domain dependency before implementation. Then sole root
writer implements/tests/spec/inventory, complete actual diff source reviews,
remediation, closeout draft, both fresh final reviews and subsequent scoped pure
checks with retained dependencies. Normal combined-publication/full-release checks
remain separate held gates; no ticketDone/fullG06/G07/install/actual-use claim.

No changes to original schemas/rules/sizers/precursors/caps/normalizer/lifecycle/
UI/workflows/dependencies, no acquisition/credentials/provider/auth/model/native/
DB/store/listener/ownership/cleanup/denied retries. No publication or remote CI
trigger. Existing rights/retention/calendar truth/calibration/prospective-runner
admission and original route-specific holds remain. Credits Off; no fallback.
Private archive1311525917 and duplicate1415749091 untouched.

## Local implementation status

Contract revision2 passed separate fresh accuracy/adversarial reviews with no
blocker/high and no new product/domain dependency. Sole root writer implemented
the exact pure composition, constructed tests and inventory entries. Verification
and complete source/final reviews remain separate stages; no outcome claimed yet.

## Local source closeout draft

Implemented only the new pure composer, its constructed tests, this specification
and two new import inventory entries. Both precursor source files, original
schemas/rule/sizer/caps, simulator/lifecycle/normalizer/UI/workflows/dependencies
are unchanged. Reconstructed shared originals require both precursor replay
matchers; only the selected observation can reach the existing sizer. Refusal
never searches for a later quote. No production consumer invokes the composer.

Contract revision2 SHA256
`ec9976812ee7367e8ed8bc42385122dd3b1927b06016c581a60b40fe73517ace`
passed fresh separate accuracy/adversarial reviews, both no blocker/high and no
new product/domain dependency. A medium v1 check-wording ambiguity was resolved:
zero sizing calls for pre-sizing refusal/no-selection; exactly one selected call
including private semantic-binding rejection. Algorithm step5 did not change.
Named complete contracts, reviews, manifests and originalv1 bytes are retained
in the private packet. No proposed check was called accepted before execution.

Initial focused verification after one test correction passed **63 new composition
cases +71 calendar +70 selector cases =204**. Actual module spies establish the
zero/one call behavior. Cases prove253bar/calendar input fits256KiB, exact derived
sizing replay, no later affordable-quote fallback, caps/UNKNOWN/abstention and
liquidation semantics, strict tamper/refusal and exact detached decimals. A large
1000-entry history exceeds the total budget and refuses without truncation.

One first-run test failed (203pass/1fail): highprecision adverse rounding made the
original100.05 limit incompatible, so the correct existing abstention had no
hypothetical referenceMark. The corrected test now asserts that refusal, then
uses100.06 to check proposal metadata. Product code/guards unchanged. Historical
failed log and correction record retained; no unchanged failed rerun.

Private mirror uses retained Node22.23.3 and locked dependencies. Corrected
focused tests exit0; worker TypeScript noEmit exit0; import inventory exit0
(82upstream/491candidate, MIT and lock unchanged). Whitespace checks and existing
artifact preservation accompany the source packet. Complete source accuracy/
adversarial review, fresh final reviews and subsequent scoped checks remain
required; no completion verdict is claimed by this draft. Final immutable receipt
identifies the exact reviewed candidate and actual subsequent command outcomes.

Normal broader Go/race/vet, Linux build/smoke/science/protected-browser and remote
CI/publication are separate held stages and were not run. No combined-publication
review or release readiness, installation or actual use is claimed. Trusted/global
first observation, durable freeze, authentic calendar/rights/provenance,
calibration, genuine data and prospective runner admission remain unestablished.
No genuine G05/G06 or G07 acceptance follows from these pure cases. Runtime,
acquisition, access, privacy, no-rerun, noncanonical and Credits Off holds persist.
