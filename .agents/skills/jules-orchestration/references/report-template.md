# Jules Orchestration Report Template

Use this exact structure for every user-facing orchestration update. Immediately before writing it, query Jules for all tracked sessions and GitHub for all associated PRs; do not reuse stale results.

## Your actions

| Priority | Action | When |
| --- | --- | --- |
| — | None. | — |

## Status updates

| Ticket / session | State | Parent action completed | PR / archive state |
| --- | --- | --- | --- |
| — | — | — | — |

Rules:
- Keep human actions out of the status table.
- If a code or research PR is not merged, state `retain conversation` in the archive column.
- If the merged commit is confirmed on `master`, list `Archive session <id>` in **Your actions**; the status table records only `eligibility confirmed`.
- If a completed Jules code session has no PR, list `Publish PR` only in **Your actions**.
- Include every tracked, unarchived Jules session with an open PR or pending remediation, including unchanged sessions.
- If live Jules or GitHub verification fails, state `verification unavailable` and do not infer state or actions from older results.
- A human-confirmed non-API action is a durable receipt, not a pending action. Record it immediately and omit it from future **Your actions** tables.
- For a published Jules implementation PR, automatically build the shared bounded review packet and run fresh independent and adversarial reviews when it first appears and after every head SHA, base SHA, merge-queue/conflict-resolution tree, or ticket-artifact change. With blocker/high findings, post consolidated remediation requirements as a GitHub PR comment before reporting. Draft the completion specification before the final reviews. Record the reviewed head/base SHAs and mergeability; immediately before merge, confirm they remain unchanged, mergeable, and free of unresolved artifacts. Otherwise restart final reviews and verification. Use Jules chat only for direct session instructions such as `Publish PR`.
- Name blockers and remediation in status, but do not bury required human decisions there.
