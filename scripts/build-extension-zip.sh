#!/usr/bin/env bash
set -euo pipefail

# Builds Archive.zip — the Chrome Web Store package for the extension only.
# Excludes native-host code, build scripts, packaging assets, internal docs,
# and anything else that isn't loaded by Chrome at runtime.
#
# Usage:
#   ./scripts/build-extension-zip.sh
#
# Output:
#   Archive.zip in the project root, ready to upload to the CWS dashboard.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUTPUT="${ROOT}/Archive.zip"

cd "${ROOT}"
rm -f "${OUTPUT}"

zip -r "${OUTPUT}" . \
  -x 'native-host/*' \
  -x 'scripts/*' \
  -x 'packaging/*' \
  -x 'docs/*' \
  -x '.github/*' \
  -x '.git/*' \
  -x '.claude/*' \
  -x '.idea/*' \
  -x 'dist/*' \
  -x '*.zip' \
  -x 'BUILDING.md' \
  -x 'STORE_LISTING.md' \
  -x 'PUBLISHING_GUIDE.md' \
  -x 'promo.html' \
  -x 'README.md' \
  -x '.gitignore' \
  -x '.DS_Store' \
  -x '*/.DS_Store' \
  -x '**/.DS_Store' \
  > /dev/null

# Sanity check: the zip must contain manifest.json at the root.
if ! unzip -l "${OUTPUT}" | grep -E '[[:space:]]manifest\.json$' >/dev/null; then
  echo "ERROR: Archive.zip does not contain manifest.json at the root" >&2
  exit 1
fi

# Show summary
SIZE=$(wc -c < "${OUTPUT}" | tr -d ' ')
COUNT=$(unzip -l "${OUTPUT}" | tail -1 | awk '{print $2}')
echo "Built: ${OUTPUT}"
echo "  ${SIZE} bytes, ${COUNT} files"
echo ""
echo "Next: upload to https://chrome.google.com/webstore/devconsole"
echo "      → Audio Tab Finder → Package → Upload new package"
