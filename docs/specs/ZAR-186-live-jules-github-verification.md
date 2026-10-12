---
ticket_id: ZAR-186
title: Require live Jules and GitHub verification before reports
status: completed
timestamp: 2026-08-10T00:00:00Z
---

# Specification & Completion Report for ZAR-186

## 🎯 What
Require fresh Jules and GitHub queries before every user-facing Jules-orchestration report. Restore full visibility for every tracked unarchived session with an open PR or pending remediation.

## 💡 Why
A status report is only useful when it reflects the current provider and PR lifecycle. Reusing old observations can produce invalid archive or merge instructions and can omit waiting work.

## ✅ Verification
- Reviewed the monitoring rule and canonical template for identical live-verification and status-coverage requirements.
- `git diff --check origin/master...HEAD`
- `go test -race ./...`

## ✨ Result
Reports now query current Jules state/recent activity and GitHub PR state/head/merge evidence immediately before presentation. Query failures are explicitly reported as unavailable rather than inferred. All tracked unarchived sessions with an open PR or pending remediation must remain visible.

## Changed Files
- `.agents/skills/jules-orchestration/SKILL.md`
- `.agents/skills/jules-orchestration/references/report-template.md`
- `docs/specs/ZAR-186-live-jules-github-verification.md`
