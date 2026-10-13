# M3 explicit owner setup and operational limits

Default `npm --prefix v2 start` stays offline/disconnected. Never configure a
production connection for tests. No live login, broker access, deployment or
account changes were authorized/performed by M3 delivery.

## Current platform scope (2026-10-13)

Only Linux is supported for current development and delivery. Windows code and
procedures in this document are unsupported historical implementation evidence,
not instructions to provision a current Windows deployment or a Linux acceptance
gate. Existing security checks remain intact. Current release requires exact-source
Go build/race/vet, Linux V2 tests/build/smoke, scientific and protected-browser
checks; unresolved platform-independent safety defects still block delivery.

## Supported secure backing

Supported connected storage uses Linux, Node **22 x64**, one local OS owner and
one worker. Linux results are not evidence of Windows compatibility. The retained
unsupported Windows backend historically required Windows 11 or
Server 2022+ (build >=20348), local NTFS, standard `C:\Windows` installation,
Windows PowerShell **5.1** and .NET Framework **4.8**. Launch from the trusted `v2`
checkout; retain `worker/native` beside source/dist (including when serving Next).
Do not use WSL, network/removable/non-NTFS storage, portable copies of PowerShell,
reparse-backed checkout/storage, or deployment that omits the helper. Unavailable
backing fails closed, with no plaintext/default key or implicit migration.

AES-256-GCM, fresh 96-bit nonce per update, versioned authenticated envelope and
AAD `Gelt/M3/v1`. Explicit 32-byte random key resides in a **separate, non-nested
private directory** from ciphertext. On Linux, directories must be UID-owned 0700 and files
UID-owned regular, single-link 0600; no symlinks in files/ancestors. Ancestors must
be owner/root controlled, not group/world-writable except root-owned sticky temp
roots. Explicit absolute paths, no environment key strings. Read rejects corruption,
wrong/missing key, unsafe permissions and authentication failure. Atomic private
temp-file write, fsync, rename and directory fsync for both rotation and encrypted
null tombstone (disconnect). This is not secure erasure of old filesystem snapshots.
Protect backups and key separately; no automatic key rotation/migration implemented.

### Legacy Windows boundary and durability (unsupported)

The random AES key is persisted only as a versioned **current-user DPAPI** envelope
with application entropy, in the separate key directory. Raw Linux key files are
rejected on Windows. DPAPI does not replace file security: configs, registration,
service authentication, grants, owner file, keys, ciphertext, locks and temporaries
all require verified current-user ownership, protected DACLs and no inherited ACEs.
Only current user and trusted OS principals (SYSTEM/Administrators/servicing) may
have access. Creation uses protected security descriptors, never public creation
followed by chmod/ACL repair. Broad parent/home ACLs are never changed.

The fixed SHA-256-pinned PowerShell/C# helper opens and holds each ancestor without
share-delete, checks the actual opened object's canonical identity, NTFS filesystem,
owner and DACL, and rejects reparse points/hardlinks. Ancestors may permit traversal
and creating new entries, but not untrusted deletion of existing children, deletion
of the ancestor, security changes or attribute writes. Private files are opened
without write/delete sharing. UNC/device/ADS/reserved/ambiguous paths and paths over
220 characters are rejected; key/data directories compare case-insensitively.
Helpers use fixed absolute executable/script argv, bounded stdin/stdout, a 15-second
deadline and sanitized errors. No secrets or private storage paths are helper argv.
Compilation of public reviewed source uses a fresh protected temporary directory
under the explicit nonsecret `GELT_WINDOWS_PRIVATE_PARENT` (canonical `C:\` or
an existing ancestor on that fixed system volume, at most 120 characters). No
fallback to TEMP/TMP or home lookup. Choose an ancestor that already satisfies
owner/ACL/no-reparse checks and allows creation, not a shared temp folder whose
ACLs need repair. Only random new owner-private scratch children are created;
root ACLs are never modified. The hosted runner explicitly uses `C:\`,
not runner TEMP. This is a prerequisite, not permission to provision private files
directly in broad roots: application files still require new private directories.
No PATH, profiles, caller scripts, proxy credentials or NODE_OPTIONS are inherited.

One binary request has a four-byte big-endian UTF-8 byte count (1..220000) followed
by exactly that many bytes. Raw stream reads handle split input and finish without
waiting for EOF; one process handles one frame, never a second request. The fixed
reader is hash-pinned, with narrowly enforced LF checkout bytes. Stage-only stderr
(`START/FRAME/ROOT/COMPILE/OPERATION/CLEANUP/DONE`) is validated, not passed through;
public errors stay generic. Failed cleanup cannot report success. Abrupt termination
may leave a protected `gelt-compile-*` scratch directory of public compiler inputs;
inspect/remove only that application's residual scratch while stopped, never sweep
existing user temp files. No persistent compiler cache or helper daemon is added.

`npm run test:windows-preflight` is a synthetic-only native diagnostic gate before
full tests/build/smoke. It requires successful split/open-stdin DPAPI, synchronous
unprotect and private file create/read/replace/remove. It prints only stage names
and elapsed milliseconds, never request/response/exception/path data. It exposes
startup/compilation versus operation cost without increasing the 15-second helper
deadline. If native cost exceeds lifecycle budgets, hold acceptance and obtain a
separately reviewed bounded reuse design; do not skip tests or raise timeouts.

Each Windows update creates a private same-directory file with WRITE_THROUGH,
flushes it using `FileStream.Flush(true)` (FlushFileBuffers), then uses native
`MoveFileEx(REPLACE_EXISTING | WRITE_THROUGH)` on the same NTFS volume. Disconnect
writes an authenticated encrypted null, not an unlink that could reveal old tokens.
This is a supported Windows API/NTFS contract, **not POSIX directory fsync**, not
secure erasure and not a guarantee against controllers/filesystems ignoring flushes,
physical rollback, restored snapshots or arbitrary hardware power loss. Native
functional/crash tests are required; no power-cut test has been performed.

Exclusive persistent `credentials.vault.lock` prevents a second worker. Clean
shutdown removes it only if no write/clear failed. **Any persistence failure poisons
the instance and retains the marker**, so restart cannot reload old credentials.
Crash/uncertain locks are never automatically stolen. Stop and verify all processes,
resolve the backing problem, then explicitly discard the old ciphertext and marker
before reauthorization; do not merely remove an uncertain-state lock and restore
possibly stale credentials. Lost DPAPI identity/key means no token recovery.
Bootstrap uses its own exclusive marker, rechecks the expected grant under ownership,
and on Windows commits a consumed tombstone before issuing a session. Failure leaves
no session and retains uncertain-state evidence. Renewal refuses active/consumed
files until the owner explicitly removes only those grant files while stopped.
Corrupted credentials remain unavailable; unavailable key/protections abort setup.

These are logical process/configuration boundaries, **not** an OS sandbox: same-UID
malware (same Windows user), root/Administrator/SYSTEM/servicing, compromised dependencies and physical/browser compromise are outside
this local trust model. Separate private directories protect against accidental
ciphertext copying without copying the key; they do not stop the OS owner. No
analysis/journal/ledger database receives secrets. M4 configured startup opens only
the separate protected execution ledger; the retained analysis database stays closed.

## Explicit provisioning (future authorized owner operation)

Build first on Linux. Historical unsupported Windows example: explicitly set,
`$env:GELT_WINDOWS_PRIVATE_PARENT='C:\'` before preparation and runtime (only if
that unchanged ancestor passes validation and permits creation). An existing safe
canonical directory on C: may be chosen instead; missing/unsafe roots fail closed.
Outside the repository choose six **new**, distinct non-nested
application directories: REGISTRATION_DIR, KEY_DIR, WORKER_DIR, BFF_DIR, OWNER_DIR, LEDGER_DIR. See [ledger operations](LEDGER-OPERATIONS.md)
for the separate inheritable private SQLite directory and sidecars.
Do not use a home/shared root itself or put generated files under v2. The preparation
CLI reads the **owner's new public registration** on bounded stdin, not copied
credentials. Linux owners may alternatively use existing explicit 0700 directories
and a 0600 registration file; Windows must use the protected creation primitive.
Registration shape:

```json
{
  "clientId": "OWNER_PROVISIONED_PUBLIC_CLIENT_ID",
  "redirectUri": "http://127.0.0.1:3000/api/connection/callback",
  "issuer": "https://agent.robinhood.com/mcp/trading",
  "authorizationEndpoint": "https://robinhood.com/oauth",
  "tokenEndpoint": "https://api.robinhood.com/oauth2/token/",
  "scope": "internal",
  "tokenEndpointAuthMethod": "none",
  "pkce": "S256"
}
```

This template is **not** valid registration evidence or a supplied client ID.
Official acceptance of the exact redirect/public-client grant must be independently
established before operation. From `v2`, run `node worker/dist/prepare.js` with the
six absolute directory paths in the order above, feeding registration JSON through
stdin (interactive stdin must then receive EOF). No secrets in command arguments.
It refuses existing paths and never repairs ACLs. It creates
REGISTRATION_DIR/registration.json. Then, still from `v2`, provision without printing
secrets (on Windows use absolute `C:\...` paths, not the POSIX placeholders):

```
node worker/dist/provision.js /ABS/registration.json /ABS/KEY_DIR /ABS/WORKER_DIR /ABS/BFF_DIR /ABS/OWNER_DIR /ABS/LEDGER_DIR
```

Creates private vault key, worker config (registration/key/vault path/service auth plus M4 ownerId/ledgerPath),
BFF config (service auth only), hashed expiring bootstrap grant and owner bootstrap
text. Refuses overwrite; partial provisioning failure requires owner inspection,
not automatic fallback. CLI writes only explicit supplied directories.

```
GELT_MODE=official-worker GELT_WORKER_CONFIG=/ABS/WORKER_DIR/worker.json GELT_BFF_CONFIG=/ABS/BFF_DIR/bff.json npm --prefix v2 start
```

Historical unsupported PowerShell example: set only the nonsecret configuration-path variables instead
of the POSIX inline assignment: `$env:GELT_MODE='official-worker'`,
`$env:GELT_WORKER_CONFIG='C:\...\worker.json'`,
`$env:GELT_BFF_CONFIG='C:\...\bff.json'`, then run `npm start` from `v2`.
Use canonical long absolute paths, not DOS short-name aliases.

Only worker gets worker config; only web gets BFF config. Market gets neither.
Browser gets neither. Supervisor does not forward inherited API keys, proxies,
NODE_OPTIONS or unrelated credentials. Web and market still load the M2 loopback
TCP/DNS guard. Worker alone loads the official-host TLS guard: only agent.robinhood.com
and api.robinhood.com on verified TLS port 443, with provider code pinning full URLs
and refusing redirects. Authorization-page navigation is the browser's explicit
owner action, not web-server egress. Guards are defense in depth, not OS firewalling.
Use only the supervisor; bare worker/web commands do not recreate all network guards.

At `/connect`, paste OWNER_DIR/bootstrap.txt (never into a URL or command line).
Grant expires in ten minutes and is consumed durably once. Browser must actually
accept the Secure loopback cookie; if not, remain disconnected and do not weaken
the cookie. Explicit browser compatibility is a known unproven limit, not a reason
to fall back to an insecure cookie. One-hour browser sessions are in memory. Click
status, initiate, then the explicit official authorization link only with separate
authorization to perform live login. Callback cleans its URL; restore tab CSRF and
request status. No automatic provider call on page load/startup/status. Disconnect
clears local tokens, pending flows, selection and browser session; not remote grants.

To regain a session after restart/expiry/disconnect, stop the services and remove only your consumed or
expired bootstrap.json/bootstrap.txt (not configs/key/vault), then run from `v2`:

```
node worker/dist/bootstrap.js /ABS/BFF_DIR /ABS/OWNER_DIR
```

Never log callback queries, provider payloads, token responses, headers or vault
contents. Do not add access-log middleware or a reverse proxy without new review.
Application errors are deliberately generic; diagnose setup using file existence,
permissions and supported contract, not secret dumps.

Account handles cannot be reused during a worker lifetime, including after local
disconnect. The worker retains at most 10,000 handle reservations (normally up to
100 per discovery); it never evicts old reservations. Capacity exhaustion clears
credentials and fails unavailable. Owner worker restart recovers capacity with new
cryptographic random handles and mandatory rediscovery; disconnect alone does not.
This is a bounded-memory fail-closed limit, not an automatic restart/retry policy.

## Verification and artifacts

All integration is offline fixtures or loopback-only built service calls. Smoke
uses temporary generated synthetic provisioning, never authenticates to a provider,
and deletes fixtures in finally. Full test coverage/receipts and remaining limits
are in the authoritative specification. Build outputs node_modules/.next/dist and
TS caches stay ignored; no operational DB or secret fixture file is committed.
No dependency upgrades; M4 adds only existing-dependency worker workspace lock metadata. Preserve exact upstream pin, MIT and notices.

Account compatibility tests use sanitized retained decoded evidence, not provider
calls. The raw adapter supports bounded structured/JSON-text `data.accounts`,
filters well-formed inaccessible/non-crypto records and rejects unsafe ambiguity;
see the API mapping and fixture provenance. A successful offline regression proves
neither current account access nor OAuth registration acceptance, live MCP encoding
or browser Secure-cookie-on-loopback compatibility. Keep disconnected on any such
unproven/unsupported operational prerequisite; never weaken storage/cookie policy.

## Current acceptance and retained native evidence

`.github/workflows/v2.yml` now runs the Linux foundation and scientific jobs;
Go CI remains separate and mandatory. Exact-source Linux tests/build/smoke and
protected-browser receipts are required after publication. The former
`windows-2022` job and its required Windows receipt were removed from current
support scope. Existing Windows-only primitive tests remain conditional legacy
source, not Linux certification or a current release gate. Historical DPAPI/ACL,
tamper/provisioning/restart/ownership/cleanup descriptions and candidate statuses
below preserve what was attempted; no historical failure becomes a pass.

Supervisor and services use cooperative IPC shutdown (including parent disconnect)
before bounded forced termination. Normal cleanup releases listener/vault ownership;
forced/uncertain termination leaves fail-closed markers, not a stale-lock takeover.
Direct Node launches need no shell/PATH. Windows child environment permits only
fixed SystemRoot/WINDIR, explicit GELT_WINDOWS_PRIVATE_PARENT and the existing
nonsecret role-specific settings (not inherited TEMP/TMP);
worker config never reaches web/market, and BFF config never reaches market.


### Prior corrective evidence boundary

Parent reported hosted run 35363943719/job 105661706999 failed at the previous
97dfaf8 candidate (14 failed, 114 passed, 3 skipped; build/smoke not reached).
An independent supplied local probe rejected unsafe temp ancestry immediately;
that does not establish the hosted cause. This correction removes the known EOF
dependency and implicit temp prerequisite, retains ACL rejection, and adds safe
stage diagnostics/preflight. Corrected native success and timing remain pending
parent-owned final-head Windows CI; Linux results cannot certify this code.

### Prior native transport diagnostic candidate (historical evidence)

Published 3b8f713 failed native run 35367729350/job 105674126207 at `FRAME`
after 15047ms; all later suites/build/smoke were not executed. Parent synthetic
Windows11/Node24 direct probes reached ROOT with both open stdin and split writes,
then correctly rejected local root ACLs. Neither establishes Server2022/Node22
success or the hosted failure mechanism. Do not infer an EOF/timeout/ACL cause.

The bounded investigation now compares `npm run test:windows-transport` (TypeScript
compiled, direct Node22, no Vitest transforms) and `npm run test:windows-preflight`
(Vitest) on the native job. Both execute identical fixed public synthetic frames
with closed, open and split-open stdin and require real DPAPI protect/unprotect.
Every variant runs even if an earlier variant fails. The Vitest comparison runs
even if the direct gate fails, but neither failure is optional; full suite/build/
smoke still require both to pass. Private NTFS operations remain in preflight.

Fixed stderr stages bracket header/payload reads, UTF-8 decoding, JSON parsing and
schema validation. Synthetic reports contain only fixed fixture write scheduling/
completion/join labels, stage codes and elapsed milliseconds, including on failure.
Write callbacks prove OS pipe submission, not helper consumption. No request bytes,
secret lengths, paths, exception text or environment are printed. These stages
locate a failure; they do not themselves prove array binding or Console behavior.
Per-request production deadlines remain 15 seconds; no transport algorithm, ACL,
DPAPI, persistence or authentication policy is weakened. No speculative production
fix is claimed. Parent-owned exact-head Windows success remains pending, and PR458
must stay draft until both hosted platforms and fresh reviews clear their gates.

### Prior pre-header Windows prerequisite correction (historical evidence)

Parent-supplied hosted run **35370708125 / job 105683722277** failed both direct
Node22 and Vitest at FRAME, with **no FRAME_HEADER**, in all three pipe modes.
FRAME precedes path construction, dot-source, stdin opening and allocation;
this is not evidence of an EOF/payload-read failure. Current diagnostics bracket
all these pre-read operations and independently probe fixed .NET calls, legacy
Join-Path/New-Object autoload, trusted Utility import/JSON and Add-Type resolution.
Each probe uses the production restricted environment, fixed reviewed/hash-pinned
script, empty open stdin, bounded output, unchanged 15-second deadline and joined
cleanup. Both direct and Vitest gates attempt every probe even after failures.

Production removes avoidable cmdlet autoload using .NET constructors/Path.Combine/
ordinal sorting, disables module autoload and imports the standard system Utility
manifest by absolute path; JSON/Add-Type calls are module-qualified. PSModulePath
is fixed to `C:\Windows\System32\WindowsPowerShell\v1.0\Modules`, never inherited.
No other environment, credential, cache/profile discovery, insecure fallback or
ACL repair is added. Add-Type probing resolves only; real compilation still needs
validated private scratch. No public API, storage/DPAPI/NTFS, service-role or
security contract changes. Linux checks cannot prove this correction: exact-head
Windows real DPAPI/ACL preflight, full tests/build/smoke remain a required parent
CI gate. PR458 remains a draft diagnostic candidate, not accepted native support.

### ROOT enum-mask correction (native acceptance pending)

Parent-reported native **35373683086 / job 105693300572** now reaches ROOT in
about 350ms for all closed/open/split-open frames: the former transport stall is
resolved by .NET replacements and trusted explicit imports. Legacy Join-Path and
New-Object autoload comparisons still time out at BEFORE; explicitly imported
JSON/Add-Type probes pass. These two unused autoload probes remain bounded,
sanitized diagnostic comparisons, **not production prerequisites**. Replacement
APIs, explicit imports, enum masks and real production DPAPI/NTFS operations must
pass both direct Node and Vitest gates. No deadline increase or blanket skip.

Parent's synthetic PowerShell5.1 reproduction identifies the actual ROOT failure:
`$ace.AceFlags -band 8` throws `Specified cast is not valid.` The corrected helper
uses `(([int]$ace.AceFlags) -band 8)`, retaining exactly InheritOnly mask 8 and
unsafe-access mask 0x500D0150. Other shipped PowerShell masks use like-typed
FileAttributes operands or integer access rights. Hash pins update with source;
no ACL repair/relaxation, crypto/environment fallback or public API change.
Native regressions require enum-mask correctness, accepted owner-private and
inherit-only ancestor ACLs, rejection of applicable untrusted rights, and actual
helper completion through cleanup. Existing encrypted restart/clear, provisioning,
BFF/bootstrap/private-worker and built lifecycle tests remain mandatory.

This supplied evidence establishes a concrete type defect, not final Windows
success. Linux verification cannot execute DPAPI/NTFS/PowerShell. Parent-owned
published exact-head Windows tests/build/smoke and Linux CI, plus fresh independent
and adversarial review, are still required before PR458 leaves draft. No live
OAuth/browser/broker acceptance, merge or deployment is claimed.
