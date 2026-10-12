---
title: "🔒 [ZAR-240] private durable offline synthetic intent journal"
ticket: ZAR-240
status: partial-implementation-unverified
candidate_status: UNVERIFIED
persistence: implemented-unverified
startup_or_transport_wiring: false
process_crash_atomicity: unproven
import_manifest: operator-refreshed-82-upstream-410-candidate
verification: partial-operator-local-node24
---

# 🎯 What

This candidate adds a worker-private SQLite journal for offline synthetic
companion intent reservations. It remains a partial, UNVERIFIED increment. The
journal is not constructed by worker startup and is not connected to the
synthetic preview kernel, loopback transport, BFF/UI, a provider, or any broker.
No listener, credential path, order state, or execution capability is added.

Explicit provisioning creates a separate `synthetic-companion-intents`
directory and `synthetic-companion-intents.sqlite` file. Opening requires that
path and an existing, trusted, physically distinct execution-ledger directory;
it neither creates a missing journal file nor initializes a pre-created empty
version-0 database. Only explicit provisioning may initialize version 0. The implementation reuses the
worker's one-connection `LedgerStorage` conventions: WAL, synchronous FULL,
private native metadata checks, and a persistent non-stealable ownership marker.
The new database has a distinct application ID, fixed schema/migration, and
persisted worker-owner binding.

Reservations run in an IMMEDIATE transaction. Every open/read/write validates
the actual schema and integrity and canonically decodes and validates all
stored intent facts inside the transaction. One session digest can reserve only
once regardless of later identity or terms; 64 unexpired rows are retained and
the 65th is rejected without eviction. Expired rows may be removed only after
their persisted expiry. Revocation updates an existing row's tombstone bit and
never accepts caller expiry; an absent row is not synthesized. `committed` is
returned only after the SQLite transaction returns and post-commit metadata
validation succeeds. Storage, validation, and uncertain-transaction failures
poison the handle, return `unknown`, and retain the writer marker.

Intent source associations remain commitments to expected synthetic labels,
not actual source/account attestation. No provider fallback is introduced.
Existing synthetic preview results continue to declare `brokerFacts: false` and
`execution: false`.

# ⚠️ Risk and limits

The focused real-file regression suite was authored before the journal module,
but Squire did not run it red or green. In separate operator integration, the
first focused run failed 7/7 storage tests solely because the required private
fixture parent was missing (the original in-memory 8/8 passed). With an explicit
private parent, a one-test storage run passed 1/1 in 46 seconds; a broad run
timed out at 180 seconds after printing the in-memory 8/8 result. After an
independent candidate review found a P1 existing-empty-file initialization and
P2 lexical-only separation, the operator corrected those paths; focused
negative tests passed 2/2, and the alternate-identity test passed 1/1.
A later, materially instrumented test-only capacity run wrote private JSONL milestones outside Vitest output. On native Windows Node24 it reached 64 committed reservations after ~265s and passed the 65th-capacity and clean-reopen checks in 297s; the then-nine-test real-file storage file passed 9/9 in 510s under an explicit 600s deadline. After independent review, a tenth targeted expiry-boundary/tombstone-retirement real-file test passed 1/1 in 51s; the expanded ten-test file subsequently passed 10/10 in 619s under a separate 720s deadline on native Windows Node24. Earlier failures and timeouts remain failed/timed-out, not converted into passes. Its committed regression still reopens a journal handle in the same test process. A separate **private operator diagnostic** performed a clean child-process close/reopen (duplicate), and a deliberate child `process.exit(23)` after commit (row persisted, writer marker retained, reopen rejected). That probe is not a tracked regression or proof of power-loss/in-flight transaction recovery, and there is no committed final-head review yet. A fresh full-delta review and focused correction re-review found no remaining issue for a partial PR. A later full native-Windows `npm --prefix v2 test` attempt exceeded a 25-minute operator bound without a suite exit; its partial log and timeout receipt remain failed/indeterminate evidence, not a pass. The ambiguous acknowledgement case wraps a real committed
SQLite write and then reports `unknown`; it tests no-retry/fail-closed behavior,
not an injected SQLite commit failure. No process interruption, power-loss,
filesystem-flush or crash atomicity claim is made.

Provisioning/opening code is not wired into a reviewed worker lifecycle or an
operator provisioning CLI. Native Windows local real-file tests passed separately;
independent native Linux execution, in-flight crash/power-loss recovery,
concurrent process ownership, and exact-head hosted checks remain unproven. The module depends on existing `LedgerStorage` security conventions;
this candidate's checks were not executed here. The immutable earlier candidate
and its receipts are historical and do not validate this storage implementation.

# 🛡️ Solution and remaining gates

`v2/worker/src/synthetic-companion-intent-storage.ts` provides the separately
provisioned durable journal. `v2/worker/src/ledger-storage.ts` gained an opt-out
for implicit main-file creation so reopening a missing journal fails closed.
`v2/worker/src/synthetic-companion-intent-storage.test.ts` uses a real private
SQLite file for alternate-identity/changed-terms uniqueness, clean handle
reopen, revocation with persisted expiry, 64/65 capacity, an ambiguous
post-commit acknowledgement, and noncanonical stored-fact rejection. The tests
are separate from the previous in-memory contract-model tests.

Squire's immutable candidate did not refresh the import manifest and ran only
`pwd && ls`, although other commands were allowlisted; it did not attempt them.
The separate operator integration refreshed the manifest for its changed local
files and `verify:import` passed with 82 upstream and 410 candidate files. That
operator check does not retroactively verify Squire's immutable candidate.

# Changed files

- `v2/worker/src/ledger-storage.ts` — optional fail-closed refusal to create a
  missing main database file.
- `v2/worker/src/synthetic-companion-intent.ts` — clarifies the durable adapter
  implementation and continued unwired status.
- `v2/worker/src/synthetic-companion-intent-storage.ts` — private SQLite journal,
  explicit provisioning/opening, transaction-local canonical validation,
  capacity, revocation, and poisoning behavior.
- `v2/worker/src/synthetic-companion-intent-storage.test.ts` — real-file targeted
  regression suite (native Windows expanded full file 10/10 after an earlier
  9/9 receipt); optional test-only external milestone logging is inert without a diagnostic environment path. Tracked
  process/crash tests remain absent.
- `docs/specs/ZAR-240-Synthetic-Companion-Intent.md` — candidate status, limits,
  changed files, and verification disposition.
- `v2/IMPORT-MANIFEST.json` — refreshed and verified in separate operator integration;
  absent from the immutable Squire candidate.

# ✅ Verification and handoff

**Squire candidate:** only `pwd && ls` ran; all listed focused tests, typecheck,
import refresh/verifier and Go race were **NOT RUN**, not blocked by command policy.
**Separate operator integration:** `npm --prefix v2 ci --offline`, worker typecheck,
import verification (82/410), `go test -race ./...`, V2 production build,
targeted 2/2 new negative and 1/1 alternate-identity storage tests passed on
local Windows Node24. The first unconfigured-fixture storage run failed 7/7; a configured broad run
timed out at 180s. A later bounded full storage run finished in 329s with 8/9
passing: the 64/65 test failed at `synthetic intent unavailable` while its
one-minute expiry was too short for slow native Windows private-storage checks.
The capacity test now uses a 15-minute expiry. Its first isolated run timed
out at 265s without a result, followed by a 360s diagnostic timeout whose
Vitest output did not reveal per-iteration progress. An external private JSONL
probe then measured ~4.1s per commit (25 successful commits before its 120s
deadline); a justified longer isolated run passed 1/1 in 297s, and the then-nine-test
real-file storage file passed 9/9 in 510s under a 600s bound. A subsequently
added expiry-boundary/tombstone-retirement test passed separately 1/1 in 51s;
the expanded full-file then passed 10/10 in 619s under a separate 720s bound.
Private stdout SHA-256 `783ca1f35106062c10ddf88eee465c9dbc5e69e8c8760e3562716200d773d3bc`;
exit receipt SHA-256 `f1a45884465c6b4722e86f2fb4683101cfb5f0985c89ddc60b8804c85fd64f06`. The
full-suite receipt and per-operation JSONL remain private. A separate private
normal/abrupt child-process probe established persisted row and fail-closed
writer-marker behavior after `process.exit(23)`, not power-loss or in-flight
atomicity. All earlier failed and timed-out receipts remain failures. No
red-before test against the absent adapter, complete local native-Windows
`npm test` pass, native Linux validation, committed final-head review, hosted
exact-head CI or merge-tree/merge gate is claimed.

Pending: tracked process/crash/ownership regressions, native Linux/Windows
exact-head checks, independent full-head review and merge-tree verification. Do not publish this partial integration as completed durability. Historical Node24 cumulative
ledger failure and earlier failed receipts remain unresolved and unchanged.
ZAR-240, ZAR-239, ZAR-238, and ZAR-219/M8 remain open.
