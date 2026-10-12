---
title: Privacy-safe publication snapshot
status: Baseline snapshot reviewed; combined-candidate review status is in the external receipt
updated: 2026-10-12
---

# Privacy-safe publication snapshot

This document describes the earlier 896-file sanitized baseline, whose exact inventory SHA-256 is `755bc39d7db43e1e916cd16a0fe62a95010b0d96bde670008104d53b7260f937`. The local candidate containing this file also layers the G01/G02 source delta from `580756993da733d6bd6eb86166a1de672e7829e5`, producing a separate 907-file tree. The earlier review does not clear this combined tree. The current combined-candidate review status is recorded with its exact inventory in the external local receipt. No combined-candidate import, test, smoke, browser, or runtime gate has run.

## Implemented behavior

- Account health checks require the existing configured account identifier. When it is absent, the diagnostic reports an unconfigured state and does not make an account request.
- Optional Beads/Thneed sync uses the existing `GELT_BEADS_BRAIN_PATH` setting. No machine-specific default is embedded; absent configuration disables optional sync or returns an explicit unconfigured error.
- Health tests use clearly synthetic account aliases with a local HTTP test server.
- The CLI status preview uses a clearly labeled synthetic demo fixture; it does not present a real account identifier, holding, balance, or latency.
- An empty thesis journal remains empty and reports no records; it no longer inserts or displays a broker-shaped filled-order example.
- SEC EDGAR requests require the deployment to provide its own `SEC_EDGAR_CONTACT`; no maintainer contact address is embedded as a fallback.
- Trading-plan examples use fictional account settings and explicitly label schedules and values as illustrative.
- Local development references use repository-relative paths or generic configuration destinations.
- The native tldraw diagram is preserved in the private source but excluded from the publication export because its embedded document metadata contains a local user identity; the app/editor is unavailable for a safe metadata rewrite in this environment.
- Unreferenced source-verification metadata receipts are retained in the private source but omitted from the publication export.
- Workstation-specific Beads/Brain paths and credential-shaped sample text were removed from code/docs; optional sync now uses the existing environment setting or reports unconfigured. Sample credential, endpoint, ID, webhook, and database path values are blank.
- The executive and shadow-trading examples contain invented fixture data only and explicitly distinguish simulation from broker activity or measured performance.
- CI uses only the read-only `contents` workflow token scope; checkout steps do not persist their token in Git configuration.
- A public snapshot must be exported without the private repository history, local receipts, generated binaries, databases, or machine-specific files.

## Original privacy-baseline changed files

- `.github/workflows/ci.yml`
- `.github/workflows/v2.yml`
- `.agents/skills/data-fetcher/README.md`
- `.agents/skills/db-seeder/README.md`
- `.agents/skills/executive-report/SKILL.md`
- `.agents/skills/index.md`
- `.env.example`
- `.llm-wiki/wiki/concepts/zar-214-protected-account-boundary.md`
- `cmd/gelt/main.go`
- `cmd/orchestrator/README.md`
- `cmd/orchestrator/bridge.go`
- `cmd/orchestrator/bridge_test.go`
- `docs/ROADMAP.md`
- `docs/gelt_executive_briefing.md`
- `docs/reports/REPORT_001_Strategy_Baseline.md`
- `docs/reports/zar-209/README.md`
- `docs/specs/EPIC_GCP_Cloud_Deployment.md`
- `docs/specs/Public-Snapshot-Privacy-Baseline.md`
- `docs/specs/TASK_006_Macro_Data_and_Thneed_Logger.md`
- `docs/specs/TASK_049_Live_Robinhood_Telemetry.md`
- `docs/specs/ZAR-211-Scope-Runtime-Release-Gates.md`
- `docs/specs/ZAR-219-Integrated-Offline-Trading-Screen.md`
- `docs/specs/zar-14-strategy-evaluate-context.md`
- `docs/specs/zar-54-daemon-background-service.md`
- `docs/techPlans/gelt_datasuite_and_tools.md`
- `docs/techPlans/gelt_shadow_trading.md`
- `docs/techPlans/gelt_trading_plan.md`
- `pkg/health/diagnostic.go`
- `pkg/health/diagnostic_test.go`
- `pkg/portfolio/portfolio_test.go`
- `pkg/portfolio/telemetry.go`
- `pkg/telemetry/thneed_backend.go`
- `pkg/telemetry/thneed_backend_test.go`
- `pkg/thesis/README.md`
- `pkg/thesis/thesis.go`
- `pkg/thesis/thesis_test.go`
- `skills/gelt-operator/README.md`
- `skills/gelt-operator/SKILL.md`
- `skills/robinhood-trader/README.md`
- `skills/robinhood-trader/SKILL.md`
- `v2/CONNECTION-OPERATIONS.md`
- `v2/docs/screenshots/chart.png`
- `v2/docs/screenshots/crypto.png`
- `v2/docs/screenshots/dashboard.png`
- `v2/docs/screenshots/heatmap.png`
- `v2/docs/screenshots/news.png`
- `v2/server/src/providers/secedgar.ts`
- `v2/worker/src/service.test.ts`

## Additional local G01/G02 integration files

- `.github/workflows/v2.yml` (merged with the privacy protections above)
- `docs/specs/Synthetic-Mock-Robinhood-Rebuild.md`
- `docs/specs/ZAR-231-Research-Evidence-Read-View.md`
- `v2/IMPORT-MANIFEST.json`
- `v2/RESEARCH-OPERATIONS.md`
- `v2/docs/SYNTHETIC-BROWSER-DEMO.md`
- `v2/scripts/research-owner-demo.mjs`
- `v2/scripts/research-owner-demo.test.mjs`
- `v2/scripts/synthetic-browser-demo.mjs`
- `v2/scripts/synthetic-mock-acceptance.mjs`
- `v2/scripts/web-ipc.mjs`
- `v2/scripts/web.mjs`
- `v2/tests/research-owner-entry/run.mjs`
- `v2/web/app/connect/page.tsx`
- `v2/web/lib/connection-bff.test.ts`
- `v2/web/lib/connection-bff.ts`
- `v2/worker/src/synthetic-browser-demo.test.ts`
- `v2/worker/src/synthetic-browser-demo.ts`
- `v2/worker/src/synthetic-mock-robinhood-adapter.ts`
- `v2/worker/src/synthetic-mock-robinhood-contract.ts`
- `v2/worker/src/synthetic-mock-robinhood-storage.ts`
- `v2/worker/src/synthetic-mock-robinhood-transport.ts`
- `v2/worker/src/synthetic-mock-robinhood.test.ts`
- `v2/worker/src/synthetic-order-harness.ts`

## Verification evidence

- `git diff --check` passed.
- Independent visual inspection and metadata review covered the seven raster images. The drawing archive was inspected, and its embedded user identity is why the archive is excluded from the publication export.
- A fresh exact inventory and privacy scan receipt are stored outside the export; the receipt records the inventory hash, file inventory, exclusions, scan categories, and review status.
- Exact-value and credential-pattern scans report no audited account identifier, historical author address, confirmed credential pattern, or personal workstation path in the current source tree.
- Five PNG screenshots had EXIF/XMP metadata stripped; decoded pixel hashes were unchanged. The two JPEG diagrams had no EXIF/XMP metadata. The repository drawing source remains as tracked documentation.
- The exact export inventory is recorded outside the export so the export contains no private receipt or history metadata.
- Go tests and formatting were not run because `go` and `gofmt` are unavailable in this execution environment. V2 tests were not run because `v2/node_modules` is absent; dependency installation was not attempted.
