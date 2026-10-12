---
title: ZAR-215 worker-owned durable execution ledger
type: concept
---

# M4 durable ledger

The V2 execution worker owns a single lifecycle SQLite connection in a separately
provisioned private ledger directory. The public market database and browser are
not ledger owners. Default startup remains offline; configured ledger availability
never means execution enabled. Robinhood official MCP is the sole provenance, but
M4 invokes no provider, dispatch, outbox or order state machine.

Contracts v1 distinguish requested limit order values from supplied attempted,
requested, acknowledged, reconciled and actual execution facts. Decimal strings
carry matching bounded lexical precision/scale; no floating-point finance. Owner
UUID binds a database, owner/account scopes IDs, and ACCOUNT/RHS/RHC namespaces
stay distinct. Strict facts-only schemas exclude payloads, metadata and credentials.

Intent receipt follows COMMIT. Append uses IMMEDIATE transaction-local replay to
validate current projection **before** deriving the next projection or resolving
duplicates. All reads, including timeline pages, share canonical body-to-relational
column validation and complete index/projection comparison. Schema-valid projection
tampering and identity-mismatched/noncanonical event bodies must fail unavailable.
Do not reintroduce a schema-only timeline path or trust JSON.parse(projection).

WAL/FULL, ordered checked migrations and a private exclusive token marker provide
bounded one-writer ownership. Corruption, uncertain writes and crashes retain the
marker; never automatically steal it. Only supported local locking filesystems and
M3-private ancestry are supported. Windows SQLite sidecars inherit an explicitly
new owner-only inheritable directory DACL, checked by a metadata-only pinned helper;
credential file protections remain stricter and unchanged. Clean close validates,
checkpoints and releases; automated backup/recovery/power-loss guarantees are absent.

Real-file tests cover migrations, rollback, cross-account isolation, live tampering,
independent-process contention and committed-only restart. Linux results cannot
stand in for published exact-head native Windows DPAPI/ACL/SQLite CI.

Native Windows Vitest test files run serially (`fileParallelism: false`); other
platforms retain file parallelism. Fresh pinned PowerShell/C# helper processes per
operation can contend across files and exhaust the fail-closed helper deadline.
Keep individual test semantics, helper/test/hook deadlines, and all real DPAPI/ACL
validation unchanged; do not compensate with skips, concurrent tests or binary
caching. Isolated Windows suite success cannot replace full-suite native CI with
`GELT_WINDOWS_PRIVATE_PARENT` on supported NTFS backing. Serialization alone did
not clear the full native suite; do not assume contention is the complete cause.

Native storage diagnosis is internal synthetic evidence, not a public API or
persisted event. Compiled check enums and fixed parent/main/WAL/SHM/journal kinds
cross a bounded, exact-stage/exit-status protocol; Node rejects unknown, reordered,
injected or incompatible output as PROTOCOL. Ledger call sites additionally label
marker and identity checks. Frozen sanitized WeakMap tuples preserve categories
through generic constructor/operation failures without serializing data or errors.
Only test formatters may report them. Never retain paths, SIDs, ACL text, request
values, host details, credentials, raw helper output or exceptions. The real native
construction/migration/first-intent regression must report a safe category when it
fails; diagnosis is not permission to repair ACLs or owners.

Windows token default ownership differs between client and Server environments:
SQLite-created WAL/SHM/journal may have a trusted administrative owner despite an
exact private inherited DACL. `PrivateOwner` accepts the existing closed trusted
SID set only with SQLite context AND wal/shm/journal kind. `sqlite-set` uses its
fixed suffix mapping. After canonical path validation, `sqlite-file` classifies only
the final filename with ordinal case-sensitive exact endings: `.sqlite` is main and
`.sqlite-wal`/`.sqlite-shm`/`.sqlite-journal` are their corresponding sidecar kinds.
Generic `-wal` names, case/confusable variants, extra suffixes and directory-only
matches fail before sidecar ownership can apply. Invalid enum kinds fail closed;
none/parent/main cannot relax the rule. Main, marker, secrets, directories and
explicit creations remain current-user owned. All NTFS/canonical/no-reparse/single-
link/DACL and current-user FullControl checks remain, with no repairs.
Mandatory direct production-predicate/classifier tests require no owner mutation
privileges. Their Add-Type compiler receives a unique protected owner-only scratch
child, which must be recursively removed in `finally`; cleanup failure fails the
test. Real SQLite native tests validate natural WAL/SHM/rollback-journal sidecars
through both set and single-file APIs and reject public ACLs, untrusted owners,
hardlinks/reparse objects; additional owner mutations are tested when permitted.
Exact-head hosted Windows/Linux proof is a separate gate, never inferred from the
semantic matrix or Linux execution.

Authoritative contracts and operations: `v2/LEDGER-API.md`,
`v2/LEDGER-OPERATIONS.md`, `docs/specs/ZAR-215-Durable-Execution-Ledger.md`.
