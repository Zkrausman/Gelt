---
type: Specification and Completion Report
title: Linux-only Gelt development and delivery
description: Owner-authorized support simplification without altering security, tests or repository protections.
timestamp: 2026-10-13T00:00:00Z
status: candidate-awaiting-complete-review-and-linux-ci
---

The owner selected the Linux computer and explicitly removed Windows support
from current delivery scope. G03 integrated master
`3bc2addfe8e67a1e0701a2636db15f8ff5d49f0f`, tree
`079fe47de621903b52f647ba78b742266a3a9b1f`, passed Go `38350784853`, Linux
and scientific jobs in `38350784916`, all seven protected-browser stages,
desktop/narrow pixel verification and cleanup. Both original read-only reviewers
accepted that Linux scope, with no established correctness/security blocker
affecting Linux from the retained failures. Owner consumption and genuine
autonomous execution remain separate.

The V2 workflow now contains only its existing Linux foundation and scientific
jobs. Go CI is unchanged. The README, AGENTS and ticket-delivery instructions
state Linux-only support and preserve exact-source review/verification and
platform-independent safety gates. Import accounting updates the README, connection operations and ledger
operations digests. There is no runtime code change, dependency change, test deletion,
assertion relaxation or new effect authority. Existing Windows implementation,
helper/security code and conditionally skipped tests remain unsupported legacy
material; retaining source is not a support or pass claim.

Historical Windows failures in `38318643449`, `38331401323` and `38338884937`
remain unresolved in cause. Later successful attempts do not explain them or
prove they were exclusively platform-specific. Windows is neither a current
release gate nor a target of new compatibility work. Reintroducing a support
claim requires its own reviewed scope and fresh native verification.

Read-only canonical master protection inspection reported Branch not protected
(HTTP 404); the normal required-check query reported none. No protection,
access, billing or admin setting was changed or bypassed. Such a constraint,
if added later, must be reconciled explicitly rather than circumvented.

Changed files: `.github/workflows/v2.yml`, `AGENTS.md`, ticket-delivery SKILL,
`v2/README.md`, connection/ledger operational guidance and their import-manifest
hashes, and this specification. Static import
verification (82 upstream/462 candidate files; MIT and lock inventory unchanged)
and whitespace passed. Complete independent and adversarial final reviews must
precede fresh Go/Linux/scientific/browser gates. Exact candidate and integrated
outcomes are recorded separately in the PR/receipts; no earlier pass transfers.
No local listener, ownership, cleanup or held original runtime action was run.

The final source reconciliation also marks Windows operational/provisioning
procedures as unsupported historical material and replaces obsolete current
Windows-CI readiness statements in connection/ledger operations. It preserves
all detailed security constraints as archival evidence. This accepted medium
documentation finding requires fresh complete reviews of the resulting eight
files before publication; previous six-file acceptance is stale.
