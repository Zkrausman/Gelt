---
ticket_id: ZAR-183
title: Standardize Jules orchestration status and action reporting
status: completed
timestamp: 2026-08-10T00:00:00Z
---

# Specification & Completion Report for ZAR-183

## 🎯 What
Add a reusable `jules-orchestration` skill covering dispatch, monitoring, independent review, local conflict remediation, research persistence, merged-PR archive gating, and structured reporting.

## 💡 Why
Jules work requires clear parent-agent ownership and a human handoff that distinguishes required actions from passive status. A fixed report format prevents missed PR publication, merge, and archive gates.

## ✅ Verification
- Verified skill frontmatter, lifecycle rules, and report-template references.
- `git diff --check origin/master...HEAD`
- `go test -race ./...`

## ✨ Result
Every orchestration update is required to show separate `Your actions` and `Status updates` tables, while preserving the no-self-approval, local-conflict-resolution, research-persistence, and merged-PR archive gates.

## Changed Files
- `.agents/skills/jules-orchestration/SKILL.md`
- `.agents/skills/jules-orchestration/README.md`
- `.agents/skills/jules-orchestration/agents/openai.yaml`
- `.agents/skills/jules-orchestration/references/report-template.md`
- `.agents/skills/index.md`
- `docs/specs/ZAR-183-jules-orchestration-reporting.md`
