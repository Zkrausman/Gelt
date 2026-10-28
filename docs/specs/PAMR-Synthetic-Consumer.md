---
type: specification
title: "Fixed PAMR synthetic consumer and durable lifecycle evidence"
status: source-completion-report
implementation_status: constructed-source-conformance-only
timestamp: 2026-10-28T00:00:00Z
---

# Fixed PAMR synthetic consumer

This revision connects the [selected PAMR mathematical artifact](Selected-PAMR-Conversion-Fidelity.md)
to the existing configured synthetic lifecycle and protected result/reopen path.
It implements one explicit adaptation, not arbitrary paper interpretation, a full
multi-asset PAMR portfolio, an actual shadow campaign or trading admission.
The [G05 baseline integration](Candidate-Shadow-Synthetic-Integration.md) remains a
separate identity and retains its receipt validation and operating boundary.

## Fixed adaptation and independent quantities

The consumer accepts only the original fixed recipe with exactly `SYNTH-RISK`
then `SYNTH-RESERVE`; every reserve relative must be the literal string `1`.
It replays and verifies the entire inert artifact and the preceding prefix.
The post-update first strategy weight is mapped to a single-instrument exposure
by `floor(weight * 10^18 / 4) / 10^18`. Quarter scale, flooring and the reserve
convention are declared synthetic consumer choices, not paper equations, market
calibration or a claim of full portfolio fidelity.

Strategy weights, hypothetical sizing and actual mock holdings remain distinct.
The neutral long/cash sizing kernel retains the original G05 exact arithmetic:
adverse modeled prices, cumulative cash rounding, quantity grid, fees, cash and
the fee-inclusive USD 10 cap. G05 still enters through its original validators;
the extraction does not create another G05 receipt or effect authority. Positive
target overweight abstains instead of introducing partial reductions. Off-grid
cash exits and exits above the cap abstain; no splitting or automatic retry is
added. Unsupported dimensions, labels, reserve values or recipe identities reject.

The independently derived constructed trace `[2,1]`, `[0.5,1]`, `[2,1]` yields
risky weights `0,1,0` and exposure targets `0,0.25,0`. With cash 20, price 1,
commission 0.01 and quantity grid 0.01, the entry proposal is 4.99. An observed
full synthetic fill leaves mock cash 15 and quantity 4.99; an observed cash exit
leaves 19.98 and zero. These are fixture oracles, not performance results. A
partial observed entry of 2 followed by acknowledged cancellation, explicit
settlement and reconciliation exits the actual 2, rather than the requested 4.99.

## Pure decision versus consumed attempt

`pamr-consumer-contract.ts` and `pamr-consumer-adapter.ts` define bounded,
separately named PAMR input/decision/proposal data. Primitive inputs are bounded
before strict JSON parsing; duplicate keys, invalid structure and finite numeric
resource excess reject. Input, artifact, recipe, prefix, run, source, configuration,
costs, observation, clock, portfolio and policy identities are correlated by full
recomputation. A digest is a binding, not external authenticity. Pure outputs
continue to say `consumption: not_performed` and carry no effect capability.

The configured owner policy hash is distinct from the global pure-policy
definition hash. It binds the actual constructed run, source/configuration,
quantity grid, buy/sell limits, adaptation and fixed bounds.
`PAMRConsumptionEvidence` in the existing sizing-evidence family consumes a
contiguous ordinal once, starting at 1, including valid no-action/abstention.
Each attempt binds the actual prior stored prefix and prior manifest. New proposal
IDs, time values or artifact whitespace cannot reissue a spent ordinal. Invalid
input, skipped/drifted parents and stale or future recorded clocks reject before
publication. A consumed attempt is not a confirmed order or an observed fill.

Every read and prepare replays the complete bounded retained chain, all canonical
bodies, byte counts, policy, links and relationships. There is no cache-only index.
Existing private-directory and regular-file guards, exclusive creation, file and
directory sync, staging and immutable publication are retained. Bounds are
262,144 input bytes, 8,192 proposal/policy/manifest bytes, 64 records and 8 MiB
total retained evidence. Orphans or uncertain writes are retained. A fresh owner
cannot reuse even an empty existing directory left by uncertain initialization.

Known pre-write rejection remains distinguishable from persistence uncertainty.
Any failure after mutation starts, including an injected typed rejection, latches
unavailability; the owning mock storage is poisoned and retains its marker.
Reopen validates the complete evidence but is read-only and restores no spent
capability. This is the existing owner/evidence family, not a new store, dependency,
retention policy, recovery engine or hostile same-process guarantee.

## Active consumer and one-use lifecycle

`SimulationAdapterOptions.pamrBinding` is mutually exclusive with the old decision
and G05 sizing modes. Its fixed producer supplies artifact text, availability and
decision times and an observation, rather than a receipt, target quantity, path
or evaluator selector. The adapter copies this restricted data and derives the
complete input from the actual configured owner, policy, clock and replayed mock
portfolio. The existing lifecycle lease establishes the constructed owner context;
a producer assertion alone cannot establish settlement.

Ordinal consumption precedes preview/admission. Admission and submission validate
the retained link by reading it, never by preparing it again. The existing
configured lease, generation, halt, current portfolio, confirmation and single-use
submit permit remain applicable across awaits. An admitted preview reserves its
own unchanged portfolio; dispatch carries only that exact private admission
snapshot after consuming the pending handle. The store still checks the actual
reservation and terms. Caller quantities cannot enter the bound HTTP preview path.

Mock preview schemas correlate a new PAMR decision namespace with mandatory PAMR
consumption linkage and constructed classification. Mixed G05/PAMR linkage,
unbound PAMR IDs and market classifications reject. Recorded run executions must
match their owned preview's decision, run and configuration. The old SQLite schema,
single storage connection, economic checks, transport bounds and old record
readability are preserved. Full raw artifact/input data never crosses transport.
Reopen permits validated reads and existing exact-payload readback behavior;
new prepare, admission, submission, cancel and observation mutation remain blocked.

## Protected read and corruption fences

The existing protected `history` operation accepts the optional
`pamrConsumerDispatchId` selector, mutually exclusive with `candidateDispatchId`.
There is no new endpoint, account, provider or public effect API. The existing
session, loopback Host, Origin/proxy rejection, request limits and before/after
clock checks apply; serialized selected responses remain bounded to 32 KiB.

The result names its constructed/SIMULATED_ONLY scope, adaptation, distinct policy
hashes, artifact/recipe/prefix/ordinal bindings, pure decision/sizing, consumed
attempt, requested order, independently observed simulated fills and actual mock
cash/positions. Hypothetical post-trade balances never replace observed holdings.
It omits full artifact/input text, private paths and session, confirmation or
admission credentials. Provenance/authenticity, completion and market evaluation
remain unestablished; effect authority is none and promotion is false.

`synthetic-lifecycle-join.ts` is shared by the existing G05 candidate view and the
PAMR view. It correlates preview/confirmation/claim/terms/order, broker identities,
execution IDs and values, cancellation and every retained terminal status.
Duplicate observed execution A cannot substitute for omitted B. Later statuses
cannot hide an earlier terminal contradiction. Missing selected records are
unavailable; legitimate observation lag remains UNKNOWN, rather than settlement
or independently proven corruption. Historical input snapshots are not compared
to later actual post-trade balances as if they were simultaneous.

A proven cross-owner contradiction fences both storage owners synchronously,
halts new orders, invalidates pending capabilities and retains ownership markers.
It is not merely an unavailable response followed by reuse or clean release.
Matched owner reads are not a cross-database transaction, runtime qualification
or authenticator for hostile code. Durable submission UNKNOWN is never replayed
as another submission after restart.

## Source map and delivery evidence

- Neutral arithmetic: `long-cash-sizing-kernel.ts`, its tests and the unchanged
  G05 validator wrapper in `shadow-sizing.ts`.
- Pure consumer: `pamr-consumer-contract.ts`, `pamr-consumer-adapter.ts` and tests.
- Evidence: `pamr-consumer-evidence-contract.ts`, the additive
  `PAMRConsumptionEvidence` class and `pamr-consumer-evidence.test.ts`.
- Owned storage/schema/transport: `synthetic-mock-robinhood-contract.ts`,
  `synthetic-mock-robinhood-storage.ts`, `synthetic-mock-robinhood-transport.ts`
  and `pamr-consumer-storage.test.ts`.
- Active integration: `synthetic-mock-robinhood-adapter.ts`,
  `synthetic-order-harness.ts`, the shared join, adapted
  `candidate-shadow-adapter.ts`, `pamr-consumer-lifecycle-result.ts` and
  `pamr-consumer-integration.test.ts`.
- `v2/IMPORT-MANIFEST.json` records actual source hashes; the selected mathematical
  specification and roadmap link this bounded successor without erasing history.

Synthetic verification covers hand-derived entry/exit and partial cancellation,
no-action consumption, forged lineage, clocks, one-use confirmation, pending
capability invalidation, real evidence-size/record limits, post-mutation failures,
writer loss, UNKNOWN, protected reads and complete/incomplete read-only reopen.
Old G05/candidate and configured simulation regressions remain acceptance gates.
Owner fixes include an uncertain empty-root reuse defect, invalid-clock rejection
classification and the private admission handoff needed by dispatch.

Delivery requires fresh independent and distinct adversarial accuracy/privacy
reviews of the complete final diff, full inventory, relevant seams, tests and this
report. Required exact-head Linux Go race/vet/build, V2 tests/types/build/offline
smoke, inventory and diff checks must pass, followed by ordinary PR checks,
scientific/protected-browser gates, unchanged reviewed-tree merge and remote/post-
merge verification. These are source-verification gates, not operating acceptance.

## Remaining authority and fidelity boundaries

The selected paper/reference/license limitations in the mathematical specification
remain unchanged. No upstream reference was executed and no new paper-text or
third-party rights certification is supplied. General automatic Paper2Agent
conversion, real input entitlement/availability, calibration, handling/runtime
qualification and prospective strategy observation remain separate dependencies.
The SPY253 sixteen-check profile and C07/C13/C14 unknowns are not promoted by these
constructed fixtures. Production stays CLOSED and operations DEFER. No acquisition,
provider call, actual shadow campaign, paper/live trade, credentials, access or
security change follows. Technical promotion controls, evidence sufficient to
promote a strategy and permission to transact remain different gates.
