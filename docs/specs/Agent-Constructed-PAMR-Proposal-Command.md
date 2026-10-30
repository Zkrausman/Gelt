---
type: specification
title: Agent constructed PAMR proposal data command
status: source-candidate-pending-independent-review
source_baseline: 1a95110954e8d8befd31d5a529e710524dd9b2ee
scope: bounded pure proposal and whole-input verification, no effects
---

# Agent constructed PAMR proposal data

The owner commissioned continued agent-first source development. After
[PR35](https://github.com/Zkrausman/Gelt/pull/35) delivered the A64 data-inspection
command, this increment exposes the existing pure PAMR proposal validator through
a second finite agent command. It does not connect inspected SPY253 data to an
operating consumer: the historical inspection and constructed consumer identities
remain deliberately incompatible. No policy, math, input window, lifecycle,
provider, credentials, security controls, dependencies or public server change.

## Fixed interface

Build with the existing `npm --prefix v2 run build:worker`, then use:

```sh
node v2/worker/dist/pamr-proposal-cli.js --describe
node v2/worker/dist/pamr-proposal-cli.js < permitted-constructed-request.json
```

Stdin is one complete UTF-8 JSON document:

| Field | Contract |
| --- | --- |
| `schema` | Exactly `gelt.agent.constructed-pamr-request.v1`. |
| `operation` | Exactly `propose` or `verify`, two pure data operations. |
| `inputText` | Complete existing `gelt.pamr-consumer-input.v1` JSON as a string, including the whole constructed artifact, configuration, portfolio hypothesis, observation and bindings. |
| `proposalText` | Required only for `verify`: the complete supplied existing `gelt.pamr-consumer-proposal.v1` JSON string. Not a detached digest, summary, receipt or wrapper. |

Unknown fields, effect operations, callbacks, loaders, arbitrary file arguments
and environment configuration are not accepted. `--describe` does not consume
stdin. The capability schema is `gelt.agent.constructed-pamr-capability.v1`,
command `constructed_pamr_proposal_data`. `dataOperations` lists the two data
operations; the separate `operations: DEFER` remains an operating hold.

`propose` calls the unchanged `proposePAMRConsumer` to validate/recompute the whole
input and returns `status: proposal_data` with the existing proposal under
`value`. `verify` first requires a computable whole input, then calls unchanged
`matchesPAMRConsumerProposal` against the entire supplied proposal. A match returns
`verified_proposal_data`, the proposal/input identifiers and the action outcome;
a mismatch returns generic `proposal_mismatch`. Parsing or resource failures are
generic bounded rejections, without reflected inputs or exception details.

Exit 0 means data computation or matching only, including valid `no_action` and
`abstain` outcomes. Exit 2 means rejection, 64 unsupported arguments, and 74
unavailable output/unexpected transport failure. Partial stdout must never be
accepted. Every result remains constructed-only, unauthenticated, unconsumed and
without effect authority, dispatch or promotion. Qualification NOT_READY,
production CLOSED, operations DEFER and C07/C13/C14 UNKNOWN remain explicit.

## Reused deterministic constraints

The original PAMR contract, validator, mathematical converter and neutral
long/cash sizing kernel are unchanged. They retain the fixed risk/reserve
adaptation, quarter-scale floored exposure, fee-inclusive order cap, exact units,
grid, costs, hypothetical modeled/limit comparison and whole-artifact lineage.
UNKNOWN/unsettled state, invalid declared clocks and unsupported positive-target
reductions remain abstentions; unsupported assets/profiles and foreign bindings
reject. No supplied portfolio hypothesis becomes actual account or fill truth.
This creates no G05 receipt or lifecycle admission; shared math is not identity.

The aggregate request budget is 262144 UTF-8 bytes. Existing artifact/input/
proposal budgets remain 180000/262144/8192 bytes; the complete response, envelope
and newline must fit 8192 bytes. The wrapper's escaped strings count toward the
aggregate cap, so a near-limit valid legacy object may not fit this interface.
That is an honest rejection, not a capacity extension, rounding or truncation.
UTF-16 is checked before encoding; the existing strict JSON parser retains
duplicate-key, depth-16 and 20000-node rejection. Supplied proposal text is not
normalized into a claimed match before authoritative recomputation.

## Shared finite transport and compatibility

`bounded-data-stdio.ts` extracts PR35's accepted transport. Its protocol object
is internal compiled-source configuration: concrete entry modules statically
bind their own description, validator and fixed limits. No wire message, argv,
environment value or plugin can provide a handler, resource policy or registry.
This is a shared I/O helper, not a general agent action dispatcher.

The five-second input/output budgets, 4096-chunk limit, fatal UTF-8 decode after
EOF, one-response write/end/finish/observed-close sequence, persistent output
error guard and generic failure behavior remain. These are transport budgets,
not financial cadence or freshness policy. Close remains an observed stream
event, not OS release, permanent validity or operating qualification. The shared
helper also enforces response size, including capability descriptions.

PR35's A64 entry and exported transport-limit identity remain compatible. Its
whole-input assessor, schema, mathematical profile, historical window, output
meaning and hold fields are unchanged. Existing A64 request/response and all
twenty transport regressions remain required; moving code is not a waiver of
its late-output-error correction. Neither entry creates files, persistence,
orders, consumption, acquisition, external network calls or operating authority.
One additional regression reproduced repeated delayed input errors escaping the
old one-shot terminal input guard. The shared owned-input guard is now retained
after EOF/timeout too; it does not reread input, retry a command or retroactively
change an already returned result. The original twenty assertions remain intact.

## Changed files and verification boundary

- New `bounded-data-stdio.ts`, fixed PAMR command and CLI entry modules.
- A64 command/CLI delegate to the same finite transport without wire changes.
- New PAMR command tests cover strict schemas, arguments, resources, privacy,
  UTF-8 and shared lifecycle/error/timeout behavior.
- Existing PAMR fixture tests exercise real proposal → agent/stdin → whole-input
  verification, forged proposal and binding rejection, UNKNOWN and unsupported
  sizing. Existing A64 tests retain rejection of actual inspection objects.
- Import accounting records source additions/hashes while preserving upstream
  identity, dependency resolutions and notices; roadmap records actual delivery
  and the dependency-ordered commissioned work.

The working focused suite passed 56 tests across four files, including PR35's
twenty stream regressions, the new input-tail regression and actual original fixtures. Two private commands
used incorrect repository/V2 prefixes and failed before their intended append
or test process; the append was performed once at the correct path and focused
tests then ran. Neither administrative error is counted as a test pass/failure
or an uncertain replay. These working receipts are not final source acceptance.
Both compiled entries also passed discovery, generic rejection and unsupported
argument checks through actual Node child stdout pipes. The three A64 response
objects match PR35's retained post-merge golden receipt; no new wire identity or
hold interpretation follows from the internal transport extraction.
The full working suite then passed all nine phases: 1802 worker/web, 18 server
and 53 script tests; worker types, Go race/vet/build, V2 build/offline smoke,
complete import accounting and diff/status checks. Twenty-eight unsupported
legacy Windows cases remain skipped. The local two-worker profile retains every
case, assertion and deadline; normal hosted tests still must pass. This receipt
precedes final specification/commit and is not exact reviewed-head acceptance.

Remaining required gates are worker types, full local tests, Go race/vet/build,
V2 build/offline smoke/import checks, complete bounded independent and distinct
adversarial source/privacy review, exact reviewed-head checks, normal hosted
Go/V2/scientific/protected-browser CI, ordinary merge and remote/post-merge
verification. Formal GitHub Approve needs its own action-time authority.

This reduces an agent-interface and deterministic hypothetical-validation gap.
It does not establish real-data coverage, strategy economics, handling/runtime
qualification, actual conversion-to-shadow operation or permission to transact.
