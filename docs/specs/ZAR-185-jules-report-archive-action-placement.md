---
ticket_id: ZAR-185
title: Correct Jules report archive-action placement
status: completed
timestamp: 2026-08-10T00:00:00Z
---

# Specification & Completion Report for ZAR-185

## 🎯 What
Correct the orchestration-report contract so archive eligibility becomes a human action rather than a status instruction.

## 💡 Why
The `Your actions` table is the exclusive handoff for actions the user must take. Listing “safe to archive” only in status obscures an available required action.

## ✅ Verification
- Reviewed the skill rule and canonical report template for consistent placement.
- `git diff --check origin/master...HEAD`
- `go test -race ./...`

## ✨ Result
When a merged PR commit is confirmed on `master`, reports now list `Archive session <id>` in **Your actions**. The status table records only that archive eligibility was confirmed.

## Changed Files
- `.agents/skills/jules-orchestration/SKILL.md`
- `.agents/skills/jules-orchestration/references/report-template.md`
- `docs/specs/ZAR-185-jules-report-archive-action-placement.md`
