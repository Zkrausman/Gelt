---
type: specification
title: "Versioned baseline candidate to durable constructed simulation"
status: source-completion-report
implementation_status: source-and-synthetic-conformance-only
timestamp: 2026-10-27T00:00:00Z
---

# Versioned baseline candidate to durable constructed simulation

This increment connects one explicitly versioned **G05 baseline** to the existing
configured G06 sizing/lifecycle and a protected, replay-checked result read. A
constructed entry, fill, exit and reopen can retain candidate, decision, simulated
execution and portfolio lineage. It adds no execution engine, dependency, store,
provider connection or production activation.

This is **not automatic Paper2Agent conversion**. The artifact is the existing
[G05 sign-return adaptation](G05-Shadow-First-Rules-Core.md), not the G04 covariance
implementation or evidence of general paper fidelity. The earlier
[research-to-shadow execution-first sequencing gate](ZAR-209-Research-to-Shadow.md)
continues to govern actual conversion/research operation. The separately approved
baseline integration is constructed source conformance, not acceptance of that
MVP or permission to progress an actual campaign.

Production remains **CLOSED**, operations **DEFER**, and the real SPY253 C07/C13/C14
facts remain **UNKNOWN**. No acquisition, authenticated provider/account call,
runtime qualification, actual shadow campaign, paper/live transaction, credential,
security-setting or retention change is included.

## Interfaces and lineage

`candidate-shadow-contract.ts` defines
`gelt.candidate-shadow-manifest.v1`. Its closed fields include:

- `constructed_offline_test` classification and `SIMULATED_ONLY` effect scope;
- run ID, source commit and configured simulator digest;
- the fixed artifact descriptor, with evaluator/contract/reference source pins;
- exact instrument, data, rule policy, costs and control declarations.

`candidateShadowId` uses a distinct canonical digest domain over the complete
validated manifest. Dataset, calibration, receipt, configuration, policy and
artifact identities retain their separate roles. Source pins identify the
inspected repository snapshot; they are not independent authentication of executing
code or external provenance. A regression checks the descriptor against those
actual source bytes so future baseline changes cannot silently retain its pins.
Run/source/configuration identifiers remain supplied bindings; equality is not
independent verification of that commit, account or market provenance.
Parameter/source changes need an appropriate manifest/artifact version and review.

`evaluateCandidateShadowDecision(manifestText, inputText, observationText)` accepts
bounded primitive JSON strings. Manifest, input and observation ceilings are 8 KiB,
256 KiB and 2 KiB respectively. Duplicate-key and existing structured parsing rules
remain enforced. It selects the fixed `evaluateShadowRule` implementation rather
than loading caller code, accepting a caller verdict, or treating a hash as an
execution capability. Unsupported artifact selectors, mismatched bindings and
non-constructed data reject with the closed `invalid_candidate_input` result.

An `evaluated` result supplies a G05 decision context, **not admission**. The
existing configured producer/sizing path still checks the actual simulator
configuration, costs, current portfolio, observation, complete rule receipt and
sizing proposal before admission. A rule abstention or valid no-effect sizing
result remains no effect; it is not replaced with an order.

## Existing durable boundary

The optional `candidate` field in the existing sizing policy is retained in its
bounded `policy.json`. Candidate IDs are linked in the existing sizing replay
manifest and compact evidence link. Publication continues to use the existing
private writer, bounded artifact files, sync/rename stages, capacity limits and
poisoned ownership behavior. There is no independent candidate journal or new
connection pool. Policies and evidence without candidate metadata keep their prior
representation and behavior.

Evidence preparation and read replay compare the candidate with the actual rule
input and simulator configuration. A dispatch-backed read verifies the complete
sizing evidence, stored order payload, replayed mock events and portfolio. The
lifecycle owner separately replays its facts; confirmation/claim terms, order
identity, acknowledgements and observed executions must agree. Execution joins
require unique identities and exact one-to-one correspondence before a settled
result: duplicate A cannot substitute for omitted B merely because counts match.
Legitimate simulated fills awaiting lifecycle observation remain UNKNOWN; duplicate
or conflicting observations make the joined read unavailable. Requested terms
are shown separately from observed simulated fills. Fees and cash/quantity updates
come from the configured simulator's exact-decimal event replay, not requested
amounts, a close price, or a fabricated result DTO.

Exact duplicates retain their existing no-additional-effect behavior. Unknown
dispatch facts are not cleared by a helper projection or reopening a database.
Clean sizing-bound reopen remains read-only and restores no producer/confirmation
or submission authority. Missing or damaged joins return unavailable; the reader
does not repair hashes, invent empty successful results or steal a writer marker.

## Protected result read

The existing **offline test harness** `POST /v1/synthetic-orders/history` accepts
an optional strict `{ "candidateDispatchId": "<UUID>" }` selector. An empty body
keeps the original history behavior. The selector adds no caller filesystem path,
artifact execution or production route. All existing opt-in fixture, loopback
Host, no-Origin/no-forwarded-header, bearer/session and method/body checks remain.
The owner clock is checked after body receipt and again immediately before sending
the bounded joined response; expiry or backwards movement denies the read.

The separately versioned `gelt.candidate-shadow-result.v1` view includes:

- candidate/artifact, run/configuration, decision/input/receipt and sizing links;
- requested terms versus actual recorded simulated executions and fees;
- replayed cash/positions and history/revision commitments;
- lifecycle disposition and dispatch uncertainty, with explicit evidence limits;
- the grouped real-operation admission result described below.

The serialized response is bounded to 32 KiB. It excludes bearer, session,
confirmation and admission capabilities, raw artifact/input bodies, private paths
and exception text. It does not add P&L, performance or promotion claims.

The evidence label describes **existing owner transaction replay**, with
`matched_owner_reads_not_cross_store_transaction` consistency. It does not claim
one transaction across the separate existing owners. `completion` stays
`unestablished`, `provenance` stays `not_authenticated`, market evaluation stays
`not_established`, and effect authority remains none even when the local lifecycle
is settled. These labels do not promise hostile same-process isolation or runtime
qualification.

The dispatch selector intentionally requires an actual retained order. A valid
no-effect decision retains candidate-bound input/proposal evidence in the existing
replay store but has no order-backed joined view. An unknown dispatch selection
returns unavailable, rather than presenting an empty order as a completed result.
The existing private fixture evidence remains inspectable by its owner; this
increment does not add arbitrary artifact browsing or a new UI export path.

[G07's recorded-view contract](G03-Recorded-Simulation-Terminal.md) and the
[G08 pure caller-supplied projection](G08-Configured-Simulation-Result-Projection.md)
are unchanged. In particular, the G08 helper still reports caller-supplied
snapshots and no established durable replay. Recorded v1 fixtures are not cast
into configured v2 candidate results.

## Grouped operating-admission result

`candidateShadowOperatingAdmission()` accepts no caller facts or enable switch.
It reports source-only CLOSED/DEFER, no acquisition/dispatch/retry/promotion
permission, and no accepted operational candidate. The retained proposed SPY/IEX
request/window/checkpoint is labelled a declared plan, not actual input. It is not
rolled forward or made eligible by a successful constructed test.

| Evidence domain | Established here | Missing supplier/interface or dependency |
| --- | --- | --- |
| Baseline candidate, evaluator, sizing and local replay | Versioned source and constructed conformance owned by the Gelt source owner. | Automatic conversion and reference fidelity beyond the G05 adaptation are not established. |
| SPY253 input/window/calendar/availability | Existing inspection source and retained declared input plan. | No accepted actual connector original, eligible collection, completion/revision or coherent adjusted-pagination evidence is supplied. Provider facts must come from the appropriate Alpaca interface; unavailable guarantees remain unknown. |
| Account and rights | General documented Basic/IEX personal-use planning facts do not establish this account's status. | Account-specific availability/additional terms remain unverified. This is not a request for credentials or unsupported special paperwork. |
| Runtime, reviewer, handling and copies | Linux is selected; source components exist. | No accepted preventive handling/copy/cancellation/whole-job settlement interface or qualification receipt is supplied. The actual consumer/custodian evidence is still unestablished; a trust profile is not invented. |
| Costs, risk and effects | Explicit constructed declarations, exact replay and the existing fee-inclusive USD10 cap. | No market calibration, strategy evaluation/observation protocol, risk/effect admission or transaction authority is established. |

All existing 16 byte-review check identities, closed reasons, original connector
custody, private one-use completion/reservation, immutable emission E, additive R,
current C and own-ack rules are unchanged. The new baseline fixture does not
manufacture a SPY253 lane, all-pass market verdict, disposal, execution settlement
or provider atomic vintage. The real profile remains blocked before acquisition
or operating dispatch. A later operating release requires a separately bounded
scope and evidence; naming Linux or passing these tests does not release it.

## Verification and delivery gates

The source author and independent fixture preparer produced separate static
proposals. Their terminal artifacts are not execution or acceptance evidence. The
owner applied the bounded patch, preserving its original output, and corrected a
fixture to use the existing canonical execution-price function. The ledger
correctly rejected tmpfs and group-writable ancestry during initial setup; tests
then used an existing permitted ext4 temporary location through process-local
`TMPDIR`, without changing filesystem guards or permissions.

Owner-executed conformance covers entry/whole exit, observed fees/cash/positions,
exact duplicate fills, protected reads, read-only reopen, dispatch UNKNOWN,
partial/cancel/late fills, damaged evidence, invalid lineage/market inputs,
no-effect retained decisions, stale confirmation and detached caller identity.
Two new clock regressions failed before the joined-response boundary correction
and passed after it. A further source-pin regression protects descriptor drift.

The first complete independent and adversarial reviews found the same HIGH
execution-join defect: duplicated lifecycle observation A could hide missing B.
Owner-written corrupt-event/projection regressions reproduced it through both
protected live reads and read-only reopen. The grouped correction rejects duplicate
identities and requires exact bijective matching for settled results, while the
same tests preserve UNKNOWN for legitimate unreconciled fills. No generic ledger,
engine or recovery policy was changed.

The corrected pre-review working candidate passed all 20 integration regressions,
server tests, worker/web tests, Node script tests, worker type checking, Go
race/vet/build, full V2 build, offline smoke, import inventory and whitespace
checks. Counts and commands belong to their exact
receipts; skipped unsupported legacy tests are not passes or Linux/runtime proof.
The fixture suite can be reproduced with Node 22 and the retained locked
dependencies, from `v2`:

```sh
TMPDIR=/var/tmp node node_modules/vitest/vitest.mjs run --config worker/vitest.config.ts worker/src/candidate-shadow-integration.test.ts
```

Use a temporary parent that passes the existing Linux filesystem/ownership guards;
this command is a constructed regression, not a service or campaign launch.

Acceptance requires fresh independent and distinct adversarial review of the
complete resulting source, this report and full import inventory, followed by
exact-head verification, normal Go/V2/scientific/protected-browser CI, ordinary
merge and remote verification. The delivery owner records the actual immutable
review/CI/merge receipts; this report does not infer them from a process exit.
No source-only result establishes installation, actual data acceptance, operating
qualification, conversion success, profitable behavior or live readiness.

## Changed files

- `v2/worker/src/candidate-shadow-contract.ts`: bounded manifest, fixed descriptor,
  distinct identity domain and closed operating-admission record.
- `v2/worker/src/candidate-shadow-adapter.ts`: fixed evaluator connection and
  sanitized joined-result projection over existing replay owners.
- `v2/worker/src/synthetic-mock-robinhood-contract.ts`: optional candidate policy
  metadata and replay-link identities; legacy representation retained.
- `v2/worker/src/synthetic-sizing-binding-evidence.ts`: candidate validation in
  existing publication/replay, without new storage or larger limits.
- `v2/worker/src/synthetic-mock-robinhood-storage.ts`: internal replay-backed
  candidate/order/evidence/portfolio read.
- `v2/worker/src/synthetic-order-harness.ts`: protected dispatch-selector read
  and final owner-clock check; existing fixture gates retained.
- `v2/worker/src/candidate-shadow-integration.test.ts`: constructed integration
  and independent adverse/lineage/session/descriptor regressions.
- `v2/IMPORT-MANIFEST.json`: actual scoped hashes and new Gelt entries; upstream
  metadata, retained source, lockfile and notices unchanged.
- `docs/ROADMAP.md`: current source capability/approval status, preserving the
  complete historical snapshots and all operating holds.
- This completion specification.
