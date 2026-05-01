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
