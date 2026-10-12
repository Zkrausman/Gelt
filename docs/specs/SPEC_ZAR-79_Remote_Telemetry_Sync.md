---
title: "[ZAR-79] Remote Shadow Journal Sync & Diagnostic Extraction Tooling"
status: "implemented"
type: "specification"
---

# Architectural Decision Record (ADR): Remote Telemetry Extraction Tooling

## 1. Context & Objective
As part of the GCP e2-micro 24/7 Cloud Deployment initiative (GELT Epic), we need secure remote synchronization tooling to pull persistent shadow trade journals, AI thesis logs, and generated executive reports from the headless GCP VM down to local dev machines for diagnostic review.

This fulfills Linear Ticket **ZAR-79** ([GELT-143]).

## 2. Multi-Hop Architectural Analysis

### System Flow
- **Local Dev Machines** trigger the sync via Bash (`scripts/sync-telemetry.sh`) or PowerShell (`scripts/sync-telemetry.ps1`).
- **Network Layer:** Standard `scp` over SSH.
- **Remote Host:** The headless VM running the `gelt-shadow.service` systemd unit as the unprivileged `gelt` user.
- **Data Extracted:**
  - `~/.gelt/gelt_shadow_journal.json` (Trade Journal)
  - `~/.gelt/gelt_ai_theses.json` (AI Output Logs)
  - `~/.gelt/*.md` (Executive Reports)
- **Local Storage:** Synchronized to `./cloud-telemetry-backup/YYYYMMDD_HHMMSS/` to prevent overwriting prior diagnostics.

### Concurrency & Thread Safety Evaluation
The files being copied from the remote GCP VM (e.g., `gelt_shadow_journal.json`) are actively being written to by the `gelt` engine. The `Store` struct within `pkg/shadow/shadow.go` handles concurrent-safe JSON file persistence via `sync.RWMutex`.
During the `scp` copy process:
1. `scp` performs a read operation on the remote file.
2. If `gelt` engine writes to the file concurrently, there is a minor risk of copying a partially flushed JSON payload resulting in a schema truncation locally.
3. However, since the engine's `Save()` function uses `os.WriteFile` which is atomic at the OS level (usually implemented via writing to a temp file and renaming), the `scp` will most likely read either the old state or the new state cleanly. No local daemon crashes will occur on the remote server because `scp` is merely a reader.
4. No memory leaks are introduced because this is purely shell scripting triggering `scp`.

### Compliance
- **No local Thneed daemons:** Handled via standard SSH/SCP. No new daemons introduced.
- **Telemetry logging:** The tool is external to the Go engine, but pulls the correct `.json` structured logs.

## 3. Mathematical Constraints

While this is primarily an infrastructure script, the extraction tooling enables quantitative review. Let $J$ be the set of JSON objects in the shadow journal and $T$ be the set of time intervals.
The local ingestion pipeline expects a valid JSON structure such that for each record $r \in J$, the required schema boundaries hold (e.g., $r.Profit > -5000$).
The network transfer time $T_{sync}$ can be defined as:
$$ T_{sync} = \frac{\sum_{i=1}^{n} S_i}{B_{network}} + L $$
where $S_i$ is the size of each log artifact, $B_{network}$ is the available bandwidth, and $L$ is the SSH handshake latency. Since $S_i$ is bounded by rotational log constraints (typically <10MB), $T_{sync}$ is negligible ($< 2$ seconds).

## 4. Execution Guardrails
- **Bash Script:** Checks for `REMOTE_HOST` parameter. Fails gracefully.
- **PowerShell Script:** Uses `Mandatory=$true` for `RemoteHost`. Uses `try/catch` to ignore missing optional files.
- Both scripts isolate backups into timestamped local directories to prevent data loss.
