# M4 protected SQLite ownership and operations

The execution worker alone owns `execution.sqlite`. It is separate from the
retained market/analysis `server/src/db.ts`, which startup still does not open.
No unauthenticated write surface, outbox, production dispatcher, broker request,
OAuth operation or live execution is added. ZAR-216 adds an unrouted internal
`OrderLifecycle` contract over the existing ledger, but setup/service do not construct
it and the production adapter is unsupported. Default unconfigured startup opens no
ledger and remains offline. Configured worker opens one ledger handle for its
lifetime; capabilities reports current availability, with execution always false.
See the [ZAR-216 candidate specification](../docs/specs/ZAR-216-M5-Preview-Confirmation-Lifecycle.md).

## Provisioning and filesystem prerequisites

Use the extended [M3 preparation/provisioning](CONNECTION-OPERATIONS.md): six new
non-nested directories in order REGISTRATION, KEY, WORKER, BFF, OWNER, **LEDGER**.
The provision CLI takes registration file then five directories KEY..LEDGER. Worker
config gains `ownerId` (generated UUID) and absolute canonical
`ledgerPath: LEDGER_DIR/execution.sqlite`. Only worker receives these. Existing M3
configs missing these fields fail closed: no implicit migration, guessed path or
owner credential lookup. Reprovision only under separately authorized owner
maintenance; do not overwrite configs or lose existing audit/credential state.

Node22 x64, one OS owner, one worker, local storage only. Linux: ext4/xfs/btrfs or
local container overlay with a durable local backing volume honoring SQLite locks
and flushes. The code rejects unknown/network filesystem types. Overlay tests here
prove process restart only; ephemeral container layers are **not durable deployment
storage**. Directory 0700, regular single-link files 0600, same UID; M3 ancestor,
no-symlink, root/sticky-temp rules remain. The main file is precreated privately;
SQLite creates WAL/SHM/journal with its private main-file mode. Metadata for existing
main and sidecars is checked before open, each operation and close. Main file identity
and token-matched private marker are rechecked; no chmod repair, home scan or fallback.

Windows: all M3 prerequisites (Windows11/Server2022+, Node22 x64, local fixed NTFS,
PowerShell5.1/.NET4.8, trusted packaged/pinned helper, explicit compilation parent)
remain. `prepare` creates a **new** ledger directory with protected current-user-only
DACL and ObjectInherit/ContainerInherit FullControl. Exact inheritable descriptor is
required **before SQLite opens**; ordinary non-inheritable M3 secret directories are
not ledger directories. Native metadata-only operations validate main and every
existing sidecar, NTFS/canonical identity/no-reparse/single-link and safe DACLs
(no untrusted allow ACE, current-user FullControl). The main database, marker,
directories, secrets and explicitly created objects still require current-user
ownership. **Only SQLite-created WAL/SHM/journal** may instead have an owner from
the existing closed trusted SID set: current user, SYSTEM, Administrators or
TrustedInstaller (the exact servicing SID already pinned in the helper). Windows
token default-owner semantics differ even on NTFS; a trusted sidecar owner does not
imply a public DACL. The pure owner predicate requires both SQLite validation
context and an exact wal/shm/journal kind. `sqlite-set` assigns kinds from its fixed
suffix loop. After canonical path validation, `sqlite-file` examines only the final
filename and case-sensitively accepts exact `.sqlite`, `.sqlite-wal`, `.sqlite-shm`
or `.sqlite-journal` endings as main/wal/shm/journal. Generic sidecar names, case or
Unicode confusables, extra suffixes and directory-component-only matches fail PATH
before sidecar ownership can apply. Unknown/invalid kinds fail closed; none/parent/
main cannot relax ownership. SQLite-created files may inherit the verified private DACL; neither this DACL rule
nor the sidecar owner exception applies to credential reads/writes.
No size-bound secret file reader is reused for SQLite. No broad ACL changes. Held
ancestor handles and main/sidecar metadata validation retain the existing M3 trust
boundary; same-user/admin/kernel/dependency compromise remains excluded.

Ledger data contains private account and financial facts but is not encrypted by
M4; access permissions are its protection. Credentials remain solely in the separate
DPAPI/AES vault, never this DB, events, logs or diagnostic errors. Protect disk and
any manual offline copy accordingly; do not upload databases in bug reports.

## Ownership, migration and transaction boundaries

An exclusive private `execution.sqlite.lock` with random ownership token is acquired
before opening. Another handle/process fails promptly, **no stale-lock timeout or
stealing**. SQLite busy timeout is 250ms per connection; metadata helper calls retain
the independent 15-second M3 deadline. One connection, WAL, synchronous FULL, foreign
keys and trusted_schema OFF. This is bounded contention, not a real-time SLA.

Application ID `0x474c5434`, user_version 1, fixed SHA256 migration history, STRICT
schema and persisted owner binding. The initial ordered migration consists of
ledger_owner, migrations, accounts, intents (including projection), events (including
idempotency/sequence indexes) and facts. Money lives in canonical JSON TEXT, never
REAL. Composite foreign/unique keys enforce scope. Migration runs as one IMMEDIATE
transaction. Reopen validates history, exact table DDL, integrity and foreign keys;
newer/foreign/skipped/malformed/partial schema fails, never reset/repaired. Future
versions must append reviewed migrations; do not change version-1 SQL in place.

Intent recording commits before returning a receipt. Event append, fact uniqueness
index and projection update share one IMMEDIATE transaction. Reads use deferred
snapshot transactions. Complete canonical/relational replay runs on open, every
read/write (including duplicate paths) and clean close. No trusting a cached or
JSON-parsed stored projection; no timeline-only shortcut. M5 terms, claim ordering,
cancellation facts and the single-unresolved-order-per-account invariant are
validated during that same full replay. `load` has bounded global capacity and
deliberately conservative replay cost; this is not high-volume storage.

Close performs replay validation, metadata checks, TRUNCATE WAL checkpoint (must
report no busy reader), closes the connection, revalidates sidecars/identity and
removes only the matching marker. Vault still closes if ledger cleanup fails.
Partial startup unwinds any opened resources. Corruption or uncertain writes poison
and retain the marker even after the database handle closes. Shutdown cannot
promise every sidecar remains: SQLite can checkpoint on last close.

## Crash, recovery and backup limits

Normal shutdown joins processes and releases ledger/vault markers. SIGKILL retains
ownership evidence and refuses restart. Tests kill a real independent process with
uncommitted work: reopening after **test-owned explicit stopped-process marker
removal** returns only committed state, with no invented execution. This proves
ordinary process-crash behavior, not arbitrary power-loss/hardware durability.

No automated recovery, repair, backup/restore CLI, export, compaction, online copy or
lock-recovery endpoint is supported. Do not copy a running database alone: committed
records may be in WAL. Do not delete WAL/SHM, reset user_version, truncate data or
reinitialize on failure. Preserve the complete stopped directory and config owner
binding before investigation. An operator must establish all writers/readers are
stopped, inspect filesystem/privacy/integrity and committed state, resolve the cause,
and authorize removal of **only the ledger marker** before reopening. Uncertain
provider outcomes require reconciliation; neither M4 nor the unrouted M5 candidate
infers submission/fills. On lifecycle restart, confirmation tokens are lost, the
lifecycle starts halted, and a claimed/unresolved identity is reconciled rather than
redispatched. The owner-wide halt cannot be lifted by selecting an empty second
account while another account has an unresolved order. No reconciliation status,
execution or cancellation may be attributed through an unacknowledged broker ID,
even for a nonterminal partial response. An explicit rejection returned directly
by dispatch remains a separate terminal outcome without broker acknowledgement.
An unknown dispatch remains blocked until a
separately reviewed correlation/recovery contract exists. The selected M3 account must first
be restored by normal discovery.
Vault crash recovery has different credential-discard rules—follow
M3, not the ledger marker procedure. Corrupt/newer data stays unavailable pending a
separately reviewed recovery/migration. Clean shutdown checkpoint is supported;
manual stopped copies require owner-managed access/consistency validation, not an
M4 restore guarantee. No secure erasure or snapshot rollback detection is claimed.

## Verification boundary

`npm test` runs real SQLite ledger/migration/atomicity/tampering/process tests with
synthetic records, along with unchanged M3 suites. Existing Ubuntu and native
windows-2022 CI execute them under Node22, then build and real lifecycle smoke.
Ledger tests are not platform-skipped. Native ACL/DPAPI-specific cases execute only
on Windows; Linux cannot certify them. Parent must verify genuinely published
exact-head Linux/Windows success before readiness. No live broker/OAuth evidence
is claimed. [Specification](../docs/specs/ZAR-215-Durable-Execution-Ledger.md).

## Bounded native diagnosis

The helper reports `FAIL:OPERATION:<CHECK>[:<KIND>]` only from compiled enums.
Checks are REQUEST, PATH, OPEN, CREATE, METADATA, TYPE, REPARSE, LINKS, SIZE,
CANONICAL, FILESYSTEM, SECURITY, OWNER, DACL, ACCESS, READ, WRITE, FLUSH, MOVE,
DELETE, DPAPI and INTERNAL. They identify the failing check/active native operation,
not OS error text or a root-cause conclusion. Native kinds are parent, main, wal,
shm, journal; ledger call sites additionally label marker and identity. No kind
is derived from an exception. `sqlite-set` labels each fixed sidecar while checking
it; `sqlite-file` uses the closed, case-sensitive final-filename mapping above and
rejects every other form. Node labels marker reads and compares main-file identity and marker contents without disclosing
either. Non-native ledger failures use LEDGER/validate/INTERNAL or explicit
IDENTITY/MARKER invariant codes.

PowerShell allowlists the native representation and still requires scratch cleanup
before reporting. Node validates bounded stdout/stderr, exact contiguous stage
sequence, exit status, canonical success payload and operation-compatible failure
codes/kinds. Generic stage failures carry STAGE; malformed, reordered, absent,
unknown, mismatched, oversized or injected output collapses to PROTOCOL. Diagnostic
tuples are sanitized both on insertion and retrieval. Only synthetic internal tests
format them; public errors/routes/CLIs remain generic. No path, SID, ACL contents,
request/data, host, credentials, raw helper output or exception string is retained.

The focused native regression constructs/migrates a real protected SQLite file,
then records the first synthetic intent; failure prints only the safe tuple. Native
ACL/sidecar rejection and real-file marker mismatch tests also check this boundary.
Hosted Windows Server2022 evidence located the failure at
`OPERATION:sqlite-set:OWNER:wal` after successful migration. The sidecar-only owner
correction above addresses that semantic mismatch, not a timeout or SQLite change.
Mandatory production-predicate tests cover every trusted SID, untrusted SIDs,
SQLite/non-SQLite contexts, all kinds and invalid kinds without owner privileges.
Real SQLite tests retain natural token ownership, exported single-file checks of
WAL/SHM/rollback-journal files, private main/sidecar metadata, public ACL, hardlink
and reparse rejection; test-only owner mutations are exercised when the token permits
them. The owner-policy compiler uses and then removes a dedicated protected test
scratch child; cleanup failure fails the test. Keep Windows serialization, all deadlines and Linux
coverage. Never repair ACLs/owners, precreate sidecars, cache an untrusted binary or
infer safety from isolated success. Published exact-head Windows/Linux proof remains
a parent gate; this correction alone does not establish merge readiness.
