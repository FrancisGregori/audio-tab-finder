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
