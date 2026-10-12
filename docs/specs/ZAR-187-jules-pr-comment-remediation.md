---
ticket_id: ZAR-187
title: Route Jules remediation feedback through GitHub PR comments
status: completed
timestamp: 2026-08-10T00:00:00Z
---

# Specification & Completion Report for ZAR-187

## 🎯 What
Require parent-agent review findings and remediation requirements for published Jules implementation work to be posted as GitHub PR comments.

## 💡 Why
A PR comment keeps the finding, code context, requested verification, and Jules remediation loop in the same durable review surface. Direct Jules chat is reserved for session-only instructions such as requesting PR publication.

## ✅ Verification
- Posted the existing review findings for PRs #378, #384, and #385 as GitHub comments.
- Reviewed skill and template routing rules for consistency.
- `git diff --check origin/master...HEAD`
- `go test -race ./...`

## ✨ Result
Published Jules PR feedback is now delivered through GitHub comments; the parent does not duplicate review feedback in Jules chat.

## Changed Files
- `.agents/skills/jules-orchestration/SKILL.md`
- `.agents/skills/jules-orchestration/references/report-template.md`
- `docs/specs/ZAR-187-jules-pr-comment-remediation.md`
