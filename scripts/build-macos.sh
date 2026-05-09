#!/usr/bin/env bash
set -euo pipefail

# Args: VERSION (e.g., "2.0.0")
VERSION="${1:-0.0.0-dev}"
BUNDLE_ID="com.fgregori.audio_tab_finder"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST_DIR="${ROOT}/native-host"
DIST_DIR="${ROOT}/dist/macos"
STAGING="${DIST_DIR}/staging"
BIN_DIR="${STAGING}/Library/Application Support/AudioTabFinder"
COMPONENT_PKG="${DIST_DIR}/audio-tab-finder-host-component.pkg"
FINAL_PKG="${DIST_DIR}/audio-tab-finder-host-${VERSION}-macos-universal.pkg"

mkdir -p "${BIN_DIR}"
mkdir -p "${DIST_DIR}"

echo ">>> Building universal binary"
cd "${HOST_DIR}"
GOOS=darwin GOARCH=amd64 go build -trimpath -ldflags="-s -w -X github.com/FrancisGregori/audio-tab-finder/native-host/internal/handler.HostVersion=${VERSION}" -o "${DIST_DIR}/host-amd64" ./cmd/audio-tab-finder-host
GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags="-s -w -X github.com/FrancisGregori/audio-tab-finder/native-host/internal/handler.HostVersion=${VERSION}" -o "${DIST_DIR}/host-arm64" ./cmd/audio-tab-finder-host
lipo -create -output "${BIN_DIR}/audio-tab-finder-host" "${DIST_DIR}/host-amd64" "${DIST_DIR}/host-arm64"
chmod 755 "${BIN_DIR}/audio-tab-finder-host"
rm -f "${DIST_DIR}/host-amd64" "${DIST_DIR}/host-arm64"

# codesign and productbuild --sign contact Apple's RFC3161 timestamp server
# (timestamp.apple.com), which is intermittently slow. Retry up to 3 times
# with backoff before giving up.
retry() {
  local attempts=3
  local delay=20
  local i
  for (( i=1; i<=attempts; i++ )); do
    if "$@"; then return 0; fi
    if [ "$i" -lt "$attempts" ]; then
      echo "  attempt $i failed; retrying in ${delay}s..."
      sleep "$delay"
    fi
  done
  echo "  all $attempts attempts failed"
  return 1
}

echo ">>> Codesigning binary"
if [ -n "${MACOS_CERT_APP_NAME:-}" ]; then
  retry codesign --force --options runtime --timestamp \
    --sign "${MACOS_CERT_APP_NAME}" \
    "${BIN_DIR}/audio-tab-finder-host"
else
  echo "WARNING: MACOS_CERT_APP_NAME not set; skipping codesign (dev build only)"
fi

echo ">>> Building component .pkg"
cd "${ROOT}"
pkgbuild \
  --root "${STAGING}" \
  --identifier "${BUNDLE_ID}" \
  --version "${VERSION}" \
  --scripts "packaging/macos" \
  --install-location "/" \
  "${COMPONENT_PKG}"

echo ">>> Building distribution .pkg"
PRODUCTBUILD_ARGS=(
  --distribution "packaging/macos/distribution.xml"
  --resources "packaging/macos"
  --package-path "${DIST_DIR}"
  "${FINAL_PKG}"
)
if [ -n "${MACOS_CERT_INSTALLER_NAME:-}" ]; then
  PRODUCTBUILD_ARGS+=(--sign "${MACOS_CERT_INSTALLER_NAME}")
fi

retry productbuild "${PRODUCTBUILD_ARGS[@]}"

echo ">>> Done: ${FINAL_PKG}"
