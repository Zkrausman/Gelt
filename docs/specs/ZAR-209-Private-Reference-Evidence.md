---
type: Specification and Completion Report
title: ZAR-209 Private Reference-Computation Evidence Slice
description: Bounded actual scientific MCP output, immutable local import, and protected evidence inspection without execution authority.
timestamp: 2026-10-07T00:00:00Z
status: candidate-hosted-acceptance-pending
---

# Scope and sequencing

The owner prioritized an isolated Paper2Agent integration slice while execution
MVP work continues. This changes implementation scheduling only. It does not
accept ZAR-210/ZAR-222, close ZAR-209 or its full research-to-shadow acceptance,
activate brokers, or authorize strategy promotion. The repository remains private.

The first coherent milestone is one selected public scientific reference
computation, executed through actual local stdio MCP, emitted as immutable JSON,
explicitly imported by a local operator, and inspected through protected Gelt
research views. The reference fixture is numerical input, not a verified market
dataset. Historical, costs/slippage, and shadow stages remain `not_run`; durable
recommendation is `insufficient_evidence`, with `promotionAllowed=false`.

# Scientific adapter

`research/paper2agent/` implements a narrowly scoped reviewed PyPortfolioOpt
minimum-variance operation inspired by the pinned Paper2Agent host-agent workflow.
Paper citation, modern reference-code version, older paper archive, dataset
limitations, notices, dependency lock and exact pins are explicit. The producer
uses real local stdio MCP discovery/tool invocation and compares its result to a
direct reference call and an independent active-set/KKT numeric oracle. It does
not claim a general untrusted-code sandbox, autonomous ingestion, paper-wide
replication, a dedicated upstream fork, or a trading strategy.

The adapter's README, NOTICE and tests contain the exact reference/version,
fixture, solver, protocol, hash-byte and license details. Its committed example
artifact is actual recorded numerical output, not fabricated production telemetry.
Synthetic TS fixtures are labeled test-only and never inserted by startup.

# Typed inert artifact and operator storage

- `v2/worker/src/research-contract.ts`: strict `gelt.research-evidence.v1`, only
  `reference_computation`; bounded arrays/strings/finite numbers, paper/code/license
  pins, input/dependency lock/results/tolerances/provenance, explicit producer
  stage claims, fixed insufficient-evidence/non-promotion outcome.
- `research-json.ts`: fatal UTF-8 parsing, duplicate and escaped-key rejection,
  bounded JSON structural depth/node count before Zod validation.
- `research-store.ts`: separate explicitly provisioned private store, <=65,536
  original bytes, <=100 records, existing private filesystem helpers, atomic
  single-envelope commit, original-byte SHA-256, digest idempotency and logical-ID
  conflict, read-time integrity/schema/ID checks and missing/corrupt/unavailable
  distinctions. Global persistent writer marker; no automatic recovery takeover.
- `research-cli.ts` and `research-operator.ts`: explicit local provision/import
  operations only. No URL fetch, archives, artifact execution, arbitrary endpoint,
  broker secret, provider or live-order path.
- `research-fixture.ts`, `research.test.ts`, `research-process.test.ts` and
  `fixtures/research-process.ts`: synthetic contract/adversarial tests and genuine
  independent-process import/read restart tests.
- `v2/RESEARCH-OPERATIONS.md`: supported platform constraints, provisioning,
  exact-byte integrity meaning, bounded storage and failure/recovery limitations.

Existing Linux UID/mode and Windows private NTFS helper policy is unchanged.
Windows import inputs must already satisfy that private-storage policy. No
permissions are repaired or broadened. The existing helper's 150,000-byte limit
is preserved; envelopes are bounded below 90,000 bytes. There are no new
credentials or sharing permissions. Research never shares the execution database.

Gelt schema/integrity checks are independent of unverified producer claims.
Numeric comparison only compares producer-supplied actual/expected numbers and
tolerances, with overflow guards. Gelt scientific reproduction remains `not_run`.
Input/output/lock inner hashes are producer assertions; the local original-artifact
SHA-256 verifies exact original bytes, not authenticity or paper correctness.

# Protected presentation

The integrated UI/BFF slice provides named protected list/detail operations and
research-only display, with the existing owner session, Host, Origin, ingress and
CSRF controls. No public write/import/execute route is added. Details, dependency
pins and provenance remain separate from actual broker history. Session expiry,
request races, missing/corrupt data and reload states must not expose stale data as
fresh evidence. Runtime forwards only the explicit research-root configuration to
the web role, never artifact-selected environment or endpoints.

# Verification status

Local prepublication verification on the assembled Node 24/Go 1.26.1 candidate:

- Go build, full `go test -count=1 -race -timeout=120s ./...`, and vet: passed.
- V2 full tests: server 18 passed; worker/web 317 passed, 28 native-platform skips;
  script 11 passed. Full server/worker/web production build passed.
- Complete imported-source inventory: 82 upstream paths, 432 V2 candidate files;
  upstream license and original V2 lockfile invariant unchanged.
- Approved scientific adapter 0.2.0: 21 independent and post-review tests passed;
  actual stdio replay succeeded. The current committed 12,160-byte artifact has
  SHA-256 `c386b43d907f3375563422f27c5313268337f7f399821c318a69261f0731bb96`.
  Earlier numerical-domain findings were corrected before this candidate freeze.
- Actual built operator CLI provision/import/idempotency and protected built Next
  reads, restart/session invalidation, tamper and missing classification are
  exercised by the HTTP smoke. HTTP evidence is not browser/visual acceptance.
- Offline built service smoke and final HTTP smoke are required on the unchanged
  reviewed candidate; their command receipts accompany the review packet.

Assembled independent and adversarial review identified a provisioning preflight
race. The corrected implementation rechecks emptiness under the exclusive marker;
a deterministic two-caller interleaving test preserves the first configuration.
The operator guide now distinguishes OWNER_DIR/bootstrap.txt from the BFF grant.
A fresh review also caught the restart test omitting the existing native helper
private-parent prerequisite. The test child now forwards only that explicit
nonsecret setting, with an allowlist regression and no inherited credentials.
Another fresh adversarial review exposed compact-number response expansion. A
shared 512 KiB BFF/client wire limit, 508 KiB canonical-evidence schema limit and
4 KiB metadata reserve now align import acceptance with detail inspection. The
red-before test used actual import, BFF serialization and client decoding; the
corrected regression and exact wire-boundary checks pass.
A subsequent pass found reads could overlap a retained interrupted-writer marker;
detail and list now revalidate ownership after collecting results, with red-before
interleavings for both. The research view also now owns a focusable viewport-height
vertical scroll container, because the existing global layout hides document
overflow. Real wheel/keyboard numeric and final-section reachability checks at
both widths are required in the hosted Playwright gate; local visual proof
remains unavailable.
The final bounds sweep also aligns the provisioning writer with its 8,192-byte
configuration reader before any mutation, including UTF-8 and JSON-escape growth.
Platform root budgets reserve the full 64-character ID filename and atomic-temp
suffix without changing native helper limits. Exact accepted/rejected config and
root boundaries are covered; native Windows execution remains a hosted gate.
Fresh confirmation of this correction and unchanged post-review reruns
remain prepublication gates. Exact-head hosted Ubuntu/Windows checks and sandboxed
Playwright screenshots with actual pixel review remain acceptance/merge gates.
Local sandboxed Chromium is blocked by the environment; no security bypass or
browser pass is claimed. This completes only the reference-evidence foundation,
not the owner's requested tradable simulated agent or full ZAR-209 outcome.

Fault-injection and independent-process tests exercise specified persistence
failure/restart behavior; they are not a proof of universal power-loss safety.
No provider, broker credentials, paid model campaign, live order or execution-MVP
acceptance is involved in verification.
