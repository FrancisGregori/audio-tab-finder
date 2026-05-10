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
2. Install the native helper for your OS (optional — only needed if you want to detect audio across multiple Chrome profiles)

### Step 1: Chrome extension

You can install the extension in either of two ways:

#### Option A — Chrome Web Store (recommended)

[Install from Chrome Web Store](https://chromewebstore.google.com/detail/audio-tab-finder-%E2%80%93-find-m/ecnkofmcbijompohhddkaaekdaenhmhh)

You get automatic updates and Google-reviewed binaries.

#### Option B — Load unpacked from source (developer mode)

For users who want to inspect or modify the code before installing:

1. Clone or download this repository
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (toggle in the top right)
4. Click **Load unpacked** and select the project folder
5. The extension is now active

Note: with this method you won't get automatic updates — you'll need to pull changes manually and reload the extension.

### Step 2: Native helper (optional — cross-profile audio detection)

**Do you need this?**

- **You use a single Chrome profile?** No — skip this step. The extension already detects audio in your current profile (same as v1.x). Audio Tab Finder will work fine without the helper.
- **You have multiple Chrome profiles open at the same time?** Install the helper if you want to:
  - See *which* Chrome profile is playing audio
  - Mute or close audio tabs across all your profiles from a single popup
  - See a badge with the total count of audio tabs playing across all profiles

If you don't install the helper, a small "Detect audio across profiles?" banner appears in the popup with a link back here. You can install the helper later at any time.

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

##### Step 1 — Download and extract

1. Download `audio-tab-finder-host-X.Y.Z-windows-amd64.zip` from
   [Releases](https://github.com/FrancisGregori/audio-tab-finder/releases/latest).
2. **Extract the ZIP into a real folder** (right-click the ZIP → "Extract All").
   Do NOT run `install.ps1` from inside the unopened ZIP — Windows will
   silently refuse.

##### Step 2 — Run the installer

You have two options. Try Option A first; if Windows blocks it, use Option B.

**Option A — GUI (right-click)**

1. Right-click `install.ps1` and select **Run with PowerShell**.
2. If PowerShell shows a security prompt about untrusted scripts, type `Y`.
3. Wait for the "Done" message.

If nothing happens, or the window closes instantly with no output, Windows
blocked the script (most common reason: Mark-of-the-Web flag from the ZIP
download, or the system execution policy). Use Option B instead.

**Option B — PowerShell command line (recommended fallback)**

This always works because it bypasses the execution policy explicitly.

1. Open **PowerShell** from the Start menu (regular, NOT "as Administrator").
2. Navigate to the folder you extracted in Step 1, for example:
   ```powershell
   cd "$env:USERPROFILE\Downloads\audio-tab-finder-host-2.0.0-windows-amd64"
   ```
3. Run:
   ```powershell
   PowerShell -ExecutionPolicy Bypass -File .\install.ps1
   ```
4. Wait for the "Done" message.

##### Step 3 — Reload the extension

Open `chrome://extensions` and click the reload icon on the Audio Tab Finder
card. The popup banner about installing the helper should disappear within
a few seconds.

##### Special case — running a "Load unpacked" / dev-mode extension

If you installed the extension via the **"Load unpacked"** option in
`chrome://extensions` (instead of from the Chrome Web Store), Chrome assigns
a **random extension ID** that is different from the published Chrome Web
Store ID.

**The good news:** the installer in v2.0.1+ already auto-detects this. When
you run `install.ps1`, it scans your local Chrome profiles for any installed
"Audio Tab Finder" extension and authorizes its ID automatically — including
unpacked dev builds.

**If for some reason auto-detection misses your install** (e.g. you use a
non-standard Chrome user-data directory, or you load the unpacked extension
*after* running the installer), do the following:

1. Open `chrome://extensions` and copy the ID shown under "Audio Tab Finder".
2. Re-run the installer with the ID passed explicitly:
   ```powershell
   PowerShell -ExecutionPolicy Bypass -File .\install.ps1 -ExtensionId <your-id-here>
   ```
3. Reload the extension at `chrome://extensions`.

> Internally this writes your extension ID into the
> `allowed_origins` array of `%LOCALAPPDATA%\AudioTabFinder\com.fgregori.audio_tab_finder.json`.
> If you ever need to verify or edit it manually, that's the file.

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
