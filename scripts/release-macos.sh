#!/usr/bin/env bash
set -euo pipefail

# Build, sign, notarize, staple and upload the macOS .pkg for a given version.
# Run on a developer Mac with the Developer ID Application + Installer certs
# already imported into the login keychain.
#
# Usage:
#   ./scripts/release-macos.sh <version>
#
# Required environment variables (export before running, or put in ~/.zshrc):
#   APPLE_DEVELOPER_ID_APP   — full identity name, e.g.
#                              "Developer ID Application: Francis Gregori (5PCD2J6XHA)"
#   APPLE_DEVELOPER_ID_INST  — full identity name, e.g.
#                              "Developer ID Installer: Francis Gregori (5PCD2J6XHA)"
#   APPLE_ID                 — your Apple Developer account email
#   APPLE_TEAM_ID            — your 10-char team ID
#   APPLE_APP_PASSWORD       — app-specific password from appleid.apple.com
#                              (NOT your Apple ID password)
#
# What this does:
#   1. cross-compiles darwin/amd64 + darwin/arm64 → universal binary via lipo
#   2. codesign --timestamp the binary (Developer ID Application)
#   3. pkgbuild --sign the .pkg (Developer ID Installer)
#   4. xcrun notarytool submit --wait
#   5. xcrun stapler staple
#   6. spctl --assess to confirm
#   7. gh release upload v<version> <pkg>

VERSION="${1:?Usage: $0 <version>   (e.g., 2.0.0 — without the v prefix)}"

# Verify required env vars
: "${APPLE_DEVELOPER_ID_APP:?Set APPLE_DEVELOPER_ID_APP}"
: "${APPLE_DEVELOPER_ID_INST:?Set APPLE_DEVELOPER_ID_INST}"
: "${APPLE_ID:?Set APPLE_ID}"
: "${APPLE_TEAM_ID:?Set APPLE_TEAM_ID}"
: "${APPLE_APP_PASSWORD:?Set APPLE_APP_PASSWORD}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG="${ROOT}/dist/macos/audio-tab-finder-host-${VERSION}-macos-universal.pkg"
TAG="v${VERSION}"

echo "=========================================="
echo "Releasing macOS .pkg for ${TAG}"
echo "=========================================="

# 1+2+3: build + sign + pkg via existing build-macos.sh
echo
echo ">>> Step 1/5: build + sign + pkgbuild"
MACOS_CERT_APP_NAME="$APPLE_DEVELOPER_ID_APP" \
MACOS_CERT_INSTALLER_NAME="$APPLE_DEVELOPER_ID_INST" \
  "${ROOT}/scripts/build-macos.sh" "$VERSION"

if [ ! -f "$PKG" ]; then
  echo "ERROR: expected .pkg not found at $PKG" >&2
  exit 1
fi

# 4: notarize
echo
echo ">>> Step 2/5: notarize (this can take 1-5 minutes)"
xcrun notarytool submit "$PKG" \
  --apple-id "$APPLE_ID" \
  --team-id "$APPLE_TEAM_ID" \
  --password "$APPLE_APP_PASSWORD" \
  --wait

# 5: staple
echo
echo ">>> Step 3/5: staple notarization to .pkg"
xcrun stapler staple "$PKG"

# 6: verify
echo
echo ">>> Step 4/5: verify Gatekeeper acceptance"
spctl --assess --type install -v "$PKG"

# 7: upload to GitHub release
echo
echo ">>> Step 5/5: upload to GitHub release ${TAG}"
if ! gh release view "$TAG" --repo FrancisGregori/audio-tab-finder >/dev/null 2>&1; then
  echo "ERROR: release ${TAG} does not exist on GitHub yet." >&2
  echo "       Run this script AFTER the CI workflow has created the release" >&2
  echo "       (Linux + Windows artifacts already uploaded)." >&2
  exit 1
fi

gh release upload "$TAG" "$PKG" --repo FrancisGregori/audio-tab-finder --clobber

echo
echo "=========================================="
echo "Done! .pkg uploaded to:"
echo "  https://github.com/FrancisGregori/audio-tab-finder/releases/tag/${TAG}"
echo "=========================================="
