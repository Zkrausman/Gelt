---
type: Specification and Completion Report
title: G03 native expiry-corruption reopen failure evidence
description: Test-only sanitized failure provenance without changing storage or acceptance semantics.
timestamp: 2026-10-12T00:00:00Z
status: diagnostic-candidate-awaiting-complete-review-and-exact-head-ci
---

## Failure and approved increment

G03 PR3 merged as `2892b8a8e383824b63c478e8231deeeb3e9274b6`, tree
`e229adbf82d6a608869919e687864b2e8c903a81`. Its exact candidate passed all
four required checks. Integrated Go run `38318643380` and V2 Linux/browser and
scientific checks passed; integrated native Windows check `115041197101` in
run `38318643449` failed the exact-expiry corruption reopen assertion. It
expected `synthetic mock storage unavailable` and received `ledger unavailable`.
414 worker tests passed, 9 platform skips; build and smoke were skipped.
That failed run remains evidence, not accepted runtime or a rerun target.

The fixed fixture clock and persisted timestamp make expiry rejection
deterministic. Source tracing and both original read-only reviewers confirm
that the retained generic message cannot distinguish facts-ledger construction,
mock-ledger construction, or mock atomic validation replacing replay's error.
Neither timing nor the same-tree passing candidate proves a helper timeout.
This increment establishes failure provenance; it is not a functional fix,
runtime acceptance, autonomous-agent acceptance, or owner-consumption proof.

## Implementation and invariants

`synthetic-reopen-diagnostics.ts` keeps a weak, in-memory error association gated
by `NODE_ENV=test` and both existing exact isolated harness/mock opt-ins. It
captures a fixed phase vocabulary, error replacement, replay failure and whether
the persisted acceptance invariants actually rejected corruption. It reuses the
existing allowlisted storage stage/operation/check/kind diagnostic. It adds no
error fields, public response, storage artifact, credentials, paths, exception
text or payloads. Only the affected test writes a bounded synthetic JSON receipt
to test output, before matcher failure or existing cleanup; that receipt adds
the mock-marker existence boolean.

The same error object is rethrown. Every existing storage validation, transaction,
poisoning rule, ownership retention, corruption matcher, marker assertion and
cleanup path remains. In particular, final validation still replaces an earlier
work error when it fails; the receipt reports that fact rather than changing it.
No timeout, retry, accepted error class, auth, execution or provider behavior is
changed. Initial facts/mock construction phases and mock initial/transaction/
replay/final/post-validation phases identify the evidence boundary.

Changed files are the new diagnostic helper and focused tests, the existing
synthetic mock store, fixture harness and affected corruption test, this
specification, and refreshed import accounting. Three pure diagnostic tests
cover exact thrown identity, closed-vocabulary redaction, error replacement with
corruption provenance, success preservation and opt-in absence. They create no
listener, SQLite fixture, key material or runtime process.

## Verification and closeout boundary

Pure import inventory and whitespace checks precede the complete final review.
Both original independent and adversarial reviewers must inspect the entire
base-to-candidate diff and named error/storage/caller seams. No changed-head
CI executes before their clean source reviews. Every remediation starts a new
complete review. Exact-head Go build/race/vet, V2 unit/build/smoke, scientific,
Linux protected-browser and native Windows gates remain required. Candidate
results and any later integrated result are recorded separately on the PR and
delivery receipts; no previous pass overrides the failed integrated gate.

No local listener/ownership/cleanup probe, dependency installation, held owner
acceptance, provider call or unchanged Windows rerun is authorized by this
diagnostic source increment. Hosted changed-head CI exercises the existing
approved gate after review. A new receipt may establish the specific failing
storage phase; if the case passes, it establishes only the observed successful
corruption rejection, not the previous failure's root cause. A functional change
requires actual causal evidence and its own complete review and required gates.
