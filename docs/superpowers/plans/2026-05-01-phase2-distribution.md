# Phase 2 — Public Distribution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Audio Tab Finder v2.0.0 publicly: signed/notarized macOS `.pkg`, Linux `.deb`/`.rpm`/`.tar.gz`, Windows `.zip` with PowerShell installer, all built automatically via GitHub Actions on `git tag v*`. Updated extension popup with discreet collapsible banner inviting install/update. Documentation explaining install per platform.

**Architecture:** Single GitHub Actions workflow (`release.yml`) triggered by tag push. Builds for all three platforms in parallel. Signs+notarizes macOS using Apple certificates from GitHub Secrets. Publishes a GitHub Release with all artifacts and SHA256SUMS.txt.

**Tech Stack:** Go 1.21+ (cross-compile), Bash (build scripts), GitHub Actions YAML, macOS `codesign`/`pkgbuild`/`productbuild`/`notarytool`, Debian `dpkg-deb`, RPM `fpm`, Windows PowerShell 5.1+.

**Spec:** `docs/superpowers/specs/2026-05-01-phase2-distribution-design.md`

---

## Project conventions

Read these before starting:

- **No tests for the extension code.** Manual QA only. Same convention as Phase 1.
- **`pt_BR` locale uses ASCII only** — no diacritics. Match existing strings ("audio" not "áudio", "voce" not "você").
- **Commit after each task.** Use conventional commit prefixes (`feat:`, `fix:`, `chore:`, `docs:`, `ci:`).
- **Bash scripts use `set -euo pipefail`** at the top. Strict error handling.
- **The published Chrome Web Store Extension ID is needed** for postinstall scripts. Currently the extension is at `https://chromewebstore.google.com/detail/audio-tab-finder-%E2%80%93-find-m/ecnkofmcbijompohhddkaaekdaenhmhh` — Extension ID is **`ecnkofmcbijompohhddkaaekdaenhmhh`**. This is hardcoded in the postinstall scripts.
- **Apple Developer Team ID, Apple ID, and other secrets** are user-provided after Task 1.

## File structure overview

### New files

```
.github/workflows/
└── release.yml                                   ← CI release pipeline
scripts/
├── export-certs.sh                              ← dev helper, base64-encode .p12 files
├── build-macos.sh                                ← called by CI
├── build-linux.sh                                ← called by CI
└── build-windows.sh                              ← called by CI
packaging/
├── macos/
│   ├── postinstall                              ← writes NM manifest at install time
│   ├── distribution.xml                         ← productbuild config
│   └── README.txt                                ← shown in installer wizard
├── linux/
│   ├── debian/
│   │   ├── control.tmpl                          ← .deb metadata
│   │   └── postinst                              ← .deb postinstall script
│   ├── rpm/
│   │   └── audio-tab-finder-host.spec.tmpl      ← .rpm spec
│   ├── install.sh                                ← shipped inside .tar.gz
│   └── postinstall.sh                            ← used by both .deb and .rpm
└── windows/
    ├── install.ps1                                ← shipped inside .zip
    └── uninstall.ps1                              ← shipped inside .zip
BUILDING.md                                       ← dev docs (build from source)
```

### Modified files

```
host-connection.js          ← + EXPECTED_HOST_VERSION, hostVersion, semverCompare
popup-bridge.js             ← handleGetAggregate returns hostStatus
popup.js                    ← renderHostBanner rewrite (collapsible)
popup.css                   ← .host-banner replaced with collapsible style
_locales/en/messages.json   ← + 6 new keys, − 2 obsolete keys
_locales/pt_BR/messages.json ← + 6 new keys (ASCII), − 2 obsolete
README.md                    ← rewritten Install section
promo.html                   ← + cross-profile section
STORE_LISTING.md             ← + v2.0 section + permission justification
PUBLISHING_GUIDE.md          ← + Releasing v2.x section
```

## How to verify changes

- **Bash scripts:** `bash -n script.sh` for syntax. Run locally with appropriate inputs where possible.
- **Extension code:** `node --check file.js`. Manual QA in Chrome (load unpacked, exercise feature).
- **Workflow YAML:** validate with `yamllint` or by pushing a test tag (`v0.0.1-test`) and observing CI.
- **Documentation:** read end-to-end in a Markdown previewer to confirm structure.

---

# Group A — User prerequisites (Apple Developer + GitHub Secrets)

These tasks are **user-driven** — the implementer (or user) follows step-by-step external instructions. No code changes in the repo. Each task ends when the user has the required artifact ready.

### Task 1: Apple Developer setup

**Files:** None (external work in Apple Developer Portal and Keychain Access)

**Goal:** End this task with the following ready on the user's Mac:
1. Apple Developer Team ID (10-char string)
2. `Developer ID Application` certificate `.p12` file with a strong password
3. `Developer ID Installer` certificate `.p12` file with the same password
4. App-Specific Password for `notarytool`
5. Apple ID email known

- [ ] **Step 1: Confirm Apple Developer Program membership**

Open https://developer.apple.com/account and sign in. Click **Membership** in the sidebar. Confirm:
- Status is "Active"
- Membership Type includes "Apple Developer Program"
- Note the **Team ID** (a 10-character alphanumeric string like `ABCD123456`). Save this somewhere safe.

If membership is not active, complete enrollment first ($99/yr).

- [ ] **Step 2: Generate Certificate Signing Request (CSR) in Keychain Access**

Open Keychain Access (⌘+Space → "Keychain Access").

Menu bar: **Keychain Access** → **Certificate Assistant** → **Request a Certificate from a Certificate Authority…**

Fill in:
- **User Email Address:** your Apple ID email
- **Common Name:** your name (e.g., "Francis Gregori")
- **CA Email Address:** leave blank
- **Request is:** Saved to disk

Click **Continue**. Save as `~/Desktop/CertificateSigningRequest.certSigningRequest`.

- [ ] **Step 3: Create Developer ID Application certificate**

In your browser, go to https://developer.apple.com/account/resources/certificates/list

Click the blue **+** button to create a new certificate.

Select:
- **Software** → **Developer ID Application** → Continue

Click **Choose File** and upload the CSR from Step 2. Click **Continue**.

Click **Download** to save the resulting `.cer` file. Then **double-click the `.cer` file** to install it into your Keychain (Keychain Access opens, shows the certificate added to "login" keychain).

- [ ] **Step 4: Create Developer ID Installer certificate**

Same process as Step 3, but on the certificate type screen, select:
- **Software** → **Developer ID Installer** → Continue

Use the SAME CSR file. Download and install the `.cer` the same way.

- [ ] **Step 5: Export both certificates as `.p12` files**

Open Keychain Access. Click **My Certificates** in the left sidebar.

You should see entries like:
- "Developer ID Application: <Your Name> (TEAM_ID)"
- "Developer ID Installer: <Your Name> (TEAM_ID)"

For EACH one:
1. Right-click the certificate (NOT the key inside it, the cert itself)
2. Select **Export "Developer ID … : Your Name"…**
3. File Format: **Personal Information Exchange (.p12)**
4. Save as:
   - `~/Desktop/DeveloperIDApplication.p12`
   - `~/Desktop/DeveloperIDInstaller.p12`
5. When prompted for a password, enter a **strong password** (use the SAME password for BOTH files — this is the password that will be stored as `APPLE_CERT_PASSWORD` in GitHub Secrets later)
6. Confirm the password
7. Authenticate with macOS user password if prompted

You should now have two `.p12` files on your Desktop, both protected by the same password.

- [ ] **Step 6: Generate App-Specific Password**

In your browser, sign in to https://appleid.apple.com.

Navigate to **Sign-In and Security** → **App-Specific Passwords**.

Click **Generate an app-specific password** (or the **+** icon).

Label: `audio-tab-finder notarization`

Click **Create**. You'll see a password in the format `xxxx-xxxx-xxxx-xxxx`. Copy it now — Apple does NOT show it again.

- [ ] **Step 7: Sanity check — collect everything in one place**

You should now have:

| Item | Where |
|------|-------|
| Team ID | A 10-char string (e.g., `ABCD123456`) |
| Developer ID Application `.p12` | `~/Desktop/DeveloperIDApplication.p12` |
| Developer ID Installer `.p12` | `~/Desktop/DeveloperIDInstaller.p12` |
| `.p12` password | The password set in Step 5 (same for both files) |
| App-Specific Password | The 19-char string from Step 6 |
| Apple ID email | Your Apple Developer account email |

Save these to a password manager — you'll paste them into GitHub Secrets in Task 3.

- [ ] **Step 8: No commit needed** (no code changes)

This task ends when all six items above are collected and ready to use.

---

### Task 2: Helper script — `scripts/export-certs.sh`

**Files:**
- Create: `scripts/export-certs.sh`

**Goal:** A one-time helper that takes the two `.p12` files from Task 1 and outputs them as base64-encoded strings ready to paste into GitHub Secrets.

- [ ] **Step 1: Implement the helper script**

Create `scripts/export-certs.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  cat <<EOF >&2
Usage: $0 <DeveloperIDApplication.p12> <DeveloperIDInstaller.p12>

Outputs base64-encoded contents of each .p12 file, ready to paste
into GitHub Secrets as APPLE_CERT_APPLICATION_P12_BASE64 and
APPLE_CERT_INSTALLER_P12_BASE64.

The password used to export the .p12 files goes into a separate
secret APPLE_CERT_PASSWORD.
EOF
  exit 1
fi

APP_P12="$1"
INSTALLER_P12="$2"

if [ ! -f "$APP_P12" ]; then
  echo "Error: $APP_P12 not found" >&2
  exit 1
fi

if [ ! -f "$INSTALLER_P12" ]; then
  echo "Error: $INSTALLER_P12 not found" >&2
  exit 1
fi

cat <<EOF

=== APPLE_CERT_APPLICATION_P12_BASE64 ===
Paste the lines below as the value of GitHub Secret APPLE_CERT_APPLICATION_P12_BASE64:

$(base64 -i "$APP_P12")

=== APPLE_CERT_INSTALLER_P12_BASE64 ===
Paste the lines below as the value of GitHub Secret APPLE_CERT_INSTALLER_P12_BASE64:

$(base64 -i "$INSTALLER_P12")

=== Done ===
Don't forget to also configure the other 5 secrets:
  APPLE_CERT_PASSWORD          = the password you set when exporting the .p12 files
  APPLE_ID                     = your Apple Developer account email
  APPLE_TEAM_ID                = your 10-char Team ID
  APPLE_APP_SPECIFIC_PASSWORD  = the 19-char password from appleid.apple.com
  KEYCHAIN_PASSWORD            = any random string (used for the temporary CI keychain)
EOF
```

- [ ] **Step 2: Make it executable**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
chmod +x scripts/export-certs.sh
```

- [ ] **Step 3: Verify**

```bash
bash -n scripts/export-certs.sh
ls -la scripts/export-certs.sh
```

Expected: no syntax errors; file is executable (`-rwx...`).

- [ ] **Step 4: Commit**

```bash
git add scripts/export-certs.sh
git commit -m "chore: add helper script to export Apple certs as base64 for GitHub Secrets"
```

---

### Task 3: Configure GitHub Secrets

**Files:** None (external work in GitHub repo settings)

**Goal:** All 7 GitHub Secrets configured in the repo's Settings → Secrets and variables → Actions.

- [ ] **Step 1: Run the helper from Task 2 to generate base64 strings**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
./scripts/export-certs.sh ~/Desktop/DeveloperIDApplication.p12 ~/Desktop/DeveloperIDInstaller.p12 > /tmp/secrets.txt
```

The output file `/tmp/secrets.txt` contains both base64 blocks. Open it in any editor.

- [ ] **Step 2: Open GitHub Secrets settings**

In your browser, go to:
`https://github.com/FrancisGregori/audio-tab-finder/settings/secrets/actions`

(Replace with the actual GitHub repo URL if different.)

Click the **New repository secret** button for each of the 7 secrets below.

- [ ] **Step 3: Add `APPLE_CERT_APPLICATION_P12_BASE64`**

- Name: `APPLE_CERT_APPLICATION_P12_BASE64`
- Secret: paste the entire base64 block under `=== APPLE_CERT_APPLICATION_P12_BASE64 ===` from `/tmp/secrets.txt` (the actual base64 lines, NOT the section header)

Click **Add secret**.

- [ ] **Step 4: Add `APPLE_CERT_INSTALLER_P12_BASE64`**

- Name: `APPLE_CERT_INSTALLER_P12_BASE64`
- Secret: paste the entire base64 block under `=== APPLE_CERT_INSTALLER_P12_BASE64 ===`

Click **Add secret**.

- [ ] **Step 5: Add `APPLE_CERT_PASSWORD`**

- Name: `APPLE_CERT_PASSWORD`
- Secret: the password you used in Task 1, Step 5 when exporting the `.p12` files

Click **Add secret**.

- [ ] **Step 6: Add `APPLE_ID`**

- Name: `APPLE_ID`
- Secret: your Apple Developer account email

Click **Add secret**.

- [ ] **Step 7: Add `APPLE_TEAM_ID`**

- Name: `APPLE_TEAM_ID`
- Secret: the 10-char Team ID from Task 1, Step 1

Click **Add secret**.

- [ ] **Step 8: Add `APPLE_APP_SPECIFIC_PASSWORD`**

- Name: `APPLE_APP_SPECIFIC_PASSWORD`
- Secret: the 19-char app-specific password from Task 1, Step 6

Click **Add secret**.

- [ ] **Step 9: Add `KEYCHAIN_PASSWORD`**

- Name: `KEYCHAIN_PASSWORD`
- Secret: any random string (e.g., generated with `openssl rand -hex 16` in terminal). This is used as the password for the temporary keychain created on the CI runner.

Click **Add secret**.

- [ ] **Step 10: Securely delete the temp file**

```bash
rm -f /tmp/secrets.txt
shred -u ~/Desktop/DeveloperIDApplication.p12 2>/dev/null || rm -f ~/Desktop/DeveloperIDApplication.p12
shred -u ~/Desktop/DeveloperIDInstaller.p12 2>/dev/null || rm -f ~/Desktop/DeveloperIDInstaller.p12
```

(The `.p12` files are now in your Keychain Access AND in GitHub Secrets — no need to keep the desktop copies.)

- [ ] **Step 11: Verify all 7 secrets are set**

In the GitHub Secrets page, you should see 7 secrets listed:
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_CERT_APPLICATION_P12_BASE64`
- `APPLE_CERT_INSTALLER_P12_BASE64`
- `APPLE_CERT_PASSWORD`
- `APPLE_ID`
- `APPLE_TEAM_ID`
- `KEYCHAIN_PASSWORD`

GitHub does not display secret values once saved (only the names).

- [ ] **Step 12: No commit needed**

This task ends when all 7 secrets show in the GitHub Secrets list.

---

# Group B — Packaging scripts (per platform)

### Task 4: macOS packaging — build script + postinstall + distribution.xml

**Files:**
- Create: `scripts/build-macos.sh`
- Create: `packaging/macos/postinstall`
- Create: `packaging/macos/distribution.xml`
- Create: `packaging/macos/README.txt`

- [ ] **Step 1: Create `packaging/macos/postinstall`**

Create `packaging/macos/postinstall`:

```bash
#!/bin/bash
set -e

NM_DIR="/Library/Google/Chrome/NativeMessagingHosts"
NM_FILE="${NM_DIR}/com.fgregori.audio_tab_finder.json"
BINARY="/Library/Application Support/AudioTabFinder/audio-tab-finder-host"
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
exit 0
```

- [ ] **Step 2: Create `packaging/macos/distribution.xml`**

Create `packaging/macos/distribution.xml`:

```xml
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="1">
    <title>Audio Tab Finder Native Helper</title>
    <organization>com.fgregori</organization>
    <readme file="README.txt" mime-type="text/plain"/>
    <options customize="never" require-scripts="false" hostArchitectures="x86_64,arm64"/>
    <volume-check>
        <allowed-os-versions>
            <os-version min="11.0"/>
        </allowed-os-versions>
    </volume-check>
    <choices-outline>
        <line choice="default">
            <line choice="com.fgregori.audio_tab_finder"/>
        </line>
    </choices-outline>
    <choice id="default"/>
    <choice id="com.fgregori.audio_tab_finder" visible="false">
        <pkg-ref id="com.fgregori.audio_tab_finder"/>
    </choice>
    <pkg-ref id="com.fgregori.audio_tab_finder" version="0" onConclusion="none">audio-tab-finder-host-component.pkg</pkg-ref>
</installer-gui-script>
```

- [ ] **Step 3: Create `packaging/macos/README.txt`**

Create `packaging/macos/README.txt`:

```
Audio Tab Finder Native Helper

This installer registers a small command-line tool that allows the
Audio Tab Finder Chrome extension to detect audio playback across
your Chrome profiles.

The helper:
  - Is signed and notarized by Apple
  - Communicates only with the Audio Tab Finder Chrome extension
  - Reads and writes only files under
    ~/Library/Application Support/AudioTabFinder/
  - Makes no network connections

After installation, reload the Audio Tab Finder extension in Chrome
to enable cross-profile detection.

To uninstall:
  sudo rm "/Library/Application Support/AudioTabFinder/audio-tab-finder-host"
  sudo rm "/Library/Google/Chrome/NativeMessagingHosts/com.fgregori.audio_tab_finder.json"

Source code: https://github.com/FrancisGregori/audio-tab-finder
```

- [ ] **Step 4: Create `scripts/build-macos.sh`**

Create `scripts/build-macos.sh`:

```bash
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
GOOS=darwin GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o "${DIST_DIR}/host-amd64" ./cmd/audio-tab-finder-host
GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o "${DIST_DIR}/host-arm64" ./cmd/audio-tab-finder-host
lipo -create -output "${BIN_DIR}/audio-tab-finder-host" "${DIST_DIR}/host-amd64" "${DIST_DIR}/host-arm64"
chmod 755 "${BIN_DIR}/audio-tab-finder-host"
rm -f "${DIST_DIR}/host-amd64" "${DIST_DIR}/host-arm64"

echo ">>> Codesigning binary"
if [ -n "${MACOS_CERT_APP_NAME:-}" ]; then
  codesign --force --options runtime --timestamp \
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

productbuild "${PRODUCTBUILD_ARGS[@]}"

echo ">>> Done: ${FINAL_PKG}"
```

- [ ] **Step 5: Make scripts and postinstall executable**

```bash
chmod +x scripts/build-macos.sh
chmod +x packaging/macos/postinstall
```

- [ ] **Step 6: Verify syntax**

```bash
bash -n scripts/build-macos.sh
bash -n packaging/macos/postinstall
```

Expected: no output (no errors).

- [ ] **Step 7: Local dry-run (no signing)**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
./scripts/build-macos.sh 2.0.0-dev
```

Expected:
- Output ends with "Done: dist/macos/audio-tab-finder-host-2.0.0-dev-macos-universal.pkg"
- Warning about skipping codesign (no `MACOS_CERT_APP_NAME` env var) is expected
- `dist/macos/audio-tab-finder-host-2.0.0-dev-macos-universal.pkg` exists

Verify the `.pkg` is valid:

```bash
pkgutil --check-signature dist/macos/audio-tab-finder-host-2.0.0-dev-macos-universal.pkg
```

For an unsigned dev build, expect output mentioning "no signature". That's fine — CI will sign it.

Verify the contents:

```bash
pkgutil --expand dist/macos/audio-tab-finder-host-2.0.0-dev-macos-universal.pkg /tmp/pkg-check
ls /tmp/pkg-check
rm -rf /tmp/pkg-check
```

Expected: contains `audio-tab-finder-host-component.pkg` and `Distribution`.

- [ ] **Step 8: Add `dist/` to `.gitignore`**

Add to `.gitignore` at repo root:

```bash
cat >> .gitignore <<'EOF'

# Phase 2 — local build artifacts
dist/
EOF
```

(If `.gitignore` doesn't exist, create it. If it already has these patterns, this is a no-op.)

- [ ] **Step 9: Commit**

```bash
git add scripts/build-macos.sh packaging/macos/ .gitignore
git commit -m "feat: add macOS .pkg build script and postinstall scripts"
```

---

### Task 5: Linux packaging — build script + postinstall + .deb/.rpm metadata

**Files:**
- Create: `scripts/build-linux.sh`
- Create: `packaging/linux/postinstall.sh`
- Create: `packaging/linux/install.sh`
- Create: `packaging/linux/debian/control.tmpl`
- Create: `packaging/linux/debian/postinst`
- Create: `packaging/linux/rpm/audio-tab-finder-host.spec.tmpl`

- [ ] **Step 1: Create `packaging/linux/postinstall.sh`**

Shared logic between `.deb`, `.rpm`, and `install.sh`:

Create `packaging/linux/postinstall.sh`:

```bash
#!/bin/bash
set -e

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
```

- [ ] **Step 2: Create `packaging/linux/install.sh`** (used by `.tar.gz` distribution)

Create `packaging/linux/install.sh`:

```bash
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
```

- [ ] **Step 3: Create `packaging/linux/debian/control.tmpl`**

Create `packaging/linux/debian/control.tmpl`:

```
Package: audio-tab-finder-host
Version: __VERSION__
Section: utils
Priority: optional
Architecture: __ARCH__
Maintainer: Francis Gregori <francis.g.munis@gmail.com>
Homepage: https://github.com/FrancisGregori/audio-tab-finder
Description: Native messaging host for the Audio Tab Finder Chrome extension
 Allows the Audio Tab Finder Chrome extension to detect audio playback
 across multiple Chrome profiles via Chrome's native messaging protocol.
 .
 The host runs locally only and makes no network connections.
```

- [ ] **Step 4: Create `packaging/linux/debian/postinst`**

Create `packaging/linux/debian/postinst`:

```bash
#!/bin/bash
set -e

# This script is bundled INSIDE the .deb. The actual logic lives in postinstall.sh
# at the project level, but we inline the same logic here so the .deb is self-contained.

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

CHROMIUM_DIR="/etc/chromium/native-messaging-hosts"
if [ -d "$(dirname "${CHROMIUM_DIR}")" ]; then
  mkdir -p "${CHROMIUM_DIR}"
  cp "${NM_FILE}" "${CHROMIUM_DIR}/com.fgregori.audio_tab_finder.json"
  chmod 644 "${CHROMIUM_DIR}/com.fgregori.audio_tab_finder.json"
fi

exit 0
```

- [ ] **Step 5: Create `packaging/linux/rpm/audio-tab-finder-host.spec.tmpl`**

Create `packaging/linux/rpm/audio-tab-finder-host.spec.tmpl`:

```
Name:           audio-tab-finder-host
Version:        __VERSION__
Release:        1%{?dist}
Summary:        Native messaging host for the Audio Tab Finder Chrome extension
License:        MIT
URL:            https://github.com/FrancisGregori/audio-tab-finder
Source0:        audio-tab-finder-host
Source1:        com.fgregori.audio_tab_finder.json
BuildArch:      __RPM_ARCH__
AutoReqProv:    no

%description
Allows the Audio Tab Finder Chrome extension to detect audio playback
across multiple Chrome profiles via Chrome's native messaging protocol.
The host runs locally only and makes no network connections.

%prep
# nothing to prep — pre-built binary

%install
mkdir -p %{buildroot}/usr/bin
mkdir -p %{buildroot}/etc/opt/chrome/native-messaging-hosts
install -m 0755 %{SOURCE0} %{buildroot}/usr/bin/audio-tab-finder-host
install -m 0644 %{SOURCE1} %{buildroot}/etc/opt/chrome/native-messaging-hosts/com.fgregori.audio_tab_finder.json

%files
/usr/bin/audio-tab-finder-host
/etc/opt/chrome/native-messaging-hosts/com.fgregori.audio_tab_finder.json

%changelog
* Fri May 01 2026 Francis Gregori <francis.g.munis@gmail.com> - %{version}-1
- Public release.
```

- [ ] **Step 6: Create `scripts/build-linux.sh`**

Create `scripts/build-linux.sh`:

```bash
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
GOOS=linux GOARCH=${GO_ARCH} go build -trimpath -ldflags="-s -w" -o "${DIST_DIR}/audio-tab-finder-host" ./cmd/audio-tab-finder-host

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

cp "${DIST_DIR}/audio-tab-finder-host" "${RPM_BUILD_DIR}/SOURCES/"
cp "${DIST_DIR}/com.fgregori.audio_tab_finder.json" "${RPM_BUILD_DIR}/SOURCES/"

sed -e "s|__VERSION__|${VERSION}|g" -e "s|__RPM_ARCH__|${RPM_ARCH}|g" \
  "${ROOT}/packaging/linux/rpm/audio-tab-finder-host.spec.tmpl" \
  > "${RPM_BUILD_DIR}/SPECS/audio-tab-finder-host.spec"

rpmbuild --define "_topdir ${RPM_BUILD_DIR}" \
  --target "${RPM_ARCH}" \
  -bb "${RPM_BUILD_DIR}/SPECS/audio-tab-finder-host.spec"

mv "${RPM_BUILD_DIR}/RPMS/${RPM_ARCH}/audio-tab-finder-host-${VERSION}-1."*.rpm "${RPM_FILE}"

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
```

- [ ] **Step 7: Make all scripts executable**

```bash
chmod +x scripts/build-linux.sh
chmod +x packaging/linux/postinstall.sh
chmod +x packaging/linux/install.sh
chmod +x packaging/linux/debian/postinst
```

- [ ] **Step 8: Verify syntax**

```bash
bash -n scripts/build-linux.sh
bash -n packaging/linux/postinstall.sh
bash -n packaging/linux/install.sh
bash -n packaging/linux/debian/postinst
```

All should be silent (no errors).

- [ ] **Step 9: Commit**

```bash
git add scripts/build-linux.sh packaging/linux/
git commit -m "feat: add Linux .deb, .rpm, and .tar.gz build script"
```

Note: this script can only be FULLY tested in a Linux environment with `dpkg-deb` and `rpmbuild` installed (i.e., the CI runner). On macOS, the `bash -n` syntax check is the maximum local validation. Full smoke test happens in Task 16 (CI dry-run).

---

### Task 6: Windows packaging — build script + install.ps1 + uninstall.ps1

**Files:**
- Create: `scripts/build-windows.sh`
- Create: `packaging/windows/install.ps1`
- Create: `packaging/windows/uninstall.ps1`
- Create: `packaging/windows/README.txt`

- [ ] **Step 1: Create `packaging/windows/install.ps1`**

Create `packaging/windows/install.ps1`:

```powershell
# install.ps1 — installs audio-tab-finder-host on Windows
# Right-click this file and select "Run with PowerShell".

$ErrorActionPreference = "Stop"

$ExtensionId = "ecnkofmcbijompohhddkaaekdaenhmhh"
$InstallDir = Join-Path $env:LOCALAPPDATA "AudioTabFinder"
$BinaryName = "audio-tab-finder-host.exe"
$ManifestName = "com.fgregori.audio_tab_finder.json"
$RegistryKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.fgregori.audio_tab_finder"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceBinary = Join-Path $ScriptDir $BinaryName

if (-not (Test-Path $SourceBinary)) {
    Write-Error "Could not find $BinaryName next to install.ps1"
    exit 1
}

Write-Host ">>> Creating install directory at $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

Write-Host ">>> Copying binary"
Copy-Item -Path $SourceBinary -Destination (Join-Path $InstallDir $BinaryName) -Force

Write-Host ">>> Writing native messaging manifest"
$ManifestPath = Join-Path $InstallDir $ManifestName
$BinaryPath = (Join-Path $InstallDir $BinaryName) -replace '\\', '\\\\'
$Manifest = @"
{
  "name": "com.fgregori.audio_tab_finder",
  "description": "Audio Tab Finder native helper",
  "path": "$BinaryPath",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$ExtensionId/"
  ]
}
"@
Set-Content -Path $ManifestPath -Value $Manifest -Encoding UTF8

Write-Host ">>> Registering native messaging host in registry"
New-Item -Path $RegistryKey -Force | Out-Null
Set-ItemProperty -Path $RegistryKey -Name "(Default)" -Value $ManifestPath

Write-Host ""
Write-Host "Done. Reload the Audio Tab Finder extension in Chrome."
Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
```

- [ ] **Step 2: Create `packaging/windows/uninstall.ps1`**

Create `packaging/windows/uninstall.ps1`:

```powershell
# uninstall.ps1 — removes audio-tab-finder-host from Windows
# Right-click this file and select "Run with PowerShell".

$ErrorActionPreference = "Continue"

$InstallDir = Join-Path $env:LOCALAPPDATA "AudioTabFinder"
$RegistryKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.fgregori.audio_tab_finder"

Write-Host ">>> Removing registry key"
if (Test-Path $RegistryKey) {
    Remove-Item -Path $RegistryKey -Recurse -Force
}

Write-Host ">>> Removing install directory"
if (Test-Path $InstallDir) {
    Remove-Item -Path $InstallDir -Recurse -Force
}

Write-Host ""
Write-Host "Done. The native helper has been removed."
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
```

- [ ] **Step 3: Create `packaging/windows/README.txt`**

Create `packaging/windows/README.txt`:

```
Audio Tab Finder Native Helper — Windows install

This ZIP contains:
  - audio-tab-finder-host.exe   (the native helper binary)
  - install.ps1                 (PowerShell installer script)
  - uninstall.ps1               (PowerShell uninstaller script)

To install:
  1. Right-click install.ps1 and select "Run with PowerShell".
  2. If PowerShell prompts about untrusted scripts, type Y and press Enter.
  3. Wait for "Done" message.
  4. Reload the Audio Tab Finder extension in Chrome.

The installer:
  - Copies the binary to %LOCALAPPDATA%\AudioTabFinder\
  - Writes a native messaging manifest there
  - Registers the manifest in HKCU\Software\Google\Chrome\NativeMessagingHosts
  - Requires no admin privileges (per-user install)
  - Makes no network connections

To uninstall:
  Right-click uninstall.ps1 and select "Run with PowerShell".

NOTE: This installer is not signed with a Windows Authenticode certificate
(those are expensive for a free open-source project). The PowerShell script
is plain text — you can read it before running.

Source code: https://github.com/FrancisGregori/audio-tab-finder
```

- [ ] **Step 4: Create `scripts/build-windows.sh`**

Create `scripts/build-windows.sh`:

```bash
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
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o "${STAGING}/audio-tab-finder-host.exe" ./cmd/audio-tab-finder-host

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
```

- [ ] **Step 5: Make script executable**

```bash
chmod +x scripts/build-windows.sh
```

- [ ] **Step 6: Verify syntax**

```bash
bash -n scripts/build-windows.sh
```

PowerShell scripts cannot be syntax-checked from macOS without PowerShell installed. The validation happens by running them in CI's Linux runner (cross-compile only) and then in the smoke test on a Windows machine (Task 17).

- [ ] **Step 7: Local dry-run**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
./scripts/build-windows.sh 2.0.0-dev
```

Expected:
- Output ends with "Done: dist/windows/audio-tab-finder-host-2.0.0-dev-windows-amd64.zip"
- ZIP is created and contains: `audio-tab-finder-host.exe`, `install.ps1`, `uninstall.ps1`, `README.txt`

Inspect:

```bash
unzip -l dist/windows/audio-tab-finder-host-2.0.0-dev-windows-amd64.zip
```

Expected: 4 files listed.

- [ ] **Step 8: Commit**

```bash
git add scripts/build-windows.sh packaging/windows/
git commit -m "feat: add Windows .zip with PowerShell installer build script"
```

---

# Group C — GitHub Actions CI workflow

### Task 7: Release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/release.yml`:

```yaml
name: Release

on:
  push:
    tags:
      - 'v*'

permissions:
  contents: write

jobs:
  build-macos:
    name: Build macOS .pkg
    runs-on: macos-14
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.21'
          cache-dependency-path: native-host/go.sum

      - name: Extract version from tag
        id: version
        run: echo "version=${GITHUB_REF#refs/tags/v}" >> $GITHUB_OUTPUT

      - name: Import Application certificate
        env:
          CERT_BASE64: ${{ secrets.APPLE_CERT_APPLICATION_P12_BASE64 }}
          CERT_PASSWORD: ${{ secrets.APPLE_CERT_PASSWORD }}
          KEYCHAIN_PASSWORD: ${{ secrets.KEYCHAIN_PASSWORD }}
        run: |
          # Create a temporary keychain
          security create-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
          security default-keychain -s build.keychain
          security unlock-keychain -p "$KEYCHAIN_PASSWORD" build.keychain
          security set-keychain-settings -lut 3600 build.keychain

          # Decode and import Application certificate
          echo "$CERT_BASE64" | base64 -d > /tmp/app.p12
          security import /tmp/app.p12 -k build.keychain -P "$CERT_PASSWORD" -T /usr/bin/codesign
          rm /tmp/app.p12

      - name: Import Installer certificate
        env:
          CERT_BASE64: ${{ secrets.APPLE_CERT_INSTALLER_P12_BASE64 }}
          CERT_PASSWORD: ${{ secrets.APPLE_CERT_PASSWORD }}
        run: |
          echo "$CERT_BASE64" | base64 -d > /tmp/installer.p12
          security import /tmp/installer.p12 -k build.keychain -P "$CERT_PASSWORD" -T /usr/bin/productbuild
          rm /tmp/installer.p12

          # Allow codesign and productbuild to access the keychain
          security set-key-partition-list -S apple-tool:,apple:,codesign:,productbuild: -s -k "${{ secrets.KEYCHAIN_PASSWORD }}" build.keychain

      - name: Find certificate identities
        id: identities
        run: |
          APP_NAME=$(security find-identity -v -p codesigning build.keychain | grep "Developer ID Application" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
          INSTALLER_NAME=$(security find-identity -v build.keychain | grep "Developer ID Installer" | head -1 | sed -E 's/.*"([^"]+)".*/\1/')
          echo "app=$APP_NAME" >> $GITHUB_OUTPUT
          echo "installer=$INSTALLER_NAME" >> $GITHUB_OUTPUT

      - name: Build .pkg
        env:
          MACOS_CERT_APP_NAME: ${{ steps.identities.outputs.app }}
          MACOS_CERT_INSTALLER_NAME: ${{ steps.identities.outputs.installer }}
        run: ./scripts/build-macos.sh "${{ steps.version.outputs.version }}"

      - name: Notarize .pkg
        env:
          APPLE_ID: ${{ secrets.APPLE_ID }}
          APPLE_TEAM_ID: ${{ secrets.APPLE_TEAM_ID }}
          APPLE_APP_SPECIFIC_PASSWORD: ${{ secrets.APPLE_APP_SPECIFIC_PASSWORD }}
        run: |
          PKG_PATH="dist/macos/audio-tab-finder-host-${{ steps.version.outputs.version }}-macos-universal.pkg"
          xcrun notarytool submit "$PKG_PATH" \
            --apple-id "$APPLE_ID" \
            --team-id "$APPLE_TEAM_ID" \
            --password "$APPLE_APP_SPECIFIC_PASSWORD" \
            --wait

      - name: Staple notarization
        run: |
          xcrun stapler staple "dist/macos/audio-tab-finder-host-${{ steps.version.outputs.version }}-macos-universal.pkg"

      - name: Verify .pkg
        run: |
          spctl --assess --type install -v "dist/macos/audio-tab-finder-host-${{ steps.version.outputs.version }}-macos-universal.pkg"

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: macos-pkg
          path: dist/macos/*.pkg

  build-linux:
    name: Build Linux ${{ matrix.arch }}
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        arch: [amd64, arm64]
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.21'
          cache-dependency-path: native-host/go.sum

      - name: Install packaging tools
        run: |
          sudo apt-get update
          sudo apt-get install -y dpkg-dev rpm

      - name: Extract version from tag
        id: version
        run: echo "version=${GITHUB_REF#refs/tags/v}" >> $GITHUB_OUTPUT

      - name: Build .deb / .rpm / .tar.gz
        run: ./scripts/build-linux.sh "${{ steps.version.outputs.version }}" "${{ matrix.arch }}"

      - name: Upload artifacts
        uses: actions/upload-artifact@v4
        with:
          name: linux-${{ matrix.arch }}
          path: |
            dist/linux-${{ matrix.arch }}/*.deb
            dist/linux-${{ matrix.arch }}/*.rpm
            dist/linux-${{ matrix.arch }}/*.tar.gz

  build-windows:
    name: Build Windows .zip
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Set up Go
        uses: actions/setup-go@v5
        with:
          go-version: '1.21'
          cache-dependency-path: native-host/go.sum

      - name: Extract version from tag
        id: version
        run: echo "version=${GITHUB_REF#refs/tags/v}" >> $GITHUB_OUTPUT

      - name: Build .zip
        run: ./scripts/build-windows.sh "${{ steps.version.outputs.version }}"

      - name: Upload artifact
        uses: actions/upload-artifact@v4
        with:
          name: windows-zip
          path: dist/windows/*.zip

  release:
    name: Create GitHub Release
    needs: [build-macos, build-linux, build-windows]
    runs-on: ubuntu-latest
    steps:
      - name: Download all artifacts
        uses: actions/download-artifact@v4
        with:
          path: artifacts

      - name: Generate SHA256 sums
        run: |
          cd artifacts
          find . -type f \( -name '*.pkg' -o -name '*.deb' -o -name '*.rpm' -o -name '*.tar.gz' -o -name '*.zip' \) -print0 \
            | xargs -0 shasum -a 256 \
            | sed 's|./[^/]*/||' \
            > SHA256SUMS.txt
          cat SHA256SUMS.txt

      - name: Move all artifacts to one dir
        run: |
          mkdir -p release
          find artifacts -type f \( -name '*.pkg' -o -name '*.deb' -o -name '*.rpm' -o -name '*.tar.gz' -o -name '*.zip' \) -exec cp {} release/ \;
          cp artifacts/SHA256SUMS.txt release/

      - name: Create Release
        uses: softprops/action-gh-release@v2
        with:
          files: release/*
          draft: false
          prerelease: ${{ contains(github.ref, '-') }}
          generate_release_notes: true
```

- [ ] **Step 2: Validate YAML syntax**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/release.yml'))"
```

Expected: no output (valid YAML).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add release workflow that builds and signs all platforms on tag push"
```

(Don't push the tag yet — we want code changes done first.)

---

# Group D — Extension changes (banner + auto-update)

### Task 8: `host-connection.js` — version capture and comparison

**Files:**
- Modify: `host-connection.js`

- [ ] **Step 1: Add EXPECTED_HOST_VERSION constant near the top**

Find the line that says:
```js
const NATIVE_HOST_NAME = 'com.fgregori.audio_tab_finder';
```

Insert AFTER it (still near the top of the file):

```js

const EXPECTED_HOST_VERSION = '2.0.0';
```

- [ ] **Step 2: Add `hostVersion` field to `_hostState`**

Find the existing `_hostState` object:

```js
const _hostState = {
  port: null,
  connected: false,
  reconnectMs: 1000,
  pending: new Map(), // request_id -> { resolve, reject, timeoutId }
  onMessage: null,    // callback(msg) for unsolicited pushes (action_request)
  onConnectionChange: null, // callback(connected: boolean)
};
```

REPLACE with:

```js
const _hostState = {
  port: null,
  connected: false,
  reconnectMs: 1000,
  pending: new Map(),
  onMessage: null,
  onConnectionChange: null,
  hostVersion: null,
};
```

- [ ] **Step 3: Capture host version in `handleIncomingMessage`**

Find the existing `handleIncomingMessage` function:

```js
function handleIncomingMessage(msg) {
  if (msg && msg.request_id && _hostState.pending.has(msg.request_id)) {
    const { resolve, timeoutId } = _hostState.pending.get(msg.request_id);
    clearTimeout(timeoutId);
    _hostState.pending.delete(msg.request_id);
    resolve(msg);
    return;
  }
  if (_hostState.onMessage) {
    _hostState.onMessage(msg);
  }
}
```

REPLACE with:

```js
function handleIncomingMessage(msg) {
  if (msg && msg.type === 'hello_ack' && typeof msg.host_version === 'string') {
    _hostState.hostVersion = msg.host_version;
  }
  if (msg && msg.request_id && _hostState.pending.has(msg.request_id)) {
    const { resolve, timeoutId } = _hostState.pending.get(msg.request_id);
    clearTimeout(timeoutId);
    _hostState.pending.delete(msg.request_id);
    resolve(msg);
    return;
  }
  if (_hostState.onMessage) {
    _hostState.onMessage(msg);
  }
}
```

- [ ] **Step 4: Reset hostVersion on disconnect**

Find the existing `handleDisconnect` function. Find the line `_hostState.connected = false;` and add a new line right after it:

Current:
```js
function handleDisconnect() {
  _hostState.port = null;
  _hostState.connected = false;
  if (_hostState.onConnectionChange) _hostState.onConnectionChange(false);
```

Becomes:
```js
function handleDisconnect() {
  _hostState.port = null;
  _hostState.connected = false;
  _hostState.hostVersion = null;
  if (_hostState.onConnectionChange) _hostState.onConnectionChange(false);
```

- [ ] **Step 5: Add helper functions at the end of the file**

Append at the END of `host-connection.js`:

```js

function getHostVersion() {
  return _hostState.hostVersion;
}

function isHostOutdated() {
  if (!_hostState.hostVersion) return false;
  return semverCompare(_hostState.hostVersion, EXPECTED_HOST_VERSION) < 0;
}

function semverCompare(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    const av = pa[i] || 0;
    const bv = pb[i] || 0;
    if (av !== bv) return av - bv;
  }
  return 0;
}
```

- [ ] **Step 6: Verify it parses**

```bash
node --check host-connection.js
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add host-connection.js
git commit -m "feat(ext): capture host version, expose isHostOutdated for banner"
```

---

### Task 9: `popup-bridge.js` — return `hostStatus` and `hostVersion`

**Files:**
- Modify: `popup-bridge.js`

- [ ] **Step 1: Update `handleGetAggregate`**

Find the existing `handleGetAggregate` function:

```js
async function handleGetAggregate() {
  if (!isHostConnected()) {
    const tabs = await chrome.tabs.query({ audible: true });
    const label = await getProfileLabel();
    return {
      ok: true,
      hostInstalled: false,
      profiles: [
        {
          profile_uuid: null,
          label,
          is_self: true,
          tabs: tabs.map(formatTab),
        },
      ],
    };
  }
  try {
    const resp = await sendToHost({ type: 'get_aggregate' });
    return { ok: true, hostInstalled: true, profiles: resp.profiles };
  } catch (e) {
    return { ok: false, hostInstalled: true, error: e.message };
  }
}
```

REPLACE with:

```js
async function handleGetAggregate() {
  if (!isHostConnected()) {
    const tabs = await chrome.tabs.query({ audible: true });
    const label = await getProfileLabel();
    return {
      ok: true,
      hostInstalled: false,
      hostStatus: 'disconnected',
      hostVersion: null,
      profiles: [
        {
          profile_uuid: null,
          label,
          is_self: true,
          tabs: tabs.map(formatTab),
        },
      ],
    };
  }
  try {
    const resp = await sendToHost({ type: 'get_aggregate' });
    return {
      ok: true,
      hostInstalled: true,
      hostStatus: isHostOutdated() ? 'outdated' : 'ok',
      hostVersion: getHostVersion(),
      profiles: resp.profiles,
    };
  } catch (e) {
    return { ok: false, hostInstalled: true, hostStatus: 'unknown', hostVersion: null, error: e.message };
  }
}
```

- [ ] **Step 2: Verify it parses**

```bash
node --check popup-bridge.js
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add popup-bridge.js
git commit -m "feat(ext): popup-bridge returns hostStatus and hostVersion in aggregate"
```

---

### Task 10: i18n — add new banner keys, remove obsolete

**Files:**
- Modify: `_locales/en/messages.json`
- Modify: `_locales/pt_BR/messages.json`

- [ ] **Step 1: Update `_locales/en/messages.json`**

Find and REMOVE these two existing entries (they were Phase 1 placeholders, now obsolete):

```json
  "nativeHostMissing": {
    "message": "Install the native helper to see audio across profiles",
    "description": "Banner text when native messaging host is not installed"
  },
  "installInstructions": {
    "message": "Install instructions",
    "description": "Link text for native helper install instructions"
  },
```

Then ADD these 6 new entries (place them in alphabetical order or grouped near `actionFailedToast` — wherever fits the existing layout):

```json
  "hostBannerExplanationMissing": {
    "message": "Audio Tab Finder can detect and control audio across all your Chrome profiles. This requires installing a small native helper.",
    "description": "Expanded explanation in the popup banner when host is not installed"
  },
  "hostBannerExplanationOutdated": {
    "message": "A newer version of the native helper is available. Update to keep cross-profile features working smoothly.",
    "description": "Expanded explanation in the popup banner when host is outdated"
  },
  "hostBannerLinkInstall": {
    "message": "How to install →",
    "description": "Link in the popup banner pointing to install instructions"
  },
  "hostBannerLinkUpdate": {
    "message": "Download latest →",
    "description": "Link in the popup banner pointing to the latest release"
  },
  "hostBannerQuestionMissing": {
    "message": "Detect audio across profiles?",
    "description": "Question shown in the collapsed popup banner when host is missing"
  },
  "hostBannerQuestionOutdated": {
    "message": "Update available",
    "description": "Question shown in the collapsed popup banner when host is outdated"
  },
```

- [ ] **Step 2: Update `_locales/pt_BR/messages.json` (ASCII only)**

Find and REMOVE the same two existing entries (same keys: `nativeHostMissing`, `installInstructions`).

ADD these 6 entries with ASCII-only Portuguese text:

```json
  "hostBannerExplanationMissing": {
    "message": "O Audio Tab Finder pode detectar e controlar audio em todos os seus perfis Chrome. Isso requer instalar um pequeno helper nativo.",
    "description": "Expanded explanation in the popup banner when host is not installed"
  },
  "hostBannerExplanationOutdated": {
    "message": "Uma versao mais recente do helper nativo esta disponivel. Atualize para manter as features cross-profile funcionando bem.",
    "description": "Expanded explanation in the popup banner when host is outdated"
  },
  "hostBannerLinkInstall": {
    "message": "Como instalar →",
    "description": "Link in the popup banner pointing to install instructions"
  },
  "hostBannerLinkUpdate": {
    "message": "Baixar a versao mais recente →",
    "description": "Link in the popup banner pointing to the latest release"
  },
  "hostBannerQuestionMissing": {
    "message": "Detectar audio entre perfis?",
    "description": "Question shown in the collapsed popup banner when host is missing"
  },
  "hostBannerQuestionOutdated": {
    "message": "Atualizacao disponivel",
    "description": "Question shown in the collapsed popup banner when host is outdated"
  },
```

- [ ] **Step 3: Verify both files are valid JSON**

```bash
python3 -m json.tool < _locales/en/messages.json > /dev/null && echo OK
python3 -m json.tool < _locales/pt_BR/messages.json > /dev/null && echo OK
```

Both should print "OK".

- [ ] **Step 4: Verify pt_BR has no diacritics in the new strings**

```bash
python3 -c "
import json
d = json.load(open('_locales/pt_BR/messages.json'))
keys = ['hostBannerExplanationMissing', 'hostBannerExplanationOutdated', 'hostBannerLinkInstall', 'hostBannerLinkUpdate', 'hostBannerQuestionMissing', 'hostBannerQuestionOutdated']
for k in keys:
    msg = d[k]['message']
    for c in msg:
        if ord(c) > 127 and c != chr(0x2192):  # → arrow is allowed
            print(f'NON-ASCII in {k}: {c!r} (U+{ord(c):04X})')
"
```

Expected: no output (no unexpected non-ASCII).

- [ ] **Step 5: Commit**

```bash
git add _locales/en/messages.json _locales/pt_BR/messages.json
git commit -m "i18n: add 6 banner strings, remove obsolete nativeHostMissing/installInstructions"
```

---

### Task 11: `popup.css` — replace `.host-banner` styles with collapsible design

**Files:**
- Modify: `popup.css`

- [ ] **Step 1: Find the existing `.host-banner` block**

In `popup.css`, find the existing block:

```css
/* Host banner */
.host-banner {
  background-color: #4a3010;
  color: #ffd699;
  padding: 10px 12px;
  border-radius: 8px;
  margin-bottom: 12px;
  font-size: 13px;
  border-left: 3px solid #ff9800;
}
.host-banner a { color: #ffd699; text-decoration: underline; }
```

REPLACE the entire block (both rules) with:

```css
/* Host banner — collapsible footer with question + expansion panel */
.host-banner {
  border-top: 1px solid #1f4068;
  margin-top: 12px;
  padding: 0;
  background-color: transparent;
}

.host-banner__strip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  color: #888;
  font-size: 12px;
  user-select: none;
  transition: background-color 0.2s ease, color 0.2s ease;
}

.host-banner__strip:hover {
  background-color: #16213e;
  color: #fff;
}

.host-banner__strip:focus-visible {
  outline: 2px solid #4ade80;
  outline-offset: -2px;
}

.host-banner__icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.host-banner__icon svg {
  width: 14px;
  height: 14px;
  fill: currentColor;
}

.host-banner__question {
  flex: 1;
}

.host-banner__chevron {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
  transition: transform 0.2s ease;
}

.host-banner__chevron svg {
  width: 12px;
  height: 12px;
  fill: currentColor;
}

.host-banner--expanded .host-banner__chevron {
  transform: rotate(180deg);
}

.host-banner__panel {
  display: none;
  padding: 4px 12px 12px 32px;
  font-size: 12px;
  color: #b0b0b0;
  line-height: 1.5;
}

.host-banner--expanded .host-banner__panel {
  display: block;
}

.host-banner__panel p {
  margin: 0 0 8px 0;
}

.host-banner__link {
  display: inline-block;
  margin-top: 4px;
  color: #4ade80;
  text-decoration: none;
  font-weight: 500;
  cursor: pointer;
}

.host-banner__link:hover {
  text-decoration: underline;
}
```

- [ ] **Step 2: Verify the CSS is well-formed**

Open `popup.css` in any editor and confirm there are no leftover lines from the old block, no unmatched braces.

You can also check with:

```bash
node -e "
const fs = require('fs');
const css = fs.readFileSync('popup.css', 'utf8');
let depth = 0;
for (const c of css) {
  if (c === '{') depth++;
  if (c === '}') depth--;
  if (depth < 0) { console.error('Unmatched }'); process.exit(1); }
}
if (depth !== 0) { console.error('Unmatched {'); process.exit(1); }
console.log('OK');
"
```

Expected: prints "OK".

- [ ] **Step 3: Commit**

```bash
git add popup.css
git commit -m "feat(ext): replace amber host-banner with collapsible footer style"
```

---

### Task 12: `popup.js` — `renderHostBanner` rewrite

**Files:**
- Modify: `popup.js`

- [ ] **Step 1: Add URL constants near the top**

In `popup.js`, near the top of the file (after the `DOMContentLoaded` listener), add:

```js
const HOST_INSTALL_URL = 'https://github.com/FrancisGregori/audio-tab-finder#install';
const HOST_RELEASES_URL = 'https://github.com/FrancisGregori/audio-tab-finder/releases/latest';
```

(Place them somewhere reasonable — for example, right after `function initializeI18n()` definition, or grouped at the top.)

- [ ] **Step 2: Replace the existing `renderHostBanner` function**

Find the existing `renderHostBanner` function:

```js
function renderHostBanner(hostInstalled) {
  const banner = document.getElementById('host-banner');
  if (hostInstalled) {
    banner.classList.add('hidden');
    return;
  }
  banner.innerHTML = '';
  const text = document.createElement('span');
  text.textContent = chrome.i18n.getMessage('nativeHostMissing');
  banner.appendChild(text);
  banner.classList.remove('hidden');
}
```

REPLACE the entire function with:

```js
function renderHostBanner(hostInstalled, hostStatus) {
  const banner = document.getElementById('host-banner');
  banner.innerHTML = '';
  banner.classList.remove('host-banner--expanded');

  if (hostInstalled && hostStatus === 'ok') {
    banner.classList.add('hidden');
    return;
  }

  banner.classList.remove('hidden');

  const isOutdated = hostInstalled && hostStatus === 'outdated';

  const strip = document.createElement('div');
  strip.className = 'host-banner__strip';
  strip.tabIndex = 0;
  strip.setAttribute('role', 'button');
  strip.setAttribute('aria-expanded', 'false');

  const icon = document.createElement('span');
  icon.className = 'host-banner__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M11 9h2v2h-2zm0 4h2v6h-2zm1-9C6.48 4 2 8.48 2 14s4.48 10 10 10 10-4.48 10-10S17.52 4 12 4zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
    </svg>
  `;

  const question = document.createElement('span');
  question.className = 'host-banner__question';
  question.textContent = isOutdated
    ? chrome.i18n.getMessage('hostBannerQuestionOutdated')
    : chrome.i18n.getMessage('hostBannerQuestionMissing');

  const chevron = document.createElement('span');
  chevron.className = 'host-banner__chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = `<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>`;

  strip.appendChild(icon);
  strip.appendChild(question);
  strip.appendChild(chevron);

  const panel = document.createElement('div');
  panel.className = 'host-banner__panel';

  const explanation = document.createElement('p');
  explanation.textContent = isOutdated
    ? chrome.i18n.getMessage('hostBannerExplanationOutdated')
    : chrome.i18n.getMessage('hostBannerExplanationMissing');

  const link = document.createElement('a');
  link.className = 'host-banner__link';
  link.textContent = isOutdated
    ? chrome.i18n.getMessage('hostBannerLinkUpdate')
    : chrome.i18n.getMessage('hostBannerLinkInstall');
  link.href = '#';
  link.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    chrome.tabs.create({ url: isOutdated ? HOST_RELEASES_URL : HOST_INSTALL_URL });
    window.close();
  });

  panel.appendChild(explanation);
  panel.appendChild(link);

  const toggle = () => {
    const expanded = banner.classList.toggle('host-banner--expanded');
    strip.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  };
  strip.addEventListener('click', toggle);
  strip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });

  banner.appendChild(strip);
  banner.appendChild(panel);
}
```

- [ ] **Step 3: Update the call site in `loadAndRender`**

Find the existing call:

```js
  renderHostBanner(resp.hostInstalled);
```

REPLACE with:

```js
  renderHostBanner(resp.hostInstalled, resp.hostStatus);
```

- [ ] **Step 4: Verify it parses**

```bash
node --check popup.js
```

Expected: no output.

- [ ] **Step 5: Manual verification in Chrome**

1. Reload the extension at `chrome://extensions`.
2. Make sure the native host is installed and connected (Phase 1's local install is fine).
3. Open the popup.
4. Banner should NOT be visible (host connected, status `ok`).

Now uninstall the local host:

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder/native-host
make uninstall
```

5. Reload the extension and open the popup again.
6. The collapsible banner should appear at the bottom: `ⓘ Detect audio across profiles? ▾`
7. Click the strip → it expands. The chevron rotates. The panel shows the explanation paragraph and the "How to install →" link.
8. Click the strip again → it collapses.
9. Click the link → opens a new tab to `https://github.com/FrancisGregori/audio-tab-finder#install` and the popup closes.
10. Press Tab to focus the strip, then press Enter — expansion toggles.

Reinstall the host so subsequent tasks are not affected:

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
./scripts/install-local.sh
# enter the dev extension ID when prompted
```

- [ ] **Step 6: Commit**

```bash
git add popup.js
git commit -m "feat(ext): collapsible host-banner with install/update states and explanation panel"
```

---

# Group E — Documentation

### Task 13: README.md — full Install section rewrite

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Replace the existing README.md**

Replace the entire `README.md` with:

```markdown
# Audio Tab Finder

A Chrome extension to instantly find, mute, and close tabs playing audio —
across all your Chrome profiles.

## Features

- **Find audio tabs** in any open Chrome profile, all in one popup
- **Cross-profile detection and control** via an optional native helper
- **Quick navigation** — click to jump to any tab instantly
- **Mute/unmute and close** tabs without leaving your current tab
- **Fast** — sub-second cross-profile actions
- **Local only** — no cloud, no telemetry, no remote servers

## Installation

Audio Tab Finder works in two steps:

1. Install the Chrome extension (required)
2. Install the native helper for your OS (optional, but required for cross-profile features)

Without the native helper, the extension still works for the current Chrome profile (same as v1.x).

### Step 1: Chrome extension

[Install from Chrome Web Store](https://chromewebstore.google.com/detail/audio-tab-finder-%E2%80%93-find-m/ecnkofmcbijompohhddkaaekdaenhmhh)

### Step 2: Native helper

Choose your operating system:

#### macOS

1. Download the latest `audio-tab-finder-host-X.Y.Z-macos-universal.pkg` from
   [Releases](https://github.com/FrancisGregori/audio-tab-finder/releases/latest).
2. Double-click the `.pkg` and follow the installer wizard.
3. Reload the extension at `chrome://extensions`.

The installer is signed and notarized by Apple — no Gatekeeper warnings.

#### Linux

Pick the format that matches your distribution:

**Ubuntu / Debian (`.deb`):**

```bash
wget https://github.com/FrancisGregori/audio-tab-finder/releases/latest/download/audio-tab-finder-host-X.Y.Z-linux-amd64.deb
sudo dpkg -i audio-tab-finder-host-*.deb
```

**Fedora / RHEL / openSUSE (`.rpm`):**

```bash
wget https://github.com/FrancisGregori/audio-tab-finder/releases/latest/download/audio-tab-finder-host-X.Y.Z-linux-amd64.rpm
sudo rpm -i audio-tab-finder-host-*.rpm
```

**Other distros (`.tar.gz`):**

```bash
wget https://github.com/FrancisGregori/audio-tab-finder/releases/latest/download/audio-tab-finder-host-X.Y.Z-linux.tar.gz
tar xzf audio-tab-finder-host-*.tar.gz
sudo ./install.sh
```

After install, reload the extension at `chrome://extensions`.

> **Snap/Flatpak Chrome users:** Native messaging does not work with Chrome
> installed via Snap or Flatpak due to sandbox restrictions. Use Chrome
> from Google's apt repository (`.deb`) or another Chromium build that is
> not sandboxed.

#### Windows

> ⚠️ The Windows installer is **unsigned**. Code-signing certificates for
> Windows are expensive ($200+/yr) and not justified for a free open-source
> extension. Instead of an installer, you'll run a PowerShell script. The
> script is plain text and can be inspected before running.

1. Download `audio-tab-finder-host-X.Y.Z-windows-amd64.zip` from
   [Releases](https://github.com/FrancisGregori/audio-tab-finder/releases/latest).
2. Extract the ZIP.
3. Right-click `install.ps1` and select **Run with PowerShell**.
4. If PowerShell shows a security prompt about untrusted scripts, type `Y`.
5. Wait for the "Done" message.
6. Reload the extension at `chrome://extensions`.

### Verify the install worked

Open the extension popup. The "Detect audio across profiles?" banner at the
bottom should disappear. When audio is playing in another Chrome profile,
you'll see an "Other profiles" section in the popup.

## Verifying release authenticity

All releases are built by
[GitHub Actions](https://github.com/FrancisGregori/audio-tab-finder/actions/workflows/release.yml)
from the public source code. Each Release page includes a `SHA256SUMS.txt`
file with checksums for all artifacts. To verify:

```bash
shasum -a 256 audio-tab-finder-host-*.deb
# Compare with the value in SHA256SUMS.txt
```

The macOS `.pkg` is additionally signed and notarized by Apple. To verify:

```bash
spctl --assess --type install -v audio-tab-finder-host-*.pkg
# Expected: "accepted"
```

## Permissions

The extension requests:

- **`tabs`** — to detect audio playback and tab metadata
- **`storage`** — to remember a profile label and UUID per Chrome profile
- **`nativeMessaging`** — to communicate with the optional native helper

The native helper makes no network connections — all communication is
local between Chrome and the helper via standard input/output.

## Uninstalling the native helper

**macOS:**

```bash
sudo rm "/Library/Application Support/AudioTabFinder/audio-tab-finder-host"
sudo rm "/Library/Google/Chrome/NativeMessagingHosts/com.fgregori.audio_tab_finder.json"
```

**Linux (`.deb`):**

```bash
sudo dpkg -r audio-tab-finder-host
```

**Linux (`.rpm`):**

```bash
sudo rpm -e audio-tab-finder-host
```

**Linux (`.tar.gz` / generic):**

```bash
sudo rm /usr/bin/audio-tab-finder-host
sudo rm /etc/opt/chrome/native-messaging-hosts/com.fgregori.audio_tab_finder.json
```

**Windows:**

Run `uninstall.ps1` from the original ZIP (right-click → Run with PowerShell).

## Building from source

See [BUILDING.md](BUILDING.md).

## Privacy

This extension does not send data anywhere. State files are written only to:

- macOS: `~/Library/Application Support/AudioTabFinder/`
- Linux: `~/.config/audio-tab-finder/` (via the native helper, when used) — currently the helper writes only to system paths during install
- Windows: `%LOCALAPPDATA%\AudioTabFinder\`

[Full privacy policy](privacy.html)

## License

MIT

---

🤖 Phase 1 (cross-profile architecture) and Phase 2 (cross-platform release
pipeline) were planned and implemented in collaboration with
[Claude Code](https://claude.com/claude-code). Design and review docs
are in `docs/superpowers/`.
```

- [ ] **Step 2: Verify it renders OK**

Open `README.md` in any Markdown previewer (e.g., GitHub web preview after pushing the branch, or VS Code preview).

Confirm:
- All links point to plausible URLs
- Code blocks render with correct shell syntax
- Headings nest correctly (`#`, `##`, `###`)

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: rewrite README install section for v2.0 cross-platform release"
```

---

### Task 14: BUILDING.md — new file for developers

**Files:**
- Create: `BUILDING.md`

- [ ] **Step 1: Create `BUILDING.md`**

Create `BUILDING.md`:

```markdown
# Building Audio Tab Finder from source

This guide is for developers who want to build the extension and the
native helper themselves rather than installing pre-built releases.

## Requirements

- Chrome browser (or any Chromium-based browser supporting MV3)
- Go 1.21 or newer (for the native helper)
- Bash and standard Unix utilities

## Extension only

The Chrome extension is plain JavaScript with no build step.

1. Clone this repository:
   ```bash
   git clone https://github.com/FrancisGregori/audio-tab-finder.git
   cd audio-tab-finder
   ```
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (toggle in the top-right corner).
4. Click **Load unpacked** and select the repository root.

The extension card will appear with a generated Extension ID. Note it down —
you'll need it to install the native helper for development.

## Native helper

The native helper is a small Go binary.

```bash
cd native-host
make build       # produces native-host/bin/audio-tab-finder-host
make test        # runs the Go test suite (~30 tests)
```

To install the helper for local development (registers the native messaging
manifest in your user-level Chrome config):

```bash
cd ..
./scripts/install-local.sh
# Paste the Extension ID from chrome://extensions when prompted
```

Reload the extension at `chrome://extensions`. The popup banner about
installing the helper should disappear.

To uninstall the dev helper:

```bash
cd native-host
make uninstall
```

## Building production artifacts locally

The CI pipeline (`.github/workflows/release.yml`) handles signed/notarized
builds for releases. To build artifacts locally for testing (unsigned):

```bash
# macOS .pkg (unsigned dev build)
./scripts/build-macos.sh 2.0.0-dev

# Linux .deb / .rpm / .tar.gz
./scripts/build-linux.sh 2.0.0-dev amd64
./scripts/build-linux.sh 2.0.0-dev arm64

# Windows .zip
./scripts/build-windows.sh 2.0.0-dev
```

Output artifacts go to `dist/<platform>/`.

The Linux build script requires `dpkg-deb` and `rpmbuild` to be installed.
On macOS, install via Homebrew: `brew install dpkg rpm`.

## Project layout

```
audio-tab-finder/
├── manifest.json, popup.html/.js/.css, background.js
├── _locales/{en,pt_BR}/messages.json
├── icons/
├── profile.js, host-connection.js, state-sync.js,
│   action-handler.js, popup-bridge.js          ← service worker modules
├── native-host/                                  ← Go module
│   ├── go.mod, Makefile
│   ├── cmd/audio-tab-finder-host/main.go        ← entry point
│   └── internal/
│       ├── nmproto/        ← native messaging frame codec
│       ├── store/          ← state and action file persistence
│       ├── watcher/        ← FSEvents watchers
│       ├── handler/        ← message dispatch
│       └── logging/        ← rotating file logger
├── packaging/{macos,linux,windows}/             ← per-platform install assets
├── scripts/                                      ← build and install scripts
└── docs/superpowers/                            ← design specs and plans
```

## Releasing a new version

See [PUBLISHING_GUIDE.md](PUBLISHING_GUIDE.md).
```

- [ ] **Step 2: Commit**

```bash
git add BUILDING.md
git commit -m "docs: add BUILDING.md with developer instructions"
```

---

### Task 15: promo.html — add cross-profile section

**Files:**
- Modify: `promo.html`

- [ ] **Step 1: Find the right place to insert the new section**

Open `promo.html`. Look at its structure — it has a hero section, features list, and a CTA at the bottom. Identify the closing tag of the last feature/screenshot section before the final CTA.

- [ ] **Step 2: Insert the new section**

Add this section between the existing features and the final CTA. The exact insertion point depends on the file's current structure — find a logical place where it fits the page flow.

```html
    <!-- Cross-profile section (v2.0) -->
    <section class="cross-profile" style="background: rgba(74, 222, 128, 0.05); border: 1px solid rgba(74, 222, 128, 0.2); border-radius: 16px; padding: 40px 32px; margin: 40px 0;">
      <h2 style="font-size: 28px; margin-bottom: 16px; color: #fff;">Across all your Chrome profiles</h2>
      <p style="font-size: 16px; color: rgba(255, 255, 255, 0.85); margin-bottom: 20px; line-height: 1.6;">
        Have multiple Chrome profiles open? Audio Tab Finder can detect and control audio across all of them — Work, Personal, side projects. Install the optional native helper to enable this.
      </p>
      <a href="https://github.com/FrancisGregori/audio-tab-finder#installation" style="display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #4ade80, #22c55e); color: #0f172a; border-radius: 8px; text-decoration: none; font-weight: 600;">
        See install instructions →
      </a>
    </section>
```

The inline styles match the existing dark blue/green palette of `promo.html`. If the file uses external classes for similar elements, prefer those — adapt the markup accordingly.

- [ ] **Step 3: Verify**

Open `promo.html` in a browser:

```bash
open /Users/fgregori/Projects/personal/audio-tab-finder/promo.html
```

Confirm:
- The new section renders with the existing color scheme
- The "See install instructions →" link points to the right URL
- The section visually fits between surrounding sections

- [ ] **Step 4: Commit**

```bash
git add promo.html
git commit -m "docs(promo): add cross-profile section with install link"
```

---

### Task 16: STORE_LISTING.md — update for v2.0.0

**Files:**
- Modify: `STORE_LISTING.md`

- [ ] **Step 1: Update Detailed Description and add Permissions Justification**

Open `STORE_LISTING.md`. The current file has sections like "Extension Name", "Short Description", "Detailed Description", possibly more.

Append this content to the **Detailed Description** section (after whatever paragraphs are there). Add a separator line if needed:

```markdown

---

## NEW in v2.0: Cross-profile audio detection

Have multiple Chrome profiles open? With the optional native helper,
Audio Tab Finder shows audio tabs across ALL your Chrome profiles in one
popup. Mute, close, or jump to a tab in any profile — all from a single
view.

The extension still works fine without the helper (single-profile mode,
same as v1.x), but the cross-profile feature requires it because Chrome
isolates profiles for security.

Install instructions and source code:
https://github.com/FrancisGregori/audio-tab-finder

The native helper is open source, distributed via GitHub Releases, and
makes no network connections. The macOS installer is signed and notarized
by Apple. Linux and Windows builds are reproducible from public source via
GitHub Actions.

```

Then add a new section at the end of the file:

```markdown

## Permissions Justification

If asked to justify permissions during the Chrome Web Store review:

- **`tabs`**: To detect which tabs are playing audio (required for the core feature) and to display tab titles, URLs, and favicons in the popup.
- **`storage`**: To persist a per-profile UUID and a user-defined profile label across browser restarts. No personal data is stored.
- **`nativeMessaging`**: To communicate with an optional native helper that detects audio playback across the user's Chrome profiles. The native helper is open source, distributed via GitHub, and only runs locally — no network communication. Source: https://github.com/FrancisGregori/audio-tab-finder
```

- [ ] **Step 2: Commit**

```bash
git add STORE_LISTING.md
git commit -m "docs: update STORE_LISTING.md for v2.0 with permission justification"
```

---

### Task 17: PUBLISHING_GUIDE.md — add release flow

**Files:**
- Modify: `PUBLISHING_GUIDE.md`

- [ ] **Step 1: Append new sections**

Open `PUBLISHING_GUIDE.md`. Append the following at the end (preserving any existing v1 content):

```markdown

---

## Releasing v2.x

### One-time setup (already done as of Phase 2)

- Apple Developer Program enrolled
- Certificates created (Developer ID Application + Developer ID Installer)
- App-Specific Password generated
- 7 GitHub Secrets configured (see `docs/superpowers/specs/2026-05-01-phase2-distribution-design.md`)

### Per-release steps

1. **Bump versions in code:**
   - `manifest.json`: update `"version"` field
   - `host-connection.js`: update `EXPECTED_HOST_VERSION` constant to match

2. **Commit and push:**
   ```bash
   git add manifest.json host-connection.js
   git commit -m "chore: bump version to X.Y.Z"
   git push
   ```

3. **Tag and push the tag:**
   ```bash
   git tag vX.Y.Z
   git push --tags
   ```

4. **Wait for CI (~10 minutes).**
   The GitHub Actions release workflow will:
   - Build a universal binary for macOS
   - Sign and notarize the `.pkg`
   - Build `.deb`, `.rpm`, `.tar.gz` for Linux (amd64 + arm64)
   - Build `.zip` for Windows
   - Generate `SHA256SUMS.txt`
   - Create a GitHub Release with all artifacts

5. **Verify the release:**
   - Open https://github.com/FrancisGregori/audio-tab-finder/releases/tag/vX.Y.Z
   - Confirm all artifacts are listed
   - Download the `.pkg` and verify with `spctl --assess --type install`

6. **Build the extension archive for Chrome Web Store:**
   ```bash
   zip -r Archive.zip . \
     -x 'native-host/*' \
     -x 'scripts/*' \
     -x 'packaging/*' \
     -x 'docs/*' \
     -x '.github/*' \
     -x '.git/*' \
     -x 'dist/*' \
     -x '*.zip' \
     -x 'BUILDING.md' \
     -x 'STORE_LISTING.md' \
     -x 'PUBLISHING_GUIDE.md'
   ```

7. **Upload to Chrome Web Store Developer Dashboard:**
   - Open https://chrome.google.com/webstore/devconsole
   - Select the Audio Tab Finder extension
   - Click "Package" → "Upload new package"
   - Select `Archive.zip`
   - Update the listing's description if needed (see `STORE_LISTING.md`)
   - Submit for review

8. **Wait for review** (typically 1-3 days, sometimes longer if `nativeMessaging` triggers manual review).

### Rollback

If a critical issue is found after release:

- **In the GitHub Release:** click "Delete this release" on the GitHub Releases UI. The tag remains; you can re-release after fixing by tagging vX.Y.Z+1.
- **In the Chrome Web Store:** if the new version was approved and published, submit a hotfix vX.Y.Z+1 ASAP. Users on the bad version will auto-update within ~24 hours of the new approval.

### Test releases

To test the CI pipeline without affecting public users, push a pre-release tag:

```bash
git tag v0.0.1-test
git push --tags
```

The workflow has `prerelease: ${{ contains(github.ref, '-') }}` so any tag containing a `-` is marked as pre-release on GitHub. After validating, delete the test release and tag:

```bash
gh release delete v0.0.1-test --yes
git tag -d v0.0.1-test
git push origin :refs/tags/v0.0.1-test
```
```

- [ ] **Step 2: Commit**

```bash
git add PUBLISHING_GUIDE.md
git commit -m "docs: add v2.x release flow to PUBLISHING_GUIDE.md"
```

---

# Group F — First release

### Task 18: CI dry-run with test tag

**Files:** None (CI execution + verification)

This task validates that the entire pipeline works end-to-end using a pre-release tag, BEFORE the actual `v2.0.0` tag is pushed.

- [ ] **Step 1: Push a test tag**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
git tag v0.0.1-test
git push origin v0.0.1-test
```

- [ ] **Step 2: Watch the workflow run**

Open https://github.com/FrancisGregori/audio-tab-finder/actions in a browser.

You should see a new workflow run titled `Release` with the tag `v0.0.1-test`. Watch the four jobs:

- `build-macos` — should take ~5-10 min (notarization is the slowest step)
- `build-linux (amd64)` — ~2 min
- `build-linux (arm64)` — ~2 min
- `build-windows` — ~2 min
- `release` — ~30 sec, runs after all builds succeed

If any job fails, inspect the logs to identify the issue. Common failures:

| Failure | Likely cause | Fix |
|---------|--------------|-----|
| `Import Application certificate` step fails | Wrong base64 encoding or wrong password | Re-run `scripts/export-certs.sh`, update secret |
| `notarize .pkg` fails | Wrong Apple ID, app-specific password, or Team ID | Verify secrets `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` |
| `dpkg-deb: command not found` | Workflow's `apt-get install` step skipped or failed | Re-check `.github/workflows/release.yml` — should install `dpkg-dev rpm` |
| `find_certificate_identities` returns empty | Certs imported but not searchable | Check `set-key-partition-list` step ran |

- [ ] **Step 3: Verify the release page**

After the workflow succeeds, open:
`https://github.com/FrancisGregori/audio-tab-finder/releases/tag/v0.0.1-test`

You should see (marked as Pre-release):

- `audio-tab-finder-host-0.0.1-test-macos-universal.pkg`
- `audio-tab-finder-host-0.0.1-test-linux-amd64.deb`
- `audio-tab-finder-host-0.0.1-test-linux-arm64.deb`
- `audio-tab-finder-host-0.0.1-test-linux-amd64.rpm`
- `audio-tab-finder-host-0.0.1-test-linux-arm64.rpm`
- `audio-tab-finder-host-0.0.1-test-linux.tar.gz`
- `audio-tab-finder-host-0.0.1-test-windows-amd64.zip`
- `SHA256SUMS.txt`

- [ ] **Step 4: Verify macOS .pkg signing**

Download the `.pkg` to a local Mac:

```bash
cd /tmp
gh release download v0.0.1-test --repo FrancisGregori/audio-tab-finder --pattern '*.pkg'
spctl --assess --type install -v audio-tab-finder-host-0.0.1-test-macos-universal.pkg
```

Expected output:
```
audio-tab-finder-host-0.0.1-test-macos-universal.pkg: accepted
source=Notarized Developer ID
```

If you see `source=Developer ID` (without "Notarized"), notarization didn't staple. Check the workflow's `Staple notarization` step.

- [ ] **Step 5: No commit needed** (validation only)

If everything passes, proceed to Task 19. If something fails, fix the workflow / scripts / secrets and retag (delete the test tag first):

```bash
git tag -d v0.0.1-test
git push origin :refs/tags/v0.0.1-test
gh release delete v0.0.1-test --yes
# Make fixes, re-commit, then retag
```

---

### Task 19: Smoke test on all 3 platforms

**Files:** None (manual platform testing)

After the test release artifacts validate, install on each platform and verify the extension connects.

- [ ] **Step 1: macOS smoke test**

On a Mac (preferably one without the dev native helper installed):

```bash
# If dev helper exists, uninstall it first
cd /Users/fgregori/Projects/personal/audio-tab-finder/native-host
make uninstall

# Download and install the test .pkg
cd /tmp
gh release download v0.0.1-test --repo FrancisGregori/audio-tab-finder --pattern '*.pkg'
sudo installer -pkg audio-tab-finder-host-*-macos-universal.pkg -target /
```

Open Chrome → reload the extension at `chrome://extensions` → open the popup.

Expected:
- Banner is hidden (host connected)
- Open a tab playing audio in another profile → it appears in "Other profiles" section
- Mute / close / activate work cross-profile

Inspect the host registration:

```bash
cat "/Library/Google/Chrome/NativeMessagingHosts/com.fgregori.audio_tab_finder.json"
```

Expected: valid JSON with `"path": "/Library/Application Support/AudioTabFinder/audio-tab-finder-host"` and the extension ID matching the published one (`ecnkofmcbijompohhddkaaekdaenhmhh`).

- [ ] **Step 2: Linux smoke test**

In a Linux VM (Ubuntu or Fedora) with Chrome installed:

```bash
# Ubuntu/Debian
wget https://github.com/FrancisGregori/audio-tab-finder/releases/download/v0.0.1-test/audio-tab-finder-host-0.0.1-test-linux-amd64.deb
sudo dpkg -i audio-tab-finder-host-*.deb

# OR Fedora/RHEL
wget https://github.com/FrancisGregori/audio-tab-finder/releases/download/v0.0.1-test/audio-tab-finder-host-0.0.1-test-linux-amd64.rpm
sudo rpm -i audio-tab-finder-host-*.rpm
```

Open Chrome → load the extension unpacked from a clone of the repo (or install from CWS if v2.0.0 is published, but we're pre-release).

Verify popup banner disappears, cross-profile detection works.

Inspect host registration:

```bash
cat /etc/opt/chrome/native-messaging-hosts/com.fgregori.audio_tab_finder.json
```

Expected: valid JSON with the path and extension ID.

- [ ] **Step 3: Windows smoke test**

In a Windows VM (or physical machine):

1. Download the `.zip` from the Releases page.
2. Extract.
3. Right-click `install.ps1` → Run with PowerShell.
4. Type `Y` if prompted about untrusted scripts.
5. Wait for "Done" message.

Open Chrome → load extension unpacked → reload → verify cross-profile detection works.

Inspect:

```powershell
Get-Item "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.fgregori.audio_tab_finder"
Get-Content "$env:LOCALAPPDATA\AudioTabFinder\com.fgregori.audio_tab_finder.json"
```

Expected: registry key exists with manifest path; JSON is valid with extension ID.

- [ ] **Step 4: Cleanup test release**

Once all three smoke tests pass:

```bash
gh release delete v0.0.1-test --yes
git tag -d v0.0.1-test
git push origin :refs/tags/v0.0.1-test
```

- [ ] **Step 5: No commit needed** (validation only)

---

### Task 20: Tag v2.0.0 and verify the public release

**Files:** None (release execution)

Now that all smoke tests passed, tag the actual v2.0.0 release.

- [ ] **Step 1: Confirm code state**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
git status        # should be clean
git log --oneline -5
grep '"version"' manifest.json     # should show "version": "2.0.0"
grep EXPECTED_HOST_VERSION host-connection.js   # should show '2.0.0'
```

If anything is off, fix and commit before tagging.

- [ ] **Step 2: Tag and push**

```bash
git tag v2.0.0
git push origin v2.0.0
```

- [ ] **Step 3: Watch the workflow**

Open https://github.com/FrancisGregori/audio-tab-finder/actions

Wait for the `Release` workflow with tag `v2.0.0` to complete (~10 min).

- [ ] **Step 4: Verify the release page**

Open https://github.com/FrancisGregori/audio-tab-finder/releases/tag/v2.0.0

Expected (NOT marked as pre-release):
- All 7 platform artifacts listed
- `SHA256SUMS.txt` listed
- Auto-generated release notes from commits since v1.0.4

- [ ] **Step 5: Smoke test the production release**

Download the `.pkg` and install on a clean Mac (or use a fresh user account):

```bash
spctl --assess --type install -v "audio-tab-finder-host-2.0.0-macos-universal.pkg"
sudo installer -pkg "audio-tab-finder-host-2.0.0-macos-universal.pkg" -target /
```

Open Chrome → install the extension from the Chrome Web Store (current v1.0.4) → reload → verify popup banner disappears.

Note: until Task 21 is done, the CWS still has v1.0.4 of the extension. The native helper installs and works with v1.0.4 too — but the cross-profile features only appear after the extension is also v2.0.0.

- [ ] **Step 6: No commit needed** (release is the artifact)

---

### Task 21: Submit extension v2.0.0 to Chrome Web Store

**Files:** None (manual submission)

- [ ] **Step 1: Build the extension archive**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
rm -f Archive.zip
zip -r Archive.zip . \
  -x 'native-host/*' \
  -x 'scripts/*' \
  -x 'packaging/*' \
  -x 'docs/*' \
  -x '.github/*' \
  -x '.git/*' \
  -x '.gitignore' \
  -x 'dist/*' \
  -x '*.zip' \
  -x 'BUILDING.md' \
  -x 'STORE_LISTING.md' \
  -x 'PUBLISHING_GUIDE.md'
```

Verify Archive.zip:

```bash
unzip -l Archive.zip | head -30
```

Expected: contains `manifest.json`, `popup.html`, `popup.js`, `popup.css`, `background.js`, the SW modules, `_locales/`, `icons/`, `privacy.html`, `promo.html`, `README.md`. Does NOT contain `native-host/`, `scripts/`, `docs/`, etc.

- [ ] **Step 2: Open Chrome Web Store Developer Dashboard**

In your browser, go to https://chrome.google.com/webstore/devconsole

Sign in with the Google account that owns the extension.

- [ ] **Step 3: Upload the new version**

Find the Audio Tab Finder extension. Click on it.

In the left sidebar, go to **Package** → click **Upload new package**.

Upload `Archive.zip` from Step 1. Wait for it to validate.

- [ ] **Step 4: Update store listing**

In the left sidebar, go to **Store listing** and verify:

- **Detailed description** matches the content in `STORE_LISTING.md` (including the new "v2.0" section)
- Add or update screenshots if you have new ones showing the cross-profile section
- Confirm the privacy policy link still works

- [ ] **Step 5: Provide permission justifications**

In the **Privacy practices** section, fill in justifications:

- **Single purpose**: "Find tabs playing audio across all open Chrome profiles."
- **Permissions**:
  - `tabs`: "To detect which tabs are playing audio and display tab titles, URLs, and favicons."
  - `storage`: "To persist a per-profile UUID and a user-defined profile label across browser restarts."
  - `nativeMessaging`: "To communicate with an optional native helper that detects audio playback across the user's Chrome profiles. The native helper is open source, distributed via GitHub, and only runs locally — no network communication. Source: https://github.com/FrancisGregori/audio-tab-finder"

- [ ] **Step 6: Submit for review**

Click **Submit for review** at the top.

- [ ] **Step 7: Wait for approval**

Approval typically takes 1-3 business days. The `nativeMessaging` permission may trigger manual review, which can take longer.

You'll receive an email when the extension is approved. Once approved, Chrome auto-updates users from v1.0.4 to v2.0.0 within ~24 hours.

- [ ] **Step 8: Final verification (post-approval)**

After CWS approval:

1. Force-update the extension in your dev Chrome: `chrome://extensions` → Developer mode → click "Update" button
2. Verify the popup shows v2.0.0 features
3. Verify the cross-profile section appears when audio is playing in another profile
4. Verify the banner correctly shows installed/missing/outdated states

- [ ] **Step 9: No commit needed** (the release is live)

---

## Done criteria

After Task 21 is approved:

- ✅ Extension v2.0.0 live on Chrome Web Store
- ✅ Native helper v2.0.0 available on GitHub Releases for macOS, Linux, Windows
- ✅ macOS `.pkg` signed and notarized
- ✅ Linux and Windows builds reproducible from public source
- ✅ Documentation (README, BUILDING, promo, STORE_LISTING, PUBLISHING_GUIDE) up to date
- ✅ Popup banner correctly shows install/update prompts
- ✅ Subsequent releases follow the simple flow in `PUBLISHING_GUIDE.md`

## Out of scope (Phase 2.x candidates)

- Sparkle/WinSparkle automatic background updates
- Authenticode signing for Windows (paid certificate)
- Snap or Flatpak Linux packaging
- Linux ARMv6/ARMv7 builds
- Auto-detect OS in popup banner and show platform-specific install link
- In-app changelog display
- Telemetry of installations (intentionally never)
