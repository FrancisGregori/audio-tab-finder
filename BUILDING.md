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

CI (`.github/workflows/release.yml`) handles **Linux + Windows** automatically
when a `v*` tag is pushed. **macOS is built and signed locally** because the
GitHub macos-14 runner cannot sign installer packages reliably (productbuild
and pkgbuild both hang on the keychain in that environment, regardless of
keychain configuration).

To build artifacts locally for testing (unsigned):

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

### Releasing a signed + notarized macOS .pkg

For a real release (e.g. `v2.0.0`), the macOS `.pkg` must be signed with
your Developer ID Installer cert and notarized by Apple. Use
`scripts/release-macos.sh` — it does the full flow:

1. Build universal binary (darwin amd64 + arm64 → lipo)
2. `codesign` the binary with Developer ID Application
3. `pkgbuild --sign` with Developer ID Installer
4. `xcrun notarytool submit --wait`
5. `xcrun stapler staple`
6. `spctl --assess` to confirm Gatekeeper acceptance
7. `gh release upload v<version> <pkg>` to the existing GitHub release

Set these environment variables once (e.g. in your `~/.zshrc` or in a
`.envrc` file you don't commit):

```bash
export APPLE_DEVELOPER_ID_APP="Developer ID Application: Your Name (TEAMID)"
export APPLE_DEVELOPER_ID_INST="Developer ID Installer: Your Name (TEAMID)"
export APPLE_ID="you@example.com"
export APPLE_TEAM_ID="TEAMID"
export APPLE_APP_PASSWORD="xxxx-xxxx-xxxx-xxxx"   # app-specific password
```

Then run, AFTER the CI workflow has created the release with the
Linux/Windows artifacts:

```bash
./scripts/release-macos.sh 2.0.0
```

The signed `.pkg` will be appended to the existing GitHub release.

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
