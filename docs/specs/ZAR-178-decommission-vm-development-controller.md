---
ticket_id: ZAR-178
title: Decommission legacy VM development controller
status: completed
timestamp: 2026-08-10T00:00:00Z
---

# Specification & Completion Report for ZAR-178

## 🎯 What
`deploy/setup-vm.sh` removes any legacy `gelt-delivery.service` or timer and its runtime credential file while preserving `gelt-shadow.service` setup.

## 💡 Why
A VM provisioned by an earlier setup revision must not retain an automated development controller before shadow trading.

## ✅ Verification
- `bash -n deploy/setup-vm.sh`
- `go test -race ./...`

## ✨ Result
Rerunning VM setup stops and disables legacy delivery units, deletes their unit files and `/etc/gelt/delivery.env`, reloads systemd, and enables only the shadow service.
