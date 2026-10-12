---
name: jules-research-handoff
description: Runs a read-only Jules research session, persists its validated report as a ticketed Gelt documentation PR, and authorizes conversation archival only after that PR merges.
---

# Jules Research Handoff

Use this skill when a Jules session is intended to research, audit, or plan rather than implement. The completed research report becomes a ticketed documentation change when the parent persists it; that documentation PR must follow `../ticket-delivery/SKILL.md` exactly.

## Research Session Contract

The Jules prompt must require all of the following:

- Read-only repository analysis; no file edits, branch creation, commits, PRs, or Linear mutations.
- No broker calls, credentials, live-order execution, auto-promotion, or external side effects.
- A structured final report containing repository evidence with file/line references, recommendations, safety implications, deterministic validation plan, dependencies, and unresolved human decisions.
- A clear statement that the session must not archive itself or claim the report is durably saved.

## Parent-Agent Handoff

After Jules completes, the parent agent owns delivery:

1. Read and validate the report against the current `master` code and Gelt guardrails.
2. Save the validated report under `docs/specs/` using the ticket identifier and a descriptive filename. Include YAML frontmatter with `ticket_id`, `type: research`, `status`, timestamp, and Jules session identifier.
3. Draft the report's completion specification and run its focused deterministic checks. Then follow every `ticket-delivery` stage: fresh independent review, fresh adversarial review, remediation as needed, repeat both reviews after every change, and final verification only after both final reviews are clean.
4. Commit and push the finalized report on the ticket branch, and open a PR whose title contains `[<TICKET>]` and whose body contains `Resolves <TICKET>`. The PR must include actual review and verification evidence.
5. Confirm the PR URL, head commit, and mergeability before reporting completion.
6. Keep the Jules conversation open until its associated PR is **merged**. For implementation sessions this is a mandatory code-change gate; apply the same gate to research-report documentation PRs unless the human explicitly approves earlier archival.
7. Tell the human to archive only after the merged commit is confirmed on `master`.

The parent agent must report both actions it completed and the human actions still required (publish, review, merge, and archive).

## Report Template

```text
Research report:
- Existing seams: exact files and lines
- Proposed contract/design
- Safety and trust boundaries
- Deterministic validation plan
- Dependency-ordered next tickets
- Open decisions requiring human approval
- Explicit non-goals
```

## Stop Rules

Do not create an implementation PR from research findings. Escalate when the report recommends live-order behavior, broker credential changes, automatic promotion, an unresolved architecture decision, or a conflict with the current `master` branch.
