---
title: "🔒 M4 pure Codex thread preparation"
status: local-source-delivery-candidate
repository_id: 1415613140
source_base: beace9e281bb1d5f39cbb5253e572e86a92b0c04
codex_source: 0df4aa67781ae45a3c97befa4db48b734afe46d9
verification_target: x86_64-unknown-linux-gnu
compiled: true
pure_tests_passed: 8
runtime_admitted: false
published: false
genuine_G05_G06_acceptance: false
---

# 🎯 What

This is the existing approved pure M4 source increment: bind exact retained
request bytes and a supplied real Config to pinned Codex StartThreadOptions.
It is a standalone library, with no Gelt production import, executable, runtime
launcher, provider/session integration or new acceptance framework. Preparing
options is not admitting or starting a run. This candidate does not complete
the broader M4 runtime work or mark any genuine G05/G06/G07 run accepted.

# ⚠️ Risk

No-tools/isolated options alone do not establish safe startup. A future startup
may initialize MCP or prewarm provider/auth before returning. Login enforcement
can change owner auth state and is not a permitted preflight here. TaskTracker
completion does not establish error-bearing failed-startup settlement. No retry,
resume, UNKNOWN clearance or cleanup authority follows from this library.

Dependency compilation executes build scripts, macros and native tools. The
standalone lock and selected toolchain/native inputs require verified provenance
and preventive credential/network isolation. Frozen Cargo flags alone do not
provide that isolation. Public source contains no local toolchain/cache payload,
private machine paths, credentials or raw operational receipts.

# 🛡️ Solution

The pure builder enumerates real StartThreadOptions fields, installs fresh
isolated extension state and an empty allowed-tool policy, requires managed
sandbox/unified execution, suppresses provider-model fallback and supplies new
history and explicit empty environment requests. Parent/resume state, dynamic
tools, client MCP extensions and inherited environments remain absent. The
provided Config is validated without mutation; conflicting MCP/plugin/code-mode,
context, non-ephemeral, model/effort or provider-intent values reject. Administrator
constraints are not relaxed. PreparedThread exposes only shared inspection.

The request decoder preserves historical source/mock identities and exact
bytes/digest, run/model/effort/timeout. It rejects unknown/duplicate fields,
invalid identities and bounds. These historical pins have not been migrated to
current Gelt source. Digest equality is byte linkage, not provenance. The legacy
proposal/output parser remains separate. This component supplies neither an
output-validation bypass nor an execution/admission capability.

## Changed files

- `integrations/codex-thread-preparation/Cargo.toml`: standalone library, exact
  direct versions/Git revisions, upstream dependency patches and test-only types.
- `integrations/codex-thread-preparation/Cargo.lock`: actual standalone resolution,
  with the reviewed zip compatibility correction.
- `integrations/codex-thread-preparation/src/lib.rs`: pure real-option assembly
  and supplied-configuration checks.
- `integrations/codex-thread-preparation/src/request.rs`: immutable strict request.
- `integrations/codex-thread-preparation/src/config_fixture.rs`: test-only,
  exhaustive real Config literal using constructed data and lexical paths.
- `integrations/codex-thread-preparation/src/tests.rs`: eight authored lib tests.
- `integrations/codex-thread-preparation/.gitignore`: component build output only.
- `integrations/codex-thread-preparation/README.md`: portable dependencies,
  component commands, effects and limits.
- `docs/specs/M4-Codex-Thread-Preparation.md`: scope and verification closeout.

Historical audit/inventory, machine-specific command plans, downloaded packages,
toolchains/caches, native development views and internal review/run receipts
remain outside this source-delivery set. No CI, Go, V2, producer or runtime file
changes are included.

## Existing M4 acceptance mapping

| Approved obligation | Implementation and evidence | Boundary |
| --- | --- | --- |
| Preserve exact request and historical identity | `request.rs`; byte/digest, substitution, malformed/duplicate-field and bounds tests | No current producer migration or provenance authentication |
| Prepare real pinned options with selected no-tools intent | `lib.rs`; real option/extension and fresh-map tests | No ThreadManager, startup or effective runtime isolation proof |
| Reject incompatible supplied Config without relaxing it | `config_fixture.rs`, `tests.rs`; actual prepare/config-projection tests | Constructed in-memory values; no loader/auth/store access |
| Reproduce the component dependency build | Exact manifest and standalone lock; frozen Linux check exit 0 | Native inputs and build isolation supplied separately |
| Verify authored pure component behavior | Eight tests passed, zero failed/ignored/filtered out; test command exit 0 | No upstream suite, session/provider or trading acceptance |
| Deliver a reviewable local source increment | Complete nine-file candidate and local review packet | No commit/push/PR/merge/publication or repository-wide acceptance claim |

## Verification and result

The unchanged Rust source/manifest bytes and lock SHA256
`6018741c27cc5dd46a20ad264ff68aa99b468341fabba6adb65902a3016f6c4f`
passed the README's frozen library check and eight-test command under reviewed
Linux isolation with Rust/Cargo 1.95.0. The library check exited 0. Test compilation
and harness exited 0: eight passed, none failed, ignored or filtered out. Tests
construct the actual upstream Config in memory and inspect prepared options;
they do not load host configuration, open a database or start a session.

The pinned Codex workspace lock selects zip 2.4.2. A prior standalone lock chose
2.6.1, whose ZipFile requires another type parameter, and failed E0107. The
reviewed repair selects 2.4.2 with its official registry checksum and matching
API; only that package record and references to already-present dependencies
change. No source fork, unrelated package upgrade or manifest change was needed.
The earlier lock is retained separately; it is not silently relabeled passing.

Actual dependency provenance/effects and the correction received independent and
adversarial review before isolated build/test execution. Those private records
are retained separately. This portable source candidate additionally requires
complete local accuracy/privacy and adversarial diff review. Its source/lock
build evidence does not imply repository-wide Go/Linux/scientific/browser gates,
remote checks, merge or integrated acceptance for this local-only candidate.

## Retained delivery boundary

Publication is stopped: this increment authorizes no commit, push, PR, merge or
external publication. No alternate route is supplied. Runtime/provider/model/
MCP/adapter-session integration, credentials, global settings/security/access,
held probes/workloads and genuine-run admission remain outside scope. Deterministic
shadow evaluation retains its separate data rights/calendar/availability/cost
requirements; model readiness is not imposed on that independent lane.
