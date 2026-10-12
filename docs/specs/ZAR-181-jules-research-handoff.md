---
ticket_id: ZAR-181
title: Document Jules research-session persistence and archive workflow
status: completed
timestamp: 2026-08-10T00:00:00Z
---

# Specification & Completion Report for ZAR-181

## 🎯 What
Add a project skill defining the required lifecycle for read-only Jules research sessions: structured research output, parent-agent validation, durable storage in `docs/specs/`, a ticketed documentation PR, and merged-commit confirmation before archival.

## 💡 Why
Research conclusions are only useful when they remain reviewable and discoverable after a Jules conversation is archived. Jules must remain read-only while the parent agent owns repository persistence and human handoff.

## ✅ Verification
- Verified skill frontmatter and the reusable dispatch/report contract.
- `git diff --check origin/master...HEAD`
- `go test -race ./...`

## ✨ Result
The `jules-research-handoff` skill ensures every completed research session is validated, committed, pushed, linked to a ticketed PR, and merged into `master` before the human is told to archive it.

## Changed Files
- `.agents/skills/jules-research-handoff/SKILL.md`
- `.agents/skills/jules-research-handoff/README.md`
- `.agents/skills/jules-research-handoff/agents/openai.yaml`
- `.agents/skills/index.md`
- `docs/specs/ZAR-181-jules-research-handoff.md`
