---
ticket_id: ZAR-190
title: Upgrade GitHub Actions for Node 20 deprecation
status: completed
timestamp: 2026-08-10T00:00:00Z
---

# Specification & Completion Report for ZAR-190

## 🎯 What
Upgrade CI action references from `actions/checkout@v4` to `@v5` and `actions/setup-go@v5` to `@v6`.

## 💡 Why
GitHub Actions has deprecated Node.js 20 action runtimes. The new major versions use the maintained Node.js 24 runtime while preserving the CI workflow's Go 1.22 build and race-test contract.

## ✅ Verification
- YAML parsed successfully with Python `yaml.safe_load`.
- `go test -race ./...`
- `git diff --check origin/master...HEAD`

## ✨ Result
CI no longer emits the Node.js 20 deprecation warning for checkout and Go setup actions.

## Changed Files
- `.github/workflows/ci.yml`
- `docs/specs/TASK_014_GitHub_CI_Pipeline.md`
- `docs/specs/ZAR-190-github-actions-node24.md`
