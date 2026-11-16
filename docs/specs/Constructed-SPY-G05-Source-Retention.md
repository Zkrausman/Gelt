---
id: constructed-spy-g05-source-retention
status: implementation-prepared
classification: constructed_offline_test
authority: none
market_evaluation: not_established
promotion_allowed: false
verification: prior_partial_run_stale_after_test_correction
---

# Constructed SPY/G05 original-source retention

## Purpose and limits

This is a separate, explicit archive for one caller-supplied constructed
synthetic case. It retains the complete outer input to the existing
projectConstructedSpyG05 projector, including the original daily request text
and the consumer configuration, historical portfolio, observation, controls,
and evaluation time. A read or reopen recomputes the daily assessment and full
projection from the exact retained bytes and compares them with the stored
projection and receipt.

The archive does not establish source authenticity, market-data rights,
calendar or finality truth, revision completeness, availability, calibrated
economics, runtime qualification, campaign admission, or promotion. It does
not add provider access, credentials, an order path, or a public route. The
existing projection continues to report
sourceRetention: hash_link_only_in_legacy_consumer. The archive is a sibling
store and does not make its write atomic with consumer evidence.

The fixture-only gates are NODE_ENV=test,
GELT_SYNTHETIC_ORDER_HARNESS=offline-test-only, and
GELT_SYNTHETIC_MOCK_ROBINHOOD=offline-test-only. They do not admit actual
operations. Input bytes must be constructed for the synthetic fixture; a
classification field cannot detect private or actual data.

## Record and owner binding

ConstructedSpySourceStore.create(root, owner, input) accepts one validated
outer input in an already existing owner-private Linux directory.
ConstructedSpySourceStore.reopen(root, owner) is read-only and never creates
or repairs the directory. read() returns fresh exact input bytes, the
recomputed complete projection, and a recomputed receipt. Returned buffers and
objects do not mutate persisted or later-read values.

The externally supplied owner has the strict
gelt.constructed-spy-source-owner.v1 schema. Its case and run identifiers use
the existing UUID semantics without normalization. The case epoch must equal
the epoch parsed from the same retained daily request after successful
projection. Run, source commit, configuration hash, candidate, projection, and
raw input hash are checked against a fresh replay. These declarations bind a
caller-selected case; they are not authentication.

source.json is canonical UTF-8 JSON with a single record containing the
canonical-base64 exact original input, its length and SHA256, the complete
projection as a JSON object, the owner, and the receipt. The strict
gelt.constructed-spy-source-receipt.v1 receipt hashes the canonical receipt
body and links the raw input, complete projection, daily assessment, manifest,
rule input, candidate, decision, run, configuration, and case identities.
Malformed, rejected, extra-key, contradictory, or identity-mismatched input is
never retained.

## Private storage and close protocol

The fixed namespace is source.json and .source.pending in an already
existing canonical private directory. No directory creation, permission
repair, overwrite, update, delete, append, automatic cleanup, writer reopen,
retry, clock, network, or runtime wiring is performed. Linux local filesystems
are limited to the existing ext4, XFS, Btrfs, and overlay allowlist.

The raw input and complete projection are each limited to 1 MiB. The exact
base64 limit is 1,398,104 characters, the canonical source record limit is
3 MiB, and the canonical pending owner fence limit is 8 KiB. The namespace
budget is 3,153,920 logical file-content bytes across at most two entries;
filesystem block allocation and metadata are not included. Reads use the
existing nonblocking, bounded private-file primitive and reject unsafe names,
file types, links, ownership, permissions, roots, or changed identities.

Creation validates and serializes everything before mutation. It durably
creates the pending fence before the source record. Errors after a write
attempt retain any fence or partial evidence; they are not repaired or retried.
Writer reads require the matching fence and replay the complete artifact.
Readonly reopen/read/close perform no file writes, syncs, unlinks, SQLite
construction, or sidecar creation.

Writer close performs a complete successful replay, syncs the directory, and
then unlinks the pending fence as its last fallible filesystem operation. No
sync, callback, revalidation, or other fallible operation follows that unlink.
A failure poisons the handle and retains the evidence where the failed
operation left it. This is the bounded ordinary synchronous POSIX protocol;
it does not claim stronger power-loss, hostile same-UID namespace, or
cross-store transaction guarantees.

Errors use the fixed message constructed SPY source unavailable and the
closed reason set invalid_input, unavailable, or uncertain. Raw input, paths,
owner values, parser messages, and operating-system errors are not included.

## Acceptance

Owned synthetic tests cover:

- Exact lexical input preservation when whitespace or key order differs while
  canonical projection is equivalent.
- Current and predecessor 253-row assessments, including no predecessor-row
  splicing, plus exact 1 MiB acceptance and 1 MiB + 1 rejection.
- Prewrite rejection of malformed, duplicate-key, fatal-UTF8, extra-key,
  contradictory, rejected, and invalid-owner inputs.
- Independent owner-binding negatives, raw base64 and record corruption,
  coherent receipt/projection rewrites, and fresh-reopen replay.
- Unsafe roots and files, hard links, symlinks, permissions, empty or oversized
  records, FIFO replacement, duplicate creation, and mutation isolation.
- Stage-specific file and directory write/sync failures, retained pending
  evidence, denied reopen, and pre-final-unlink failure without a
  post-unlink fault hook.
- Readonly byte, identity, name, and modification-time preservation.
- An actual synthetic consumer callback archive joined to the unchanged
  durable G05 consumer after a modeled 1.66-unit fill, stop, and protected
  readonly reopen. The expected filled portfolio is 15.01 cash; the archived
  decision-time portfolio remains 20 cash and zero quantity.
- Existing PR74/PR75 projection and G05 consumer compatibility checks on
  unchanged source.

An earlier run against the pre-correction test draft reported 55 passing tests
and three mock-instrumentation failures. A separate Go race run passed. The
current test-spy correction has not been rerun, so those results do not verify
the current tests or source head. Typechecking, import inventory verification,
vet, independent source/privacy reviews, final V2 checks, CI, and delivery
remain unrun or pending. No final acceptance or publication is claimed here.

## Changed files

- v2/worker/src/constructed-spy-source-retention.ts
- v2/worker/src/constructed-spy-source-retention.test.ts
- v2/worker/src/constructed-spy-source-consumer.test.ts
- v2/IMPORT-MANIFEST.json
- docs/specs/Constructed-SPY-G05-Source-Retention.md
