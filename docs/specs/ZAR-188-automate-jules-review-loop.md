---
ticket_id: ZAR-188
title: Automate Jules review and remediation loop
status: completed
timestamp: 2026-08-10T00:00:00Z
---

# Specification & Completion Report for ZAR-188

## 🎯 What
Make independent PR review, remediation commenting, clean-PR merge, master confirmation, and Linear completion automatic parent-agent actions in the Jules workflow.

## 💡 Why
The human should only perform actions unavailable through the connected APIs or Jules UI. Reporting that a review is needed without launching it creates avoidable manual orchestration.

## ✅ Verification
- Reviewed skill and canonical report template for matching automatic-loop rules.
- `git diff --check origin/master...HEAD`
- `go test -race ./...`

## ✨ Result
A published Jules PR is automatically reviewed on initial publication and every remediation head change. Blockers are posted to GitHub; clean verified PRs are merged, confirmed on `master`, and completed in Linear. Human reporting is limited to unavailable actions, including conversation archival.

## Changed Files
- `.agents/skills/jules-orchestration/SKILL.md`
- `.agents/skills/jules-orchestration/references/report-template.md`
- `docs/specs/ZAR-188-automate-jules-review-loop.md`
