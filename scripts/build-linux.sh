#!/usr/bin/env bash
set -euo pipefail

# Args: VERSION ARCH (amd64 | arm64)
VERSION="${1:-0.0.0-dev}"
GO_ARCH="${2:-amd64}"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST_DIR="${ROOT}/native-host"
DIST_DIR="${ROOT}/dist/linux-${GO_ARCH}"
STAGING="${DIST_DIR}/staging"
EXTENSION_ID="ecnkofmcbijompohhddkaaekdaenhmhh"

# Architecture mapping
case "${GO_ARCH}" in
  amd64) DEB_ARCH="amd64"; RPM_ARCH="x86_64" ;;
  arm64) DEB_ARCH="arm64"; RPM_ARCH="aarch64" ;;
  *) echo "Unknown ARCH: ${GO_ARCH}"; exit 1 ;;
esac

rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

echo ">>> Building binary for linux/${GO_ARCH}"
cd "${HOST_DIR}"
GOOS=linux GOARCH=${GO_ARCH} go build -trimpath -ldflags="-s -w -X github.com/FrancisGregori/audio-tab-finder/native-host/internal/handler.HostVersion=${VERSION}" -o "${DIST_DIR}/audio-tab-finder-host" ./cmd/audio-tab-finder-host

# Generate the NM manifest file (used by RPM and tar.gz)
cat > "${DIST_DIR}/com.fgregori.audio_tab_finder.json" <<EOF
{
  "name": "com.fgregori.audio_tab_finder",
  "description": "Audio Tab Finder native helper",
  "path": "/usr/bin/audio-tab-finder-host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://${EXTENSION_ID}/"
  ]
}
EOF

echo ">>> Building .deb"
DEB_STAGE="${DIST_DIR}/deb-stage"
mkdir -p "${DEB_STAGE}/DEBIAN" "${DEB_STAGE}/usr/bin" "${DEB_STAGE}/etc/opt/chrome/native-messaging-hosts"

cp "${DIST_DIR}/audio-tab-finder-host" "${DEB_STAGE}/usr/bin/"
chmod 755 "${DEB_STAGE}/usr/bin/audio-tab-finder-host"
cp "${DIST_DIR}/com.fgregori.audio_tab_finder.json" "${DEB_STAGE}/etc/opt/chrome/native-messaging-hosts/"
chmod 644 "${DEB_STAGE}/etc/opt/chrome/native-messaging-hosts/com.fgregori.audio_tab_finder.json"

sed -e "s|__VERSION__|${VERSION}|g" -e "s|__ARCH__|${DEB_ARCH}|g" \
  "${ROOT}/packaging/linux/debian/control.tmpl" > "${DEB_STAGE}/DEBIAN/control"
cp "${ROOT}/packaging/linux/debian/postinst" "${DEB_STAGE}/DEBIAN/postinst"
chmod 755 "${DEB_STAGE}/DEBIAN/postinst"

DEB_FILE="${DIST_DIR}/audio-tab-finder-host-${VERSION}-linux-${GO_ARCH}.deb"
dpkg-deb --build "${DEB_STAGE}" "${DEB_FILE}"

echo ">>> Building .rpm"
RPM_FILE="${DIST_DIR}/audio-tab-finder-host-${VERSION}-linux-${GO_ARCH}.rpm"
RPM_BUILD_DIR="${DIST_DIR}/rpm-build"
mkdir -p "${RPM_BUILD_DIR}/SOURCES" "${RPM_BUILD_DIR}/SPECS"

# RPM Version field rejects '-' (used as separator from Release).
# Replace any hyphen with underscore for the spec only; user-facing filename
# keeps the original VERSION so artifacts match the git tag.
RPM_VERSION="${VERSION//-/_}"

cp "${DIST_DIR}/audio-tab-finder-host" "${RPM_BUILD_DIR}/SOURCES/"
cp "${DIST_DIR}/com.fgregori.audio_tab_finder.json" "${RPM_BUILD_DIR}/SOURCES/"

sed -e "s|__VERSION__|${RPM_VERSION}|g" -e "s|__RPM_ARCH__|${RPM_ARCH}|g" \
  "${ROOT}/packaging/linux/rpm/audio-tab-finder-host.spec.tmpl" \
  > "${RPM_BUILD_DIR}/SPECS/audio-tab-finder-host.spec"

rpmbuild --define "_topdir ${RPM_BUILD_DIR}" \
  --target "${RPM_ARCH}" \
  -bb "${RPM_BUILD_DIR}/SPECS/audio-tab-finder-host.spec"

mv "${RPM_BUILD_DIR}/RPMS/${RPM_ARCH}/audio-tab-finder-host-${RPM_VERSION}-1."*.rpm "${RPM_FILE}"

echo ">>> Building .tar.gz"
TARGZ_STAGE="${DIST_DIR}/targz-stage"
mkdir -p "${TARGZ_STAGE}"
cp "${DIST_DIR}/audio-tab-finder-host" "${TARGZ_STAGE}/"
cp "${ROOT}/packaging/linux/install.sh" "${TARGZ_STAGE}/"
cp "${ROOT}/packaging/linux/postinstall.sh" "${TARGZ_STAGE}/"
chmod 755 "${TARGZ_STAGE}/audio-tab-finder-host" "${TARGZ_STAGE}/install.sh" "${TARGZ_STAGE}/postinstall.sh"

# Generic .tar.gz only built once for amd64; arm64 .tar.gz is omitted
if [ "${GO_ARCH}" = "amd64" ]; then
  TARGZ_FILE="${DIST_DIR}/audio-tab-finder-host-${VERSION}-linux.tar.gz"
  tar -czf "${TARGZ_FILE}" -C "${TARGZ_STAGE}" .
fi

# Cleanup
rm -rf "${DEB_STAGE}" "${RPM_BUILD_DIR}" "${TARGZ_STAGE}"
rm -f "${DIST_DIR}/audio-tab-finder-host" "${DIST_DIR}/com.fgregori.audio_tab_finder.json"

echo ">>> Done: ${DIST_DIR}/"
ls -la "${DIST_DIR}"
