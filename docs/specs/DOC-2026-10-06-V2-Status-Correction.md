---
type: specification
title: V2 current-status documentation correction
date: 2026-10-06
status: documentation-candidate
source_commit: d78c39f146a18a567b3cf6a836eb51bd5ab27ae9
---

# V2 current-status documentation correction

## Scope and implemented documentation behavior

Correct current-status descriptions while retaining the dated M2 and Windows
candidate receipts. Source presence, hosted automated verification and operational
acceptance are separate evidence levels. This change does not close a milestone,
enable a runtime, authorize broker/account access, or accept a trade or release.

The source review found protected M3 setup, a worker-owned M4 ledger, internal
M5 lifecycle, M6 connection/simulation UI, M7 history and a partial M8 home
workspace. Production startup does not construct M5 or the synthetic companion,
and the protected order-status response keeps every order capability false.
Draft PR #480 remains a separate candidate outside this correction.

## Exact changed-file inventory

- `README.md`: dated current summary and explicitly historical M2 snapshot.
- `docs/ROADMAP.md`: matching current summary, partial/M8-open heading, original
  planning authority label and unchanged historical roadmap phases.
- `v2/README.md`: dated exact-source/hosted disposition, current ledger ownership
  and historical labels for retained Windows candidate receipts.
- `v2/IMPORT-MANIFEST.json`: only the candidate SHA-256 for `README.md` changes.
  Upstream pin/hash, reason, all code entries and license notices stay unchanged.
- `docs/specs/DOC-2026-10-06-V2-Status-Correction.md`: this closeout record.

No source, tests, workflow, dependencies, credentials or runtime configuration
changes are included. All publication stays in the existing private repository.

## Source and verification evidence

Source was independently inspected at `d78c39f146a18a567b3cf6a836eb51bd5ab27ae9`:
`v2/worker/src/setup.ts`, `index.ts`, `service.ts`, `ledger.ts`,
`order-lifecycle.ts`, `order-history.ts`, `synthetic-companion-transport.ts`,
`synthetic-companion-intent-storage.ts`, `v2/web/app/page.tsx` and
`v2/web/app/connect/page.tsx`.
The [M8 specification](ZAR-219-Integrated-Offline-Trading-Screen.md)
preserves the partial milestone and live/owner acceptance boundary.

The [V2 README's dated disposition](../../v2/README.md#current-source-and-hosted-disposition-2026-10-06)
links the exact Go, Ubuntu and native Windows jobs inspected for that source
head and PR #458's final head. Job steps and workflow definitions were checked;
these are historical hosted receipts, not a fresh run of this documentation
candidate or manual/live acceptance. Local Windows Node 24 failures remain open.

The import verifier checks the SHA-256 of every recorded candidate path;
updating the README requires its one manifest hash change. Candidate inventory,
complete diff, links, privacy and exact-byte hash consistency must be checked.
No local application execution, provider/model runs, benchmarks, new tests or
deployment are part of this documentation task. Only existing hosted CI is used.

## Review and completion gates

This record is the pre-publication documentation-candidate snapshot. Initial
independent and adversarial read-only reviews on 2026-10-06 both reported no
blocker/high findings. The independent review's M6 simulation evidence request
was resolved from the pinned connection-page source and ZAR-217 specification;
no evidence request remains open. Both reviews checked the full five-file patch,
source/acceptance boundaries, retained failures and exact README/manifest bytes.
Before merge, fresh final independent and adversarial reviewers must inspect the
complete resulting diff and explicitly report no blocker/high findings. Any later
artifact, head or target-base change restarts final review and verification.

The associated private PR must record reviewed head/base, complete inventory,
review results, whitespace/link/hash checks and exact-head hosted Go build/race/vet,
Ubuntu Node 22 aggregate tests/build/offline smoke and native Windows preflight,
tests/build/offline smoke. Missing, skipped, failed or untriggered checks are not
passes. Ordinary merge and post-merge verification are separate gates; no bypass
or auto-merge is authorized. Final receipts belong in the PR so this historical
candidate snapshot does not falsely claim its own future checks have passed.
