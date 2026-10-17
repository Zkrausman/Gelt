---
type: specification
title: G06 constructed paper observation selection
status: local-source-review
date: 2026-10-17
---

# Constructed paper observation selection

This local source slice advances the existing PR16 obligation to select the first
structurally eligible observation before branch quantity/size/cost checks. It
does not supply an actual quote feed, admission, persistent freeze, runner or
proof of the first quote in the outside world. Canonical repository ID1415613140;
accepted source09b7d2281acd22a2df44be6a24fb4a5b2fe5b493. Owner direction renews
independent roadmap/source work toward known goals, while all runtime/data/
access/privacy/publication/no-rerun holds and Credits Off remain unchanged.

## Outcome and nonduplication

Existing `proposePaperSizing` receives a single caller-chosen observation. Its
fixed economics and exact quantity calculation do not select a candidate from a
batch. Existing Alpaca normalization already binds bars to a supplied calendar;
it does not implement this batch selection or provide an actual quote interface.
This helper adds only deterministic selection and replay over explicit
constructed data. Calendar binding at the paper-input boundary and a later pure
selection-to-sizing composition are separate queue items. No new strategy,
backtest framework, store, feed, scheduler or production consumer is introduced.

## Exact input contract

`selectPaperObservation(bytes: Buffer)` accepts at most `shadowRuleMaxBytes`
(256 KiB), parsed with existing duplicate-key/UTF-8/depth/node-bounded
`parseResearchJSON`. Non-Buffer, malformed, oversized, wrong-schema, extra-key
or invalid binding/batch inputs return only:

```ts
{ schema: 'gelt.paper-observation-selection.v1', status: 'rejected', reason: 'invalid_input' }
```

No rejected input, original bytes, raw exceptions, caller digests or partial
identity escape. This helper grants no acceptance authority by parsing data.
Strict root and nested existing schemas define the input:

```ts
{
  schema: 'gelt.paper-observation-selection-input.v1';
  policyId: 'gelt.spy-long-cash-paper-policy.v1';
  config: PaperSizingConfig;             // existing PR16 schema, constructed only
  mapping: PaperInstrumentMapping;       // existing PR16 SPY/IEX/internal mapping
  ruleInput: ShadowRuleInput;
  ruleReceipt: ShadowRuleReceipt;
  evaluationAt: string;                  // canonical nonnegative millisecond UTC
  observations: PaperSizingObservation[]; // 0..64, exact existing PR16 schema
}
```

Validate exact replay of the original canonical ruleInput/receipt with existing
`matchesShadowRuleReceipt`; receipt inputValidation must be valid. Require rule
input/receipt/config runId, sourceCommit and constructed classification agreement;
ruleInput.data.eligibility is declared. Rule instrument is SPY/USD and its calendar
hash equals mapping.signal.calendarSha256. Config.mappingSha256 equals the existing
canonical mapping digest; mapping internal instrument/currency matches config.
Rule schedule hash, signal maxAgeMs and exact 0.95 exposure metadata match the
existing paper policy/config. The helper does not authenticate those declarations.
It does not require a trade signal: a valid rule abstention remains an abstention
and cannot acquire effect authority from observation selection.

Do not compare candidate price to portfolio, target quantity, quote size, limits,
costs, affordability or expected return. There are no input fields for those
branch decisions. Config/receipt schema validation and identity binding precede
selection; this does not certify cost calibration or full sizing-input validity.
The original rule/cost assertions are hashed, not reinterpreted as market facts.

## Batch validation and deterministic rule

Every observation must use the exact mapping digest and SPY instrument. Reject
the whole batch if any observation is malformed, cross-mapped, has availableAt
before observedAt, or has availableAt after the supplied evaluationAt. Do not
skip a malformed record to find a later profitable/valid one. Observed timestamps
must strictly increase in supplied order; duplicate timestamps or reversal reject
instead of sorting, deduplicating or inventing tie-breakers. No provider arrival
order, exchange calendar or wall clock is inferred from that order.

After structural validation, require decisionAt <= evaluationAt <= validThrough
and evaluationAt-decisionAt <= config.maxDecisionAgeMs, with inclusive endpoints.
Otherwise emit a valid-context not_selected receipt with decision_outside_window.
Then select the lowest supplied zero-based index for which observedAt > decisionAt
and evaluationAt-observedAt <= config.maxObservationAgeMs. All availableAt values
are already known at evaluationAt. Equality at the freshness limit is eligible;
equality observedAt=decisionAt is not. If no candidate qualifies, emit not_selected
with no_eligible_observation. Never search for a later price because sizing or
costs might fail. Changing candidate prices without changing times/identity cannot
change the selected index; it does change the committed input/receipt identity.

## Exact result and replay contract

Valid-context selected/not_selected receipts contain these fields:

```ts
{
  schema: 'gelt.paper-observation-selection.v1';
  selectionId: `paper-observation-${string}`; // SHA256 of complete body without ID
  inputSha256: string; inputDigestKind: 'canonical_validated_input';
  batchSha256: string; configSha256: string; mappingSha256: string;
  ruleInputSha256: string; ruleReceiptSha256: string;
  runId: string; sourceCommit: string; decisionId: string;
  decisionAt: string; evaluationAt: string;
  classification: 'constructed_offline_test';
  selectionBasis: 'first_eligible_in_supplied_batch';
  globalFirstObservation: 'not_established'; durableFreeze: 'not_established';
  sourceAndProvenance: 'caller_assertions_not_independently_verified';
  marketEvaluation: 'not_established'; effectAuthority: 'none'; promotionAllowed: false;
  // Selected branch:
  status: 'selected'; reason: 'first_eligible'; selectedIndex: number;
  observation: PaperSizingObservation; observationSha256: string;
  // Or not_selected branch:
  // status: 'not_selected'; reason: 'decision_outside_window' | 'no_eligible_observation';
  // selectedIndex: null; observation: null; observationSha256: null;
}
```

Hashes use existing canonical/simulationDigest helpers. Preserve exact price
string/precision/scale and all observation metadata; result values are detached
from input bytes. `matchesPaperObservationSelection(bytes, result)` strictly
parses the result, replays the original bounded input and compares the entire
canonical receipt. Rejected inputs/results never match. Selected and
not_selected valid-context receipts may match their exact replay; matching
establishes only deterministic linkage, not admission or a durable freeze.

Any different batch, rule, config, mapping, evaluation time or selected record
invalidates an old receipt. This is NOT a persistent one-use claim and cannot
prevent a caller supplying a new batch to a later call. Future consumers must
own trusted batch provenance and durable selection-before-sizing state. This
slice does not complete that runtime obligation or release UNKNOWN fences.

## Reserved source and exclusions

- v2/worker/src/paper-observation-selection.ts
- v2/worker/src/paper-observation-selection.test.ts
- docs/specs/G06-Paper-Observation-Selection.md
- v2/IMPORT-MANIFEST.json

Only new pure source/tests/docs plus two inventory entries. No existing rule,
sizing, caps, normalization, lifecycle, adapter, transport, runner, data/credential
access, DB/store, clock read, UI, launcher, workflow or dependency changes. Imports
are limited to existing pure schemas/replay/JSON/hash primitives and Zod; no
connector import or acquisition. Existing source/human edits and frozen M4/G08
candidates remain intact. Public publication and full release checks are separate
held stages; no denied retry, actual model invocation or paid fallback.

## Acceptance and verification plan

Pure cases must cover exact deterministic selection/replay, rejecting tampered
selection/batch/context and duplicate keys, UTF-8/size/structural bounds, strict
namespaces, chronology/availability/freshness/decision-window boundaries, no
eligible observation, high precision preservation, caller abstention/UNKNOWN
nonpromotion, and price/affordability independence. A first expensive observation
must remain chosen over a later affordable one; no quantity/limit field may tune
selection. Existing legacy/paper schemas, fees/caps and other source remain
unchanged. No actual portfolio/market outcome, selection persistence or rights
evidence is established by constructed cases.

Contract review precedes code. Full source/privacy accuracy and adversarial
reviews, accepted remediation, final closeout review and scoped pure verification
precede any local source-completion claim. No test/build/implementation result
is claimed yet. Broader Go/Linux/scientific/browser/release checks and publication
remain unrun/held until separately applicable; no installation or actual use.

## Local source closeout draft

Implemented the pure selector/replay helper and 70 constructed cases within the
four reserved paths. The helper rejects an entire malformed or cross-bound batch,
selects the first fresh observation strictly after the decision, and records
exact original identities. Prices do not tune index selection. Valid abstentions
remain effect-free. No production consumer invokes the helper.

The unchanged contract SHA256
`d8bc7f9439b87bbd7934b88429e5a77893715e30f1726d8a549a5edbf3256907`
passed separate complete accuracy and adversarial contract reviews, each with no
blocker/high finding; the parent retained both results in the private contract
review receipt. Both reviewers inspected all nine named seams and matched all
ten hashes. Source implementation was separately resumed by the parent after
ownership reconciliation; no competing Gelt writer was active.

Initial scoped verification in a private mirror using retained Node22.23.3 and
locked dependencies: focused Vitest **70 passed**, worker TypeScript `--noEmit`
exit0, import inventory exit0 (**82 upstream / 487 candidate files**, MIT and lock
unchanged). Parent diff whitespace check exit0; explicit new-file whitespace
accounting and exact manifest/patch accompany the source review packet.
Full source accuracy/adversarial review and fresh final review are required;
this draft does not claim them complete. Final verdicts and subsequent scoped
verification belong to the immutable private receipt for the reviewed candidate.
No source edits may follow final review without a new review cycle.

Broader Go/race/vet, Linux build/smoke, scientific, protected-browser and remote
CI were not run for this local-only pure slice. Those normal release gates and
publication remain separate held stages. No merge, installation, actual use,
genuine market input, runtime acceptance, global first-observation proof or
persistent freeze is claimed. Original rule/sizing/caps/source are unchanged;
existing M4 and G08 source candidates and human edits are retained. The shared
import inventory adds exactly these two new source/test entries to its retained
post-G08 baseline; this does not change the frozen prior G08 candidate identity.
