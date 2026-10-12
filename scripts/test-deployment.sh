#!/bin/bash
set -e
echo "Verifying systemd service..."
if command -v systemd-analyze >/dev/null 2>&1; then
    systemd-analyze verify deploy/gelt-shadow.service
else
    echo "Warning: systemd-analyze not available. Skipping syntax verification."
fi
echo "Service verification complete."
