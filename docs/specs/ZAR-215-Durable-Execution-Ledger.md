---
title: "ZAR-215: Durable SQLite execution ledger and event contracts"
ticket: ZAR-215
status: sqlite-file-classification-corrected-awaiting-independent-review-and-native-ci
baseline: b4fec4aee5edc9e141fe46915ef16ab41abd5695
runtime: Node 22 x64
broker: Robinhood official MCP only
live_actions: none
---

# Scope and disposition

M4 supplies a real on-disk, worker-owned execution ledger and versioned internal
contracts. The cumulative implementation starts at the merged ZAR-214 baseline
above; this narrow sqlite-file classification and test-scratch correction starts
from `5d6ca72c68391ec10d4679ba71bd99b3caf117d1`, retaining the previous diagnostic
and sidecar-owner remediations and evidence. V1/archive, retained
server surfaces, M3 OAuth/connection/security boundaries, OpenTerminal pin
`6feb4869489c8ac9537b1405547983591e1d3263`, MIT and notices remain intact.
No dispatch, outbox, provider call, order state machine, funding/cancel, deployment,
merge or downstream ZAR-216/217/218 behavior. Default startup remains offline.

## Design and durable contracts

Authoritative [API](../../v2/LEDGER-API.md) and
[operations](../../v2/LEDGER-OPERATIONS.md) define the stable methods/envelopes,
capacity, errors, paging, explicit provisioning, backing prerequisites and recovery
limits. Strict runtime Zod v1 schemas cover scoped intent, limit-order request,
event, execution, projection and read/write result contracts. Exact unsigned
monetary decimal text has explicit matching precision 1..38 and scale 0..18; no
floating-point financial arithmetic. Requested quantity/price and independently
supplied observed executions/optional fees remain distinct. No fabricated fills,
provider IDs, positions, timestamps or connected state.

Opaque owner binds the entire database; account-scoped local IDs/idempotency and
independently unique ACCOUNT/RHS/RHC identifiers prevent scope substitution.
Narrow synthetic facts represent attempted, requested, acknowledged, reconciliation
and execution observations without deriving an order lifecycle. IDs/times are
caller supplied; no raw provider bodies, arbitrary metadata or credential fields.
Ledger has no browser/BFF/public write route. Hashes and schema validation detect
inconsistency, not malicious coordinated rewriting by a compromised OS owner.

One lifecycle-owned better-sqlite3 handle uses WAL, FULL synchronization, foreign
keys, trusted_schema OFF, 250ms busy timeout and an exclusive private marker. The
supported existing dependency is reused; **only worker workspace/direct dependency
metadata changes in the lockfile**. Import verification reconstructs original
upstream lockfile bytes and hashes them, proving no resolved dependency upgrades.

Initial ordered migration v1 is one IMMEDIATE transaction, with fixed application
ID, user_version, source checksum and exact DDL validation. STRICT tables:
ledger_owner, migrations, accounts, intents (canonical body/hash/projection), events
(canonical body, scope/ID/key/type/sequence/hash chain) and facts (namespace uniqueness).
Compound FK/unique constraints, deterministic replay and global bounded capacity
protect relational integrity. Failed migration rolls back; foreign/newer/invalid
schemas fail without reset. Startup additionally runs integrity/foreign-key checks.

`recordIntent` commits before returning. `append` validates persisted aggregate
inside IMMEDIATE transaction, inserts event and fact index, and updates projection
atomically; post-write validation runs before COMMIT. Identical duplicates return
validated existing state; conflicting reuse never overwrites. Read snapshots and
all write paths share full canonical body/column, routing, sequence, key, hash-chain,
fact-index and replay/projection validation. Even paged reads validate all bounded
records. Corruption/constraint/I/O/busy/uncertain failures latch unavailable and
retain ownership rather than returning partial success. Clean close also validates.

Separate explicit ledger provisioning extends the protected worker config with
ownerId/ledgerPath. M3 key/vault/config directories remain non-nested/separate.
Linux UID/mode/no-follow rules are reused; local ext4/xfs/btrfs/container-overlay
backing must actually honor SQLite locking/flushes. Windows adds only private
SQLite-directory creation and metadata-only main/sidecar validation to the pinned
helper. Exact current-user-only OI/CI inheritable directory ACL is checked **before
SQLite opens**; SQLite files alone can inherit its verified private DACL. Credential
read/write size and protected/non-inherited ACL rules are not weakened. No broad
ACL mutation or owner credential access. Partial startup unwinds vault/ledger;
shutdown attempts both. Successful checkpoint/close plus matching marker removes
ownership; failure/crash never auto-steals it.

## Required prior-review regressions

1. **Unsafe append projection trust:** no next projection is derived from
   JSON.parse(stored projection). `Ledger.run(true)` begins IMMEDIATE, `load`
   reconstructs every aggregate from strict canonical relational events and compares
   projection/index state, then invokes append. The real-file live-tamper test alters
   a schema-valid projection's apparent route while the handle stays open, calls
   append **directly**, expects unavailable, and proves all table snapshots unchanged.
   No pre-tamper getIntent can poison this regression into passing.
2. **Timeline schema-only decoding:** timeline uses the same loader, not a separate
   body parser. Real second-connection tests replace event/idempotency/intent/owner/
   account identity and recompute the event digest, or introduce noncanonical JSON;
   timeline still fails unavailable. Other read/duplicate/write paths, sequence/type,
   hash/index/account route and projection divergence have explicit regressions.

These are implemented regression protections, **not independent review clearance**.
Fresh independent Review and distinct adversarial Test must explicitly inspect and
clear both across the full original-baseline patch; any changed artifact repeats
review and verification. Missing evidence blocks, never invites archaeology.

## Threat and operational limits

- Secrets stay in the separate M3 vault/service boundary. No ledger logging of
  payloads/inputs or SQLite exception text. Plausible identifiers cannot be proven
  non-secret by regex; future trusted allowlisting adapters must not repurpose fields.
- Private account/financial facts are permission-protected, not encrypted by M4.
  Same-user/admin/root/kernel/dependency compromise and coordinated rollback are
  outside the trust model. No raw production data is a test fixture.
- Global MVP limit: 1000 intents/accounts and 1000 events; pages max100, full bounded
  replay on each call. History is UUID-sorted offset paging, not multi-call snapshot
  or time order. No eviction, automatic archive, compaction or performance claim.
- Clean checkpoint is supported. No online backup/restore, automatic corruption
  repair or recovery tool. Stop and verify all holders, preserve complete private
  directory/config, inspect integrity and resolve cause before any explicitly
  authorized ledger-marker removal. Vault has different M3 credential-discard rules.
- Real process-crash tests prove committed-only restart; no arbitrary power-loss,
  secure-erasure or ephemeral-container durability claims. Existing markers prevent
  uncertain restarts. No provider outcome is inferred after a crash.
- Native Windows correctness requires actual hosted NTFS/DPAPI/SQLite execution.
  Linux testing cannot establish it. Existing Windows helper deadlines, preflight,
  security suites and lifecycle budgets remain unchanged; no blanket platform skips.

## Verification evidence and remaining gates

### Native Windows file-scheduling correction

The correction starts from published `f585956d4bde677f82e0b1b94ba0abb6fa3660e8`;
the cumulative baseline remains `b4fec4aee5edc9e141fe46915ef16ab41abd5695`.
Parent-supplied diagnostic evidence at that unchanged source head: on Windows
x64/NTFS with `GELT_WINDOWS_PRIVATE_PARENT=C:\`, isolated
`npx vitest run --config worker/vitest.config.ts worker/src/ledger.test.ts`
passed **34/34**, in 579.98s (579.387s test execution); individual cases commonly
took 13–54s. Without the required environment variable fixture setup correctly
fails closed. The failed hosted full suite instead ran files in parallel and
failed 35 ledger/process/provisioning cases rapidly (about 27s), while other
prerequisite/server cases passed. Retain that failed-run evidence.

The pinned Windows helper starts fresh PowerShell/C# per operation with a 15s
fail-closed deadline. Cross-file contention was a plausible contributor, **not a
proven complete explanation**; the subsequent serialized failure below retracts
that earlier attribution. Neither isolated success nor serialization proves a
ledger or ACL invariant correct. `worker/vitest.config.ts` now sets
`fileParallelism: process.platform !== 'win32'`: native Windows **files only** run
serially; non-Windows file parallelism remains enabled. No concurrent-test marking,
skips, production changes, binary caching, or security relaxation is introduced.
The existing Windows/non-Windows test timeouts (180s/5s), 30s hook timeout, helper
deadline, include patterns and workflow budgets remain unchanged. API/operations
contracts are unchanged. There is no stable dedicated config-behavior test seam;
no brittle source-text assertion is added. Native full-suite execution is the
behavioral scheduling gate.

This isolated prior-head evidence is diagnostic only, **not final-head Windows
clearance**. The parent-owned published exact-head Windows2022/Node22 x64/NTFS job
must still run the full suite, build and lifecycle smoke with the private-parent
prerequisite, alongside Linux CI. File serialization increases suite duration;
the unchanged 45-minute Windows budget must be established by that hosted run.

### Post-serialization failure and diagnostic-only remediation

Parent-supplied run **35395212272**, Windows job **105762369588**, at published
`72e63af`: Linux build-and-test and node-foundation and native prerequisites passed.
Windows file serialization took effect, but the full worker suite still failed
**35/188** in **464.47s**: one windows-storage SQLite case (6.787s), 31 ledger cases
(about 6.7–7.0s each; three non-helper cases passed), two process cases and one
provisioning case. This does not locate the failing invariant. The common boundary
is after construction/migration creates WAL/SHM and before/at first validation;
previous generic unavailable results erased the distinction. Preserve both hosted
failures and isolated prior-head evidence; do not reinterpret them as clearance.

At that stage source inspection did not prove a safe platform-semantic fix. The
previous diagnostic delta added bounded instrumentation, strict transport validation
and real-file regressions, without changing ownership, SQLite or scheduling:

- C# enum check codes and fixed object kinds; no exception text/OS error values.
  PowerShell accepts only the enum grammar and retains cleanup-before-result.
- Node requires exact exit status, bounded stdout/stderr, contiguous stage traces,
  canonical success payloads and operation-compatible failure codes/kinds. Invalid
  transport becomes PROTOCOL, never arbitrary reflected output.
- Frozen, sanitized internal WeakMap tuples follow constructor/validation/operation
  failures, including marker and identity checks. Ordinary errors/results and all
  public routes/CLIs remain generic. No database/event/log diagnostic persistence.
- A native protected real-file construction/migration/first-recordIntent regression
  emits only a safe category on failure. Unit tests cover every enum and stage,
  protocol injection/reordering/oversize/mismatch, and relay sanitization; real-file
  tests cover marker mismatch, native foreign sidecar ACL and constructor rejection.
- Both packaged helper hashes and scoped import inventory are refreshed. No resolved
  dependency, upstream pin, license, workflow, deadline or security relaxation.

### Narrow SQLite-sidecar owner correction

Owner-supplied hosted run **35401697134**, job **105782795098**, on Windows
Server2022/Node22/NTFS consistently reports `OPERATION:sqlite-set:OWNER:wal`
after real migration, including the focused first-intent regression. Main creation
and migration succeed. SQLite's WAL has an existing trusted administrative token
owner, while the exact private inherited DACL grants current-user FullControl and
admits no untrusted principal. The owner's Windows11/NTFS isolated suite passed
34/34: token default-owner semantics differ. This evidence locates the ownership
mismatch; the older timing attribution and diagnostic-only disposition are superseded.

`PrivateOwner(owner, sqlite, kind)` is a pure semantic predicate. Only SQLite
wal/shm/journal accept the existing trusted SID set (current user, SYSTEM,
Administrators, pinned TrustedInstaller SID). Main, marker, secrets, directories
and explicitly created objects remain current-user owned. `sqlite-set` retains its
fixed suffix mapping. After canonical path validation, `sqlite-file` now examines
only `Path.GetFileName` and case-sensitively maps exact final endings `.sqlite`,
`.sqlite-wal`, `.sqlite-shm` and `.sqlite-journal` to main/wal/shm/journal. Generic
`-wal` names, case variants, Unicode confusables, extra suffixes and directory-only
matches fail PATH before any relaxed owner classification. Invalid enum values fail
closed; missing/none/parent/main cannot enable the exception. No new SID, owner
rewrite, ACL repair or sidecar precreation. All other native metadata/DACL checks,
source pinning, deadlines, Windows file serialization and Linux coverage remain unchanged.

Owner-supplied hosted run **35404051965**, job **105789994585**, is diagnostic,
not final-head clearance: 192/194 executed tests passed and all ledger operations,
provisioning and native post-migration diagnostics passed. Its two failures exposed
only the stale sqlite-file-as-main contract and owner-policy Add-Type scratch leak
corrected here. The owner-policy test now creates a unique owner-only inheritable
scratch child using the production DirectorySecurity pattern, directs TEMP/TMP only
there, recursively deletes only that child in `finally`, and fails if it remains.
No cleanup suppression, ACL repair or broad permission mutation is used.

Mandatory native reflection tests invoke the production predicate for current user,
each trusted SID, multiple untrusted SIDs/null/empty, both SQLite contexts, all six
kinds and invalid values. They also exhaust exact accepted suffixes and rejected
generic/case/confusable/extra/path-component forms. Real SQLite WAL/SHM/rollback-
journal fixtures pass exported single-file validation for natural and, when allowed,
trusted owners; untrusted sidecars and trusted-but-not-current main remain rejected.
The matrix never depends on owner-assignment privilege. Real public ACL, hardlink
and reparse rejection remains mandatory, as does the post-migration first-intent
regression with no fabricated execution facts.

Runtime C# SHA256 and scoped import hashes/reasons are refreshed. API/operations
and the sole cumulative wiki path document the distinction. No production schema,
ledger transaction, dependency, lockfile, workflow, provider or timeout changes in
this correction. Published exact-head Windows/Linux proof remains pending and
parent-owned; Linux cannot certify Windows. Fresh independent cumulative Review and
distinct adversarial Test must cover `b4fec4a..finalHead` and `5d6ca72..finalHead`.

### Linux verification and closeout

Historical pre-closeout Linux Node v22.22.1 verification retained from the earlier
ledger correction (not evidence for the current final head):

| Check | Result |
| --- | --- |
| Real-file ledger suite | 34 contract/storage/migration/tamper/atomicity cases plus 2 independent-process tests passed |
| `npm --prefix v2 test` | 18 server tests, 165 worker/BFF tests and 9 lifecycle/guard tests passed; 23 native-only cases not executable on Linux |
| `GOTOOLCHAIN=go1.26.1 go test -race ./...` | exit 0 |
| `GOTOOLCHAIN=go1.26.1 go vet ./...` | exit 0 |
| `npm --prefix v2 ci --no-audit --no-fund` | exit 0, existing resolved dependency inventory preserved |
| `NEXT_TELEMETRY_DISABLED=1 npm --prefix v2 run build` | exit 0 |
| `npm --prefix v2 run test:smoke` | exit 0; real configured SQLite startup, disabled routes, clean and crash-retained ledger/vault markers; occupied-port failure is intentional |
| Import and whitespace checks | manifest/hash verification and `git diff --check` passed |

This correction's Linux verification exercises TypeScript compilation, import/hash
verification and the full configured ledger/diagnostic/native-storage/process suite.
The production owner-predicate/classifier reflection matrix, scratch cleanup and
native filesystem tests require Windows; Linux execution is not evidence that those
cases passed.

Before handoff, all eight prescribed checks run **sequentially at the unchanged
committed final head**, including clean `git status --short`. Exact-head logs/command
statuses belong to phase artifacts, not a self-referential commit hash in this file.
This report does not claim final independent reviews or published native CI have
already passed. Parent must obtain genuine exact-head Ubuntu and Windows2022
Node22 full tests/build/smoke receipts, fresh Review/Test clearance and normal App
publication/terminal lock release before merge readiness. No live authorization,
provider request, trade, cancel, funding, merge or deployment was performed.

## Changed-file inventory

<!-- inventory follows: paths are the complete intended baseline-to-candidate set -->
- `.llm-wiki/wiki/concepts/zar-215-durable-execution-ledger.md`
- `AGENTS.md`
- `docs/specs/ZAR-215-Durable-Execution-Ledger.md`
- `v2/CONNECTION-API.md`
- `v2/CONNECTION-OPERATIONS.md`
- `v2/IMPORT-MANIFEST.json`
- `v2/LEDGER-API.md`
- `v2/LEDGER-OPERATIONS.md`
- `v2/README.md`
- `v2/package-lock.json`
- `v2/package.json`
- `v2/scripts/smoke.mjs`
- `v2/scripts/update-local-import.mjs`
- `v2/scripts/verify-import.mjs`
- `v2/worker/native/PrivateStorage.cs`
- `v2/worker/native/private-storage.ps1`
- `v2/worker/native/test-attacks.ps1`
- `v2/worker/package.json`
- `v2/worker/src/contract.ts`
- `v2/worker/src/fixtures/ledger-process.ts`
- `v2/worker/src/index.ts`
- `v2/worker/src/ledger-canonical.ts`
- `v2/worker/src/ledger-contract.ts`
- `v2/worker/src/ledger-fixture.ts`
- `v2/worker/src/ledger-migrations.ts`
- `v2/worker/src/ledger-process.test.ts`
- `v2/worker/src/ledger-storage.ts`
- `v2/worker/src/ledger.test.ts`
- `v2/worker/src/ledger.ts`
- `v2/worker/src/prepare.ts`
- `v2/worker/src/provision.ts`
- `v2/worker/src/provisioning.test.ts`
- `v2/worker/src/provisioning.ts`
- `v2/worker/src/service.ts`
- `v2/worker/src/setup.ts`
- `v2/worker/src/storage-diagnostics.test.ts`
- `v2/worker/src/storage-diagnostics.ts`
- `v2/worker/src/windows-storage.test.ts`
- `v2/worker/src/windows-storage.ts`
- `v2/worker/vitest.config.ts`

Unchanged but required review seams: `.agents/skills/ticket-delivery/SKILL.md`,
its `references/review-packet.md`, `.github/workflows/v2.yml`,
`v2/worker/src/private-files.ts`, `vault.ts`, `connection.ts`, `provider.ts`,
`v2/server/src/db.ts`, `index.ts`,
`v2/server/package.json`, `v2/scripts/runtime.mjs`, `start.mjs`,
`docs/specs/ZAR-214-Protected-Account-Boundary.md`, and M3 security tests.
Existing CI already runs all ledger tests via the worker test glob on both platforms;
no workflow timeout/security/preflight gate was removed. No retained market route,
Go, archive, provider behavior or legacy database pool changed.

Durable target-worktree wiki change is exactly
`.llm-wiki/wiki/concepts/zar-215-durable-execution-ledger.md` from the fixed baseline.
It records architecture/contracts/corruption/ownership, Windows test-scheduling
closed diagnostic and sidecar-owner constraints only, not session transcripts, routine status
or credentials. No personal/host vault was consulted.
