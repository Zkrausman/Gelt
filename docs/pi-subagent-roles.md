---
title: Pi project subagent roles
status: active
---

# Pi project subagent roles

Gelt tracks its project-specific Pi roles in [`.pi/agents/`](../.pi/agents/). They are runtime configuration, not a second orchestration system: the parent session retains all scope, Git, Linear, Jules, trading, release, and acceptance authority.

## Roles

| Role | Use | Authority |
| --- | --- | --- |
| `bounded-implementer` | One parent-assigned, path-bounded implementation | The only writer; cannot mutate Git state, use the network, dispatch, trade, or change external state. |
| `independent-reviewer` | Fresh-context correctness and regression review | Read-only evidence and parent-decision verdict only. |
| `regulatory-risk-reviewer` | Adversarial safety, trading-risk, and regulatory-constraint review | Read-only engineering-risk findings; not legal or release authority. |
| `jules-liaison` | Evidence-backed response to a Jules question or remediation item | Read-only handoff support; cannot dispatch/message Jules or change delivery state. |
| `jules-acceptance` | Independent assessment of a Jules-delivered diff | Read-only acceptance evidence; cannot approve, merge, or close work. |
| `documentation-researcher` | Repository and parent-supplied primary-source research | Read-only brief; no unapproved network retrieval or external decisions. |
| `repository-scout` | Fresh-context reconnaissance of the checked-out repository | Read-only and repository-only; no shell, network, external access, edits, or state changes. |
| `vm-readiness-auditor` | Human-supervised VM configuration readiness audit | Reviews only approved safe repository paths and parent-supplied redacted VM command output; cannot execute VM commands. |

These eight project roles preserve the parent session's authority boundaries. Project-scoped [`.pi/settings.json`](../.pi/settings.json) disables Pi's built-in `researcher` role because this project has no web-search capability. It does not disable `documentation-researcher`, which is limited to repository material and parent-supplied sources.

Every role disables ambient extensions and project-skill inheritance, has no shell tool, uses a strict declared tool list, and instructs the child not to invoke subagents. The parent runs required validation; `bounded-implementer` returns the commands for the parent to run. The intentionally blank `extensions:` scalar is Pi's documented no-extension setting; do not replace it with the literal `extensions: []`, which is parsed as an extension path. A role's final verdict is evidence for the parent, never permission to change a branch, ticket, service, or live trading state.

## Discovery and restart verification

Pi discovers project roles from `.pi/agents/**/*.md`; project roles override same-named user or built-in roles. Verify a checkout after pulling this change:

1. Start Pi from the repository root and approve the trusted project if prompted: `pi --approve`.
2. Restart Pi if it was already running before the role files were added or changed. Project-local discovery and trust are resolved at startup; do not rely on a stale session.
3. Use `/subagents` or the parent `subagent({ action: "list" })` control to confirm all eight canonical project role names appear as executable project agents and that the built-in `researcher` role is disabled by the project-scoped override.
4. Run one deliberately read-only dry review against a known diff with `independent-reviewer`; confirm it returns findings only and leaves `git status --short` unchanged.
5. For the bounded writer role, assign a disposable, explicitly path-scoped task in an isolated worktree. Confirm its handoff reports changed files and validation, then discard the worktree; do not use a live-trading or production task as a discovery test.

If a role is absent, first confirm the current directory is the repository root, the project is trusted, and the file has valid YAML frontmatter. Restart Pi, then inspect `subagent({ action: "doctor" })`; do not copy roles into ignored `.pi/agent/agents-team.json`.
