# Phase 2 — Public Distribution & Cross-Platform Release Pipeline

**Date:** 2026-05-01
**Status:** Approved (pending implementation plan)
**Target version:** 2.0.0 (first public release)
**Phase:** 2 of 2

## Context

Phase 1 (PR #1, merged) delivered the v2.0.0 cross-profile audio detection feature: Go native messaging host, modular service worker, popup with cross-profile sections, hybrid badge, and local install via `scripts/install-local.sh`. The code works end-to-end on macOS but is not yet publicly distributed — the Chrome Web Store still has v1.0.4, and the native host has no signed installer.

Phase 2 ships v2.0.0 publicly: cross-platform native host installers (macOS signed/notarized `.pkg`, Linux `.deb`/`.rpm`/`.tar.gz`, Windows `.zip` with PowerShell installer), automated release pipeline via GitHub Actions, an updated Chrome Web Store listing, and documentation pointing users at the install flow. The popup gains a discreet collapsible banner that invites users to install the helper (when missing) or update it (when outdated), with explanations and links to the GitHub repository.

## Goal

Make v2.0.0 publicly installable for any Chrome user on macOS, Linux, or Windows with minimal friction:

1. **Chrome extension** updated on the Chrome Web Store from v1.0.4 to v2.0.0.
2. **Native helper installers** available on GitHub Releases for all three platforms, generated automatically by CI on `git tag v*`.
3. **macOS installer** signed and notarized — installs without Gatekeeper warnings.
4. **Linux installers** unsigned (industry-standard for free open-source software) but built reproducibly via public CI.
5. **Windows installer** ships as a PowerShell script in a ZIP — avoids the SmartScreen warning that would appear on an unsigned `.exe`. README explains the PowerShell execution flow.
6. **Popup banner** invites uninstalled users to install the helper, and notifies installed users when their helper version is older than the version expected by the current extension (simple semver comparison).
7. **Documentation** (README, promo, STORE_LISTING, PUBLISHING_GUIDE) explains the install flow per platform.

## Non-goals (Phase 2)

- **Authenticode signing for Windows.** Costs $200+/yr; not justified for a free open-source extension. Documented in README so users understand why they run a script instead of an installer.
- **Sparkle or full auto-update mechanism.** Only a simple in-extension version-mismatch notification. Users still download new `.pkg`/`.deb`/`.zip` manually.
- **Snap or Flatpak packages on Linux.** Native messaging has known interop issues with Chrome under Snap/Flatpak; documented as a caveat.
- **Linux ARM packages beyond amd64+arm64.** Other arches not pre-built.
- **Telemetry of installations.** Never. The extension and host run entirely locally.
- **Sparkle-style auto-update on macOS.** Manual updates via new `.pkg` download.

## Architecture overview

The public release surface has three independent artifacts that ship in lockstep:

```
┌────────────────────────────────────┐
│  Chrome Web Store                  │
│  - Audio Tab Finder v2.0.0          │
│  - Same Extension ID for all users │
│  - Source of EXPECTED_HOST_VERSION  │
└──────────────┬─────────────────────┘
               │
               │ embedded link (#install)
               ↓
┌────────────────────────────────────┐
│  github.com/.../audio-tab-finder    │
│  - README with platform install    │
│  - promo.html landing page          │
│  - Releases page with binaries     │
└──────────────┬─────────────────────┘
               │
               │ download
               ↓
┌────────────────────────────────────┐
│  GitHub Releases v2.0.0             │
│  ├── *.pkg (macOS, signed)          │
│  ├── *.deb / *.rpm / *.tar.gz (Linux)│
│  ├── *.zip (Windows)               │
│  └── SHA256SUMS.txt                 │
└────────────────────────────────────┘
```

Trigger: developer pushes a `git tag v*` → CI builds all three platforms in parallel → CI signs+notarizes macOS → CI publishes a GitHub Release with all assets.

## Apple Developer setup

The plan includes a step-by-step setup guide for the user (assumes nothing pre-existing). Quick summary of what the user must produce:

| Item | Use | Source |
|------|-----|--------|
| **Apple Developer Team ID** | 10-char identifier for the team | developer.apple.com/account → Membership |
| **Developer ID Application certificate** (`.p12`) | Sign the Go binary | Developer Portal → Certificates → "+" → "Developer ID Application", upload CSR generated in Keychain Access |
| **Developer ID Installer certificate** (`.p12`) | Sign the `.pkg` | Same workflow with type "Developer ID Installer" |
| **App-Specific Password** | Authenticate `notarytool` | appleid.apple.com → Sign-In and Security → App-Specific Passwords |
| **Apple ID email** | The account email | (already known) |

A helper script `scripts/export-certs.sh` automates exporting the two `.p12` files and base64-encoding them ready to paste into GitHub Secrets.

## GitHub Secrets

Configured by the user once after Apple setup:

| Secret name | Content |
|-------------|---------|
| `APPLE_CERT_APPLICATION_P12_BASE64` | Application cert `.p12`, base64-encoded |
| `APPLE_CERT_INSTALLER_P12_BASE64` | Installer cert `.p12`, base64-encoded |
| `APPLE_CERT_PASSWORD` | Password used at `.p12` export time (same for both certs) |
| `APPLE_ID` | Apple Developer account email |
| `APPLE_TEAM_ID` | 10-character Team ID |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password from appleid.apple.com |
| `KEYCHAIN_PASSWORD` | Random string used as password for the temporary keychain created on each CI runner |

## GitHub Actions release workflow

**File:** `.github/workflows/release.yml`

**Trigger:** push of any tag matching `v*` (e.g., `v2.0.0`, `v2.0.1-beta`).

**Jobs (matrix-parallel):**

```yaml
on:
  push:
    tags: ['v*']

jobs:
  build-macos:
    runs-on: macos-14
    outputs: { version-from-tag }
    steps:
      - actions/checkout
      - actions/setup-go
      - run: scripts/build-macos.sh   # arm64 + amd64 → universal binary
      - apple-actions/import-codesign-certs (Application + Installer)
      - run: codesign + pkgbuild + productbuild → signed .pkg
      - run: xcrun notarytool submit + wait + xcrun stapler staple
      - actions/upload-artifact: macos.pkg

  build-linux:
    runs-on: ubuntu-latest
    strategy:
      matrix: { arch: [amd64, arm64] }
    steps:
      - actions/checkout
      - actions/setup-go
      - run: scripts/build-linux.sh ${{ matrix.arch }}   # → .deb + .rpm + .tar.gz
      - actions/upload-artifact: linux-${{ matrix.arch }}

  build-windows:
    runs-on: ubuntu-latest          # cross-compile, no Windows runner needed
    steps:
      - actions/checkout
      - actions/setup-go
      - run: scripts/build-windows.sh   # GOOS=windows GOARCH=amd64 → .zip
      - actions/upload-artifact: windows.zip

  release:
    needs: [build-macos, build-linux, build-windows]
    runs-on: ubuntu-latest
    permissions: { contents: write }
    steps:
      - actions/download-artifact (all)
      - run: sha256sum * > SHA256SUMS.txt
      - softprops/action-gh-release with all assets and auto-changelog
```

Total runtime: ~10 minutes (notarization is the longest step at 3-7 min).

## Build/packaging per platform

### Repository layout additions

```
audio-tab-finder/
├── .github/workflows/
│   └── release.yml                         ← NEW
├── packaging/
│   ├── macos/
│   │   ├── postinstall                    ← writes NM manifest at /Library/...
│   │   ├── distribution.xml               ← productbuild config
│   │   └── README.txt                      ← visible in installer wizard
│   ├── linux/
│   │   ├── debian/control.tmpl            ← .deb metadata
│   │   ├── rpm/audio-tab-finder-host.spec.tmpl  ← .rpm spec
│   │   ├── postinstall.sh                 ← writes NM manifest at /etc/opt/...
│   │   └── install.sh                      ← shipped inside .tar.gz
│   └── windows/
│       └── install.ps1                     ← shipped inside .zip
├── scripts/
│   ├── export-certs.sh                    ← NEW, dev runs once
│   ├── build-macos.sh                     ← NEW, called by CI
│   ├── build-linux.sh                     ← NEW, called by CI
│   ├── build-windows.sh                   ← NEW, called by CI
│   └── install-local.sh                    ← EXISTING (Phase 1, dev local install)
├── BUILDING.md                             ← NEW, dev docs (compile from source)
├── README.md                               ← UPDATED (install section per platform)
├── promo.html                              ← UPDATED (cross-profile section)
├── STORE_LISTING.md                        ← UPDATED (v2.0.0 description)
└── PUBLISHING_GUIDE.md                     ← UPDATED (release flow)
```

### macOS — `.pkg` installer

**Build steps:**

1. Cross-compile `audio-tab-finder-host` for `darwin/amd64` and `darwin/arm64`.
2. `lipo` the two architectures into a universal binary.
3. `codesign` the binary with Developer ID Application cert + hardened runtime.
4. `pkgbuild --root <staging> --identifier com.fgregori.audio_tab_finder --version $VERSION --scripts packaging/macos --install-location /Library/Application\ Support/AudioTabFinder` → component `.pkg`.
5. `productbuild --distribution packaging/macos/distribution.xml --package-path <component> --sign $INSTALLER_CERT` → distribution `.pkg`.
6. `xcrun notarytool submit --apple-id $APPLE_ID --team-id $TEAM_ID --password $APP_PASSWORD --wait` → notarization (3-7 min).
7. `xcrun stapler staple` → embed notarization in the `.pkg`.

**Install layout (after user runs `.pkg`):**

```
/Library/Application Support/AudioTabFinder/
└── audio-tab-finder-host                  ← binary, root:wheel 0755

/Library/Google/Chrome/NativeMessagingHosts/
└── com.fgregori.audio_tab_finder.json     ← NM manifest, system-wide
```

The NM manifest is written by `packaging/macos/postinstall` (executed by the installer at install time):

```json
{
  "name": "com.fgregori.audio_tab_finder",
  "description": "Audio Tab Finder native helper",
  "path": "/Library/Application Support/AudioTabFinder/audio-tab-finder-host",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://<PUBLISHED_EXTENSION_ID>/"]
}
```

The published Extension ID (32 chars `[a-p]`) is hardcoded in the postinstall script. It is stable across all users because the extension is distributed via Chrome Web Store.

System-wide install (`/Library/...`) is preferred over per-user (`~/Library/...`) for distributed `.pkg`s — it avoids the macOS `com.apple.provenance` SIGKILL caveat seen in Phase 1, and works for all macOS user accounts.

### Linux — `.deb`, `.rpm`, `.tar.gz`

**Build steps:**

For each arch (`amd64`, `arm64`):
1. Cross-compile `audio-tab-finder-host` for `linux/<arch>`.
2. Build `.deb` via `dpkg-deb`:
   - Stage tree: `usr/bin/audio-tab-finder-host`, `etc/opt/chrome/native-messaging-hosts/com.fgregori.audio_tab_finder.json`, `DEBIAN/control`, `DEBIAN/postinst`.
   - `dpkg-deb --build <stage>` → `.deb`.
3. Build `.rpm` via `fpm` (or `rpmbuild` directly):
   - Same staging, different metadata format.
4. Build `.tar.gz` (generic install):
   - Bundle binary + `install.sh` + `LICENSE` + `README.txt`.

**Install layout (after `dpkg -i` or `rpm -i`):**

```
/usr/bin/audio-tab-finder-host                                   ← binary
/etc/opt/chrome/native-messaging-hosts/com.fgregori.audio_tab_finder.json  ← NM manifest
```

The package's `postinst` script writes the NM manifest with the published Extension ID, similar to macOS.

The `.tar.gz` ships an `install.sh` that performs the same actions for users on distros without `.deb`/`.rpm` (run with `sudo ./install.sh`).

**Caveat documented in README:** Native messaging from Chrome installed via Snap or Flatpak does not work due to sandbox restrictions. Users must use Chrome `.deb` from Google's apt repo or another non-sandboxed Chromium build.

### Windows — `.zip` with PowerShell installer

**Why script instead of `.exe`/`.msi`:**

An unsigned `.exe` or `.msi` triggers Windows SmartScreen ("Unknown publisher") with a prominent warning. Without a paid Authenticode certificate ($200+/yr), this UX is unacceptable. PowerShell scripts avoid SmartScreen entirely — the user gets a much milder execution-policy prompt, and the script's source is plain-text auditable.

**Build steps:**

1. Cross-compile `audio-tab-finder-host` for `windows/amd64` (binary suffix `.exe`).
2. Bundle into a `.zip` containing:
   - `audio-tab-finder-host.exe`
   - `install.ps1`
   - `uninstall.ps1`
   - `README.txt`

**Install flow (user-facing):**

1. Download and extract the `.zip`.
2. Right-click `install.ps1` → **Run with PowerShell**.
3. PowerShell may prompt: "Do you want to run scripts from this untrusted publisher?" → user types `Y`.
4. Script copies binary and writes registry entry. Done.

**Install layout (after `install.ps1`):**

```
%LOCALAPPDATA%\AudioTabFinder\
├── audio-tab-finder-host.exe              ← binary
└── com.fgregori.audio_tab_finder.json     ← NM manifest

Registry:
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.fgregori.audio_tab_finder
  (Default) = "<%LOCALAPPDATA%>\AudioTabFinder\com.fgregori.audio_tab_finder.json"
```

Per-user install (HKCU + LOCALAPPDATA) — does not require admin.

## Banner UX with auto-update notification

### States

The popup banner has three states determined by the SW's connection state and the host version:

| State | Condition | Banner |
|-------|-----------|--------|
| Hidden | Host connected AND version ≥ EXPECTED | (no banner) |
| Missing | Host disconnected OR `connectNative` fails | "Detect audio across profiles?" |
| Outdated | Host connected AND version < EXPECTED | "Update available" |

### Layout — collapsed (default)

```
├──────────────────────────────────────┤
│ ⓘ  <question>                     ▾  │   ← rodapé sutil ~32px
└──────────────────────────────────────┘
```

Style: `color: #888`, `font-size: 12px`, `border-top: 1px solid #1f4068`. Hover swaps `bg: #16213e` and `color: #fff`. Cursor pointer over the entire strip.

### Layout — expanded (after click)

```
├──────────────────────────────────────┤
│ ⓘ  <question>                     ▴  │
│                                      │
│ <explanation paragraph>              │
│                                      │
│ ▸ <link text> →                      │   ← chrome.tabs.create + window.close
└──────────────────────────────────────┘
```

The chevron rotates 180° on expand. Click on the strip again collapses. Keyboard: Enter or Space on focused strip toggles.

### Implementation

**`host-connection.js` adds:**

```js
const EXPECTED_HOST_VERSION = '2.0.0';   // bumped each release

// inside _hostState:
hostVersion: null,

// inside handleIncomingMessage, when hello_ack arrives:
if (msg.type === 'hello_ack') {
  _hostState.hostVersion = msg.host_version || null;
}

function getHostVersion() { return _hostState.hostVersion; }
function isHostOutdated() {
  if (!_hostState.hostVersion) return false;
  return semverCompare(_hostState.hostVersion, EXPECTED_HOST_VERSION) < 0;
}
function semverCompare(a, b) {
  const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}
```

**`popup-bridge.js` `handleGetAggregate` returns:**

```js
{
  ok: true,
  hostInstalled: <boolean>,
  hostStatus: 'disconnected' | 'outdated' | 'ok',
  hostVersion: <string | null>,
  profiles: [...]
}
```

**`popup.js` `renderHostBanner(hostInstalled, hostStatus)`** rebuilds the banner DOM with the appropriate copy and link target. Old behavior (single amber strip) is replaced. CSS styles for the new collapsible design replace the old `.host-banner` rules.

**URLs (hardcoded in popup.js):**

- `HOST_INSTALL_URL = 'https://github.com/FrancisGregori/audio-tab-finder#install'`
- `HOST_RELEASES_URL = 'https://github.com/FrancisGregori/audio-tab-finder/releases/latest'`

### i18n strings (replace + add)

**Removed (Phase 1, now obsolete):**
- `nativeHostMissing`
- `installInstructions`

**Added (en):**

| Key | Text |
|-----|------|
| `hostBannerQuestionMissing` | Detect audio across profiles? |
| `hostBannerQuestionOutdated` | Update available |
| `hostBannerExplanationMissing` | Audio Tab Finder can detect and control audio across all your Chrome profiles. This requires installing a small native helper. |
| `hostBannerExplanationOutdated` | A newer version of the native helper is available. Update to keep cross-profile features working smoothly. |
| `hostBannerLinkInstall` | How to install → |
| `hostBannerLinkUpdate` | Download latest → |

**Added (pt_BR, ASCII-only):**

| Key | Text |
|-----|------|
| `hostBannerQuestionMissing` | Detectar audio entre perfis? |
| `hostBannerQuestionOutdated` | Atualizacao disponivel |
| `hostBannerExplanationMissing` | O Audio Tab Finder pode detectar e controlar audio em todos os seus perfis Chrome. Isso requer instalar um pequeno helper nativo. |
| `hostBannerExplanationOutdated` | Uma versao mais recente do helper nativo esta disponivel. Atualize para manter as features cross-profile funcionando bem. |
| `hostBannerLinkInstall` | Como instalar → |
| `hostBannerLinkUpdate` | Baixar a versao mais recente → |

## Documentation updates

### `README.md`

Major rewrite of the install section. The new structure:

1. **Features** — short bullet list highlighting cross-profile detection
2. **Installation** — split into Step 1 (Chrome extension from CWS) and Step 2 (native helper for OS, optional but recommended)
3. **Native helper** — three subsections (macOS / Linux / Windows) with download links and exact commands
4. **Verifying release authenticity** — explains GitHub Actions reproducible builds, SHA256SUMS, and `spctl --assess` for macOS
5. **Permissions explained** — `tabs`, `storage`, `nativeMessaging` with brief justification
6. **Uninstalling the native helper** — one-liner per platform
7. **Building from source** — link to `BUILDING.md`
8. **Privacy** — confirms no network calls, all local

Per-platform details:

- **macOS:** Download `.pkg` → double-click → wizard → reload extension. Note: signed and notarized.
- **Linux:** Three options (`.deb`, `.rpm`, `.tar.gz` + `install.sh`). Snap/Flatpak Chrome caveat documented.
- **Windows:** Disclaimer that the installer is unsigned; download `.zip`, extract, right-click `install.ps1` → Run with PowerShell. Source code transparency note.

### `BUILDING.md` (new file)

Move existing "Manual Installation" section from README here. Add Go build instructions:

```markdown
# Building Audio Tab Finder from source

## Extension only

1. Clone this repo
2. Open chrome://extensions
3. Enable "Developer mode"
4. Click "Load unpacked" and select the repo root

## Native helper

Requires Go 1.21+:

cd native-host
make build
# Binary at native-host/bin/audio-tab-finder-host

# Install locally for development
cd ..
./scripts/install-local.sh
```

### `promo.html`

Adds one new section between the existing features and CTA:

```html
<section class="cross-profile">
  <h2>Across all your Chrome profiles</h2>
  <p>
    Have multiple Chrome profiles open? Audio Tab Finder can detect and
    control audio across all of them — Work, Personal, anything. Install
    the optional native helper to enable this.
  </p>
  <a href="https://github.com/FrancisGregori/audio-tab-finder#install">
    See install instructions →
  </a>
</section>
```

CSS reuses the page's existing palette and typography.

### `STORE_LISTING.md`

Adds a "NEW in v2.0" section to the detailed description, explaining cross-profile detection and pointing to the GitHub repo for install instructions. Permission justification text is added explaining why `nativeMessaging` is requested.

### `PUBLISHING_GUIDE.md`

Adds a "Releasing v2.x" section with the release flow:

```markdown
## Releasing v2.x

1. Update manifest.json version
2. Update EXPECTED_HOST_VERSION in host-connection.js to match
3. git commit, git push to main
4. git tag v2.0.X && git push --tags
5. Wait for GitHub Actions release pipeline (~10 min)
6. Verify the GitHub Release has all artifacts + SHA256SUMS.txt
7. Build extension Archive.zip (excluding native-host/, scripts/, docs/)
8. Upload Archive.zip to Chrome Web Store Developer Dashboard
9. Submit for review (typically 1-3 days)
```

## Release flow

### First release (v2.0.0)

Pre-flight checklist (run before `git tag v2.0.0`):

**Apple Developer prerequisites:**
- [ ] Apple Developer Program active
- [ ] Both certificates created and exported as `.p12`
- [ ] App-specific password generated
- [ ] Team ID known
- [ ] All 7 GitHub Secrets configured

**Code state:**
- [ ] `manifest.json` version is `"2.0.0"`
- [ ] `host-connection.js` has `EXPECTED_HOST_VERSION = '2.0.0'`
- [ ] Banner UX implemented and tested locally
- [ ] All four docs updated (README, promo, STORE_LISTING, PUBLISHING_GUIDE)
- [ ] BUILDING.md created

**CI dry-run:**
- [ ] Push a test tag like `v0.0.1-test` to validate the workflow without publishing
- [ ] Inspect CI logs for any signing/notarization errors
- [ ] Verify all artifacts upload correctly
- [ ] Validate the macOS `.pkg` with `spctl --assess --type install`

**Smoke test the release artifacts:**
- [ ] Download `.pkg`, install on a clean macOS user → host connects
- [ ] Download `.deb` (or `.rpm`), install in a Linux VM → host connects
- [ ] Download `.zip`, extract, run `install.ps1` in a Windows VM → host connects
- [ ] In each case: extension popup banner disappears, cross-profile detection works

**Chrome Web Store submission:**
- [ ] Build `Archive.zip` (extension files only, no `native-host/`, no `scripts/`, no `docs/`)
- [ ] Upload to CWS Developer Dashboard
- [ ] Provide `nativeMessaging` permission justification: *"Used to communicate with an optional native helper that detects audio playback across the user's Chrome profiles. The native helper is open source, distributed via GitHub, and only runs locally — no network communication."*
- [ ] Update screenshots to show v2 popup with cross-profile section
- [ ] Submit for review

### Subsequent releases (v2.0.1+)

After Phase 2 setup is done, releasing is:

```bash
# Edit manifest.json + host-connection.js to bump version
git commit -am "chore: bump version to 2.0.1"
git push
git tag v2.0.1
git push --tags
# Wait ~10 min for CI
# Build Archive.zip and upload to CWS
```

### Rollback strategy

| Problem | Action |
|---------|--------|
| Critical bug in `.pkg` for macOS | Delete the GitHub Release. Issue v2.0.1 with fix within 24h. Users with v2.0.0 keep working old install until they choose to upgrade (the banner will guide them once v2.0.1 is published). |
| Banner showing wrong state | Hotfix in extension. CWS auto-update propagates within ~24h. |
| CWS rejects v2.0.0 due to permission | Resubmit with reinforced justification. Existing v1.0.4 users are unaffected. |
| CI fails before release | Delete the tag (`git tag -d v2.0.X && git push origin :refs/tags/v2.0.X`). Fix and retag. |

## Effort estimate

| Component | Time |
|-----------|------|
| Apple Developer setup (manual, by user) | ~30 min |
| GitHub Secrets configuration | ~15 min |
| `release.yml` workflow + four `build-*.sh` scripts | 1 day |
| Packaging configs (postinstall scripts, distribution.xml, etc.) | 0.5 day |
| Banner collapsible UX + auto-update detection | 0.5 day |
| Documentation updates (README, promo, STORE_LISTING, PUBLISHING_GUIDE, BUILDING) | 0.5 day |
| Smoke testing on three platforms (macOS native, Linux VM, Windows VM) | 0.5 day |
| Chrome Web Store submission + waiting for review | passive, 1-3 days |
| **Total active development** | **~3 days focused** |

## Out of scope (Phase 2.x candidates)

- Automatic background updates (Sparkle, WinSparkle, etc.)
- Authenticode signing for Windows (requires paid certificate)
- Linux Snap or Flatpak packaging
- macOS Apple Silicon-only or Intel-only builds (currently universal binary)
- Linux ARM beyond arm64 (no ARMv6/ARMv7)
- In-app changelog display
- Analytics or telemetry of any kind

## Estimated change size

- New files: 1 GitHub Actions workflow, 4 build/packaging scripts, 5 packaging templates, 1 dev docs file (BUILDING.md), 1 spec doc (this file).
- Modified files: 4 docs (README, promo, STORE_LISTING, PUBLISHING_GUIDE), 4 extension files (popup.js, popup.css, popup-bridge.js, host-connection.js), 2 locale files.
- Total: ~600-800 LOC across configs and code, plus ~300-500 LOC of documentation.
