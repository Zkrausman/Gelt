---
name: jules-orchestration
description: Coordinates Jules dispatch, monitoring, review, remediation, research persistence, PR lifecycle, and mandatory human-action/status reporting for Gelt.
---

# Jules Orchestration

Use this skill whenever dispatching, checking, responding to, reviewing, or closing out a Jules session. For every ticketed implementation, also use `../ticket-delivery/SKILL.md`: local and Jules tickets share its identical closed-loop acceptance standard. Jules only changes who performs assigned implementation/remediation work and how the parent monitors/waits for it.

## Authority and Lifecycle

1. Dispatch one ticket per Jules session from current `master`, with exclusive file/package ownership across concurrent implementation sessions.
2. Before dispatching an implementation session, complete and inject the applicable **`references/implementation-packet.md`** requirements: bounded scope/allowed files, explicit non-goals and safety boundary, acceptance matrix, deterministic test contract, milestone gates, one-branch/one-draft-PR rule, and change budget. Do not dispatch a vague ticket description alone.
3. Jules may implement or research, but never merges, self-approves, or changes Linear status unless the human explicitly authorizes it.
4. For code sessions, inspect the published PR/branch independently. Run relevant verification, classify blockers, and send concise remediation feedback to Jules when it can continue. Jules self-review is not an acceptance gate.
5. Jules cannot resolve merge conflicts in its isolated VM. The parent agent resolves conflicts locally, force-pushes the existing branch safely, then rechecks mergeability.
6. Research sessions are read-only. The parent validates and persists their report in `docs/specs/` through a ticketed documentation PR.
7. Never tell the human to archive a Jules conversation until its associated PR is merged and the merged commit is confirmed on `master`.

## Monitoring and Remediation

- Immediately before every user-facing orchestration report, query Jules for each tracked session's current state and recent activity, and query GitHub for each associated PR's current state, head SHA, mergeability, and merge commit. Never report cached or previously observed state as current.
- If either live query fails, state `verification unavailable` with the failed system in the status table; do not assert completion, merge, archive eligibility, or a required action derived from stale data.
- Check the session state and recent activities before claiming completion. At the plan, first-change, focused-verification, and PR milestones, compare work against the implementation packet. Treat repeated plans, scope expansion, more than one PR, or a stalled milestone as an intervention signal. An untracked, temporary, or out-of-scope artifact is a merge stop until removed or explicitly dispositioned and freshly reviewed.
- A completed Jules session without a published PR requires a human **Publish PR** action; do not call it merge-ready.
- Do not publish or merge a PR with known blockers. Post remediation feedback as a GitHub PR comment with exact paths, failures, acceptance impact, and required verification so Jules can act on the review context. Use Jules chat only for direct session instructions (for example, `Publish PR`) or questions that cannot be expressed on the PR; do not duplicate PR review feedback in chat.
- When a published Jules implementation PR needs its first review, or its GitHub head SHA changes **for any reason**, automatically build the `ticket-delivery/references/review-packet.md` packet and run its fresh independent **and adversarial** review stages. Do not wait for user approval or report that a review is merely needed.
- Review implementation PRs independently; do not rely only on Jules-reported test results. The parent supplies reviewers a bounded actual-diff packet (SHA/base, manifest/stat, targeted patch, named seams/tests, invariants, verification evidence, and remediation delta); reviewers must not rediscover repository scope. If either review has blocker/high findings, automatically post one consolidated GitHub PR comment with exact paths, failed acceptance invariants, required proof, and rerun commands. Jules remediation updates the same branch and PR; after every head SHA, base SHA, merge-queue/conflict-resolution tree, or ticket-artifact change, repeat both fresh reviews. Record the reviewed head/base SHAs and mergeability. Immediately before merge, confirm they remain unchanged and mergeable; otherwise restart final review and verification. Only after both final reviews explicitly have no blocker/high finding and final verification passes may the PR merge, its merge commit be confirmed on `master`, and Linear be marked Done.
- Record plan time, first-change time, first-PR time, activity count, PR count, review rounds, out-of-scope artifacts, and final verification outcome in the ticket closeout observation.
- Report only actions unavailable through the available APIs/UI automation. Once a merged commit is confirmed on `master`, present human-only Jules conversation archival in **Your actions**.
- When the human confirms completion of a non-API action, immediately record a durable receipt (ticket, session, action, and confirmation) in project knowledge. Treat that action as complete in all future reports; never re-present it as pending because provider APIs cannot observe it.
- Persist completed research before any archival recommendation.

## Mandatory User-Facing Report

Every orchestration update must contain these two Markdown tables, even when empty:

1. `## Your actions` — only actions requiring the human. Use `None` when no human action is needed.
2. `## Status updates` — facts, completed parent actions, and remaining workflow state. Do not repeat action instructions here.

An archive-eligible conversation is a required human action: place `Archive session <id>` in **Your actions**. In **Status updates**, record only that its merged-PR-on-`master` eligibility was confirmed. Include every tracked, unarchived Jules session with an open PR or pending remediation, even when unchanged. Use the canonical template in `references/report-template.md`. Keep entries concise and use ticket IDs, Jules session IDs, PR numbers/URLs, merge state, and archive eligibility evidence when known.

## Stop Rules

Escalate rather than proceed when a change would introduce broker-order execution, auto-promotion, unapproved architecture/product decisions, raw credentials, or unresolved risk/backtest/telemetry guardrail violations.
