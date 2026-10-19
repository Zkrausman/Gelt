---
type: specification-closeout
title: Original-process unverified Alpaca candidate mode
date: 2026-10-19
repository_id: 1415613140
base_commit: 1b2ad846df7782e413c6471e3b455dfa8d02e7dc
status: source-review-candidate
actual_provider_access: false
---

# Original-process unverified candidate mode

## Delivered source boundary

The capture-only command drops its original acquisition before returning. A
serialized summary cannot later satisfy the normalizer's module-private issuance
check. The separate `scripts/alpaca-iex-candidate-once.mjs` entry point instead
passes the original verified connector object directly to the existing
`buildAlpacaShadowCandidate` before dropping it. That builder invokes the existing
normalizer, evaluates strict canonical G05 bytes, and verifies their receipt.
There is no reconstructed acquisition, arbitrary callback, plugin or data sink.

The existing capture command is byte-for-byte unchanged: SHA256
`e6077219f639118593e6e7950ad98357385db45c55ecb33e3743fd6a7f152cb9`.
Its CLI, approval schema, frozen request and capture-only success meaning remain
separate. The new mode is inert on import; `--describe` emits only the original
fixed proposal without loading worker modules, reading a record or requesting
data. The operation flag is `--candidate-once`, followed only by `--data-dir`
and `--approval-record` absolute private paths. No endpoint, adjustment, output,
callback, retry or alternate-source option is added.

The request remains SPY/IEX/USD/1Day/raw, descending, inclusive
`2025-10-15T04:00:00.000Z` through `2026-10-16T04:00:00.000Z`, symbol mapping
`asof=2026-10-16`, and exactly the existing 253 proposed sessions. Request SHA256
is `4cfa86f403460f4dadcf5238f01fa19a75f1ec3c5668ab885130bb5744d90b1a`.
The existing connector retains its maximum three GETs, 100 rows/page, 512 KiB/page,
ten seconds/page, no redirects, retries or fallback. Source implementation and
publication authorize no actual invocation, stored-key access or new acquisition.

## Distinct preflight and owned plan

A future invocation requires a separately reviewed action-time record with schema
`gelt.alpaca-iex-candidate-once-approval.v1`. The old capture approval is rejected.
The strict duplicate-key-rejecting record has the original command/request/path,
repository, calendar/completion, rights, finite-retention and action-evidence
fields, but `commandSha256` must identify this new entry. It additionally requires:

| Field | Required meaning |
| --- | --- |
| `candidateContext` | Exact existing `AlpacaShadowCandidateContext`: run/source assertion, expected calendar digest/window, rights, policy/schedule/freshness, costs/stress, passive/cash and portfolio context; no fabricated defaults |
| `availabilityBasis` | Literal `final_connector_receipt`; never historical provider finality |
| `availabilityEvidenceSha256` | External evidence assertion for the explicit receipt-based availability convention |

The context rights reference must equal the record rights reference. The context
must bind the record's recomputed calendar digest and local ordinals 0..252/count
253. This does not establish G06 global runner ordinals or calendar authenticity.
All required context is parsed from bounded owned bytes and recursively frozen
before any asynchronous notice, credential or connector boundary. The prepared
plan has process-local identity and is consumed on one valid original-object
handoff. Copies cannot substitute for it. Missing or malformed context blocks
before the credential reader or connector. No plan or approval file is created
by this entry. Hash-shaped references bind supplied assertions; they do not
prove their truth, rights, retention or admission.

After capture, the mode obtains a new decision timestamp. Each supplied session's
availability is set to the original final connector receipt under the explicitly
selected convention, not to its historical date. The unchanged normalizer requires
receipt/completion <= availability <= decision. A backwards decision clock fails.
This establishes structural consistency only; no historical knowledge or provider
creation time is inferred. A prospective lookback and historical decision replay
have different evidence requirements.

## Runtime and output restrictions

The same private-path protections apply: bounded 256 KiB record, owner-only 0600
single-link regular file beneath a safe 0700 directory, no symlink ancestors,
and approval outside the credential directory. Linux, trusted Node 22 and an
externally clean launch are required. **A trusted absolute `/usr/bin/env -i`
must clear the environment before the trusted absolute Node binary starts.**
JavaScript cannot undo preloads already executed by Node. The in-process check
permits only PATH/LANG/LC_ALL/TZ and no Node flags before worker imports.

Before imports, 27 literal hashes bind the existing credential/connector closure,
new candidate/normalizer/rule closure, Zod ESM/package boundaries, worker package,
and unchanged capture script. The existing verifier rejects missing, changed,
symlinked or oversized artifacts and dependency/package shadows. Node built-ins
and the new entry itself belong to the externally reviewed trusted launch.
No hostile concurrent artifact writer may be present; hashes are not an OS
immutable snapshot. Dependency/compiler changes require new source/digest review.
No build, download, permission change or credential modification is automatic.

A constant notice and queued-output-error checkpoint precede the one existing
credential-helper read and one connector call. The original capture then passes
byte verification, exact count/calendar matching and one candidate handoff. The
bridge must return its exact replayable `market_shadow_input/unverified`
`abstain/unverified_data` receipt, with no effect authority or promotion.

Only fixed source/request/calendar identities, counts, actual receipt/decision
times and constant diagnostic result fields are emitted. Success schema is
`gelt.alpaca-iex-candidate-summary.v1`, status
`candidate_unverified_memory_only`; the summary includes `freshness=not_established`,
`signalCompatibility=raw_not_adjusted` and
`g06Compatibility=constructed_only_consumer`. It never exposes candidate input,
prices, raw pages, page/dataset/receipt hashes, headers, cursors, credential values
or hashes, provider error bodies or exception objects. Failure is a constant
preflight/acquisition category, nonzero exit, no retry or fallback.

The candidate, normalized bars and raw capture remain within the single process.
Only sanitized metadata crosses stdout. No market-data file, report, telemetry,
cache or durable replay record is written. References are dropped and the process
ends; this is not secure RAM erasure, an OS swap/core-dump guarantee, or a hard
whole-process lifetime deadline. One-shot is per invocation, not a durable reuse
lock. Publication does not authorize repeating an earlier acquisition. Any future
invocation remains human-terminal-only under the existing secure-auth boundary.

## Remaining actual delivery dependencies

Raw is unadjusted; the normalizer's `adjustedClose` field name copies exact close
tokens and does not adjust them. G05's approved adjusted-close rule and G06's
`gelt.spy-long-cash-paper-policy.v1` all-adjustment mapping are preserved. No raw
capture is relabeled, transformed, promoted or admitted. A compatible adjusted
253-close input still needs actual corporate-action convention/coverage, truthful
availability, rights/finite-use evidence and justified policy/economic context.
`asof` is symbol mapping, not an adjustment knowledge cutoff; see the retained
[Alpaca bars reference](https://docs.alpaca.markets/us/reference/stockbars).
No new source/acquisition route or raw-plus-factors transform is selected here.

Candidate success does not establish freshness: G05 returns `unverified_data`
before its later freshness check. Future freshness admission requires explicit
checks/evidence. Existing G06 sizing/config/portfolio/selection accepts constructed
fixtures only. This mode never calls or relaxes those APIs, the order harness,
simulator, runner, lifecycle, UI or broker. Genuine G06 and dependent G07/G08
acceptance remain blocked on their actual input, admission and runner obligations.

## Changed files and verification

The change contains this specification, the new entry, the new worker plan/handoff
module and its synthetic tests, the additive export of the existing candidate
context schema, and `v2/IMPORT-MANIFEST.json`. No dependencies, lock, workflow,
request, credential helper, normalizer, strategy rule or G06 contract changes.

Initial verification: retained-lock worker compilation passed; 51 new synthetic
cases and 140 focused cases across the new mode, capture command and candidate
bridge passed. Tests use the real connector/normalizer/candidate with injected
fake HTTP responses and synthetic key strings only. They check original-object
identity, fixed paging/request, strict preflight/no-request failures, context
snapshotting, clone/summary/plan substitution, backwards time, permanent
abstention, output redaction and stop-without-retry. No real credential or provider
operation is exercised. Exact final reviews, remediation and post-review results
are retained in the delivery receipts, not asserted ahead of execution here.
Normal Go build/race/vet, Linux V2 tests/build/smoke, scientific and applicable
protected-browser gates remain required on exact candidate and integrated source.

Initial self-review caught a source-startup ordering defect: static reuse of the
old capture script would execute that dependency before checking its hash. The
new entry now contains its own fixed request/calendar and bounded verifier; no
source or worker module is imported before the integrity gate. The old entry
remains unchanged and separately pinned. Synthetic byte/symlink/shadow regressions
exercise the independent verifier, and a source assertion excludes the early
capture-script import. Fresh reviews cover this complete remediation.

The independent review also found that the handoff helper had treated a capture's
own `asof` as its expected mapping date. It now checks every fixed request field,
including `asof`, start/end, raw adjustment and identity, before consuming the
prepared plan. Original connector objects with another mapping date or shifted
window reject. A valid original object still works after an `asof` rejection,
showing that a mismatched request did not consume the valid prepared plan.
