---
type: specification
title: "ZAR-238: Bounded offline synthetic companion preview kernel"
status: integration-partial-unverified
issue: "ZAR-238"
baseline: "d818353a95735ba577fff64db22338d6f7aa3d0b"
scope: "Isolated non-authorizing worker contract; no runtime/BFF integration"
changed_files:
  - v2/worker/src/synthetic-companion.ts
  - v2/worker/src/synthetic-companion.test.ts
  - v2/docs/SYNTHETIC-BROWSER-DEMO.md
  - v2/IMPORT-MANIFEST.json
  - docs/specs/ZAR-238-Companion-Preview.md
verification:
  source_tests: 14/14-local-node24
  worker_typecheck: passed-local-node24
  worker_build: passed-local-node24
  offline_smoke: passed-local-node24
  go_race: passed-local
  import_verification: passed-local-node24-82-upstream-404-candidate
  independent_review: candidate-blocked-follow-up-pending
  operator_ci: pending
---

# 🔒 Bounded offline synthetic companion preview kernel

## 🎯 What

This candidate adds a separate, default-disabled TypeScript kernel at
`v2/worker/src/synthetic-companion.ts`. It does not modify or reuse the existing
`pi-handoff.ts` fixture. Explicit in-process construction can provision a random,
short-lived credential bound to an opaque owner-session identifier. The kernel
accepts only strict v1 synthetic-preview messages with identity-local one-use
nonces, bounded request/identity lifetimes, credential/session matching,
identity-local duplicate request rejection, revision floors and an explicit
private-loopback caller address. It keeps identity, nonce and duplicate-request
state bounded and in memory; nonce and duplicate-term guards remain until the
identity expires even after a request expires or the revision floor is invalidated.
A process restart drops all of it. Two separately provisioned identities for the
same session **can** preview the same terms and revision; this is not a durable
session-wide one-use logical intent.

Only two named synthetic accounts with their fixed RHS/RHC routes, `SYNTH-USD`,
BUY LIMIT DAY, exact decimal terms and revision are accepted. A response requires
explicitly supplied sources (no fallback amounts) with an association digest
covering the owner session and complete terms. This is an in-process binding
check, not an external-source attestation. Fresh `synthetic-companion-quote-v1`
and `synthetic-companion-fee-v1` facts feed BigInt exact-decimal multiplication/addition,
and rejects a fee-inclusive total greater than USD 10. All response fields are
closed and explicitly state `synthetic: true`, `authorizing: false`,
`brokerFacts: false` and `execution: false`.

This is deliberately a **kernel only**, not an end-to-end companion channel.
There is no private HTTP listener, BFF operation, credential file/CLI,
companion-process integration, UI enablement or runtime setup. The `remoteAddress`
check is an input policy seam until a separately reviewed transport binds it to an
actual socket. Identity provisioning is an in-memory helper, not an operator
provisioning interface. The production worker does not construct the kernel, and
no preview/order control is enabled. Existing test-only Pi fixture and disabled
order-surface controls remain unchanged.

## ⚠️ Risk

The governing contract is `docs/specs/ZAR-219-Integrated-Offline-Trading-Screen.md`,
"Next M8 increment: authenticated offline companion contract". It requires
independent simulated account attestation, authenticated private transport,
durable one-use intent reservation and attributable simulated receipts that this
unwired kernel does **not** provide. `v2/docs/SYNTHETIC-BROWSER-DEMO.md` describes
a separate opt-in test-only browser/harness demonstration and leaves M8 open. The new kernel must
not be mistaken for that bridge, a broker quote, account, preview, funds check,
confirmation or execution capability. Callers outside the worker transport could
forge the `remoteAddress` argument, and no secure external provisioning or session
binding to the current BFF exists yet. Market/provider data and real broker tools
are never queried. The immutable Squire candidate was not tested; an independent read-only review
found three P1 gaps (fabricated source fallback, incomplete source/terms association,
pending manifest hashes) and one P2 documentation error. The operator's separate
integration removed the fallback, added DAY and session/terms source association,
and corrected this specification. Local manifest refresh and import verification
passed; cumulative checks remain pending.

## 🛡️ Solution

Keep the module unreachable from startup, BFF and browser routes; require explicit
construction to provision identities; bind each request to the generated credential
and owner session; reject non-loopback addresses, expiry, stale session, unknown
schema fields, replayed nonce or duplicate terms/revision *within the same
unexpired identity*, invalid synthetic route,
unsupported instrument, stale/unsourced quote or fee, and exact totals above $10.
No external adapter or `OrderLifecycle.confirm()` call was added. Capability and
broker facts stay false. Promotion requires satisfying the existing normative companion
contract, separately reviewed private provisioning and actual loopback transport,
protected named BFF wiring (if approved), source-specific tests, complete import
hash refresh, full offline test/build/smoke gates on supported platforms, and independent review. M8
acceptance, durable send/receipt reconciliation, operator CI and any production
activation remain explicitly open.

## Changed files

- `v2/worker/src/synthetic-companion.ts` — isolated closed schemas, ephemeral identity,
  loopback/session/nonce/expiry/replay checks, synthetic quote/fee validation and
  exact fee-inclusive cap; not runtime-wired.
- `v2/worker/src/synthetic-companion.test.ts` — offline unit regressions for default
  disabled state, identity-local replay/duplicate scope, terms, expiry, sources
  and cap; focused Node24 tests passed 14/14 after the identity/expiry-scope
  corrections (not a Squire or M8 test receipt).
- `v2/docs/SYNTHETIC-BROWSER-DEMO.md` — add a scope note distinguishing this kernel
  from the existing fixture/demo and preserving M8-open status.
- `v2/IMPORT-MANIFEST.json` — operator refreshed exact local hashes; local
  verifier passed 82 upstream paths and 404 candidate files.
- This specification.

## Verification evidence

The preserved Squire candidate ran no Bash checks. In this separate operator
worktree, a newly added adverse-source test failed red (11 passed/1 failed),
then 12/12 focused Node24 Vitest tests and `tsc -p worker --noEmit` passed after
the local source/terms correction. A fresh identity-local-scope regression raised
the focused suite to 13/13. An expiry-scope regression then failed red 13/14;
retaining guards until identity expiry (including across same-floor invalidation)
passed 14/14, and the worker typecheck passed again. These are focused local receipts only; import
verification passed locally (82 upstream/404 candidate), and local Node24 V2
build, offline smoke and Go race passed. The smoke log includes an expected
occupied-port rejection, then ends with both PASS lines and exit 0. V2 aggregate
tests and supported-platform cumulative checks, independent final review and
exact-head CI remain pending. No runtime channel, production or M8
acceptance follows.
