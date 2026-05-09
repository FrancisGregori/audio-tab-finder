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
# (timestamp.apple.com). productbuild --sign in particular can hang
# indefinitely if the server is slow/unreachable. Wrap each attempt in a
# per-command timeout so a hang gets killed and we get a real chance to retry.
TIMEOUT_BIN=""
if command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT_BIN="gtimeout"
elif command -v timeout >/dev/null 2>&1; then
  TIMEOUT_BIN="timeout"
fi

retry() {
  local attempts=3
  local delay=15
  local per_attempt_timeout=150
  local i rc
  for (( i=1; i<=attempts; i++ )); do
    if [ -n "$TIMEOUT_BIN" ]; then
      "$TIMEOUT_BIN" "$per_attempt_timeout" "$@"
      rc=$?
      [ $rc -eq 0 ] && return 0
      if [ $rc -eq 124 ]; then
        echo "  attempt $i timed out after ${per_attempt_timeout}s"
      else
        echo "  attempt $i failed (exit=$rc)"
      fi
    else
      "$@" && return 0
      echo "  attempt $i failed"
    fi
    [ "$i" -lt "$attempts" ] && { echo "  retrying in ${delay}s..."; sleep "$delay"; }
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
