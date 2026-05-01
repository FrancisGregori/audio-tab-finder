#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d "native-host" ]; then
  echo "native-host directory not found"
  exit 1
fi

echo "Audio Tab Finder — local install"
echo ""
echo "Step 1: Make sure the extension is loaded in chrome://extensions (Developer mode → Load unpacked, select this repo root)."
echo "Step 2: Copy the Extension ID shown on the extension card and paste it below."
echo ""
read -rp "Extension ID: " EXT_ID

if [[ ! "$EXT_ID" =~ ^[a-p]{32}$ ]]; then
  echo "Invalid Extension ID (expected 32 chars, a-p)."
  exit 1
fi

cd native-host
make install EXT_ID="$EXT_ID"
cd ..

echo ""
echo "Done. Reload the extension in chrome://extensions."
echo "Logs: ~/Library/Application Support/AudioTabFinder/logs/host.log"
