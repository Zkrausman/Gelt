---
ticket_id: ZAR-201
title: Commit discoverable Gelt subagent roles
status: implemented
timestamp: 2026-08-12T00:00:00Z
---

# Specification & Completion Report for ZAR-201

## 🎯 What
Replace the ignored, inactive Pi team scaffold with six tracked project role definitions under `.pi/agents/`:

- bounded implementation
- independent review
- adversarial safety, trading-risk, and regulatory-constraint review
- Jules liaison
- Jules acceptance assessment
- documentation research

The `.gitignore` exception tracks only reviewed Markdown role definitions; all other `.pi` runtime state remains ignored.

## 💡 Why
Role configuration must be visible, reviewable, and discoverable by Pi after a checkout. Each role also needs a narrow tool and authority contract so advisory work cannot silently become implementation, external orchestration, acceptance, or trading authority.

## Implemented Behavior

- Every role uses canonical `.pi/agents/*.md` discovery, project context, fresh context, Pi's blank `extensions:` no-extension setting, disabled inherited skills, and a strict declared tool allowlist.
- `bounded-implementer` is the only writer and explicitly requires parent-assigned scope; all other roles are read-only.
- The bounded writer prohibits Git-state mutation and network/external-service actions; review, regulatory, Jules, and research roles explicitly prohibit GitHub/Linear/Jules mutation, commits, merges, credential access, and live-trading actions.
- `docs/pi-subagent-roles.md` records role selection, retained parent authority, discovery, restart verification, and safe dry-run expectations.

## ✅ Verification

- Load the worktree through `subagent({ action: "list" })` and confirm the required role names, declared context, and project scope.
- Successfully launch `independent-reviewer` in a no-edit runtime dry review after loading its blank `extensions:` contract.
- Confirm the `.pi/agents/*.md` files are addable while `.pi/agents/runtime.json` and `.pi/agent/agents-team.json` remain ignored.
- Inspect the complete diff and run `git diff --check`.
- Runtime procedure: restart Pi from the repository root, then confirm the six canonical names through `/subagents` or `subagent({ action: "list" })` as documented in `docs/pi-subagent-roles.md`.

## ✨ Result
Gelt now ships standard, discoverable Pi role definitions with explicit operational boundaries instead of an ignored local scaffold.

## Changed Files

- `.gitignore`
- `.pi/agents/bounded-implementer.md`
- `.pi/agents/independent-reviewer.md`
- `.pi/agents/regulatory-risk-reviewer.md`
- `.pi/agents/jules-liaison.md`
- `.pi/agents/jules-acceptance.md`
- `.pi/agents/documentation-researcher.md`
- `docs/pi-subagent-roles.md`
- `docs/specs/ZAR-201-pi-discoverable-subagent-roles.md`
