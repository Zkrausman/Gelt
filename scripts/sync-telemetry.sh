#!/usr/bin/env bash

# Gelt Shadow Engine - Remote Telemetry Extraction Tool (Bash)
# Pulls persistent trade journals, AI thesis logs, and executive reports.

set -e

# Configuration
LOCAL_BACKUP_DIR="./cloud-telemetry-backup/$(date +%Y%m%d_%H%M%S)"

if [ "$#" -eq 0 ]; then
    echo "Usage: $0 [remote_user] <remote_host> [identity_file]"
    echo "Example: $0 ubuntu 34.123.45.67 ~/.ssh/gcp_key"
    echo "Example (defaults to gelt user): $0 34.123.45.67"
    # Safe exit compatible with sourcing and standalone execution
    kill -INT $$
    return 1 2>/dev/null || true
elif [ "$#" -eq 1 ]; then
    REMOTE_USER="gelt"
    REMOTE_HOST="${1}"
    IDENTITY_FILE=""
else
    REMOTE_USER="${1}"
    REMOTE_HOST="${2}"
    IDENTITY_FILE="${3}"
fi

SSH_OPTS=""
if [ -n "$IDENTITY_FILE" ]; then
    SSH_OPTS="-i $IDENTITY_FILE"
fi

echo "Creating local backup directory: $LOCAL_BACKUP_DIR"
mkdir -p "$LOCAL_BACKUP_DIR"

echo "Syncing shadow trade journal from $REMOTE_HOST..."
scp $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}:~/.gelt/journals/shadow_journal.json" "$LOCAL_BACKUP_DIR/" || echo "Warning: shadow_journal.json not found."

echo "Syncing AI thesis logs from $REMOTE_HOST..."
scp $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}:~/.gelt/journals/ai_theses.json" "$LOCAL_BACKUP_DIR/" || echo "Warning: ai_theses.json not found."

echo "Syncing daemon status logs from $REMOTE_HOST..."
scp $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}:~/.gelt/daemon/status.json" "$LOCAL_BACKUP_DIR/" || echo "Warning: daemon/status.json not found."

echo "Syncing shadow telemetry logs from $REMOTE_HOST..."
scp $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}:~/.gelt/telemetry/shadow_telemetry.json" "$LOCAL_BACKUP_DIR/" || echo "Warning: telemetry/shadow_telemetry.json not found."

echo "Syncing executive reports from $REMOTE_HOST..."
scp $SSH_OPTS "${REMOTE_USER}@${REMOTE_HOST}:~/.gelt/*.md" "$LOCAL_BACKUP_DIR/" 2>/dev/null || echo "No markdown reports found."

echo "Telemetry extraction complete. Files saved to: $LOCAL_BACKUP_DIR"
ls -la "$LOCAL_BACKUP_DIR"
