---
type: specification
title: G08 constructed configured simulation result projection
status: local-source-review
date: 2026-10-17
---

# G08 constructed result projection

This is a pure source slice of approved G08 truthful synthetic result inspection.
It does not implement full G08, durable reads, installation, actual use or a
completed/genuine run. Canonical repository: Zkrausman/Gelt, ID1415613140.
Base: beace9e281bb1d5f39cbb5253e572e86a92b0c04. Publication and all existing
runtime/data/runner/MCP/auth/retry holds remain unchanged. Credits remain Off.

## Exact input/output contract

Export only the pure function `projectConfiguredSimulationResult(input: unknown)`
and its TypeScript result/view types. Input is caller-supplied JSON-like data,
not serialized bytes, a path, reader, callback, service or authority token.
Validate with existing Zod schemas before projecting; malformed values return
the same fixed rejection. No raw input or Zod error crosses the function boundary.
This is not a sandbox for executing hostile JavaScript objects/accessors.

The input object is strict (unknown keys reject):

```ts
{
  schema: 'gelt.constructed-result-view-input.v1';
  config: SimulationRun;                 // existing simulationRunSchema
  portfolio: {                          // existing simulationPortfolioReadSchema
    snapshot: SimulationSnapshot;
    state: 'settled' | 'unsettled';
  };
  lifecycle?: null | {                   // strict, separately caller-supplied
    runId: string;                      // UUID
    configSha256: string;               // lowercase 64-hex
    snapshotSha256: string;             // lowercase 64-hex
    disposition: 'settled' | 'unknown';
  };
}
```

Both config and snapshot must have `classification='constructed_offline_test'`.
Use the existing configured v2 schemas unchanged: instrumentId SYNTH-RH-USD and
currency USD are their explicit present constraints, not new defaults or a
claim of multi-currency support. Existing declared_market_uncalibrated values,
G03 v1 recorded fixtures and PR16 paper config/portfolio/proposal schemas reject.

Require snapshot.runId/config.classification/instrumentId/currency agreement;
snapshot.configSha256 equals simulationDigest(parsed config), and
snapshot.genesisSha256 equals simulationDigest(parsed config.genesis).
If lifecycle is supplied, its runId/configSha256 and snapshotSha256 must match
this exact parsed config/snapshot. Snapshot digest includes history commitment,
revision, quantities and classification; cross-snapshot lifecycle reuse rejects.
Missing/null lifecycle projects 'unestablished', never 'settled'. The declaration
is not verified lifecycle truth and cannot establish completion or effect safety.

Successful return is exactly this structure; no extra derived metrics or IDs:

```ts
{
  status: 'projected';
  view: {
    schema: 'gelt.constructed-result-view.v1';
    source: 'gelt-synthetic-robinhood-mock-v2';
    classification: 'constructed_offline_test';
    evidence: 'caller_supplied_constructed_snapshot';
    runId: string; sourceCommit: string;
    instrumentId: 'SYNTH-RH-USD'; currency: 'USD';
    configSha256: string; genesisSha256: string;
    historySha256: string; snapshotSha256: string; revision: number;
    reportedPortfolio: { state: 'settled' | 'unsettled'; cash: Decimal; quantity: Decimal };
    reportedLifecycle: 'settled' | 'unknown' | 'unestablished';
    completion: 'unestablished'; durableReplay: 'not_established';
    provenance: 'not_authenticated'; marketEvaluation: 'not_established';
  };
}
// All invalid/mismatched inputs and internal validation/hash failures:
{ status: 'rejected'; reason: 'invalid_constructed_input' }
```

Preserve original decimal value strings, scale and precision without conversion
to JS numbers, normalizing, valuation or rounding. Produce detached data: caller
mutation after return cannot alter the projected view and vice versa. No input
mutation or clock dependence. Revision/history hash are unverified declarations;
this function does not accept history facts, authenticate provenance, replay
stored facts or certify even a revision-zero portfolio as a correct balance.
All caller-reported balances remain explicitly labelled as such.

Portfolio 'settled' never clears reportedLifecycle 'unknown'; an unsettled
portfolio remains unsettled even if separately reported lifecycle is settled.
Completion is always unestablished, including zero quantity/cash or settled
declarations. No completion evidence interface is introduced. No decisionId,
orderId, receiptId, executions, fees, P&L, prices, timeline, paper linkage or
effect/resume/redispatch authority can be inferred or supplied as extra fields.

## Reserved changes and exclusions

Only these four repository paths are reserved for this increment:

- v2/worker/src/configured-simulation-result-view.ts
- v2/worker/src/configured-simulation-result-view.test.ts
- docs/specs/G08-Configured-Simulation-Result-Projection.md
- v2/IMPORT-MANIFEST.json

No production imports/consumer, storage/DB open, history reader, recovery,
provisioning/cleanup, provider/credential/data fetch, UI/BFF/transport, scheduler,
pause/resume, launcher, workflow, dependencies or M4 candidate changes. Reuse
only existing pure economics/schema/hash imports and Zod. Hashing through existing
node:crypto is deterministic in-process computation, not provider/network/store
access. Existing v1 schemas and fixtures, legacy USD10 fee cap, PR16 pure USD10000
policy and all order/admission APIs remain unchanged. No new capability flag.

## Focused acceptance cases

1. Exact constructed config/snapshot plus bound lifecycle yields only the stated
   fields and labels; deterministic repeat preserves exact values and identities.
2. Cross-run/config/genesis/classification/instrument/currency mismatches reject;
   lifecycle bound to another run/config/snapshot also rejects.
3. Malformed, non-constructed, G03 v1 and PR16 paper/extra-authority inputs reject
   with one sanitized result; successful output invents no execution/result fields.
4. Unknown lifecycle survives settled portfolios; missing/null stays unestablished;
   unsettled portfolios are not cleared. No input can claim completion.
5. High-precision cash/quantity representation is preserved exactly, without
   valuation, invented fees/P&L or JS-number conversion; input/output are detached.
6. Existing G03 recorded schema/fixture source bytes and fee caps stay unchanged;
   no real-account namespace is accepted or silently converted.
7. Production helper has only named pure imports and no I/O/clock/store/provider
   or mutation; tests exercise only pure calls, not listener/DB/runtime workflows.
8. Complete source/privacy/accuracy/adversarial reviews and scoped verification
   distinguish local source/pure tests from full G08 acceptance and actual use.

## Verification and completion evidence

Both independent contract reviews accepted the exact four-path boundary without
blocker/high findings or broader authority, effects or hidden dependencies.
Reviewed contract SHA256:
3518867c037fd98c095652a399fc18cf6c9de757d9d0617da23c8a1e0e01a256.
The helper and focused tests now implement that contract; there is no production
consumer. Import accounting adds only the two new TypeScript files. This spec
provides the required implementation/closeout report for the four changed paths.

Before source review, the exact source in a private verification mirror passed:

- Vitest 2.1.9: only configured-simulation-result-view.test.ts, 52 passed, none skipped.
- TypeScript 5.9.3: worker `tsc --noEmit -p worker`, exit0.
- Existing import verifier: 485 candidate files, 82 upstream paths; MIT retained
  verbatim and resolved lock inventory unchanged, exit0.
- `git diff --check`, exit0. Existing untracked M4 files are retained separately.

Tests use constructed data and pure calls only. Node22.23.3 and existing installed
dependencies are reused from retained local preparation; current lock bytes match
that installation's source lock. No install, dependency/lock edit or M4 rebuild.
Contract/source/final review identities, exact complete patches, file hashes,
findings/remediation and scoped final-verification receipts are retained in the
task-private g08-projection-v1 packet. Final source reviews and the post-review
scoped verification are separate gates; this text does not preclaim their result.
Initial complete source accuracy/adversarial reviews found no blocker/high.
The adversarial reviewer suggested isolating the genesis commitment rejection
from a stale lifecycle binding; that low-severity improvement was accepted.
Three cases now omit lifecycle to independently exercise run/config/genesis
binding. The helper/contract are unchanged. The revised four-file closeout and
complete patch require fresh final reviews before scoped final verification.

Broad runtime/listener/browser/MCP/provider/held tests, full foundation build/smoke,
Go release checks, remote CI and publication were not run for this authorized
pure slice. No full G08 acceptance, installation, actual use, merge readiness,
genuine run, durable replay or completed outcome is established by these checks.
