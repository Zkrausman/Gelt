#!/bin/bash

# Exit immediately if a command exits with a non-zero status
set -e

echo "Starting Gelt VM Setup..."

# Create unprivileged gelt user if it doesn't exist
if id "gelt" &>/dev/null; then
    echo "User gelt already exists."
else
    echo "Creating unprivileged gelt user..."
    useradd -m -s /bin/bash gelt
fi

GELT_OPT_DIR="${GELT_OPT_DIR:-/opt/gelt}"
GELT_HOME_DIR="${GELT_HOME_DIR:-/home/gelt}"
SYSTEMD_DIR="${SYSTEMD_DIR:-/etc/systemd/system}"

# Provision directories
echo "Provisioning directories..."
mkdir -p "$GELT_OPT_DIR"
mkdir -p "$GELT_HOME_DIR/.gelt"
chown -R gelt:gelt "$GELT_OPT_DIR"
chown -R gelt:gelt "$GELT_HOME_DIR/.gelt"
chmod 755 "$GELT_OPT_DIR"
chmod 755 "$GELT_HOME_DIR/.gelt"

# Install binary explicitly
echo "Deploying binary..."
mkdir -p "$GELT_OPT_DIR/bin/linux"
if [ ! -f "bin/linux/gelt" ]; then
    echo "Error: Binary bin/linux/gelt not found. Please build it first."
    exit 1
fi
if [ ! -x "bin/linux/gelt" ]; then
    echo "Error: Source binary bin/linux/gelt is not executable."
    exit 1
fi

EXPECTED_SHA=$(echo "$1" | tr '[:upper:]' '[:lower:]')
if [[ ! "$EXPECTED_SHA" =~ ^[a-f0-9]{64}$ ]]; then
    echo "Error: A valid 64-character hex SHA-256 must be provided."
    exit 1
fi

cp bin/linux/gelt "$GELT_OPT_DIR/bin/linux/gelt" || exit 1
chown gelt:gelt "$GELT_OPT_DIR/bin/linux/gelt" || exit 1
chmod +x "$GELT_OPT_DIR/bin/linux/gelt" || exit 1

if [ ! -f "$GELT_OPT_DIR/bin/linux/gelt" ]; then
    echo "Error: Deployed artifact path does not exist."
    exit 1
fi
if [ ! -x "$GELT_OPT_DIR/bin/linux/gelt" ]; then
    echo "Error: Deployed binary is not executable."
    exit 1
fi

OWNERSHIP=$(stat -c "%U:%G" "$GELT_OPT_DIR/bin/linux/gelt")
if [ "$OWNERSHIP" != "gelt:gelt" ]; then
    echo "Error: Incorrect ownership. Expected gelt:gelt, got $OWNERSHIP"
    exit 1
fi

ACTUAL_SHA=$(sha256sum "$GELT_OPT_DIR/bin/linux/gelt" | awk '{print $1}')
if [ "$ACTUAL_SHA" != "$EXPECTED_SHA" ]; then
    echo "Error: SHA-256 mismatch. Expected $EXPECTED_SHA, got $ACTUAL_SHA"
    exit 1
fi

# Install systemd services
echo "Installing systemd services..."
# Assuming the script is run from the root of the repository
ESCAPED_OPT_DIR="${GELT_OPT_DIR//\\/\\\\}"
ESCAPED_OPT_DIR="${ESCAPED_OPT_DIR//|/\\|}"
ESCAPED_OPT_DIR="${ESCAPED_OPT_DIR//&/\\&}"
sed "s|/opt/gelt|$ESCAPED_OPT_DIR|g" deploy/gelt-shadow.service > "$SYSTEMD_DIR/gelt-shadow.service"

# Remove any legacy local delivery controller left by older VM setup revisions.
# Stop/disable both possible units before removing their definitions so neither can
# run again after the daemon reload.
for unit in gelt-delivery.service gelt-delivery.timer; do
  if systemctl is-active --quiet "$unit"; then
    systemctl stop "$unit"
  fi
  if systemctl is-enabled --quiet "$unit"; then
    systemctl disable "$unit"
  fi
done
rm -f "$SYSTEMD_DIR/gelt-delivery.service"
rm -f "$SYSTEMD_DIR/gelt-delivery.timer"
rm -f /etc/gelt/delivery.env

# Provision user config before starting daemon
echo "Provisioning config.json..."
su -c "\"$GELT_OPT_DIR/bin/linux/gelt\" config init" gelt

systemctl daemon-reload
systemctl enable gelt-shadow.service
systemctl restart gelt-shadow.service
echo "Gelt VM Setup Complete."
