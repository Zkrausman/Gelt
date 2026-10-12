---
type: concept
title: "ZAR-237 offline handoff session invalidation"
status: fixture-fix-shipped-m8-open
source_merge: "a8c657ea01e33ea258b2e001f7265d59180ae586"
---

# ZAR-237 — per-session revision floors in an inert fixture

[Gelt PR #471](https://github.com/Zkrausman/Gelt/pull/471) merged 2026-09-28T16:21:09Z as `a8c657ea01e33ea258b2e001f7265d59180ae586` from head `17d629f75616f7bfe31ab2a3d2095a3a493eac72` over `6631ac6ea3a5a334bec9dcdd9b028261ce1cd7ed`. The source and merge trees matched. Exact-head hosted [Go](https://github.com/Zkrausman/Gelt/actions/runs/36446256828) and [Ubuntu Node 22/native Windows Node 22](https://github.com/Zkrausman/Gelt/actions/runs/36446256825) checks passed. A read-only independent source review found no issue for this scoped development PR; local red/green and focused 7/7 checks were operator-run, not reviewer-run.

The test-injected, execution-disabled offline Pi handoff originally had a single revision floor: `invalidate(A, 3)` followed by `invalidate(B, 1)` could admit a delayed `prepare(A, 2)`. The patch retains independent floors for up to 64 owner sessions, rejects the stale A revision and keeps at most one pending draft. At the 65th distinct valid invalidation, that fixture instance permanently disables itself rather than evicting a safety floor. The private HTTP regression covers the A/B/A interleaving, fresh revision, cross-session review rejection, expiry, capacity overflow and restart. An operator-owned disposable probe reproduced the pre-fix failure and passed after the patch. This is a safety-test seam and an explicit availability tradeoff, not a production owner-session store or broker/order authorization.

## Product/test lesson and open gate

Interleaving **different** valid owner sessions matters even when a single-session edit/restart test passes. A bounded cache must not silently evict stale-revision protection; at-capacity fail-closed behavior should be visible in a real authenticated companion design. The applicable [ZAR-219 specification](../../../docs/specs/ZAR-219-Integrated-Offline-Trading-Screen.md) documents the fixture restriction and remaining authenticated offline companion, account/terms/expiry/cap and recovery work. The earlier local Windows Node 24 ledger run failed 33/34 with `secure storage unavailable` near 702 seconds and hit a 720-second outer timeout; a later diagnostic copy passing 34/34 does not explain or erase it. Hosted Windows Node 22 passing is a separate fact. As with [[zar-215-durable-execution-ledger]], synthetic drafts and requested terms are not observed broker executions.

[ZAR-237](https://linear.app/geltagentictrading/issue/ZAR-237/m8-keep-offline-handoff-revision-invalidation-across-owner-sessions) is Done; parent [ZAR-219/M8](https://linear.app/geltagentictrading/issue/ZAR-219/mvp-8-pass-integrated-offline-safety-recovery-and-ui-acceptance-gate) remains In Progress. Refine ZAR-219's existing acceptance evidence rather than open a duplicate ticket for this fix. No broker connection, live preview, order, cancellation, production activation or M8 acceptance is claimed or authorized here.
