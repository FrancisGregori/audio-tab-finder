#!/bin/bash
set -euo pipefail

NM_DIR="/etc/opt/chrome/native-messaging-hosts"
NM_FILE="${NM_DIR}/com.fgregori.audio_tab_finder.json"
BINARY="/usr/bin/audio-tab-finder-host"
EXTENSION_ID="ecnkofmcbijompohhddkaaekdaenhmhh"

mkdir -p "${NM_DIR}"

cat > "${NM_FILE}" <<EOF
{
  "name": "com.fgregori.audio_tab_finder",
  "description": "Audio Tab Finder native helper",
  "path": "${BINARY}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://${EXTENSION_ID}/"
  ]
}
EOF

chmod 644 "${NM_FILE}"

# Also write to chromium dir if present
CHROMIUM_DIR="/etc/chromium/native-messaging-hosts"
if [ -d "$(dirname "${CHROMIUM_DIR}")" ]; then
  mkdir -p "${CHROMIUM_DIR}"
  cp "${NM_FILE}" "${CHROMIUM_DIR}/com.fgregori.audio_tab_finder.json"
  chmod 644 "${CHROMIUM_DIR}/com.fgregori.audio_tab_finder.json"
fi

exit 0
