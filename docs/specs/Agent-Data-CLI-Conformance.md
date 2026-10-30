---
type: specification
title: Offline compiled agent data command conformance
status: source-candidate-pending-independent-review
source_baseline: 99119c5bca7e6756ed9d50095d23259b526b2b18
scope: canonical post-build test coverage, no product or operating interface change
---

# Compiled data-command conformance

[PR35](https://github.com/Zkrausman/Gelt/pull/35),
[PR36](https://github.com/Zkrausman/Gelt/pull/36) and
[PR37](https://github.com/Zkrausman/Gelt/pull/37) delivered the fixed A64
inspection, constructed-PAMR proposal and prospective-declaration data commands.
Their delivery checks exercised actual compiled child stdin/stdout pipes, but
canonical smoke verification previously did not cover those command entries.
This increment brings that proven pattern into the existing offline build/smoke
path. It creates no product command, general executor, runtime or framework.

This matters because a correct in-memory stream result does not establish a
healthy Node process exit. PR35's preserved development evidence included a
healthy stdout body followed by exit 74 when stdio flags were reread after close.
The conformance gate checks actual exit, complete output and retained meaning
together. A valid body never overrides an unhealthy exit or partial output.

## Existing execution path and fixed coverage

The existing workflow still runs full unit tests, build, smoke and the protected
browser/scientific gates. No package script, dependency, guard or workflow change
is needed. After build, `scripts/smoke.mjs` calls `verifyAgentDataCommands()` before
launching application children. An assertion failure exits smoke before those
children start. Existing application readiness, interruption, private owner,
disabled-route, cleanup and deadline assertions remain unchanged.

The standalone developer check is:

```sh
npm --prefix v2 run build:worker
node v2/scripts/agent-data-conformance.mjs --offline-test-only
```

The helper has no configurable program, command list, callback, fixture path,
resource policy or expected-exit input. Its three entries and modes are fixed:

- `a64-inspection-cli.js`, `pamr-proposal-cli.js` and
  `prospective-declaration-cli.js`: capability discovery exits 0, invalid schema
  exits 2, unsupported arguments exit 64. Nine complete response snapshots bind
  the accepted PR37 source tree and preserved A64/PAMR wire identities.
- Complete constructed initial and revised declarations exercise actual child
  pipes and canonical whole-predecessor recomputation. Mutating the supplied
  predecessor without rebinding rejects. Unknown facts remain unknown.
- An invalid UTF-8 input rejects. Passing the new declaration request and result
  through each old command rejects, preserving both identity boundaries.

There are seventeen actual child cases, separate from Vitest and script-test
counts. These are constructed data checks, not seventeen observations, consumed
decisions, strategy trials or market events. The fixtures use explicit synthetic
identifiers and old example dates; they establish no prospective time coverage.

## What fixtures cannot authorize

`agent-data-response-fixtures.json` contains only source provenance, the nine
entry/mode identities and complete expected response values captured during PR37
acceptance. It includes no actual market/account data or private source paths.
The helper requires exactly the fixed entry/mode set, no duplicates and exact
case fields. Fixture metadata cannot choose another executable or supply an exit
expectation, timeout or buffer allowance. Exits 0/2/64 and critical holds are
asserted independently in code before comparison with fixture response values.

Every case requires a direct child to finish without transport error or signal,
the correct actual exit, empty stderr, at most 8192 stdout bytes and one complete
canonical JSON response/newline decoded with fatal UTF-8 handling. The complete
preflight result field set and its canonical data fingerprint are checked
independently; generic rejection headers/statuses remain explicit. Raw synthetic
input must not be reflected.
Qualification NOT_READY, production CLOSED, operations DEFER, no effect authority,
no dispatch/promotion and C07/C13/C14 UNKNOWN remain mandatory. Declaration
responses additionally retain all sixteen unknown checks, the unknown-fact map,
zero actual history/decisions/consumption and no persistence.

Expected response fixtures are regression oracles, not authenticators or source
admission tokens. A coordinated fixture/source edit does not grant authority;
the independent critical assertions and normal complete-diff review remain
required. An intentional interface change needs an explicit reviewed baseline
update, not automatic fixture regeneration during a test run.

## Child ownership, environment and limits

Each child uses the current `process.execPath`, a fixed compiled entry, the
existing `childEnvironment()` with credentials, proxies, NODE_OPTIONS and settings
omitted, and the unchanged offline-guard preload. That guard remains defense in
depth, **not an OS sandbox or runtime qualification**. Its existing loopback
allowance is unchanged. The accepted pure command sources make no provider calls.
No broker configuration or private worker role is supplied to these test children.

Each child has a 15000 ms test timeout and 8192-byte capture bound; the harness
stops on the first failed case. Existing product input/output budgets, five-second
transport deadlines and chunk bounds are unchanged. The application smoke timer
starts after this separate conformance phase; none of its existing deadlines are
extended. Direct child completion is checked, without claiming global descendant
emptiness, permanent stream validity, handling settlement or own acknowledgement.

The helper itself launches controlled test children. It is not a product-facing
effect interface and cannot qualify the runtime in which it runs. No acquisition,
private data inspection, actual campaign, lifecycle activation, financial action,
credential/security change or paid service is introduced.

## Verification and delivery boundary

The standalone seventeen-case gate passed on the working source. A negative
control then replaced only the known ignored local generated A64 CLI with a
synthetic body writer returning exit 74. The harness correctly failed with
`capability: wrong actual exit`, even though the body was valid. The original
generated bytes were restored in `finally`, their SHA256 matched exactly, and
the positive seventeen-case gate passed again. This expected negative result
is preserved as a failure-detection control, not a positive test pass. Product
source, guard configuration and held workloads were not modified by that control.

The complete intended change set is the fixed helper, response fixture, two-line
smoke integration, this specification, import inventory and cumulative roadmap.
The first full run lost its transport and has no terminal/exit receipt. It
remains incomplete, not a pass. Read-only reconciliation found no original driver
or log handle and the old session was unavailable; no global descendant-empty
claim follows. A fresh separately recorded run with explicit process ownership
metadata passed all nine phases. Final self-review then strengthened fatal stdout
decoding and complete preflight-body validation before the final full rerun.
Both expected-failure detector controls and byte-restored positive runs remain
preserved. The final working run passed all nine phases: 1821 worker/web, 18
server and 53 script tests; worker types; Go race/vet/build; V2 build, smoke with
the new seventeen-case marker, import accounting and diff/status checks.
Twenty-eight unsupported legacy Windows cases remain skipped; the local
two-worker profile keeps the same cases, assertions and deadlines, with normal
hosted tests still required. The smoke log includes its existing intentional
occupied-port/secure-setup negatives followed by both success markers; those are
expected fail-closed tests, not waived failures. These pre-commit working receipts
precede final source review and do not replace post-review exact-head verification.

Fresh independent and distinct adversarial source/privacy review, applicable
full Linux tests/types/Go race/vet/build/V2 build/smoke/inventory, normal hosted
Go/V2/scientific/history/research/G01/G03, ordinary PR/CI/merge and remote/post-merge
verification remain mandatory. Formal GitHub Approve retains its separate
action-time requirement. All actual checks/qualification remain UNKNOWN/NOT_READY;
production CLOSED and operations DEFER. Successful conformance establishes source
interface behavior only, not source authenticity, strategy economics, permission
to transact or operating readiness.
