---
type: specification
title: Agent A64 inspection command
status: source-candidate-pending-independent-review
source_baseline: 0c65b9e54beefd9b7a3f0db5158f5f12c1a00cef
scope: bounded read-only agent interface to the existing data-only assessor
---

# Agent A64 inspection command

The owner commissioned continued source-level development toward agent-first
operation. This increment exposes PR33's whole-input data assessor as one finite
machine-readable command. It provides usable discovery, stdin, response and exit
contracts without introducing an execution agent, provider, persistence or order
interface. The human UI remains an oversight surface; charts are deferred unless
they answer a concrete decision or explanation.

## Invocation and meaning

Build the existing worker with `npm --prefix v2 run build:worker`, then invoke:

```sh
node v2/worker/dist/a64-inspection-cli.js --describe
node v2/worker/dist/a64-inspection-cli.js < permitted-inspection-input.json
```

The second command reads one complete UTF-8 JSON document from stdin. Its schema
is the existing `gelt.pamr-a64-inspection-evidence-input.v1`, containing complete
`artifactText` and `contextText` strings. The shell may redirect a permitted local
file; this command accepts no filenames, file-write flags, environment-supplied
configuration, credentials or arbitrary actions. `--describe` does not read stdin.
Extra arguments are rejected without reflection.

Discovery uses `gelt.agent.a64-inspection-capability.v1`. The response uses
`gelt.agent.a64-inspection-response.v1` and the fixed command identity
`assess_a64_inspection_evidence`. A successful result has `status: assessed_data`
and the existing complete assessment under `value`; a failure has
`status: rejected` and a bounded reason. Artifact/context bytes, private paths,
proposed epoch IDs and raw exceptions are not emitted. Existing hashes remain
data bindings, not authentication. Callers must inspect the complete JSON and
exit status; partial stdout or zero status alone is never an admission record.

| Exit | Contract |
| --- | --- |
| 0 | Complete data assessment or `--describe`; neither permits operation. |
| 2 | Input, transport, encoding, resource, artifact or binding rejection. |
| 64 | Unsupported arguments; stdin not consumed. |
| 74 | Output unavailable or unexpected transport failure; no success claim. Do not accept partial stdout. |

Every response preserves no effect authority, disabled dispatch/promotion,
qualification NOT_READY, production CLOSED, operations DEFER and C07/C13/C14
UNKNOWN. Successful assessments retain all sixteen inherited checks with their
existing structural-only interpretation and actual unknowns. No decisions,
consumption, durable reservation, lifecycle activation, clock authentication,
runtime/handling qualification or actual supplier/account evidence is created.
The existing historical window, exact ratios, mathematics, source identities and
constructed-consumer rejection are unchanged.

## Finite resources and failure handling

The command retains the assessor's 262144-byte aggregate, 180000-byte artifact,
8192-byte context and 8192-byte output limits. The output envelope and final
newline count toward the output budget. The existing strict parser retains
duplicate-key rejection, depth 16 and 20000-node limits. Complete input is decoded
once after EOF, with fatal UTF-8 decoding across chunk boundaries; no replacement
characters, primitive coercion or partial assessment is accepted.

The CLI additionally bounds stdin to 4096 chunks and five seconds, and output
completion to five seconds. These are local transport resource limits, not
financial cadence, calendar availability or strategy-observation policy. Stalled,
errored, prematurely closed or oversized input is stopped, owned stdin is closed,
and a generic rejection is emitted. Output is attempted once, then ended. Success
requires the write callback, stream `finish` and observed owned `close` within
the same five-second budget. The stream is explicitly destroyed after finish
to include cleanup/destruction failures; premature close and errors/timeouts
return 74 without raw exception details or retries. A guarded error listener
remains on that owned stream after terminal close/timeout so delayed callbacks
or repeated errors cannot expose a stack. Errors after observed terminal close
are suppressed, not claimed to retroactively change an already returned exit
status or prove permanent validity of a downstream consumer.
Node's standard-output wrapper can reset its mutable stream flags during
destruction. Completion therefore uses the recorded callback/finish/close event
sequence, not flags re-read after close. A real retained-Node child/pipe probe
observed that reset; compiled CLI discovery and generic rejection/usage checks
passed after the correction. Observed close is a stream-lifecycle event, not an
operating-data handling or OS-release attestation.
No unowned process or file is stopped or removed. Ordinary stdin/stdout I/O is
not described as absence of all I/O; the no-effect claim concerns acquisition,
persistence and execution authority.

## Changed interfaces and tests

- `v2/worker/src/a64-inspection-command.ts`: fixed capability/response envelope,
  direct whole-input assessor invocation and response-byte bound.
- `v2/worker/src/a64-inspection-cli.ts`: finite stdin/stdout transport and compiled
  entry point; importing the module does not start the CLI.
- `v2/worker/src/a64-inspection-command.test.ts`: discovery, arguments, duplicate/
  legacy/multiple JSON, exact resource boundaries, invalid/split UTF-8, input
  timeout/error/close and output error/timeout/once-only failure tests.
- `v2/worker/src/pamr-a64-inspection-evidence.test.ts`: reuse the existing complete
  constructed fixture for real assessor → command → stdin response equality,
  forged binding rejection, privacy and unchanged holds. This is not actual input.
- `v2/IMPORT-MANIFEST.json`: complete current source hashes/addition provenance;
  no upstream identity, dependency or notice changes.
- `docs/ROADMAP.md`: commissioned agent-first source queue and dependencies.

## Verification and delivery boundary

The initial compiler check caught a duplicate persistence property in discovery;
it was corrected by distinguishing `persistenceEffects` from the inherited
`persistence: not_performed` assessment hold. One subsequent compiler invocation
used an incorrect doubled `v2` path and failed before compilation; it is not a
test or pass. The correct worker compilation passed. Thirty focused tests and
three compiled-entry checks passed on the working candidate: discovery, generic
invalid-input rejection and unsupported arguments, without reflected sentinels.
These receipts predate final source review and are not exact-final-head success.

The complete working candidate then passed all nine local verification phases:
1786 worker/web tests, 18 server tests and 53 script tests; worker compilation,
Go race/vet/build, V2 build, offline smoke, complete import inventory and diff/
status checks. Twenty-eight retained Windows tests are unsupported skips. As in
PR34, the local full-suite profile uses two workers with every original case,
assertion and per-test deadline unchanged; hosted CI's normal command remains
mandatory. The final specification receipt was added after that working run;
exact reviewed-head and post-merge verification are still required.

The first complete independent review approved the bounded source. The original
distinct adversarial reviewer found one MEDIUM: removing the output error guard
after a successful write callback could expose later exception details. Seven
new lifecycle regressions failed against that original source, including async
destruction error, premature close, stalled finalization, missing close and late
callback/repeated error cases. The grouped correction above retains the guard
and observes bounded finish/close. All 37 focused tests then passed with the real
whole-input assessor and existing fixture; original reports, failures and prior
byte-audits remain preserved. Bounded correction confirmation by the original
reviewers, full corrected-head verification and ordinary delivery gates remain
required. No previous source approval is silently carried over to this change.
The first cleanup correction rejected a healthy compiled stdout pipe because it
re-read reset flags; that failed check is retained. A private shell chain also
started a working suite after that failure; the exact owned invocation and its
children were stopped and recorded as cancelled, never a pass. Corrected checks
run under failure-stopping orchestration. No other assignment was interrupted.
The corrected working revision subsequently passed all nine local phases:
1793 worker/web tests, 18 server and 53 script tests, worker compilation, Go
race/vet/build, V2 build/offline smoke/import/diff checks. The same two-worker
local profile, assertions and deadlines remain; normal hosted tests and exact
post-confirmation and post-merge gates are still mandatory. This working receipt
precedes final specification/commit and is not corrected-head acceptance.

Mandatory remaining gates are complete applicable local tests, Go race/vet/build,
worker types, V2 build/offline smoke/import accounting, fresh independent and
distinct adversarial accuracy/privacy source review, exact-head verification,
ordinary draft PR/hosted CI/merge and remote/post-merge verification. Source
changes after review require a bounded fresh review with sufficient dependency
context. No formal GitHub Approve is granted by standing delivery authority.

This increment reduces the machine-interface gap. It does not establish actual
Paper2Agent conversion, operating qualification, shadow/paper/live evidence,
economic performance, capital authority or readiness for the year-end target.
