# Pure Codex thread preparation

This standalone library implements the approved pure M4 preparation increment.
It binds a validated request and caller-supplied, already-resolved `Config` to
real `codex_core::StartThreadOptions` at Codex revision
`0df4aa67781ae45a3c97befa4db48b734afe46d9`. It is not imported by Gelt production
code and adds no executable, launcher, workflow or session integration.

`BoundRequest::parse` retains exact request bytes and checks the supplied SHA256,
strict fields, historical source/mock identities, UUID shape, model/effort and
size/timeout bounds. The digest links bytes; it does not authenticate provenance.
The retained historical request identifiers deliberately do not claim current
Gelt compatibility. Timeout is metadata here, not an enforced deadline.

`prepare` rejects incompatible supplied configuration without relaxing its
restrictions. It constructs real options with isolated session/extensions,
an empty tool allowlist, managed sandbox/unified-exec requirements, new history,
no parent/resume/inherited environments, no dynamic tools/client MCP extensions,
empty supplied user instructions and no provider-model fallback. The result
provides shared inspection only, without an options-extraction or startup API.

Configuration checks express structural intent. They do not prove effective
subscription-only auth, tool/context/network isolation, quota or runtime safety.
No configuration loader, thread manager, provider, login enforcement, MCP startup,
turn or synthetic order is invoked by this component's authored call paths.
Future startup requires a separately accepted host/supervisor contract; isolation
and an empty tool list alone do not prevent MCP initialization or provider/auth
prewarming. Do not use login enforcement as a preflight: it may change auth state.
UNKNOWN remains fenced; preparation grants no retry, resume or cleanup authority.

## Reproducible build inputs

Use an explicitly selected, reviewed Rust/Cargo **1.95.0** toolchain on Linux
`x86_64-unknown-linux-gnu`, the committed standalone `Cargo.lock`, and verified
cached public dependency sources. There is no automatic toolchain installer.
Direct Codex revisions and upstream root patches are pinned in `Cargo.toml`;
transitive versions and registry checksums are pinned in `Cargo.lock`.

Lock SHA256:
`6018741c27cc5dd46a20ad264ff68aa99b468341fabba6adb65902a3016f6c4f`.
It contains 1096 cross-platform package records. That count is not a Linux
compiler-unit or feature graph. The standalone root needs its own lock; Git
dependencies do not inherit the upstream workspace lock or patches.

The verified standalone resolution pins `zip 2.4.2`, matching the pinned Codex
workspace lock and its `ZipFile<'a>` API. A prior standalone resolution selected
`2.6.1` and failed with E0107. The repair changes only that package record and
its references to already-present `displaydoc` and `thiserror`; it does not fork
upstream source or add another direct dependency. Do not regenerate or update
the lock during verification. The retained unused-crossterm-patch warning is
expected for this graph and does not require an update.

The dependency graph includes native code and build scripts/procedural macros.
The tested Linux inputs included GCC/G++ 15.2, Make, Perl, binutils and matching
OpenSSL 3.5.5 runtime/development inputs. Its selected `openssl-sys` unit was
non-vendored: headers and linker inputs must be supplied, not assumed present.
The verified build used explicit child-only `OPENSSL_INCLUDE_DIR`,
`OPENSSL_LIB_DIR` and `OPENSSL_STATIC=0` to reuse matching runtime libraries.
When using such overrides, validate both generic and architecture-specific
headers, runtime identity and dynamic-link compatibility. Never invent package
metadata or expose additional private system paths to make a build succeed.
No toolchain, dependency cache, native library or downloaded archive is shipped
with this source candidate. Other native prerequisites depend on the selected
platform/features; Linux verification does not establish other-platform support.

## Component checks

From the repository root, with the selected toolchain/cache and native inputs
already supplied inside the accepted build sandbox:

```sh
cargo check --frozen --lib --target x86_64-unknown-linux-gnu --manifest-path integrations/codex-thread-preparation/Cargo.toml
cargo test --frozen --lib --target x86_64-unknown-linux-gnu --manifest-path integrations/codex-thread-preparation/Cargo.toml -- --test-threads=1
```

These are Cargo invocations inside an independently reviewed environment, not a
sandbox launcher. `--frozen` prevents resolution updates and downloads; it does
not prevent dependency code from reading credentials or reaching the network.
Build scripts, macros, native compiler subprocesses and linked initializers need
reviewed effects and preventive isolation. The verified build used private
namespaces with network isolation, cleared inherited environment, read-only
source/toolchain/cache/development inputs and private writable build outputs,
home and temporary directories. Host credentials and service sockets were not
mounted. Do not replace those controls with Cargo flags alone or run a runtime
smoke after these commands.

The exact source/manifest/lock inputs passed frozen library checking and all
**eight** authored library tests on Linux. Tests cover byte identity, strict
rejection, real isolation/option assembly and an exhaustive in-memory Config
fixture. They do not load configuration or open its lexical fixture paths.
Harness/allocation/synchronization and linked constructors remain runtime
effects; this is not a zero-syscall claim. Upstream suites, binaries, integration
tests and doctests are not selected. Component results do not prove real session,
auth/provider/network behavior, current producer migration or genuine trading.

See [the M4 specification](../../docs/specs/M4-Codex-Thread-Preparation.md) for
acceptance mapping and the local-delivery boundary. Ordinary repository delivery
checks and external publication are separate from this component verification.
