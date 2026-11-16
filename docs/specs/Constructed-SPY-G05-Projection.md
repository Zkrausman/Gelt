---
type: specification
title: Constructed SPY to G05 projection
status: implemented-working-validated-initial-reviews-accepted-final-gates-pending
source_baseline: 93b517e1543284d50d47436c54ef1b48cd540e73
scope: pure constructed daily input projection into the existing synthetic G05 consumer
---

# Constructed SPY to G05 projection

## Purpose and boundary

`projectConstructedSpyG05(bytes)` bridges one complete PR74 daily-input request
to the existing fixed G05 rule and candidate-manifest schemas. It accepts only
bounded, strict JSON input with a `constructed_offline_test` daily request,
the existing synthetic simulation configuration and settled portfolio shape,
constructed controls, a separate raw-reference observation, and fixed
constructed-only basis declarations. It uses PR74 assessment for daily-source
consistency, maps only the current 253-row snapshot, and leaves G05's decision
or abstention unchanged.

The projector is synchronous and pure. It has no clock, environment, file,
network, provider, credential, storage, order, or dispatch access. A successful
projection still establishes no data rights, source truth, calendar
authenticity, actual availability, market eligibility, market evaluation,
promotion, or effect authority. Hashes bind canonical supplied values; they do
not authenticate an issuer or source.

## Mapping and checks

The daily request is capped at 262,144 UTF-8 bytes within a 1 MiB outer input.
The projector copies the outer input once before parsing, rejects duplicate
JSON keys and malformed UTF-8, asks PR74 to recompute a consistent assessment,
then reparses the same inner bytes as the PR74 request type. No supplied pass or
assessment is trusted. The complete current request, including its optional
predecessor, remains bound through PR74's whole-request digest.

Each current row maps one-for-one to a G05 row: calendar ordinal, constructed
daily interval end, whole-snapshot `availableAt`, and unchanged adjusted-close
decimal. Predecessor rows are not spliced into the current window. Midnight
interval ends are explicitly constructed conventions, not exchange close or
provider finality. G05 receives only its existing internal
`SYNTH-RH-USD`/USD instrument. Its 24-hour signal-age policy may therefore
produce an ordinary `stale_input` abstention.

The bridge requires the existing constructed simulation config with semantic
genesis cash 20, quantity zero, commission 0.01, zero spread and slippage,
960,000 ms maximum decision age, and 5,000 ms maximum observation age. Supplied
decimal representations remain intact in the config and digest. The portfolio
must be settled and bound to the run, classification, instrument, currency,
config, and genesis; cash and quantity must be exactly representable at the
existing scales. The pure function cannot establish that this is an authentic
owner read or complete history. The configured synthetic fixture supplies its
own portfolio read and the existing consumer independently checks it.

Execution reference is a separate constructed observation and is checked by
the existing observation gate. The bridge does not copy an adjusted signal
close into that mark or use daily availability as an execution observation.
The fixed `constructed_raw_reference` and `constructed_none` assertions do not
prove actual mark quality or corporate-action absence.

## Identity and outputs

Domain-separated mapping, calendar, dataset, rights-declaration,
point-in-time-declaration, schedule, and cost hashes bind the generated G05
input. The rights and point-in-time hashes are synthetic descriptors with
explicit `not_established` meaning. Candidate identity binds the frozen daily
request, config, and controls; it excludes changing portfolio, raw mark, and
evaluation time. A changed daily request or control set requires a new
candidate identity.

Every successful projection call invokes the existing pure G05 evaluator once
and preserves its full receipt, including truthful abstention. The result is a
closed, bounded object with the recomputed PR74 assessment, mapping, canonical
candidate manifest text, canonical G05 input text, rule receipt, separate
observation, evaluation time, and explicit no-authority fields. Its identity
hash covers the complete result body except the identity itself. The matcher
validates the closed shape, recomputes from the supplied complete input, and
compares the complete canonical result.

The existing sizing evidence store retains the projected G05 input, receipt,
proposal, manifest, and joined synthetic execution/fee/portfolio facts. It
does not store or independently reopen the complete original daily JSON or
reassess its PR74 assessment. The fixture can compare the owner-read projected
consumer evidence with its expected projection while it holds the original
synthetic bytes. This is projected-consumer evidence only; it is not complete
source replay, source authentication, cross-store atomicity, crash proof, or
actual-market qualification.

## Synthetic acceptance coverage

The unit suite specifies 253-row mapping and unchanged decimal values; distinct
raw execution mark; PR74 whole-request and predecessor linkage; mapping hashes;
candidate identity stability across portfolio/mark/evaluation changes;
candidate identity changes for daily-input/control changes; inclusive age
boundaries; stale-signal abstention; malformed, contradictory, duplicate,
oversized, extra-key, tampered and cross-input rejection; unsettled state; and
fixed economic/config bindings.

The integration suite uses the existing explicitly enabled synthetic order
harness with disposable stores. A setup projection defines the candidate;
the producer recomputes from the consumer's owner-read portfolio. It then
checks one bounded G05 proposal, one constructed fill, reconciled durable
projected input/receipt/proposal, candidate/data hashes, fee, quantity and cash,
followed by halt and protected read-only reopen. It verifies rejected
post-stop preview/confirmation attempts do not change durable evidence or
restore authority. The test does not claim the full daily source was stored.

## Implementation and verification

The bounded projector, its unit coverage, and the constructed consumer
integration are implemented. The PR74 change exports only its inferred
request type. The existing G05 rule, consumer schemas, storage schemas and
routes were not changed.

Working verification completed on the implementation candidate: 20 new tests
and 75 unchanged focused compatibility tests passed; the worker TypeScript and
import-inventory checks passed; Go race tests and vet passed. The Go working
cache was reused for unchanged packages. An initial working test run had 92
passes and three fixture-expectation failures; the corrections changed tests
only. A missing `awk` dependency in the isolated check wrapper was resolved
through its existing read-only binding. No production rule or consumer changes
were made to address either issue.

The initial fresh independent and adversarial source/privacy reviews accepted
the implementation with no actionable correctness, privacy, or evidence-gap
findings. The owner read and accepted both reports; no code remedy was needed.
This specification closeout is a further ticketed change, so fresh final
reviews must cover the complete resulting head. Final exact-head verification,
required CI, and ordinary delivery gates remain pending and are not reported as
passed.

## Changed files

- `v2/worker/src/constructed-spy-g05-projection.ts`
- `v2/worker/src/constructed-spy-g05-projection.test.ts`
- `v2/worker/src/constructed-spy-g05-consumer.test.ts`
- `v2/worker/src/spy-daily-input-consistency.ts` (type-only request export)
- `v2/IMPORT-MANIFEST.json`
- `docs/specs/Constructed-SPY-G05-Projection.md`

No data acquisition, provider call, account access, campaign, live order,
credential change, or operating admission is included.
