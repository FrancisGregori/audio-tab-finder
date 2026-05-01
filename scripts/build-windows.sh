#!/usr/bin/env bash
set -euo pipefail

# Args: VERSION
VERSION="${1:-0.0.0-dev}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST_DIR="${ROOT}/native-host"
DIST_DIR="${ROOT}/dist/windows"
STAGING="${DIST_DIR}/staging"
ZIP_FILE="${DIST_DIR}/audio-tab-finder-host-${VERSION}-windows-amd64.zip"

rm -rf "${DIST_DIR}"
mkdir -p "${STAGING}"

echo ">>> Cross-compiling binary for windows/amd64"
cd "${HOST_DIR}"
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w -X github.com/FrancisGregori/audio-tab-finder/native-host/internal/handler.HostVersion=${VERSION}" -o "${STAGING}/audio-tab-finder-host.exe" ./cmd/audio-tab-finder-host

echo ">>> Bundling install scripts"
cp "${ROOT}/packaging/windows/install.ps1" "${STAGING}/"
cp "${ROOT}/packaging/windows/uninstall.ps1" "${STAGING}/"
cp "${ROOT}/packaging/windows/README.txt" "${STAGING}/"

echo ">>> Creating .zip"
cd "${STAGING}"
zip -r "${ZIP_FILE}" .
cd "${ROOT}"

# Cleanup staging
rm -rf "${STAGING}"

echo ">>> Done: ${ZIP_FILE}"
ls -la "${DIST_DIR}"
