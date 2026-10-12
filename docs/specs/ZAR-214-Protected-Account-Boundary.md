---
id: ZAR-214
title: Protected account connection and isolated MCP boundary
status: native-windows-corrective-candidate-hosted-acceptance-pending
baseline: a1498e3fc7394d4622a13236622aeb8b926e78f5
corrective_source: 6804a5e530c25b08909637cd963327fac3ae42f0
upstream_pin: 6feb4869489c8ac9537b1405547983591e1d3263
scope: M3-only
---

# ZAR-214 closeout specification

**Superseding native Windows scope:** the owner now requires native Windows
connected storage and lifecycle, preserving Linux and the completed provider and
lifetime-handle corrections. The final section below is the current Windows
closeout. Earlier Linux-only/no-platform-expansion statements and old launch-source
wiki accounting are retained as historical receipts, not current constraints.
Original full-review baseline remains a1498e3; this native launch starts from
completed PR458 6804a5e530c25b08909637cd963327fac3ae42f0, not any failed candidate. The prior native implementation
closeout is historical; the corrective section at the end is current. Native hosted
re-execution is parent-owned **pending**, not a reason to substitute Linux mocks or claim readiness.

## Authority and preservation

Owner authorized ordinary Squire delivery to reviewed PR, not merge, deployment,
live login/authenticated broker access, orders/cancel/funding, host/Pi credential
import or downstream ledger/order/UI work. Original baseline is **PR457 merge
`a1498e3fc7394d4622a13236622aeb8b926e78f5`**, fixed for all attempts. V1 source/tests,
Go CI, archive preservation identity `357f0dbbd853848484a6afe2773f6a7ac3c9fe2d`, exact
OpenTerminal pin, licenses/notices and original import hashes are preserved. No
host/personal vault consulted. This file is authoritative notwithstanding Linear's
filename rewriting. No authenticated provider call, OAuth browser authorization,
remote mutation or deployment was performed for implementation verification.

## Implemented design and contracts

Normative detail: [connection API](../../v2/CONNECTION-API.md) and
[owner operations/platform/key contract](../../v2/CONNECTION-OPERATIONS.md).

1. Additive worker-owned OAuth/public-client registration configuration, exact
   official endpoints from the supplied snapshot, resource binding, S256 PKCE,
   cryptographic one-use state/session/fixed-redirect/generation binding. One
   pending transaction, five-minute/session-bounded lifetime; malformed, expired,
   mismatched and replayed callbacks rejected; correctly bound denial consumed.
2. Real single-owner server session and CSRF, short-lived one-use owner CLI grant,
   exact raw Host/Origin checks, no CORS. Custom Next ingress rejects caller
   forwarded headers **before** Next normalizes them; server-only random ingress
   proof admits only generated expected forwarding fields. Next's synthetic
   localhost request URL is not used as trusted Host evidence. Bare Next startup
   cannot bypass the boundary. Only callback has narrow Origin/CSRF exception.
3. Private BFF→worker bearer authentication, opaque session/expiry context and
   independent worker Host/body/method checks. Named status/initiate/callback/
   discover/select/disconnect only; no arbitrary tools/URLs/identities. Closed
   runtime validation of inputs, outputs, token expiry and errors. Browser sees
   no broker token, PKCE verifier, MCP header, service auth or raw provider payload.
4. Serialized refresh/discovery with generation and credential-identity guards
   after network awaits; synchronous vault writes make commit/clear noninterleaved.
   Disconnect invalidates in-flight callback/refresh/discovery, clears local
   credentials/accounts/pending flows and browser session. Failed persistence is
   unavailable, not successful disconnect. No remote revocation guarantee.
   Expired credentials cannot report connected. Restart requires fresh discovery.
5. Real AES-256-GCM encrypted vault, separately protected explicit random key,
   private Linux UID/mode/no-symlink/single-link checks, atomic private file write,
   file/directory fsync, single-writer lock and encrypted null tombstones. No
   plaintext/default/neighbor-key fallback, automatic migration or installed
   credential search. Corruption/read errors latch unavailable. Native Windows now
   uses DPAPI and NTFS descriptors through the bounded fixed helper described below;
   its actual hosted acceptance is pending, never inferred from Linux tests.
6. Fixed official MCP Streamable HTTP initialize/notification/protocol/session,
   tools/list inspection and only named get_accounts. Protocol 2025-03-26, bounded
   JSON/finite SSE and request timeouts; no redirects or automatic retries.
   Unknown input metadata, pagination, protocol or response forms fail unavailable.
7. Evidence-backed raw account boundary maps `data.accounts` independently from
   strict normalized Account. Only active cash individual, caller-relative agent
   access, both explicitly false deactivation flags and usable ACCOUNT/RHS/RHC
   qualify. Well-formed inaccessible/non-crypto neighbors are filtered, malformed
   or conflicting identities reject the response. No nickname/default/guide
   authority. Only masked suffixes and collision-checked opaque handles leave
   worker; selection grants no trading authority. Detailed mapping below/API.
8. Default startup/smoke stays disconnected/offline. Explicit secure configured
   worker alone gets official token/MCP TLS egress; web/market retain M2 offline
   guards and no broker config. Supervisor joins siblings on startup failure.
   Guards are application defense in depth, not a firewall or same-UID sandbox.
   No execution ledger/analysis DB or retained provider/AI/portfolio activation.

## Deliberate limitations and evidence boundaries

- Public metadata was supplied in intake; implementation made no discovery or
  registration requests. Exact config validation is not provider approval. Owner
  must provision a new client with redirect agreement, never assume a Pi client.
- Retained get_accounts evidence now supplies decoded field names/types and mixed
  `data.accounts`, with historical input `{}`. It is one observation, not complete
  enum/requiredness or current-access proof. Structured/JSON-text tool envelopes,
  protocol 2025-03-26 and finite SSE remain offline implementation contracts, not
  observed wire encoding. Unsupported forms fail closed. No fabricated production
  connection records or fixture mode/debug routes.
- Explicitly provisioned owner-operated Linux or supported native Windows backing;
  Windows acceptance requires the new native hosted gate. This is not production
  operational readiness. Same-UID/root, OS compromise, backup erasure and OS network isolation
  are not claimed. Crash locks are never auto-broken; documented owner recovery.
- Secure loopback cookie acceptance is browser-dependent and not proven by Node
  HTTP smoke. No insecure-cookie fallback. Supported runtime is one literal-loopback
  owner/process, no reverse proxy, remote origin, TLS termination or multi-instance.
- Status requires unexpired credentials and validated discovery, not actual trading
  eligibility/balance/price. MCP does not own whole-application safety. M4 ledger,
  M5 exact confirmation/submission/reconciliation and M6 UI remain separate tickets.
  Unknown outcomes stay fail-closed; no live order proof is claimed.

## Verification matrix (offline)

| Seam | Evidence |
| --- | --- |
| Preserve V1/Go | Unmodified root source/test/CI; Go 1.26.1 race and vet commands below |
| Existing upstream coverage | All six upstream server test files/18 tests retained |
| Session/bootstrap/ingress/CSRF | BFF tests: wrong grant, one-use durable consumption, expiry, Secure cookie, anonymous, bad Origin/Host/CSRF/ingress/forwarding, output redaction, closed input and disconnect session invalidation |
| Actual private HTTP | Worker HTTP tests: wrong service secret/session/expiry context, Origin/Host/forwarding, bounds and named-only tool denial |
| OAuth/lifecycle | S256, state/session mismatch/replay/expiry/denial, exchange/refresh failure, expiry/restart, single flight, stale handles, callback/refresh/discovery-vs-disconnect, vault errors and session expiry during exchange/discovery |
| Vault/provisioning | Encrypted roundtrip/fresh nonce/restart/clear, corruption/wrong key, private mode/symlink/hardlink/missing/short/neighbor key denial, unsafe update preserves previous data, single writer, explicit provisioning/renewal/no overwrite |
| MCP/transport | Initialize/notification/session/tool metadata, JSON/SSE, ID/protocol/error rejection, argument-schema/pagination/unsupported-tool denial, token expiry/scope/redirect policy, body bounds and no retry |
| Account safety | Missing/false eligibility/access, inactive/margin/joint/malformed cases, distinct identifier roles, masked opaque selection and stale selection rejection |
| Process/network | Minimal per-role env, offline TCP/DNS/fetch denial, official worker arbitrary/raw/TLS-misconfiguration denial, offline DNS sink for allowed TLS shape, sibling cleanup and readiness deadlines |
| Built services | Existing bounded offline smoke + actual raw-gated Next bootstrap/status/initiate/local-disconnect/private worker using synthetic secure setup; no provider calls; malformed Host via node:http, forwarded rejection, session/CSRF and disabled tool routes |
| Provenance | Complete v2 inventory/hashes, fixed upstream pin, verbatim MIT/lockfile and dependency notices; no new dependencies |

Tests use internal provider/clock/transport injection or temporary synthetic local
provisioning, never real tokens/accounts, external provider fixtures or production
fake-connection switches. No page-source/log dump of secrets. Generic errors do not
serialize provider/Zod/transport exceptions. Private fixture directories are removed
in finally. Build/dependency caches are ignored; no operational DB is committed.

### Prior source implementation receipts (historical, not corrective acceptance)

Commands run **sequentially**, never npm ci concurrently with Go discovery:

```
GOTOOLCHAIN=go1.26.1 go test -race ./...
GOTOOLCHAIN=go1.26.1 go vet ./...
npm --prefix v2 ci --no-audit --no-fund
npm --prefix v2 test
NEXT_TELEMETRY_DISABLED=1 npm --prefix v2 run build
npm --prefix v2 run test:smoke
npm --prefix v2 run verify:import
git diff --check
git status --short
```

Precommit execution: Go race/vet and npm ci passed on Linux, Node 22.22.1.
No dependency/lockfile delta; retained Recharts deprecation warning is not hidden.
Initial additional private-Host test used Node fetch, which normalizes Host; test
was corrected to node:http (not weakened). Initial protected built smoke exposed
Next's synthetic `localhost` request URL; fixed authority validation to raw gated
Host with server ingress proof. Subsequent protected smoke passed. Expected
EADDRINUSE/child-exit output belongs to deliberate occupied-port failure tests, not
an ignored unexpected startup failure. Final precommit suite/build/smoke/import/diff
results are recorded in the closeout below before independent review.

**Receipt distinction:** precommit checks validate the working candidate, not a
future commit hash. Independent Review and distinct adversarial Test must examine
complete original-baseline→final-HEAD diff and run their own exact-head checks.
No fabricated review/test/PR/CI/publication/merge receipts are asserted here. Parent
alone verifies PR base/head, CI, terminal state and lock release. Delivery stops at
reviewed merge-ready PR, not merge.

## Changed-file and import accounting

`v2/IMPORT-MANIFEST.json` records every retained/modified/omitted upstream path and
local addition, with original upstream hashes unchanged. New local updater refuses
silent retained-file modification. `package-lock.json`, MIT and notices unchanged;
no new dependency or license delta. M2 archive/Go CI unchanged. Candidate file groups:

- Worker contracts/lifecycle/transport/vault: `v2/worker/src/{contract,service,index,
  connection-contract,connection,provider,account-adapter,private-files,security,vault,setup}.ts`.
- Owner-only CLI: `v2/worker/src/{provision,bootstrap,provisioning}.ts`.
- Tests: `v2/worker/src/{connection,provider,vault,private-service,provisioning}.test.ts`,
  `v2/worker/src/account-integration.test.ts`, `v2/worker/src/fixtures/{README.md,get-accounts.json}`,
  `v2/worker/vitest.config.ts`; pre-existing service/upstream tests preserved.
- Web: `v2/web/lib/connection-bff.ts`, `connection-bff.test.ts`,
  `v2/web/app/api/connection/[operation]/route.ts`, `v2/web/app/connect/page.tsx`,
  `v2/web/next.config.ts` (NodeNext source-extension resolution only).
- Runtime/import/checks: `v2/scripts/{runtime,runtime.test,smoke,start,web,
  official-worker-guard,update-local-import}.mjs`.
- Docs/provenance: `v2/{README,CONNECTION-API,CONNECTION-OPERATIONS}.md`,
  `v2/IMPORT-MANIFEST.json`, this specification.
- Durable cumulative target-worktree wiki, compared with original baseline:
  `.llm-wiki/wiki/concepts/zar-214-protected-account-boundary.md` (new) and
  `.llm-wiki/wiki/concepts/zar-213-v2-foundation.md` (historical transition addendum).

Generated outputs are node_modules, server/worker dist, web .next, TypeScript cache
and ephemeral test directories; excluded from committed inventory. Provisioned
operational configs/keys/grants/vaults must be outside the repository. No Squire
controller/state edits, secrets, owner account data or unrelated host material.

### Prior source closeout (historical PR458 candidate, not corrective acceptance)

All configured commands above completed sequentially with exit 0 on the final code
candidate: Go race suite and vet; npm ci; **18 retained upstream + 45 worker/BFF +
8 process/network tests**; production server/worker/Next build; bounded default and
protected built smoke; import verification (**82 original upstream paths, 348
candidate files**); diff whitespace check. Precommit status contained only the
intended source/tests/docs/manifest/wiki changes listed here. Shutdown now invalidates
in-flight connection generations before vault key/lock release; offline tests also
cover a stale callback finishing after a newer connection succeeds. No changes to
V1, Go workflows, pin, lockfile, license/notices or preservation identity.

Implementation receipts are precommit, not independent exact-HEAD approval. The
commit includes this completed closeout and both cumulative project-wiki paths;
postcommit status/import/diff checks are run by Implement without inventing a
self-referential commit receipt inside this file. Review/Test and parent PR/CI
verification remain required. Live OAuth/provider compatibility, Windows secure
backing and actual browser Secure-loopback-cookie acceptance remain explicitly
unproven; no gate is closed on the strength of fixture success alone.

## Corrective delivery: observed payload regression

Correction starts from completed PR458 `ab363b22865f8f44c35252ef680162f5fb99942c`,
not a prior failed candidate. The original ticket baseline above does not move.
The source mislabeled invented normalized fields as a conservative raw fixture
adapter; that did not satisfy provider compatibility and is superseded here.

### Evidence and implemented mapping

[Fixture/provenance](../../v2/worker/src/fixtures/README.md) records the retained
parent-authorized decoded get_accounts observation at 2026-09-18T03:17:46.356Z.
All account IDs, nickname and funds in the supplied fixture are synthetic/replaced.
It is neither production telemetry nor live-wire evidence. The fixture has one
margin/inaccessible record and one cash/accessible record, ordinary metadata and
untrusted guide. No new broker/network verification or credential import occurred.

`account-adapter.ts` explicitly maps raw `type:cash`,
`brokerage_account_type:individual`, `state:active`, `agentic_allowed:true`,
`deactivated:false` and `permanently_deactivated:false` to the strict internal
eligible/agent_accessible/active/cash/individual model. ACCOUNT, RHS and RHC are
preserved separately; RHS remains crypto routing identity, RHC only a distinct
identity/masked suffix, not its substitute. Nickname/defaults/guide cannot promote.

Missing/unknown/disallowed policy excludes a record; malformed types reject the
whole result. Optional/empty crypto IDs exclude non-crypto records, while invalid
supplied IDs reject. Check duplicate IDs in each namespace before filtering,
including inaccessible records; duplicate routes cannot hide behind filtering.
Empty/all-excluded lists remain unavailable. Internal validation independently
rechecks identities; handle collisions/reuse fail before atomic map replacement.
Successful rediscovery clears selection; stale handles/disconnected discoveries
remain non-actionable. No raw metadata is returned or logged.

StructuredContent or one JSON-text tool block carries `data.accounts`. Both must
independently validate and agree deeply if supplied together (including guide,
ignoring object-key order). Reject tool/RPC errors, ambiguous/conflicting envelopes,
duplicate JSON keys (including escaped aliases), unsupported content, oversized or
excessively nested data. Safely bound/discard irrelevant account metadata; closed
outer/data envelopes. Full bounds and rejection semantics are in CONNECTION-API.
Fixed official transport, empty named-tool arguments, initialization/session checks,
private auth/vault/callback/refresh/disconnect controls and disabled execution remain.

### Actual before/after evidence

Run from `v2`:
`npx vitest run --config worker/vitest.config.ts worker/src/account-integration.test.ts`.
Before changing implementation at ab363b2, the initial two connection regressions
failed (exit 1). A three-test run, with direct provider assertion added and the
masked-suffix expectation corrected to four characters, also failed all three
(exit 1). Both structured and text callback/discovery paths returned generic
`connection unavailable`; direct OfficialProvider rejection identified missing
`structuredContent.accounts` and unrecognized `data`/`guide`. No production source
had changed for either red run. This demonstrates the old actual path failure,
not only schema-fixture self-consistency.

After normalization, the same three tests passed (exit 0), together with the
retained provider/lifecycle tests (32 total). Expanded integration now has **69
passing tests** covering text/structured over JSON/finite SSE, mixed eligibility,
missing/false/malformed flags, deactivation, unknown policy, optional/invalid/duplicate
identities, metadata/guide injection, envelopes/errors/bounds, equality, sanitized
selection/rediscovery and actual provider discovery vs disconnect. Additional
normalized duplicate/handle-collision and RPC/session/SSE tests preserve previous
negative coverage. Synthetic tokens exist only inside injected offline tests.

### Corrective implementation verification (precommit, Linux / Node 22.22.1)

All eight configured commands were executed sequentially with full output and exit
inspection, after source/docs/wiki/import updates except this receipt closeout:

| Command | Exit | Actual result |
| --- | --- | --- |
| `GOTOOLCHAIN=go1.26.1 go test -race ./...` | 0 | All Go packages passed; no race detected |
| `GOTOOLCHAIN=go1.26.1 go vet ./...` | 0 | No diagnostics |
| `npm --prefix v2 ci --no-audit --no-fund` | 0 | 317 packages; retained Recharts deprecation warning |
| `npm --prefix v2 test` | 0 | 18 upstream + 119 worker/BFF + 8 process/network tests; import 82 upstream / 352 candidate files |
| `NEXT_TELEMETRY_DISABLED=1 npm --prefix v2 run build` | 0 | Server/worker TypeScript and production Next build passed |
| `npm --prefix v2 run test:smoke` | 0 | Default offline and protected bootstrap/BFF/private worker passed without broker calls |
| `git diff --check` | 0 | No whitespace errors |
| `git status --short` | 0 | Intended modified files and new adapter/integration/fixtures only; staged/committed during closeout |

Expected EADDRINUSE/child-exit output is the deliberate occupied-port test, followed
by passing cleanup checks; it is not hidden unexpected failure. `verify:import`
also runs explicitly during closeout. Caches/node_modules/dist/.next/tsbuildinfo
are ignored, test provisioning is ephemeral and removed. No dependency/lockfile,
V1, Go CI, license or upstream pin changes. Existing M0/M1/M2 specs and ZAR-212
report remain historical evidence; this spec supplies the corrected decoded
mapping without rewriting them or claiming new operational approval. ZAR-234 is
backlog only; no delivery-framework/controller/state changes.

### Complete cumulative wiki disposition and review gate

NET original-ticket baseline a1498e3..candidate has exactly these committed wiki
paths, both required durable knowledge updates:

| Path | Original-ticket disposition | Corrective-source disposition |
| --- | --- | --- |
| `.llm-wiki/wiki/concepts/zar-213-v2-foundation.md` | Modified: historical M2→M3 transition, preserved defaults/provenance and corrected provider-boundary/owner-Linux constraints | Modified: explain corrected normalization and limits |
| `.llm-wiki/wiki/concepts/zar-214-protected-account-boundary.md` | Added: security architecture, operations, provider mapping, failure semantics and verification constraints | Modified: replace invented-fixture contract with evidence-backed mapping/envelope support and limits |

Native Implement projectWiki uses the separate fixed launch ab363b2..HEAD path set:
**both paths above**. No personal/host vault was consulted. No routine session/status
or secrets belong in these wiki pages. Complete changed-file groups above include
the four corrective additions and all original 38 paths (42 total). Import inventory
records each V2 addition/hash; the complete actual name-status/stat/patch against
both fixed baselines is the authoritative final review packet, not a delta-only
summary. Full original security boundaries remain in acceptance scope.

This receipt is implementation verification, **not** independent Review/Test or
merge readiness. Closeout precedes final reviews. Fresh independent Review and
distinct adversarial Test must inspect every actual original-baseline patch plus
corrective delta (including this spec/wiki/manifest), explicitly clear blocker/high
findings, and Test must run all eight commands at unchanged final head with one
native command receipt each. Missing exact evidence blocks acceptance. Parent owns
hosted CI, App publication and lifecycle decisions; no fabricated receipts here.
OAuth registration, actual browser Secure-cookie compatibility and live MCP access
remain unproven; Windows connected mode remains unavailable. No merge/live action.

## Review remediation: lifetime handle non-reuse

Independent Review of `6e9c147ce5392770a8691eda7e9c289ad1feb200` found a HIGH:
checking only the current discovery map allowed an older handle to be reassigned
once two rediscoveries or disconnect erased its history. This remediation preserves
the prior evidence-backed adapter correction and fixes that lifecycle boundary;
it does not substitute an attempt delta for the full original-ticket review.

Connection now reserves generated handles for its entire instance lifetime, across
rediscovery, failure and disconnect. Duplicate generation fails before publishing
a replacement map. Reservations include partial failed allocations and have a
10,000-entry limit, with no eviction. Exhaustion takes the existing fail-closed
credential/selection clearing path; disconnect cannot reset the limit. Owner worker
restart recovers capacity, restores no account mapping and uses fresh cryptographic
random handles. The cap avoids unbounded retention; restart remains subject to
fresh discovery and all existing provisioning/security checks.

Actual regression, run from `v2` with
`npx vitest run --config worker/vitest.config.ts worker/src/connection.test.ts`:

- **Before production changes**, at the reviewed source above plus three new tests:
  exit **1**, **25 passed / 3 failed**. After handles A→B→C, attempting A for a
  different synthetic account returned `connected` instead of rejecting, in each
  rediscovery, disconnect/reconnect and provider-failure/reconnect case.
- **After correction**: exit **0**, **29 passed**, including all three unchanged
  regressions and a capacity test allocating 10,000 handles, rejecting the next
  discovery and rejecting capacity reset through disconnect/reconnect. Tests assert
  no actionable stale handle, empty status/selection and cleared persisted tokens.
  All transport/provider data remains injected offline synthetic fixtures.

Remediation changes `v2/worker/src/{connection.ts,connection.test.ts}`, API and
operations contracts, their import hashes, this specification and the protected
boundary wiki. Original-baseline cumulative wiki disposition remains exactly the
two paths in the table above: foundation modified, protected-boundary added.
Launch-source cumulative disposition remains both paths modified (including prior
Implement work); this attempt adds durable lifetime/cap/recovery semantics to the
protected-boundary page. No third wiki path, V1/CI/dependency/pin change or platform
expansion. Fresh full-diff independent Review and adversarial Test remain required;
the previous HIGH is not considered independently cleared by this implementation.

### Remediation verification (precommit)

Executed sequentially on Linux / Node 22.22.1, with full outputs inspected:

| Command | Exit | Result |
| --- | --- | --- |
| `GOTOOLCHAIN=go1.26.1 go test -race ./...` | 0 | All Go packages passed (cached), no race diagnostics |
| `GOTOOLCHAIN=go1.26.1 go vet ./...` | 0 | No diagnostics |
| `npm --prefix v2 ci --no-audit --no-fund` | 0 | 317 packages; retained Recharts deprecation warning |
| `npm --prefix v2 test` | 0 | 18 upstream + 123 worker/BFF + 8 process/network tests; import 82 upstream / 352 candidate files |
| `NEXT_TELEMETRY_DISABLED=1 npm --prefix v2 run build` | 0 | Server/worker TypeScript and production Next build passed |
| `npm --prefix v2 run test:smoke` | 0 | Offline and protected built-service smoke passed; no broker calls |
| `git diff --check` | 0 | No whitespace errors |
| `git status --short` | 0 | Exactly the seven intended remediation files listed above; no untracked files |

Occupied-port EADDRINUSE and child-exit messages are expected negative-test output;
cleanup assertions passed. Explicit `verify:import` also passed. Generated caches,
dist, .next and node_modules remain ignored. This receipt is precommit and was
added after the checks, not an exact-head independent Test receipt. Closeout is
committed before final checks/reviews; no subsequent ticketed mutation is allowed
without fresh review and verification. Prior regression failures and Review HIGH
remain preserved as evidence; no controller or previous phase output was changed.


## Native Windows implementation closeout (supersedes historical platform limits)

### Architecture, bounded scope and threat model

Actual production changes dispatch all private-file operations to a fixed packaged
PowerShell5.1/.NET4.8/C# helper on Windows; Linux retains its secure primitives.
Current-user DPAPI wraps a fresh 32-byte AES key in a strict versioned envelope;
raw-key fallback/migration is rejected. BFF/service/registration/bootstrap/owner
files, locks, key and ciphertext share verified current-user ownership and protected
NTFS DACL enforcement. Creation supplies private descriptors, not repair-after-create.
The preparation CLI reads bounded registration stdin and provisions only five new
explicit non-nested application directories. No broad ACL modification, account
lookup, credential search, execution ledger or broker request was introduced.

Native checks retain every ancestor handle without share-delete, inspect opened
identity/NTFS/owner/ACL, reject reparse/hardlinks and unsafe ancestry, and bound
canonical absolute paths (no UNC/device/ADS/reserved names/trailing ambiguity).
Separate key/data containment is Windows case-insensitive. Ancestors can permit
creation/traversal but not untrusted deletion/security/attribute modification.
Same-user/Administrator/SYSTEM/servicing compromise is excluded, matching the
Linux same-UID/root exclusion. The trusted checkout and standard C:\Windows
installation are prerequisites, not caller-selected executables. OS temp ancestry
is validated before public-source compilation in a new protected directory.

The wrapper verifies SHA-256 of fixed packaged sources, invokes an absolute OS
executable without shell/profile/script interpolation, and bounds request/response
and execution time. Private paths and secrets are stdin, never helper argv or error
text. No arbitrary PATH, credentials, proxy or NODE_OPTIONS inheritance. Unavailable
crypto/helper/ACL backing is unavailable, never plaintext or chmod fallback.

Windows updates use protected WRITE_THROUGH files, FlushFileBuffers via .NET
Flush(true), and same-volume native MoveFileEx replace/write-through. This is **not
POSIX directory fsync**, a general transaction journal or arbitrary hardware
power-cut proof. Supported NTFS/OS storage must honor these APIs; snapshots,
physical rollback, hostile same-user/admin and broken disk flush implementations
are outside the guarantee. Tests target ordinary process failure and API/protection
failures; no physical power-cut test is claimed. A persistent exclusive writer
marker survives crash; failed persistence permanently poisons that vault instance
and keeps the marker even through close, preventing stale credential reload.
Bootstrap compares under its own exclusive marker and persists a consumed tombstone
before granting any Windows session. Recovery is explicit offline clearing of
uncertain state, not automatic stale-lock theft. See operations for owner procedure.

Cooperative IPC stops direct services and nested supervisors, responds to parent
disconnect, closes listeners and releases healthy vault ownership before exiting;
forced termination keeps fail-closed markers. Node launches use file-URL preloads
and a nonsecret explicit OS environment allowlist, no inherited PATH/shell. Role
separation, private service auth, raw ingress/Origin/CSRF/callback guards, refresh
and disconnect generations, masked lifetime selection handles and official-only
worker egress remain unchanged. Default startup, backtest and telemetry remain
offline/non-fabricated. Live OAuth/MCP/browser compatibility remains unproven.

### Implemented native verification gate

`.github/workflows/v2.yml` adds isolated `windows-2022`, Node22 x64, explicit
PowerShell5.1/.NET4.8/NTFS prerequisite checks, full Node tests/build/smoke and
contents:read only. No pull_request_target, secrets, broker requests or uploaded
secret artifacts. Existing Ubuntu Node and Go jobs are retained. Native primitive
cases are conditional only with this job; BFF/authentication/provider/security
and built smoke are not blanket-skipped. Synthetic private test directories are
removed in finally/afterEach. Windows tests execute real DPAPI and ACL operations,
not mocked process.platform. The cross-platform vault suite checks encryption,
restart, nonce changes, corruption/wrong key, clear and conflicting ownership;
native negatives cover unsafe/inherited ACLs, wrong owner, unsafe ancestors,
reparse/hardlinks, malicious paths, missing helper, DPAPI tamper, failed persistence
sharing-violation replacement/clear failures and independent concurrent helper writers. Shared provisioning/BFF/private-worker
suites and built smoke cover owner/session/service boundaries, the real preparation
and provisioning CLIs, parent-disconnect cleanup, healthy lock release and abrupt
worker termination with restart refusing the retained ownership marker. Native
wrong-owner negative-fixture setup requires the hosted elevated test token; ordinary
production use does not require administrator privileges.

**No Windows execution receipt exists from this Linux sandbox.** Parent must run
and verify hosted Linux and Windows jobs on the published final head. Candidate
publication is allowed for that gate; merge readiness is not asserted. Fresh
independent correctness and distinct adversarial reviews must explicitly clear
all blocker/high findings on the full original-baseline patch and native delta.
Implementation self-checks are not either independent verdict. No merge or live
action is authorized. ZAR-234 remains backlog.

### Complete native changed-file and import accounting

The exact native correction patch is cadf266c43ac08ea711f2c0d7363bda67bff7409..HEAD;
original review remains a1498e3fc7394d4622a13236622aeb8b926e78f5..HEAD. Native files:

- `.github/workflows/v2.yml`: additional native gate, no Linux job removal.
- `v2/worker/native/{PrivateStorage.cs,private-storage.ps1,test-attacks.ps1}`:
  fixed native backing and isolated negative-fixture script (never production-called).
- `v2/worker/src/{windows-storage.ts,windows-storage.test.ts,private-files.ts,
  vault.ts,vault.test.ts,provision.ts,provisioning.ts,provisioning.test.ts,prepare.ts,
  storage-fixture.ts,index.ts}` and `v2/worker/vitest.config.ts`: backing,
  bounded protocol, production integration, preparation and native/shared tests.
- `v2/web/app/connect/page.tsx`: replace superseded Linux-only platform notice.
- `v2/web/lib/{connection-bff.ts,connection-bff.test.ts}`: durable grant consumption
  and platform-private test setup, preserving authentication requirements.
- `v2/scripts/{runtime.mjs,start.mjs,web.mjs,smoke.mjs}` and
  `v2/server/src/index.ts`: native cooperative lifecycle and shared built smoke.
- `v2/scripts/{verify-import.mjs,update-local-import.mjs}`, `v2/.gitattributes`,
  `v2/IMPORT-MANIFEST.json`: Windows separator/byte-stable complete inventory.
- `v2/{README.md,CONNECTION-API.md,CONNECTION-OPERATIONS.md}`, this YAML spec
  and the two worktree wiki pages below: current scope/operational closeout.

Original archive/pin/license/lockfile and Go production code are unchanged. No
npm dependency upgrade or new binary import: helper is reviewed local source
compiled with the stated OS prerequisites. Manifest preserves upstream hashes and
accounts for every new/modified V2 file; byte-preserving git attributes avoid
Windows line-ending changes to pinned legal text and source.

### NET cumulative project wiki disposition (both baselines)

No host/personal vault imported or consulted. The **complete original-ticket**
a1498e3..HEAD wiki set remains exactly:

1. `.llm-wiki/wiki/concepts/zar-213-v2-foundation.md` — modified: historical M2/M3
   transition and provider constraints, now links the superseding Windows boundary.
2. `.llm-wiki/wiki/concepts/zar-214-protected-account-boundary.md` — added relative
   to original ticket: durable account/security/provisioning architecture, provider
   normalization/lifetime safety, now DPAPI/ACL/IPC/durability/acceptance limits.

The **native Implement launch-source** cadf266..HEAD set is separately exactly
**both paths above, modified**. This set includes the cumulative native work, not
just the last edit, and does not reset on remediation. Earlier ab363b2-based native
projectWiki receipts are historical; they are not this launch's accounting.


### Native implementation Linux receipts (precommit; Windows still pending)

All eight configured commands ran sequentially with complete output/exit inspection
in this worktree, Node22.22.1. Later focused self-review corrections were followed
by fresh test/build/smoke; all eight will also be rerun on the committed candidate
without editing the closeout afterward. These are Implement receipts, not fresh
independent/adversarial or hosted receipts:

| Command | Exit | Genuine result |
| --- | --- | --- |
| `GOTOOLCHAIN=go1.26.1 go test -race ./...` | 0 | All Go packages passed; no race diagnostics |
| `GOTOOLCHAIN=go1.26.1 go vet ./...` | 0 | No diagnostics |
| `npm --prefix v2 ci --no-audit --no-fund` | 0 | 317 packages; unchanged Recharts deprecation warning |
| `npm --prefix v2 test` | 0 | 18 upstream, 125 worker/BFF/protocol, 8 process/network; six native-only cases correctly await Windows; 82 upstream / 359 candidate import paths |
| `NEXT_TELEMETRY_DISABLED=1 npm --prefix v2 run build` | 0 | Server/worker TypeScript and Next15.5.25 production build passed |
| `npm --prefix v2 run test:smoke` | 0 | Built preparation/provisioning, authenticated BFF/private worker, default offline, parent disconnect, occupied-port cleanup, healthy release, abrupt death and restart lock refusal passed |
| `git diff --check` | 0 | No whitespace errors |
| `git status --short` | 0 | Only intended source/test/CI/docs/import/wiki changes; committed before final checks/reviews |

Initial build failures were Buffer generic inference and Next's required NODE_ENV
augmentation in the helper spawn environment; both were corrected without changing
tests/dependencies, and full build reruns passed. Expected EADDRINUSE/child-exit
output tests occupied ports; expected generic secure-setup failure tests a retained
crash marker. Neither is a hidden unexpected failure. No external broker requests,
real secrets, owner data or fabricated Windows receipts. Full original-baseline
self-review preserved provider normalization/handle lifetime, removed stale UI/CLI
Linux-only notices, rejected inherit-only public private-directory ACEs, and kept
canonical Windows CLI path rejection and post-consumption grant-expiry checks.
Adversarial disposition: **independent adversarial clearance is pending**, not
self-certified by Implement. Fresh correctness Review, distinct adversarial Test,
final-head native hosted evidence and parent publication/lifecycle checks remain
required; any ticketed changes after final review require repeating that review.


## Prior corrective native helper delivery (historical, failed hosted acceptance)

### Evidence, established dependency and bounded correction

Launch source is completed PR458 `97dfaf82490df46f9ec7bada7b8c13acb4b9c5fa`.
Original-ticket baseline remains `a1498e3fc7394d4622a13236622aeb8b926e78f5`.
Parent reports native run **35363943719**, job **105661706999**: **14 failed,
114 passed, 3 skipped**, 214.26 seconds, failures at secure-storage create/protect;
native build/smoke did not run. Full hosted log was not supplied to this sandbox.
Approximate 15-second failures suggest the unchanged helper deadline, not a proven
root cause. A separately supplied direct local probe immediately rejected temp
ancestor ACLs; this is a legitimate independent fail-closed condition, not evidence
that hosted CI had that ACL or permission to repair user temp/home.

Source establishes an EOF dependency: oversized Console.In TextReader reads after
compilation terminate only on EOF. This is unsuitable for a one-request pipe that
may stay open. Replaced it with raw bounded binary exact reads: four-byte big-endian
byte count, 1..220000 strict UTF-8 bytes, closed request schema, one frame/process.
Both production and fixed negative fixtures use the same hash-pinned reader. A
native regression deliberately splits header/payload and keeps stdin OPEN while
requiring successful actual DPAPI, then verifies synchronous spawnSync unprotect.
Malformed/truncated/oversized frames and invalid UTF-8 reject at FRAME without
compilation; an incomplete open frame is killed/joined at the test deadline. Linux
checks validate encoding/bounds/hash/diagnostic logic, **not PowerShell execution**.
No assertion that this was the hosted root cause or a native passing receipt.

Compilation no longer inherits TEMP/TMP or hunts home. Owners explicitly set
`GELT_WINDOWS_PRIVATE_PARENT` to a canonical C: system-volume ancestor (<=120
characters, e.g. `C:\` only if it already passes). The helper validates fixed NTFS,
no reparse/aliases, trusted owner and non-null supported DACLs root-to-leaf, retaining
the original unsafe-rights denial (also rejecting generic write/all masks). Only a
new random owner-private child is created, checked private/empty before compiling
public reviewed source. Parent ACLs are never changed; unsupported/unwritable roots
stay unavailable. Existing C# handle-retained storage checks/DPAPI/flush/locks are
unchanged. Scratch deletion is caught and sanitized; success is emitted only after
cleanup. Forced termination may leave private public-source scratch; no automatic
broad sweep or credential search. Same-user/admin/OS compromise remains excluded.

Fixed sources remain SHA-256 validated; existing V2 `-text` already preserved bytes,
so checkout conversion is **not** asserted as the observed cause. Narrow LF helper
rules make the compiled-source contract explicit. Standard absolute PowerShell5.1
and .NET4.8 CodeDOM use only fixed SystemRoot/WINDIR and the explicit nonsecret
parent; no PATH, inherited TEMP/TMP, credentials, proxies or NODE_OPTIONS. Runtime
forwards the same nonsecret prerequisite without mixing worker/BFF config roles.
No helper executable/script selection, secret argv or raw exception output.

Closed stderr stages START/FRAME/ROOT/COMPILE/OPERATION/CLEANUP/DONE and a bounded
failure tag distinguish native failures without request/path/exception dumping.
The wrapper validates diagnostics and exposes only an internal closed stage code;
public errors remain generic. The native preflight prints only stage elapsed ms and
aggregate synchronous operation cost. It must succeed on real DPAPI and private
create/read/replace/remove before the full Node suites/build/smoke. Explicit
windows-2022/Node22 x64/PowerShell5.1/.NET4.8/NTFS, minimal permissions and synthetic
cleanup remain. The hosted job uses explicit `C:\`, never runner TEMP ACL repair.
Per-operation 15-second and lifecycle budgets are **not increased**, no caching,
daemon or dependency added. Native compilation/startup measurements remain pending;
if these exceed lifecycle budgets, block acceptance and review bounded reuse rather
than weakening/skipping tests. Linux Go and Node jobs remain intact.

### Corrective changed files and cumulative wiki disposition

Exact correction packet is 97dfaf8..final HEAD, alongside COMPLETE a1498e3..final
HEAD for both fresh reviews. This correction changes:

- `.github/workflows/v2.yml`: explicit safe-parent prerequisite and native success
  preflight before unchanged full test/build/smoke gates.
- `v2/.gitattributes`, `v2/package.json`: helper LF rules and preflight command only;
  no lockfile/dependency/version/license/pin changes.
- `v2/worker/native/{private-storage.ps1,read-frame.ps1,test-attacks.ps1}`:
  framing, safe explicit scratch, stage diagnostics and sanitized cleanup.
- `v2/worker/src/{windows-storage.ts,windows-storage.test.ts,storage-fixture.ts,
  windows-helper-fixture.ts,windows-preflight.test.ts}`: wrapper, exact hashes,
  native success/failure tests, isolated roots and bounded joined test helper.
- `v2/scripts/{runtime.mjs,runtime.test.mjs}`: minimal nonsecret parent environment.
- `v2/{CONNECTION-OPERATIONS.md,CONNECTION-API.md,README.md,IMPORT-MANIFEST.json}`,
  this specification and the protected-boundary wiki below: operational contract,
  truthful evidence and complete V2 inventory (original upstream hashes retained).

NET original a1498e3..HEAD wiki set is still exactly **two** committed paths:
`.llm-wiki/wiki/concepts/zar-213-v2-foundation.md` (modified historical transition),
`.llm-wiki/wiki/concepts/zar-214-protected-account-boundary.md` (added durable M3
boundary including provider normalization/lifetime handles and Windows constraints).
Native Implement's separate **fixed launch 97dfaf8..HEAD** cumulative wiki set is
exactly **one** path: `.llm-wiki/wiki/concepts/zar-214-protected-account-boundary.md`
(modified framing, explicit scratch/environment, diagnostics and native acceptance
constraints). Earlier cadf266/ab363b2 launch accounting is historical only. No
host/personal vault was consulted; no routine session transcript/secret imported.

### Corrective verification and review gate

Actual Linux receipts are recorded below before committing closeout. Native code
has **not executed here**; corrected final-head Windows tests/build/smoke remain
parent-owned pending after candidate publication. PR remains draft, not merge-ready.
Independent correctness Review and distinct adversarial Test must inspect the full
original-baseline patch plus this correction, explicitly clear blocker/high findings
and produce unchanged-head checks. **Adversarial clearance is pending**, not
self-certified by Implement. Scope/design/docs/import/wiki precede final reviews;
any later ticket change repeats review. No merge, broker call or live OAuth/browser
proof, controller/state repair, broad installed-tool change or ZAR-234 expansion.

### Genuine Linux working-candidate receipts (Implement, not native acceptance)

Node 22.22.1 / npm 9.2.0, Linux x64. All eight configured commands ran sequentially
with complete output and exit inspection; tests/build were repeated after bounded
helper-fixture cleanup and source-error diagnostic polishing. The committed
candidate will receive another full sequential eight-command run without modifying
this closeout. Independent Test must supply its own unchanged-head receipts.

| Command | Exit | Observed result |
| --- | --- | --- |
| `GOTOOLCHAIN=go1.26.1 go test -race ./...` | 0 | All Go packages passed, no races |
| `GOTOOLCHAIN=go1.26.1 go vet ./...` | 0 | No diagnostics |
| `npm --prefix v2 ci --no-audit --no-fund` | 0 | 317 packages, retained Recharts deprecation warning |
| `npm --prefix v2 test` | 0 | 18 upstream + 127 worker/BFF/protocol + 8 process/network passed; 9 native-only tests await Windows; import 82 upstream / 362 candidate paths |
| `NEXT_TELEMETRY_DISABLED=1 npm --prefix v2 run build` | 0 | Server/worker TypeScript and Next15.5.25 production build passed |
| `npm --prefix v2 run test:smoke` | 0 | Default/protected built bootstrap, private worker, healthy release, abrupt restart refusal and child/port cleanup passed, no provider requests |
| `git diff --check` | 0 | No whitespace errors |
| `git status --short` | 0 | Only the 19 intended corrective files above (including 3 new source/test files); committed during closeout, clean status required afterward |

The initial focused test invocation before npm ci returned 127 because dependencies
were not installed; the post-install focused suite and full suites passed. Expected
occupied-port EADDRINUSE/child-exit and crash-marker setup refusal are asserted
negative smoke/lifecycle cases, not suppressed failures. Git attributes explicitly
report helper text/eol=lf and retained legal text unset; exact helper hashes pass
on Linux. This does not test a Windows checkout or actual DPAPI/ACL semantics.
No change to Go source/CI, original archive/pin/licenses/lockfile, provider mapping,
lifetime handles, authentication or broker/telemetry/backtest guardrails. Fresh
independent/adversarial and hosted Windows acceptance remain required.

## FRAME investigation from published 3b8f713 (historical closeout)

### Established evidence and decision boundary

Fixed launch is completed PR458 **3b8f7132ade3deceeb9d930b75108cf34a105f5f**,
not a failed candidate. Full original review baseline remains immutable
**a1498e3fc7394d4622a13236622aeb8b926e78f5**. Parent reports hosted native run
**35367729350**, job **105674126207**, failed its first preflight after **15047ms**:
`Native preflight unavailable at FRAME; no native acceptance`. Subsequent tests,
build and smoke **did not execute**. Prior implementation/review/Linux receipts
are historical and do not establish native acceptance.

Parent's separate synthetic Windows11/Node24 direct-helper probes reached ROOT
promptly (and rejected the local root ACL), including stdin left open and splits
at 0:2, 2:7 and 7:end with 25ms intervals. No real secrets were used. Those probes
constrain, but do not establish, Server2022/Node22 behavior. The supplied FRAME
receipt alone cannot locate blocked/lost bytes, .NET array binding, PowerShell
Console reads, JSON decode, or Vitest interaction. No complete hosted transport
trace was supplied. Repository inspection finds the existing exact binary-read
loops and delayed split writes; no fake-timer setup occurs in the worker/BFF suites
or their Vitest config. Neither source inspection nor Linux can establish which
native mechanism failed. We do **not** claim a root cause or an effective production
transport correction, and do not guess one from elapsed time.

The approved bounded fallback is therefore a **diagnostic candidate**, not
merge-ready Windows support. New hosted evidence must select any subsequent
minimal correction. This is not another timeout increase or a replacement of real
native success with Linux mocks. Windows support remains required, not dropped.

### Implemented diagnostics and native comparison

- Hash-pinned fixed helper adds `FRAME_HEADER`, `FRAME_HEADER_DONE`,
  `FRAME_PAYLOAD`, `FRAME_PAYLOAD_DONE`, `FRAME_UTF8`, `FRAME_JSON` and
  `FRAME_SCHEMA` between existing FRAME and ROOT stages. Header/payload loops,
  allocation bounds, byte order, strict UTF-8, request validation and native
  storage primitives are unchanged. Negative attack fixtures use the same reader
  without tracing; only the fixed production entrypoint enables tracing.
- Closed diagnostic validation and exact packaged hashes update together. New
  tests accept every bounded prefix/failure stage and reject arbitrary values.
  Native malformed-frame tests still assert failure without compilation, now at
  the exact header/payload/decode/schema stage. Truncated/oversized/invalid UTF-8
  and incomplete-open-frame deadline/kill/join coverage is retained.
- Test-only fixture marks fixed spawn, first/second/last or whole write queued/
  completed, EOF queued/completed or left-open, pipe-error, deadline and joined
  events. Only public labels and elapsed ms enter CI reports, even on failure;
  never request/response bytes, secret lengths, paths, exceptions or environment.
  A Node write callback means OS pipe submission, not PowerShell consumption.
- One fixed synthetic 32-byte public key drives identical **closed, open and
  split-open** frames in `windows-transport-fixture.ts`. Every variant must protect
  with real DPAPI, produce the complete success protocol, and synchronously
  unprotect back to the original key. All three variants are attempted even when
  one fails. Reports never include plaintext or encrypted keys.
- `test:windows-transport` compiles using the existing pinned TypeScript and runs
  that fixture directly in Node22, with no Vitest transform/timer layer. The
  existing Vitest preflight uses the same fixture and still additionally requires
  real private NTFS create/read/replace/remove. Separate transport and filesystem
  test cases keep six DPAPI calls and seven filesystem calls within the existing
  per-test budget without extending it. The direct script hard-fails on
  unsupported runtime; a Linux test verifies it cannot issue a native receipt.
- Hosted workflow runs Vitest comparison even after a direct-gate failure; no
  continue-on-error or optional success path. Both must pass before existing full
  Node security tests, build and process smoke can run. Server2022, Node22 x64,
  PowerShell5.1, .NET4.8, unchanged NTFS ancestor requirements and minimal workflow
  permissions remain. No broker requests, credentials or uploaded secret artifacts.

Production 15000ms timeout, bounded stdin/stdout/stderr, fixed executable/argv,
source verification, safe environment and kill-and-join behavior remain. No
arbitrary scripts/executable discovery, ACL relaxation/repair, home/temp search,
silent migration or weaker fallback. DPAPI-current-user, handle-retained NTFS
ownership/reparse checks, protected creation, same-volume flush/write-through,
crash/persistence writer barriers and same-user/admin threat limits are unchanged;
no POSIX or physical-power-loss durability claim. Private-file callers (vault,
provisioning, config/setup, BFF/bootstrap/owner and locks) still dispatch through
`private-files.ts`. Provider normalization, lifetime handles, session/Host/Origin/
CSRF/callback/generation checks, private service authentication, environment role
separation and official-worker-only egress are preserved. No V1/Go, archive, pin,
license, lockfile, backtest, telemetry or execution-policy changes.

### Current changed-file/provenance and NET wiki accounting

The full a1498e3..final HEAD patch (including all historical implementation) and
separate **3b8f713..final HEAD** correction patch must both be reviewed in full.
The current correction contains exactly these 17 paths:

- `.github/workflows/v2.yml` — required direct/transform comparison gates.
- `v2/package.json` — additional compile/direct-native command only.
- `v2/worker/native/{read-frame.ps1,private-storage.ps1}` — fixed stage brackets.
- `v2/worker/src/{windows-storage.ts,windows-storage.test.ts}` — closed stage
  validation, exact hashes and unchanged malformed-frame rejection coverage.
- `v2/worker/src/{windows-helper-fixture.ts,windows-preflight.test.ts,
  windows-transport-fixture.ts}` — bounded scheduling reports and shared native
  success cases (last file new).
- `v2/scripts/{windows-transport.mjs,windows-transport.test.mjs}` — new direct
  compiled entrypoint and unsupported-runtime negative regression.
- `v2/{README.md,CONNECTION-OPERATIONS.md,CONNECTION-API.md,IMPORT-MANIFEST.json}`
  — operational/API/evidence limits and full local hash accounting.
- This specification and `.llm-wiki/wiki/concepts/zar-214-protected-account-boundary.md`.

Manifest records **82 original upstream paths / 365 candidate files**, including
all three new local sources/tests. Original hashes, MIT, notices and lockfile are
unchanged; no dependencies or binary imports. Full changed-file groups in earlier
sections plus this list account for the original-ticket patch. Generated outputs
remain ignored; no operational artifacts are intended in the committed source.

Evaluated NET original-ticket a1498e3..HEAD, not just this attempt: wiki disposition
is exactly `.llm-wiki/wiki/concepts/zar-213-v2-foundation.md` **modified** (historical
M2/M3 transition) and `.llm-wiki/wiki/concepts/zar-214-protected-account-boundary.md`
**added** (durable M3 security/provider/lifetime/Windows constraints). No original
wiki change is omitted. Separately, native Implement's fixed launch
**3b8f713..final HEAD** cumulative wiki path set is exactly **one modified path**:
`.llm-wiki/wiki/concepts/zar-214-protected-account-boundary.md`. This records durable
safe diagnostic/comparative-native-verification constraints, not session status,
transcripts or secrets. It includes all internal remediation and must not reset
on retry. Older launch-source dispositions above are historical only. No host or
personal vault has been consulted/imported.

### Genuine Linux Implement receipts and remaining gates

Linux x64 / Node **22.22.1**, npm **9.2.0**. All eight configured commands ran
sequentially, with complete output and exit inspection, on the working candidate
before this receipt was added; unit tests were repeated after separating native
transport/filesystem cases within existing budgets. This is not a self-referential
final-commit receipt.
After committing all closeout/import/wiki changes, Implement reruns the complete
sequence without modifying the source; independent Test supplies its own exact-head
receipts. No native execution occurred in this sandbox.

| Command | Exit | Observed working-candidate result |
| --- | --- | --- |
| `GOTOOLCHAIN=go1.26.1 go test -race ./...` | 0 | All Go packages passed, no race diagnostics |
| `GOTOOLCHAIN=go1.26.1 go vet ./...` | 0 | No diagnostics |
| `npm --prefix v2 ci --no-audit --no-fund` | 0 | 317 packages; retained Recharts deprecation warning |
| `npm --prefix v2 test` | 0 | 18 upstream + 127 worker/BFF/protocol + 9 process/network/runtime tests passed; 10 native-only tests await Windows; import 82/365 passed |
| `NEXT_TELEMETRY_DISABLED=1 npm --prefix v2 run build` | 0 | Server/worker TypeScript and production Next15.5.25 build passed |
| `npm --prefix v2 run test:smoke` | 0 | Default and protected built bootstrap/private worker, healthy release, abrupt restart refusal and lifecycle cleanup passed; no provider requests |
| `git diff --check` | 0 | No whitespace errors |
| `git status --short` | 0 | Only the 17 intended correction files above; committed during closeout, clean final status required |

Expected EADDRINUSE/child-exit and retained-crash-marker setup refusal are deliberate
negative cases followed by passing cleanup assertions, not hidden failures. All
source tests/build/smoke passed on their first execution in this attempt. Hash and
protocol tests are genuine Linux evidence, **not** PowerShell/NTFS/DPAPI evidence.

**Adversarial verdict: independent adversarial clearance is pending.** Implement
does not certify itself as either fresh correctness Review or distinct adversarial
Test. Both must examine complete original-baseline patch plus current correction
and explicitly clear blocker/high findings; missing evidence blocks acceptance.
Parent-owned exact-head Windows CI must establish real helper success, DPAPI/ACL
preflight, full suites/build/smoke and lifecycle cleanup before any native readiness
claim or undrafting PR458. A persistent FRAME or unsafe ROOT result remains a
blocker, not permission to extend timeouts, weaken ACLs or skip tests. Linux hosted
CI, App publication/base/head, terminal completion and lock release also remain
parent-owned. Candidate publication is only for that diagnostic gate; no merge,
deployment, live broker/OAuth action, controller repair or ZAR-234 expansion. Any
source/docs/wiki change after final review requires renewed review and verification.

## Prior pre-header prerequisite correction — launch 734fc309 (historical closeout)

### Evidence, bounded design and acceptance boundary

Fixed launch source is completed PR458 **734fc30926dc3e6ea87132cdeabc2d7b8e4dc631**;
original-ticket baseline remains **a1498e3fc7394d4622a13236622aeb8b926e78f5**.
The approved Plan/previousCumulative retains the earlier diagnosis and storage
implementation, but does not establish native acceptance. No failed candidate or
controller state was changed. The owner still requires native Windows; older
Linux-only restrictions and old launch-source accounting are historical only.

Parent supplies genuine hosted failure **35370708125 / job 105683722277**: both
compiled direct Node22 and Vitest, every closed/open/split-open mode, START about
200ms, FRAME about 210ms, deadline 15000ms, **no FRAME_HEADER**. Fixture writes
completed promptly; even closed EOF completion waited until kill. Crucially,
FRAME occurs **before** Join-Path/dot-source/function entry/OpenStandardInput/
New-Object. The evidence localizes the stall before the first header read, not
inside payload/EOF reading. Other-version Windows11/Node24 probes reaching ROOT
cannot explain hosted Server2022/Node22. The exact blocked operation and effective
native correction remain unproven until parent-owned hosted execution.

Implemented the approved bounded design:

- Bracket fixed reader path construction, dot-source, function entry, stdin open
  and header allocation with closed before/after stages. Retain all header/payload/
  UTF-8/JSON/schema stages and add explicit trusted-module import brackets. Update
  stage validators and packaged SHA256 pins together. No paths, exception details,
  environment values, request/response bytes or secret lengths enter diagnostics.
- Replace avoidable Join-Path/New-Object/Sort-Object with PowerShell5.1-compatible
  .NET Path.Combine, array/security constructors and ordinal Array.Sort. This
  removes unnecessary command discovery before reads and during protected scratch
  creation; it is **not a claimed measured root-cause fix**. Framing byte bounds,
  read loops and 15-second production deadlines are unchanged.
- Disable production module autoload; require standard PSHOME and explicitly
  import the fixed system Microsoft.PowerShell.Utility manifest. JSON/Add-Type are
  module-qualified. The helper environment adds only the fixed standard system
  Modules path as PSModulePath; never inherits PSModulePath, module cache settings,
  PATH, TEMP/TMP, profiles, NODE_OPTIONS, proxies or credentials. Missing trusted
  prerequisites fail closed. No cache/home discovery or repair is added.
- New hash-pinned `prerequisite-probe.ps1` has eight fixed enum actions: .NET path,
  dot-source, OpenStandardInput, array, legacy Join-Path/New-Object autoload, fixed
  Utility import/JSON and Add-Type command resolution. Each runs in an independent
  production-environment PowerShell process, with **empty open stdin**, 15-second
  deadline, 16-byte stdout/256-byte stderr limits and joined cleanup. Only fixed
  enum argv is allowed, never caller scripts/paths or secrets. Add-Type probe does
  not compile; actual compilation still occurs only after private scratch passes
  unchanged ancestor/ACL validation. Legacy probes alone intentionally autoload
  against the fixed system module path to distinguish that mechanism.
- Every probe runs even if another fails. Direct Node continues to all three real
  DPAPI transport modes after prerequisite failures; Vitest has independent test
  cases and still attempts real NTFS preflight. Workflow requires both gates;
  no continue-on-error, skipped security suite or timeout increase. Native full
  tests/build/smoke remain mandatory. The negative ACL/reparse fixture uses the
  same restricted environment, .NET constructors and fixed qualified system
  modules, not untrusted discovery. New Linux protocol tests reject arbitrary,
  duplicate, reordered and oversized diagnostics and arbitrary probe actions.

Storage call-site audit: provisioning/prepare, config/setup, broker vault/key,
bootstrap owner/grant, BFF/service secret and persistent locks still use
`private-files.ts`. Linux UID/mode/no-follow/fsync is unchanged. Windows retains
current-user DPAPI key wrapping, key/data separation, handle-held NTFS ancestor/
identity/reparse/hardlink/owner/DACL validation, new-only private directories,
exclusive writers, poisoned persistence and restart barriers. No plaintext/shared
key fallback, migration, broad ACL repair or credential hunting. Windows uses
native flush/write-through replacement, not claimed POSIX directory fsync or
physical power-loss guarantees. Same-user/admin/system/servicing compromise remains
outside the boundary. Trusted checkout and standard protected OS/module installation
are prerequisites, not protection against compromised dependencies/OS. Abrupt
termination may leave private public-source scratch; never authorize broad cleanup.

Provider normalization, lifetime selection handles, masking, authentication,
Host/Origin/CSRF, one-use session-bound callbacks, refresh/disconnect generations,
private worker service auth, role-restricted child environments and official-worker-
only egress are unchanged. No Go production, V1/archive, pin/licenses, lockfile,
backtest/telemetry, execution-policy or ZAR-234 scope changes. Tests are synthetic,
isolated and offline; no OAuth, broker, trade/cancel/funding, deployment or merge.

### Complete correction file/provenance and cumulative wiki accounting

The **734fc309..final HEAD** correction contains these **16 paths**, in addition
to the full original-baseline changes enumerated in historical sections:

- `.github/workflows/v2.yml` — identify independent direct/Vitest prerequisites;
  retain Windows2022/Node22 x64, PowerShell5.1/.NET4.8/NTFS, minimal permissions.
- `v2/scripts/windows-transport.mjs` — run all independent probes and transport
  modes without suppressing either on failure.
- `v2/worker/native/{private-storage.ps1,read-frame.ps1,test-attacks.ps1}` — staged
  pre-read path, trusted module resolution and constructors.
- `v2/worker/native/prerequisite-probe.ps1` **new** — fixed independent native probes.
- `v2/worker/src/windows-prerequisite-fixture.ts` **new** — bounded child lifecycle,
  closed diagnostic parser and all-probe orchestration.
- `v2/worker/src/{windows-storage.ts,windows-storage.test.ts,windows-preflight.test.ts}`
  — pins, stage/environment contract, protocol and mandatory native coverage.
- `v2/{README.md,CONNECTION-OPERATIONS.md,CONNECTION-API.md,IMPORT-MANIFEST.json}`
  — honest prerequisites/evidence boundary and exact local import accounting.
- This specification and `.llm-wiki/wiki/concepts/zar-214-protected-account-boundary.md`.

Inventory is **82 original upstream paths / 367 candidate files**. Original hashes,
MIT/notices and retained lockfile remain verbatim; no new dependency, binary import
or broad tool upgrade. Generated outputs are ignored, not source artifacts.

Evaluated NET original-ticket **a1498e3..final HEAD**, retaining all prior work:
`.llm-wiki/wiki/concepts/zar-213-v2-foundation.md` is **modified**, and
`.llm-wiki/wiki/concepts/zar-214-protected-account-boundary.md` is **added**. These
are every committed original-ticket wiki path. Separately, native Implement's
fixed **734fc309..final HEAD** cumulative path set is exactly **one modified file**:
`.llm-wiki/wiki/concepts/zar-214-protected-account-boundary.md`. It documents durable
pre-read localization, deterministic trusted prerequisite resolution and safe
native verification constraints, not routine status/transcripts. This launch
baseline stays fixed across internal remediations. No personal/host vault consulted
or imported.

### Genuine Linux receipts and pending final gates

Working candidate, Linux x64, Node **22.22.1**, npm **9.2.0**, all eight commands
ran **sequentially**, each exit and complete output inspected. These precommit
receipts precede this closeout text; they do not purport to test their own commit.
After committing all source/docs/import/wiki, Implement repeats the eight commands
at the unchanged head; the session records those exact-head receipts. Independent
Test must separately execute and report all eight after fresh reviews.

| Command | Exit | Genuine working-candidate observation |
| --- | --- | --- |
| `GOTOOLCHAIN=go1.26.1 go test -race ./...` | 0 | All Go packages passed, no races |
| `GOTOOLCHAIN=go1.26.1 go vet ./...` | 0 | No diagnostics |
| `npm --prefix v2 ci --no-audit --no-fund` | 0 | 317 packages, retained Recharts deprecation warning |
| `npm --prefix v2 test` | 0 | 18 upstream + 128 worker/BFF/protocol + 9 process tests; 18 native-only cases await Windows; import 82/367 passed |
| `NEXT_TELEMETRY_DISABLED=1 npm --prefix v2 run build` | 0 | Server/worker TypeScript and Next15.5.25 production build passed |
| `npm --prefix v2 run test:smoke` | 0 | Offline and protected bootstrap/BFF/private worker, release/crash restart refusal and child cleanup passed, no broker requests |
| `git diff --check` | 0 | No whitespace errors |
| `git status --short` | 0 | Exactly the 16 intended paths above before commit; clean final tree required |

Expected EADDRINUSE/child-exit and secure-setup refusal diagnostics were deliberately
exercised negative cases with passing cleanup assertions, not hidden failures.
All eight checks passed on first execution. No native Windows/PowerShell execution
occurred here. Linux cannot prove NTFS, DPAPI, module loading, Windows durability,
helper timing or built Windows process cleanup.

**Adversarial verdict: distinct independent adversarial clearance pending.**
Implement cannot clear itself. Fresh correctness Review and distinct adversarial
Test must inspect the complete a1498e3..final HEAD patch plus 734fc309..final HEAD
correction and full named files, explicitly clearing all blocker/high findings.
Parent-owned exact-head Windows hosted independent probes, real DPAPI/ACL preflight,
full tests/build/smoke, Linux hosted CI, App publication/base/head and lifecycle/
lock-release evidence remain pending. PR458 stays **draft diagnostic candidate**,
not merge-ready. Failure must narrow the next correction, never justify relaxed
ACLs, additional credential environment, skipped tests or timeout inflation.
Any artifact change after final review requires repeated review and verification.

## Current ROOT enum-mask correction — launch 6804a5e5

### Evidence, design and preserved boundaries

Fixed corrective launch: **6804a5e530c25b08909637cd963327fac3ae42f0**, completed
PR458, not a failed candidate. Full immutable original-ticket baseline remains
**a1498e3fc7394d4622a13236622aeb8b926e78f5**. PreviousCumulative Plan requires the
bounded type correction and diagnostic/gating separation, retaining all earlier
remediation context. Historical failed receipts above are preserved, not erased.

Parent supplies actual native **35373683086 / job 105693300572**: .NET path/array
replacements and explicit module import allow **all closed/open/split-open frames
to reach ROOT in about 350ms**, without transport timeout. Legacy Join-Path and
New-Object autoload probes still stall at BEFORE; explicit-import JSON/Add-Type
probes pass. This resolves the former transport stall; unused implicit autoload
is not a required production dependency and must not determine acceptance.

Parent separately reproduced the precise ROOT exception in the exact helper copy
at line 64, with synthetic data on native Windows PowerShell5.1:
`$ace.AceFlags -band 8` produces `Specified cast is not valid.` A pure enum
ContainerInherit reproduction fails identically; `([int]$v) -band 8` returns 0.
These are **supplied native receipts**, not executions in this Linux sandbox.
No speculative remaining ROOT cause is substituted for that concrete type defect.

Implemented changes:

- Cast the AceFlags operand to integer before numeric mask 8; preserve the exact
  unsafe-ancestor access mask **0x500D0150**, owner/trusted-principal checks,
  CommonAce/callback/qualifier validation and every ACL rejection rule.
- Audit every shipped PowerShell helper/fixture bitwise expression: the other
  production masks are FileAttributes paired with FileAttributes (same enum type)
  or integer AccessMask paired with an integer. No equivalent uncast enum/numeric
  mask remains. New fixed native enum probe tests real CommonAce flags, including
  ContainerInherit/InheritOnly, unsafe FullControl versus read-only rights and
  existing like-typed FileAttributes masks. No new executable/module/dependency.
- Keep both legacy autoload comparisons independent, 15s-bounded, joined, and
  sanitized in logs with explicit `required:false`. They no longer fail the
  aggregate gate. Every replacement API, explicit-import JSON/Add-Type and new
  enum-mask probe is `required:true`; Linux classification tests exhaust the
  closed probe set. Both direct Node and Vitest share that decision. No production
  helper failure is suppressed; real closed/open/split-open protect/unprotect and
  private create/read/replace/remove still require full success through DONE.
- Add native real-ACL ROOT regression: fresh isolated owner-private ancestor and
  then inherit-only untrusted ACE allow protect/unprotect through cleanup; adding
  applicable untrusted FullControl rejects at ROOT without scratch or error leaks.
  Existing private-object inherit-only rejection remains (ancestor and private
  object policies intentionally differ). Exact packaged source SHA-256 pins update.

Storage and call-site audit retains private-files dispatch for broker key/vault,
worker/BFF config, service secret, registration, bootstrap grant/owner files,
provisioning and locks. Linux UID/mode/no-follow/fsync is unchanged. Windows retains
current-user DPAPI, owner-private protected NTFS DACLs, ancestor/reparse/path checks,
protected new-only creation, separate key paths and exclusive/persistent writers.
Same-user/admin/system/servicing/compromised-OS limits remain explicit; Windows
flush/write-through replacement is not POSIX directory fsync or physical-power-loss
proof. Failed persistence poisons access and preserves restart barriers; no silent
migration, broad ACL modification, plaintext/shared fallback or credential hunting.

Native runtime/IPC cleanup, fixed executable/scripts/modules, source integrity and
safe nonsecret environment are unchanged. Secrets stay off argv/logs/errors/browser;
private storage input remains framed bounded stdin. Provider normalization/lifetime
handles, masking, one-use callback/session/generation guards, Host/Origin/CSRF,
private service auth, named-tool denial and official-worker-only egress remain.
No Go/V1/archive/pin/licenses/lockfile, offline/backtest/telemetry, broker execution
or ZAR-234 expansion. Existing Windows2022/Node22 x64/PowerShell5.1/.NET4.8/NTFS
hosted job already executes the added cases; no workflow weakening is needed.

### Complete correction/import and NET wiki accounting

The **6804a5e5..final HEAD** correction contains exactly these **12 paths**:

- `v2/worker/native/{private-storage.ps1,prerequisite-probe.ps1}` — typed mask and
  required native enum regression.
- `v2/worker/src/{windows-storage.ts,windows-storage.test.ts,
  windows-prerequisite-fixture.ts,windows-preflight.test.ts}` — integrity pins,
  classification, native real ACLs and mandatory production-success coverage.
- `v2/{README.md,CONNECTION-API.md,CONNECTION-OPERATIONS.md,IMPORT-MANIFEST.json}`
  — evidence/operational contract and exact local hash accounting.
- This specification and `.llm-wiki/wiki/concepts/zar-214-protected-account-boundary.md`.

Manifest still accounts for **82 original upstream paths / 367 candidate files**;
no added dependency/binary/import path, upstream hash, lockfile or notice changes.
Original-baseline complete changes include all historical groups above; the full
actual name-status/stat/patch, not this correction alone, is the review authority.

NET original-ticket **a1498e3..final HEAD** committed wiki paths remain exactly:

1. `.llm-wiki/wiki/concepts/zar-213-v2-foundation.md` — **modified**, historical
   M2/M3 transition, provider and superseding native-platform constraints.
2. `.llm-wiki/wiki/concepts/zar-214-protected-account-boundary.md` — **added**, full
   durable M3 security/provider/lifetime/native architecture and acceptance limits.

Separately, Implement projectWiki for fixed **6804a5e5..final HEAD**, across all
internal remediations, is exactly **one modified path**:
`.llm-wiki/wiki/concepts/zar-214-protected-account-boundary.md`. New durable knowledge
is PowerShell enum/numeric-mask typing and required-versus-diagnostic prerequisite
policy. No personal/host vault consulted/imported; no routine transcript or secrets.

### Verification and remaining gates

Linux working-candidate receipts are recorded below before closeout commit.
Final unchanged-head Implement receipts belong in the phase session; distinct Test
must run its own eight sequential checks. No native execution occurs in this
sandbox. Supplied native transport/ROOT evidence is not final production success.

**Adversarial verdict: independent adversarial clearance pending.** Fresh
independent correctness Review and distinct adversarial Test must inspect the
COMPLETE a1498e3..final HEAD patch plus 6804a5e5..final HEAD correction and full
named files, explicitly clearing blocker/high findings. Missing evidence blocks
acceptance. All scope/design/docs/import/wiki are committed before those reviews;
any subsequent change repeats review and verification. Parent owns publication,
exact-head Linux and native Windows hosted tests/build/smoke, terminal state/lock
release and PR base/head checks. **PR458 remains draft; native acceptance pending.**
Candidate publication enables that gate, not merge readiness. No merge, deployment,
live OAuth/broker/browser proof or controller repair is claimed or authorized.

### Genuine working-candidate Linux receipts (before closeout commit)

Linux x64, Node **22.22.1**, npm **9.2.0**. All eight configured commands executed
sequentially; complete outputs and exit codes inspected. These receipts precede
this text/commit; they are not self-referential exact-head or independent verdicts.

| Command | Exit | Actual result |
| --- | --- | --- |
| `GOTOOLCHAIN=go1.26.1 go test -race ./...` | 0 | All Go packages passed, no races |
| `GOTOOLCHAIN=go1.26.1 go vet ./...` | 0 | No diagnostics |
| `npm --prefix v2 ci --no-audit --no-fund` | 0 | 317 packages; retained Recharts deprecation warning |
| `npm --prefix v2 test` | 0 | 18 upstream + 129 worker/BFF/protocol + 9 process tests passed; 20 native-only cases await Windows; import 82/367 passed |
| `NEXT_TELEMETRY_DISABLED=1 npm --prefix v2 run build` | 0 | Server/worker TypeScript and production Next15.5.25 build passed |
| `npm --prefix v2 run test:smoke` | 0 | Default/protected bootstrap/BFF/private worker, healthy release, crash restart refusal and child/port cleanup passed without provider calls |
| `git diff --check` | 0 | No whitespace errors |
| `git status --short` | 0 | Exactly the 12 intended paths above, no untracked files; committed during closeout |

Explicit `verify:import` also passed (82/367). Expected occupied-port EADDRINUSE/
child-exit and secure-setup refusal output is asserted negative lifecycle coverage,
not suppressed failure. No configured check failed. After commit, Implement reruns
all eight sequentially at the unchanged head and preserves receipts in the phase
session, with clean final status. Actual Windows enum/ACL/helper/provisioning/full
suite/build/smoke evidence remains pending publication and parent-owned hosted CI;
Linux skips are not native successes. Independent adversarial clearance is pending.
