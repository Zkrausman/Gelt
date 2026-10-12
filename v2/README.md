# Gelt V2 — offline foundation and protected M3 connection boundary

Derived from [ErTasselli/OpenTerminal](https://github.com/ErTasselli/OpenTerminal),
exact commit `6feb4869489c8ac9537b1405547983591e1d3263`.
Copyright (c) 2026 OpenTerminal contributors; [MIT license](LICENSE) is verbatim.
This additive tree does not replace Gelt V1. See the authoritative
[ZAR-213 specification](../docs/specs/ZAR-213-V2-Baseline.md).
M3 adds a protected, execution-disabled account API; see the
[API contract](CONNECTION-API.md), [explicit owner setup](CONNECTION-OPERATIONS.md)
and [ZAR-214 specification](../docs/specs/ZAR-214-Protected-Account-Boundary.md).
Default startup remains offline. No live-provider or Windows connected-mode proof.

## Current source and hosted disposition (2026-10-06)

Checked source: [master `d78c39f`](https://github.com/Zkrausman/Gelt/tree/d78c39f146a18a567b3cf6a836eb51bd5ab27ae9).
The protected M3 connection boundary, worker-owned M4 ledger, internal M5 lifecycle,
M6 connection/simulation UI, M7 read-only history and partial M8 home workspace
are present. M5 remains unintegrated with production startup and its order adapter
is unsupported. Isolated synthetic companion kernel, transport and intent-journal
components are present, without production startup/BFF/UI integration.
[PR #480](https://github.com/Zkrausman/Gelt/pull/480) is a separate open draft for
durable synthetic-preview reservation at this audit; its implementation is not
part of this master snapshot.

[PR #458](https://github.com/Zkrausman/Gelt/pull/458) merged on 2026-09-18.
Its final head `a68cd7ee7f2cb787907c843e0e6b2d4f9c907f1b` passed
[Go](https://github.com/Zkrausman/Gelt/actions/runs/35376210212/job/105701373760),
[Ubuntu Node 22](https://github.com/Zkrausman/Gelt/actions/runs/35376210222/job/105701374547)
and [native Windows](https://github.com/Zkrausman/Gelt/actions/runs/35376210222/job/105701373125)
hosted jobs. The audited master `d78c39f146a18a567b3cf6a836eb51bd5ab27ae9` also passed
[Go build/race/vet](https://github.com/Zkrausman/Gelt/actions/runs/36599787346/job/109513897858),
[Ubuntu Node 22 tests/build/offline smoke](https://github.com/Zkrausman/Gelt/actions/runs/36599787108/job/109513895624)
and [native Windows Node 22](https://github.com/Zkrausman/Gelt/actions/runs/36599787108/job/109513895309).
The Windows job passed real transport/DPAPI/private-NTFS preflight, aggregate tests,
build and offline smoke on the configured `windows-2022` runner.

These are exact-head automated offline results. They do not establish live
OAuth/browser/provider interoperability, general owner-machine portability,
power-loss durability or M8 acceptance. Production order capabilities remain
all-false, and **M8, supervised live validation and explicit owner acceptance
remain open**. The Windows candidate narratives below preserve earlier FRAME/ROOT
failures and pending states as historical receipts. Separate local Windows Node 24
storage/ACL failures and timeouts remain unresolved; see the
[ZAR-219 evidence and authority boundary](../docs/specs/ZAR-219-Integrated-Offline-Trading-Screen.md#post-merge-disposition-and-evidence-2026-09-28).
No historical failure is converted into a pass by the later hosted results.

## Local startup (Node 22, npm 9+)

From the repository root:

```sh
npm --prefix v2 ci --no-audit --no-fund
npm --prefix v2 test
NEXT_TELEMETRY_DISABLED=1 npm --prefix v2 run build
npm --prefix v2 run test:smoke
npm --prefix v2 start
```

Installation needs the public npm registry; runtime/smoke needs no network beyond
loopback. `start` (and `dev`, deliberately the same built baseline) requires the
build first. Ctrl-C stops and joins all three direct Node processes; startup
failure also stops siblings. Ports are fixed by the supervisor: web **3000**,
market/analysis **4000**, worker **4100**, all on **127.0.0.1**. Free these ports
before starting; do not run the V1 daemon. No `.env`, API key, broker connection,
local settings or data migration is required. Startup passes an allowlisted
minimal environment, not inherited credentials/proxy/NODE_OPTIONS. Standalone
server/worker entrypoints accept API_PORT/WORKER_PORT (1–65535) and only literal
127.0.0.1 for API_HOST/WORKER_HOST. Use the supervisor for the supported baseline.

### Honest execution-disabled state

- `web/`: Next.js/React local trading workspace with protected M3 state,
  exact BUY LIMIT draft fields, explicit preview/confirmation unavailability,
  account-scoped durable history and timeline. `/api/connection/*` is a protected
  named BFF, not a generic proxy. `/connect` retains owner bootstrap and account
  selection controls. The screen does not fabricate quotes, orders, fills, fees or
  account balances; unsupported order actions remain disabled.
- `server/`: original market/analysis tests and source retained. Entry point loads
  no provider, AI, portfolio or DB modules. Only `GET /v1/health`; no enable flag.
- `worker/`: independent Node/TypeScript OAuth/PKCE, encrypted vault and named
  get_accounts boundary. Default health is disabled/unconfigured; explicit secure
  configuration is reported as protected, still execution false. Status is never
  connected without unexpired tokens and validated eligible discovery.

Loopback is not authentication. Actual owner sessions, exact Origin/Host/CSRF and
separate private service authentication protect M3. Only the worker owns broker
secrets. The secure vault supports Linux private files with separately protected
key; native Windows uses current-user DPAPI plus verified private NTFS ACLs.
See the [dated hosted disposition](#current-source-and-hosted-disposition-2026-10-06)
for native automated results and remaining acceptance limits. Explicit official-worker mode does
not open web/market egress. Use the supervisor's raw-ingress-gated Next entrypoint,
not direct next start/dev, for the supported boundary. See the linked contracts
for Secure-cookie loopback browser limitations and the evidence-backed raw-account
mapping. Connected operation requires an explicitly provisioned **owner-operated
Linux or supported Windows runtime**; registration acceptance and actual browser login remain unproven.
The sanitized retained observation tests decoded `data.accounts`, not live MCP
wire compatibility; see [fixture provenance](worker/src/fixtures/README.md).

The worker owns execution SQLite, distinct from the analysis DB.
M4 adds a worker-owned durable SQLite ledger. ZAR-216's internal M5 lifecycle
remains unintegrated and the production adapter is unsupported. The workspace now
uses a protected, read-only `/api/connection/order-status` BFF route and worker
`POST /v1/orders/status`; its capability response always reports execution, preview,
confirmation, dispatch, cancellation and reconciliation false. No order lifecycle,
provider dispatch, funding, Go fallback or generic MCP API is active. See the
[ledger API](LEDGER-API.md) and [ledger operations](LEDGER-OPERATIONS.md) for
explicit private provisioning.

Any future order integration must use exact-decimal money, explicit user
confirmation, fee-inclusive **≤$10**, fail-closed unknown outcomes and manual
reconciliation. These are not implemented order capabilities. Market
quotes/portfolio simulations can never substitute for actual broker execution
truth. Re-enabling retained upstream surfaces requires separate review.

### Offline and lifecycle checks

`test` retains all 18 upstream server tests and adds worker/BFF security, vault,
OAuth/refresh/disconnect race tests, process lifecycle/egress and import checks.
`test:smoke` starts/stops real built services under a 60-second Linux / 300-second Windows deadline, including
synthetic protected bootstrap/BFF/private-worker checks without any broker request.
Default children use `scripts/offline-guard.mjs`; explicit configured worker alone
uses `official-worker-guard.mjs`. These are application defense in depth, not OS
isolation. Build alone does not prove browser security or provider interoperability.
Next telemetry is disabled; no external fonts/provider fetches on default pages.
Run configured Go/Node checks sequentially; npm ci must not race Go discovery.

## Import and licenses

[IMPORT-MANIFEST.json](IMPORT-MANIFEST.json) accounts for every upstream tracked
path, each retained/modified/omitted hash and every local addition under `v2/`.
Manifest itself has no self-hash (explicit exception). `verify:import` checks
inventory and candidate hashes offline. `scripts/generate-import.py` can rebuild
it against a local checkout of the exact upstream pin; review any change. `scripts/update-local-import.mjs` updates local candidate
hashes/additions without changing upstream evidence or silently modifying retained imports.
M4 declares the worker workspace and direct use of already pinned better-sqlite3/Zod.
The lockfile changes only this workspace metadata; the import verifier reconstructs
and hashes the original upstream lockfile to prove all resolved dependencies unchanged.
Only scripts changed in package manifests; worker uses existing pinned TypeScript,
Zod and Vitest without an additional dependency/workspace resolution.

[DEPENDENCY-NOTICES.json](DEPENDENCY-NOTICES.json) inventories the pinned lockfile
and references verbatim bundled license/notice texts in `notices/`, captured
from the Linux-x64 `npm ci` installation using `scripts/generate-notices.py`.
Absent optional platform packages are labeled, not claimed inspected; their
license declarations remain in the lockfile. Keep package-distributed notices
when shipping other platforms. This is notice preservation, not a legal or
vulnerability audit. Recharts' upstream v2 deprecation warning is retained;
no broad upgrade was authorized.

Upstream workflow, editor launch settings, Docker deployment files and tracked
TypeScript build cache are intentionally omitted. Screenshots and source remain.
`node_modules/`, `.next/`, `dist/`, `*.tsbuildinfo` and analysis DB files are ignored
local build/test artifacts, never imported. Upstream DB unit tests use and remove
temporary directories. M2 startup must not create analysis or execution DBs.

### Native Windows prerequisites and historical candidate receipts

The candidate status statements in this section and the FRAME/ROOT subsections
are retained historical evidence from the PR #458 correction sequence. The dated
hosted disposition above records the later merged/green result; the prerequisites
and operational restrictions below still apply.

Windows 11/Server 2022+, local NTFS, Node22 x64, Windows PowerShell5.1/.NET4.8 and
standard `C:\Windows` are required. From PowerShell set
`$env:NEXT_TELEMETRY_DISABLED='1'` before `npm --prefix v2 run build` (the inline
POSIX assignment above is not PowerShell syntax). Use the explicit private-directory
preparation in [operations](CONNECTION-OPERATIONS.md); chmod is not Windows security.
No automatic Linux-key migration. The trusted checkout and packaged fixed helper
are required at runtime. Windows hosted CI is a required **pending** acceptance
gate, not a Linux-mock result or proof of live OAuth/browser compatibility.

The Windows corrective candidate requires an explicit nonsecret compilation/fixture
parent, e.g. `$env:GELT_WINDOWS_PRIVATE_PARENT='C:\'`, whose existing ACLs must pass
unchanged checks. It never repairs TEMP/home or falls back to inherited TEMP/TMP.
See operations before provisioning. `npm run test:windows-preflight` exercises real
DPAPI/ACL backing and open-stdin framed transport with secret-free stage/timing
output before the full native suite/build/smoke. The previous hosted Windows job
failed; corrected native evidence remains pending, not proven by Linux results.

Current transport diagnosis also runs `npm run test:windows-transport`: compile the
worker fixture with pinned TypeScript, then run directly in Node22 without Vitest.
It compares the same fixed synthetic closed/open/split-open DPAPI frames as Vitest,
with bounded public stage/write timing on failures as well as success. CI runs the
Vitest comparison even after a direct-probe failure; both are required gates, not
alternatives. That earlier published preflight failed at FRAME; see the newer ROOT correction
below for subsequent reported evidence, not final native acceptance. No timeout increase or ACL repair is
part of this diagnostic candidate. See the current specification/operations for
the failed native receipt and pending parent-owned acceptance.

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

### ROOT enum-mask correction (historical native acceptance pending)

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
