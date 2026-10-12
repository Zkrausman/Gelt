---
type: Specification and Completion Report
title: Protected reference-computation evidence inspection
description: Read-only Paper2Agent evidence UI and named owner-authenticated store reads.
timestamp: 2026-10-07T00:00:00Z
---

# Scope

This additive ZAR-209/ZAR-231 slice displays a bounded reference computation. It
is not acceptance of the full research-to-shadow epic, historical evaluation,
market edge, broker execution, shadow observation, or permission to promote.

## Implemented boundary

`/research` is a separate read-only view. Public HTML contains no private evidence;
owner-session authenticated POST reads use the existing ConnectionBff ingress,
exact Host/Origin, cookie and CSRF checks. The narrowly named `research-list` and
`research-detail` operations call core `listResearch`/`readResearch` directly.
They do not contact the worker transport, broker, artifact URLs or any provider.
A broker account/connection is not required. The existing owner bootstrap is
still required and its credential/config policy is unchanged.

The explicit `GELT_RESEARCH_ROOT` reaches only the web role in configured runtime
mode. No browser input selects a filesystem root, and startup does not provision,
import, repair ACLs or execute artifacts. Core private-root marker, separation,
original-byte SHA-256, strict original JSON and schema checks remain authoritative.
Missing configuration returns unavailable, an empty provisioned store returns an
empty library, and missing/corrupt reads do not become valid evidence.

List responses expose at most 100 IDs and read states. Detail responses use the
shared record schema. Both include authoritative owner-session expiry and the BFF
rechecks expiry immediately after the core read. Browser responses are size-bounded,
schema checked and detail identity checked; duplicate list IDs are rejected.
The shared 512 KiB response limit accounts for compact numeric literals expanding
during serialization. Canonical evidence is capped at 508 KiB before import, with
4 KiB reserved for Gelt/session metadata. The BFF also enforces the full wire
limit. An actual import-to-BFF-to-client regression covers this expansion, with
exact-boundary client checks and oversized-canonical-evidence rejection.

## Display and request safety

All artifact fields are inert React text; source identifiers are not navigable
URLs. Paper/code/Paper2Agent source pins and licenses, data assumptions, actual and
expected numbers, explicit absolute/relative tolerances, dependency versions, hash
metadata, limitations and insufficient_evidence recommendation are displayed.
Producer claims are visually separate from Gelt local schema/integrity/numeric
checks. Numeric comparison only compares producer-supplied numbers/tolerances;
scientific reproduction remains not_run. Inner hashes, source authenticity and
execution claims are explicitly not independently verified. Historical, shadow
and costs stay not_run, and promotionAllowed remains false.

The page has no upload/run/promote/trade controls. Every new request supersedes and
aborts the prior generation. Late success/error/finally handlers cannot restore
old evidence. Editing/restoring CSRF, Clear evidence, navigation/page restoration,
read failure and known session expiry clear evidence. Browser visibility restoration
checks the expiry deadline. No evidence or CSRF is written to local storage. The focusable main container
owns viewport-height vertical scrolling with border-box sizing, preserving access
to long numerical/provenance/recommendation sections despite global hidden
document overflow. Hosted Playwright must demonstrate real wheel and keyboard
reachability at desktop and narrow widths; full-page screenshots alone do not
prove scroll access.

## Changed files

- `v2/web/app/research/{page.tsx,evidence-detail.tsx,research.module.css}`
- `v2/web/lib/{research-response.ts,research-requests.ts}`
- `v2/web/lib/{research-bff.test.ts,research-requests.test.ts,research-view.test.ts}`
- `v2/web/lib/connection-bff.ts`: named authenticated local read branches only
- `v2/web/app/page.tsx`: additive navigation link only
- `v2/scripts/runtime.mjs` and `runtime.test.mjs`: web-only explicit root seam
- `v2/scripts/running-next-research-read-smoke.mjs`: explicit offline HTTP integration
- `v2/IMPORT-MANIFEST.json`: final assembly must reconcile all lane hashes

## Verification and remaining acceptance

Local Node 24: 12 focused research tests passed; 10 runtime tests passed; web
TypeScript passed; production server/worker/web build passed. The protected BFF
unit integration imports the exact real MCP-produced 12,160-byte artifact with
SHA-256 `c386b43d907f3375563422f27c5313268337f7f399821c318a69261f0731bb96`
and verifies its 18 results without running research code or a broker.

The explicit offline HTTP smoke exercises the real production Next route, ingress,
owner bootstrap, denied reads, actual artifact import/read, restart/new owner
session, missing evidence and tamper rejection. Its evidence is HTTP integration,
not browser/visual acceptance. Run after the full build:

`NODE_ENV=test GELT_OFFLINE_RESEARCH=fixture-only node scripts/running-next-research-read-smoke.mjs --offline-test-only`

Final integrated Go race/vet/build, full V2 tests/build/smoke/import accounting,
fresh final reviews, supported Node 22/native Windows and real sandboxed browser
interaction/visual acceptance remain assembly gates. No unsupported local browser
sandbox bypass or unperformed visual test is claimed here.
