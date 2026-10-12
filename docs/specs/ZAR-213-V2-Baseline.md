---
type: specification
title: "ZAR-213: Preserve V1 and establish additive V2 foundation"
status: implemented-pending-independent-review
scope: "M2 only; non-executing offline foundation"
issue: "https://linear.app/geltagentictrading/issue/ZAR-213"
owner_decision: "Capability GO, reconciled intake 2026-09-18"
original_baseline: "357f0dbbd853848484a6afe2773f6a7ac3c9fe2d"
upstream: "https://github.com/ErTasselli/OpenTerminal"
upstream_commit: "6feb4869489c8ac9537b1405547983591e1d3263"
preservation_publication: "Pending parent verification/publication; not performed in sandbox"
verification_scope: "Local precommit candidate checks; not independent review, remote CI or PR receipts"
changed_files:
  - v2/IMPORT-MANIFEST.json
  - v2/README.md
  - v2/DEPENDENCY-NOTICES.json
  - .github/workflows/v2.yml
  - AGENTS.md
  - README.md
  - docs/ROADMAP.md
  - docs/specs/ZAR-213-V2-Baseline.md
  - docs/specs/ZAR-212-Official-Crypto-Capability-Gate.md
  - docs/reports/zar-212/README.md
  - .llm-wiki/wiki/concepts/official-crypto-capability-gate.md
  - .llm-wiki/wiki/concepts/zar-211-scope-runtime-release-gates.md
  - .llm-wiki/wiki/concepts/zar-213-v2-foundation.md
---

# M2 foundation and completion record

## Authority and preservation

The reconciled owner intake dated **2026-09-18** explicitly approves capability
GO after clarification: OpenTerminal is market/analysis; a separate worker owns
future application safeguards; official Robinhood MCP supplies broker primitives.
Owner-reported trading is attestation, **not independently captured fills**.
The dated [M1 spec addendum](ZAR-212-Official-Crypto-Capability-Gate.md),
[report](../reports/zar-212/README.md) and capability wiki supersede historical
HOLD/PENDING/blocked disposition without editing the original observations or
filling evidence gaps. No broker requests were made for this implementation.

Exact preservation baseline is `357f0dbbd853848484a6afe2773f6a7ac3c9fe2d`
(PR456 merge per supplied intake), including final V1 plus M0/M1 documents. Older
`ce1c4a48e6e76e4ce1284707da9c6b4d8a8c7f7c` was a planning candidate, not the approved
M2 preservation target. The parent owns verification/publication of
`archive/gelt-v1-zar213` at the approved SHA, without force/overwrite. **No archive
ref, tag, push, PR, remote CI, merge or lock-release receipt is claimed here.**
The ordinary Squire review branch is additive; root V1 implementation and Go
manifests/CI remain unchanged. No reset, deployment, secret migration, owner-asset
cleanup or backlog retirement was performed.

## Implemented behavior and charter

See [V2 local guide](../../v2/README.md) for exact installation/build/start commands.
Node 22 / TypeScript is scoped to `v2/`; the additive AGENTS supplement preserves
all V1 Go guardrails, including Go 1.26.1 build/race/vet CI.

| Component | Implemented M2 authority / behavior |
| --- | --- |
| `v2/web` | Next.js/React workspace; offline landing page. Retained upstream widgets are not mounted. All `/api/*` methods are disabled (503), not an arbitrary proxy or credential relay. |
| `v2/server` | Retained upstream MARKET/ANALYSIS source; offline loopback entrypoint imports no providers, AI, portfolios or database. Only `GET /v1/health`; no provider enable flag. |
| `v2/worker` | Separate minimal service; only exact `GET /v1/health` and `/v1/capabilities`; versioned strict Zod response validation, disabled/unconfigured, no credentials, ledger or executable operations. |
| Runtime supervisor | Direct Node processes on literal 127.0.0.1: web 3000, market 4000, worker 4100. Minimal environment, readiness deadline, child-failure propagation, signal cleanup and joined children. |
| Offline guard | Loaded by supported runtime children; denies non-loopback TCP/DNS before traffic and exits on attempted egress. Defense in depth, **not an OS sandbox**. Next telemetry disabled. |

Worker rejects non-loopback bind configuration, invalid ports, unsafe Host/Origin,
unknown routes/versions/queries, methods and nonempty/chunked request bodies. It
is **not authenticated execution security**. Worker accepts only its own exact
Origin (or no Origin), not browser-to-worker calls from web. The web/BFF boundary
is not connected to the worker in M2. Neither service opens an analysis/ledger DB.
No synthetic balances, fills or telemetry are displayed.

Future worker alone owns sole-writer SQLite execution truth (ZAR-215); upstream
portfolio/analysis SQLite and market quotes are non-authoritative. Future protected
account/BFF routes require session, Origin, Host and CSRF protections (ZAR-214).
Optional upstream AI/API-key/portfolio controls are not these safeguards.
Downstream order work must enforce exact decimal money, explicit user confirmation,
fee-inclusive **≤$10** proposals, fail-closed unknown outcomes and manual
reconciliation. Those controls, account connection, ledger, broker adapters and
orders are **not implemented** here. No legacy Go fallback or arbitrary MCP proxy.

## Exact import, changed files and dependency notices

Source was fetched from the public upstream repository, detached at the exact
pin above and imported with `git archive` (not branch latest). The machine-readable
[import manifest](../../v2/IMPORT-MANIFEST.json) accounts for **82 upstream tracked
paths**: **65 retained, 11 modified, 6 omitted**. It also accounts for **248 local
additions**, including itself (explicit self-hash exception), yielding **324
candidate files under v2**. Every other candidate file has a SHA-256; every upstream
entry has its original SHA-256. The verifier checks inventory and hashes offline;
regeneration requires an exact-pin local checkout. This is traceability, not trust
in upstream code or a security audit.

- Retained: MIT `LICENSE` verbatim with OpenTerminal contributors attribution,
  all relevant provider/component source, screenshots, all six upstream test files,
  and **byte-for-byte package-lock.json**. No dependency versions/resolution changes.
- Modified: `.gitignore`, `README.md`, root package scripts, market entrypoint,
  web page/API route/config/package scripts. Three upstream files (`cache.ts`,
  `providers/nasdaq.ts`, `providers/yahoo.ts`) lose only an extra EOF blank line
  for diff hygiene; no behavior change. No upstream tests modified or omitted.
- Omitted: `.claude/launch.json`, upstream `.github/workflows/ci.yml`,
  `docker-compose.yml`, both Dockerfiles and `web/tsconfig.tsbuildinfo`.
  No `.git`, `.env`, owner settings, local data, installed dependencies or generated
  build assets were imported. `data/readme.md` is only upstream documentation.
- Added: worker contracts/service/tests/config, supervisor/egress/smoke/lifecycle
  scripts, import/notice generators and verifier, legal-text attributes and
  dependency notices. Full per-path accounting is in the manifest, not an
  abbreviated changed-file list.
- Legal notices: [DEPENDENCY-NOTICES.json](../../v2/DEPENDENCY-NOTICES.json) covers
  **432 lockfile dependency entries**, 315 installed on Linux-x64 at capture,
  with **230 deduplicated verbatim notice texts**, including bundled notices.
  Optional packages absent on this platform are labeled, not claimed inspected.
  Preserve their shipped notices when distributing those platforms. `.gitattributes`
  exempts only these verbatim legal texts from whitespace normalization/checks;
  source/tests remain checked. No legal/vulnerability audit is claimed.

Outside `v2/`, only the frontmatter's named docs/wiki/charter and additive Node CI
change. Existing `.github/workflows/ci.yml` is untouched. The new Node 22 workflow
targets master, uses lockfile `npm ci`, all V2 tests/build/smoke and no secrets,
deployments or auto-merge.

## Verification — actual local precommit results

These are **candidate checks run before the implementation commit**, not the
supplied upstream preflight or independent Review/Test/CI evidence. Runtime:
Node v22.22.1, npm 9.2.0, Go toolchain go1.26.1. Complete command output/exit status
was inspected. Fresh exact-head checks belong in phase receipts and downstream
Review/Test; no self-referential final SHA is embedded in this document.

| Command / check | Result |
| --- | --- |
| `GOTOOLCHAIN=go1.26.1 go test -race ./...` | PASS, all Go packages; initial uncached execution and subsequent cached rerun |
| `GOTOOLCHAIN=go1.26.1 go vet ./...` | PASS |
| `GOTOOLCHAIN=go1.26.1 go build ./...` | PASS (additional preserved CI build check) |
| `npm --prefix v2 ci --no-audit --no-fund` | PASS, 317 packages; unchanged upstream Recharts v2 deprecation warning |
| `npm --prefix v2 test` | PASS: original 18 tests/6 files, worker 5 tests/1 file, lifecycle/egress 5 tests; import/notice verification |
| `NEXT_TELEMETRY_DISABLED=1 npm --prefix v2 run build` | PASS: server tsc, worker tsc, Next 15.5.25 production build |
| `npm --prefix v2 run test:smoke` | PASS: real built services, local pages/contracts/disabled routes, supervisor interruption, occupied-port failure, port closure/child joining |
| `git diff --check` and staged diff check | PASS after documented whitespace handling below |
| Literal MIT and lockfile comparison to exact checkout | PASS; upstream hashes also recorded in manifest |
| Original baseline V1 preservation comparison | No Go code, go.mod/go.sum or original Go CI changes; historical root source retained |
| Final clean status | Required after commit; see exact-head implementation phase receipt, not a precommit clean-status claim |

### Retained and added test accounting

| File | Disposition | Executed tests |
| --- | --- | ---: |
| `v2/server/src/cache.test.ts` | Verbatim upstream | 6 |
| `v2/server/src/concurrency.test.ts` | Verbatim upstream | 3 |
| `v2/server/src/db.test.ts` | Verbatim upstream, temporary SQLite directory removed by test | 2 |
| `v2/server/src/providers/binance.test.ts` | Verbatim upstream | 3 |
| `v2/server/src/rateLimit.test.ts` | Verbatim upstream | 2 |
| `v2/server/src/routes/market.test.ts` | Verbatim upstream, provider success fixture remains test-only | 2 |
| `v2/worker/src/service.test.ts` | Added strict schemas, config, real HTTP and rejection boundaries | 5 |
| `v2/scripts/runtime.test.mjs` | Added environment, failure joining, occupied port, TCP/fetch/DNS denial and readiness timeout | 5 |
| `v2/scripts/smoke.mjs` | Added built-process integration, signals, occupied port and no residual listeners | Script assertions |

No test skips or baseline coverage replacements. EADDRINUSE/child-exit logs in
successful lifecycle tests/smoke are **expected negative-case output**, followed
by assertions and exit zero, not ignored failures. Requests go only to loopback;
external guard test targets are intercepted before any DNS/network transmission.
No provider/broker calls, credentials or V1 runtime are used by V2 smoke.

### Actual failures and fixes during implementation

1. First aggregate V2 test run passed server/worker/lifecycle tests but failed
   because the planned import verifier file had not yet been created. Added the
   verifier and complete manifest, then reran the aggregate successfully.
2. Expanded occupied-port smoke initially timed out: the test blocker accepted
   an idle readiness connection, so `blocker.close()` waited on that fixture
   socket. Changed the blocker to immediately destroy accepted sockets. Reran
   full smoke successfully, including port-closure assertions. Production service
   cleanup was not bypassed or weakened.
3. Initial staged whitespace check found whitespace in verbatim third-party
   notices and three extra EOF blank lines in upstream sources. Preserved legal
   bytes using a legal-text-only attribute; normalized the three source EOFs and
   recorded those modifications in the manifest. Staged diff check then passed.

4. First post-commit exact-head verification ran `npm ci` concurrently with Go
   discovery. Go vet failed with `pattern ./...: open
   v2/node_modules/require-directory: no such file or directory` while npm was
   replacing dependencies. This was a verification sequencing race, not a Go
   source failure. Do not run npm installation concurrently with root Go `./...`
   discovery in one worktree; rerun the complete checks sequentially. CI jobs
   already have separate workspaces. Final sequential receipts are reported by
   the implementation phase; no tests or baseline policy were weakened.

### Ignored artifact accounting

Candidate-generated ignored artifacts retained locally: `v2/node_modules/`,
`v2/server/node_modules/` (Vitest cache), `v2/server/dist/`, `v2/worker/dist/`,
`v2/web/.next/`. Build cache patterns include `*.tsbuildinfo`. They are neither
staged nor imported; no reason to destructively remove them for git cleanliness.
Upstream DB unit tests create and remove isolated temporary directories. No
`v2/data/*.db*` is created by startup/smoke. Root ignored
`pkg/server/gelt_journal.db` was observed after Go checks; preexistence was not
recorded, so it is left untouched rather than presumed disposable owner data.
No owner secrets/settings/ignored assets were read or cleaned up.

## Fresh review packet and remaining gates

Review the **net original-baseline-to-candidate** diff, never only a remediation
commit: `git diff 357f0dbbd853848484a6afe2773f6a7ac3c9fe2d HEAD`.
Named review seams:

- Exact pin/license/path accounting: manifest, generators, verifier and notices.
- No execution authority/egress: market entrypoint, web page/API route,
  worker `contract.ts` / `service.ts`, `offline-guard.mjs`.
- Process cleanup/deadlines/environment: `runtime.mjs`, `start.mjs`, lifecycle
  tests and smoke (especially occupied-port and signal paths).
- V1 preservation: original Go implementation/manifests/CI and additive AGENTS
  supplement. Historical M1 evidence stays unchanged under dated GO addenda.
- Cumulative durable wiki: the three named concept pages record owner GO,
  preservation identity and the offline/non-executing authority boundary.

Independent Review and distinct adversarial Test must clear blocker/high findings
on the exact committed head through normal Squire remediation, followed by
read-only Retro. Parent alone handles actual archival publication, App-authored
PR/base/head/CI verification and reservations. **Stop before merging ZAR-213.**
