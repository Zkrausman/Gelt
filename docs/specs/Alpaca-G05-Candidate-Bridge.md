---
type: specification-closeout
title: Alpaca to G05 in-memory candidate bridge
status: candidate-awaiting-independent-reviews-and-hosted-checks
date: 2026-10-15
repository_id: 1415613140
base_commit: 17a745bf152d7295b6ea44d3348b8160af21e351
base_tree: 4d70dab852fd35db2f4fe406e6c4c0395cec640b
execution_enabled: false
---

# Alpaca to G05 in-memory candidate bridge

## What changed

`buildAlpacaShadowCandidate(acquisition, normalizationInput, context)` assembles
the existing connector-issued capture through the shipped
`normalizeAlpacaIexBars` seam, checks the caller-frozen calendar digest and
window bounds, builds strict canonical G05 input, evaluates it through the
existing `evaluateShadowRule`, and verifies the result with
`matchesShadowRuleReceipt`. It neither acquires data nor reads a clock, account,
credential, or file.

The API requires a strict context containing a run ID, a G05 source-commit
assertion, the expected calendar digest and ordinal/count window, and explicit
rights, policy, costs, controls, and portfolio fields. Missing fields produce a
sanitized blocked result with the missing field paths and no G05 payload. Extra
or malformed fields block the candidate. A distinct immutable PR13 connector
pin records repository 1415613140, reviewed source
`b2a13a02430dc1d650d641648e3ed28d0d45834b`, merge commit
`17a745bf152d7295b6ea44d3348b8160af21e351`, and tree
`4d70dab852fd35db2f4fe406e6c4c0395cec640b`. The caller's `sourceCommit` is
preserved separately as a G05 input assertion; the bridge does not authenticate
that assertion.

The candidate fixes `classification=market_shadow_input`,
`eligibility=unverified`, `effectAuthority=none`, and `promotionAllowed=false`.
It has no promotion field or switch. Therefore every schema-valid candidate's
existing G05 receipt must be a valid, exact-replayable `abstain/unverified_data`
receipt. The seven admission gates are reported independently and remain
`not_established` for every result:

| Gate | State |
| --- | --- |
| A1 source and use rights | `not_established` |
| A2 finite retention | `not_established` |
| A3 eligible 253-observation window | `not_established` |
| A4 exact provenance | `not_established` |
| A5 schedule and freshness | `not_established` |
| A6 cost, stress, passive and cash evidence | `not_established` |
| A7 initial portfolio and risk context | `not_established` |

## Candidate identity and bounds

The non-self-referential data body binds the fixed PR13 source pin, supplied
G05 source-commit assertion, normalizer schema, symbol, USD/IEX/1Day identity,
adjustment and `asof`, exact request and cursor digests, ordered page hashes and
lengths, receipt time, calendar digest, and canonical normalized-bar digest.
`datasetSha256` hashes that canonical body. A separate point-in-time body binds
the dataset digest, decision/receipt times, expected window, full supplied
calendar and availability facts, and the normalizer's availability digest;
`pointInTimeEvidenceSha256` hashes that body. The G05 bytes contain normalized
bars and hash references only. Raw response bodies are not included in the
candidate manifest or G05 bytes. The manifest records page references and
explicitly grants no retention authority. It has no self-hash.

The bridge preserves the normalizer's process-local issuance requirement and
its byte/token/calendar/availability checks. It also compares the frozen
calendar digest and window bounds with the normalized bars. A shorter complete
series can form a warm-up candidate and still abstains first as
`unverified_data`; a candidate never declares that a short series is eligible
for a long/cash result. A self-consistent caller calendar remains an assertion,
not evidence that all expected exchange sessions are present. If both the data
and frozen declaration are changed together in a separately issued synthetic
capture, the result is another unverified candidate and A3 remains unresolved.

The G05 input is canonicalized and checked against the existing 256 KiB limit
before evaluation. The result exposes the canonical input as a string rather
than a mutable buffer, an immutable parsed input/receipt, and the exact replay
comparison result. Receipt dataset evidence recomputed by G05 remains distinct
from the bridge's `input.data.datasetSha256`.

## Safety boundary

This change adds no provider invocation, credential handling, durable storage,
retention/deletion task, scheduler, rule or sizing change, simulator, lifecycle,
order dispatcher, UI, launcher, dependency, workflow, accepted-data promotion,
or G06/G07 authority. Hashes and caller declarations bind supplied values but
do not authenticate rights, source truth, exchange calendar coverage, historical
availability, cost calibration, controls, or portfolio state. No actual
market data, provider request, credential, account, or trading path is involved
in the tests.

The separate provisioning helper remains a static local recipe. There is no
shipped CLI or UI for key entry. The actual Node 22 binary, compiled artifact,
and TTY paths remain unverified and were not executed for this change. This
candidate bridge does not call the provisioning helper.

## Changed files

- `v2/worker/src/alpaca-shadow-candidate.ts`
- `v2/worker/src/alpaca-shadow-candidate.test.ts`
- `docs/specs/Alpaca-G05-Candidate-Bridge.md`
- `v2/IMPORT-MANIFEST.json`

## Synthetic acceptance cases

The new offline test file covers the approved C01–C09 cases with injected fake
transport and synthetic values only: exact large decimal preservation and
receipt replay; missing/extra context; duplicate-key and exponent raw JSON plus
copy/tamper rejection; backdated capture, calendar, chronology, and availability
rejection; short warm-up, frozen-window mismatch, and the 254-observation cap;
price, adjustment, and availability revision identity; raw page bodies above
256 KiB excluded from G05 input; promotion/authority-field rejection; and
separate constructed G05 warm-up, stale, UNKNOWN, cost, long, and cash outcomes.
Those constructed G05 cases do not relabel connector-derived data. The schema's
bounded field sizes make a valid bridge input over 256 KiB unreachable today;
the implementation still fails closed if serialization exceeds the existing
limit. The transport tests use the synthetic `AAPL` label and consecutive
calendar days, including weekends; this is not a selected instrument or an
exchange/provider calendar. All rights, availability, policy, cost, control,
and portfolio hashes and values in these cases are invented test assertions,
not accepted evidence.

## Verification and closeout

Source and test files were authored against the exact shipped seam APIs. The
implementer did not run tests, builds, import-manifest verification, or runtime
probes in this environment, per the delegated execution boundary. All runtime
verification and complete-diff reviews are pending the parent-owned hosted CI
and review loop. No verification pass is claimed here. The candidate remains
disabled and provides no execution authority.
