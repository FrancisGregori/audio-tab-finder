#!/usr/bin/env bash
set -euo pipefail

# install.sh — installs audio-tab-finder-host on generic Linux
# Run with sudo: sudo ./install.sh

if [ "$(id -u)" -ne 0 ]; then
  echo "Error: install.sh must be run as root (sudo ./install.sh)" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "${SCRIPT_DIR}/audio-tab-finder-host" ]; then
  echo "Error: audio-tab-finder-host binary not found alongside install.sh" >&2
  exit 1
fi

echo ">>> Installing binary to /usr/bin/audio-tab-finder-host"
install -m 0755 "${SCRIPT_DIR}/audio-tab-finder-host" /usr/bin/audio-tab-finder-host

echo ">>> Writing native messaging manifest"
"${SCRIPT_DIR}/postinstall.sh"

echo ">>> Done. Reload the Audio Tab Finder extension in Chrome."
