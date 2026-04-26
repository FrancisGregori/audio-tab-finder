# Cross-Profile Audio Detection (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the Audio Tab Finder Chrome extension to detect, display, and control audio tabs across all open Chrome profiles via a Go-based Native Messaging Host that bridges profile instances through shared filesystem state.

**Architecture:** Each Chrome profile runs an independent extension instance + native host process. State is shared through atomic JSON files in `~/Library/Application Support/AudioTabFinder/`. Cross-profile actions (mute/close/activate) are dispatched via FSEvents-watched action files and pushed to target profiles via persistent Native Messaging connections.

**Tech Stack:** Go 1.21+ (native host), vanilla JavaScript Manifest V3 (extension), `fsnotify` (FSEvents wrapper), `chrome.runtime.connectNative` (NM transport), `chrome.storage.local` (per-profile persistence). No build step for the extension. No test framework for the extension (manual QA). Automated tests for Go via stdlib `testing`.

**Spec:** `docs/superpowers/specs/2026-04-25-cross-profile-audio-design.md`

---

## File structure overview

### Native host directory (NEW)

```
native-host/
├── go.mod
├── go.sum
├── Makefile
├── cmd/audio-tab-finder-host/main.go
├── internal/
│   ├── nmproto/
│   │   ├── codec.go
│   │   ├── codec_test.go
│   │   └── messages.go
│   ├── store/
│   │   ├── state.go
│   │   ├── state_test.go
│   │   ├── action.go
│   │   └── action_test.go
│   ├── watcher/
│   │   ├── watcher.go
│   │   └── watcher_test.go
│   ├── handler/
│   │   ├── handler.go
│   │   └── handler_test.go
│   └── logging/
│       └── logger.go
└── manifest/
    └── com.fgregori.audio_tab_finder.json.tmpl
```

### Extension files

**Modified:**
- `manifest.json` — version bump, new permissions
- `background.js` — rewrite as modular entry point
- `popup.html` — new structure for cross-profile sections
- `popup.css` — new styles for cross-profile layout
- `popup.js` — significant rewrite for aggregate rendering
- `_locales/en/messages.json` — new strings
- `_locales/pt_BR/messages.json` — new strings (ASCII)

**Created:**
- `profile.js` — UUID + label management (loaded via `importScripts` in SW)
- `host-connection.js` — NM connect/reconnect/send/receive
- `state-sync.js` — audio change detection, heartbeat
- `action-handler.js` — execute pushed action_request from host
- `popup-bridge.js` — handle messages from popup

### Top-level (NEW)

- `scripts/install-local.sh` — friendly install wrapper

---

## Project conventions to follow

Read these before starting:

### Extension conventions

- **No test framework exists.** Each extension task ends with manual verification in Chrome (load unpacked, exercise the feature, observe). Do not introduce Vitest/Jest/etc.
- **`pt_BR` locale uses ASCII only** — no diacritics. Existing strings use "audio" (not "áudio"), "voce" (not "você"), "esta" (not "está"), "titulo" (not "título"). Match this convention exactly.
- **CSS uses dark theme** with palette: bg `#1a1a2e`, item bg `#16213e`, hover `#1f4068`, accent green `#4ade80`, muted text `#888`, primary text `#fff`/`#eaeaea`.
- **Existing focus pattern:** `outline: 2px solid #4ade80; outline-offset: -2px` for items, `+2px` offset for buttons.
- **No comments in code** unless behavior is non-obvious.
- **Commit after each task.** Use conventional commit prefixes (`feat:`, `chore:`, `fix:`, `docs:`).

### Go conventions

- **Go 1.21+** (uses `any`, `slices`, etc.)
- **Standard project layout:** `cmd/` for binaries, `internal/` for non-public packages.
- **Tests live next to the code** they test (`foo.go` + `foo_test.go`).
- **Errors wrapped with `fmt.Errorf("...: %w", err)`** for the call chain.
- **No external dependencies beyond `fsnotify`, `google/uuid`, `lumberjack`** as listed in spec.
- **Logging:** use the project's `internal/logging` package, not stdlib `log` (because stdout is bound to Chrome via NM).
- **No `panic()` outside `main()`.** Return errors.

### Native Messaging conventions

- **Frame format:** 4-byte uint32 LE length + JSON payload. Max 1MB.
- **stdin/stdout** are bound to Chrome. Use `os.Stdin` for incoming, `os.Stdout` for outgoing. **Do NOT print debug to stdout** — Chrome will treat it as a malformed message and disconnect.
- **stderr** is silently discarded by Chrome. Don't rely on it. Log to file instead.

---

## How to manually verify (extension tasks)

1. Open Chrome → `chrome://extensions` → enable **Developer mode** (top-right toggle).
2. Click **Load unpacked** → select `/Users/fgregori/Projects/personal/audio-tab-finder` (the repo root).
3. After every code change, return to `chrome://extensions` and click the **reload** icon on the extension card.
4. To inspect popup: right-click the extension icon → **Inspect popup**.
5. To inspect service worker: `chrome://extensions` → click the "service worker" link on the extension card.
6. To inspect storage: in either DevTools, **Application** tab → **Storage** → **Extension storage** → **Local**.
7. Native host logs: `~/Library/Application Support/AudioTabFinder/logs/host.log`

---

# Part A — Native Host (Go)

### Task 1: Go module + Makefile + project skeleton

**Files:**
- Create: `native-host/go.mod`
- Create: `native-host/Makefile`
- Create: `native-host/.gitignore`

- [ ] **Step 1: Initialize Go module**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
mkdir -p native-host
cd native-host
go mod init github.com/FrancisGregori/audio-tab-finder/native-host
```

This creates `go.mod`. Verify it contains:

```
module github.com/FrancisGregori/audio-tab-finder/native-host

go 1.21
```

(The `go 1.21` line may show as your installed version; that's fine as long as it's ≥1.21.)

- [ ] **Step 2: Create the Makefile**

Create `native-host/Makefile` with this exact content:

```make
.PHONY: build install uninstall test clean

BINARY := bin/audio-tab-finder-host
INSTALL_DIR := /usr/local/bin
NM_MANIFEST_DIR := $(HOME)/Library/Application Support/Google/Chrome/NativeMessagingHosts
NM_NAME := com.fgregori.audio_tab_finder

build:
	mkdir -p bin
	go build -o $(BINARY) ./cmd/audio-tab-finder-host

install: build
	@if [ -z "$(EXT_ID)" ]; then echo "Usage: make install EXT_ID=<extension-id>"; exit 1; fi
	mkdir -p "$(INSTALL_DIR)"
	cp $(BINARY) "$(INSTALL_DIR)/audio-tab-finder-host"
	mkdir -p "$(NM_MANIFEST_DIR)"
	sed -e 's|{{HOST_BINARY_PATH}}|$(INSTALL_DIR)/audio-tab-finder-host|g' \
	    -e 's|{{EXTENSION_ID}}|$(EXT_ID)|g' \
	    manifest/com.fgregori.audio_tab_finder.json.tmpl \
	  > "$(NM_MANIFEST_DIR)/$(NM_NAME).json"
	@echo "Installed. Reload extension to connect."

uninstall:
	rm -f "$(INSTALL_DIR)/audio-tab-finder-host"
	rm -f "$(NM_MANIFEST_DIR)/$(NM_NAME).json"

test:
	go test ./...

clean:
	rm -rf bin
```

- [ ] **Step 3: Create `.gitignore`**

Create `native-host/.gitignore`:

```
bin/
*.test
*.prof
```

- [ ] **Step 4: Verify nothing builds yet (no source files)**

Run from `native-host/`:

```bash
make build
```

Expected: error along the lines of `pattern ./cmd/audio-tab-finder-host: directory prefix . does not contain main module or its selected dependencies` — that's expected, we haven't created the cmd directory yet.

- [ ] **Step 5: Commit**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
git add native-host/go.mod native-host/Makefile native-host/.gitignore
git commit -m "chore: scaffold native-host Go module with Makefile"
```

---

### Task 2: Native Messaging frame codec (TDD)

**Files:**
- Create: `native-host/internal/nmproto/codec.go`
- Create: `native-host/internal/nmproto/codec_test.go`

- [ ] **Step 1: Write the failing tests**

Create `native-host/internal/nmproto/codec_test.go`:

```go
package nmproto

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"strings"
	"testing"
)

func TestWriteThenRead_RoundTrip(t *testing.T) {
	var buf bytes.Buffer
	payload := []byte(`{"hello":"world"}`)

	if err := Write(&buf, payload); err != nil {
		t.Fatalf("Write failed: %v", err)
	}

	got, err := Read(&buf)
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}

	if !bytes.Equal(got, payload) {
		t.Errorf("round-trip mismatch: got %q want %q", got, payload)
	}
}

func TestWrite_LengthPrefix_LittleEndian(t *testing.T) {
	var buf bytes.Buffer
	payload := []byte("abcd") // 4 bytes
	if err := Write(&buf, payload); err != nil {
		t.Fatalf("Write failed: %v", err)
	}

	raw := buf.Bytes()
	if len(raw) != 8 {
		t.Fatalf("expected 8 bytes (4 prefix + 4 payload), got %d", len(raw))
	}

	gotLen := binary.LittleEndian.Uint32(raw[:4])
	if gotLen != 4 {
		t.Errorf("length prefix = %d, want 4", gotLen)
	}
	if string(raw[4:]) != "abcd" {
		t.Errorf("payload = %q, want abcd", raw[4:])
	}
}

func TestRead_PartialPayload_ReturnsError(t *testing.T) {
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint32(10)) // claim 10 bytes
	buf.WriteString("only5")                            // give 5

	_, err := Read(&buf)
	if err == nil {
		t.Fatal("expected error on truncated payload, got nil")
	}
	if !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Errorf("expected ErrUnexpectedEOF, got %v", err)
	}
}

func TestRead_OversizedMessage_RejectedBeforeAlloc(t *testing.T) {
	var buf bytes.Buffer
	binary.Write(&buf, binary.LittleEndian, uint32(MaxMessageSize+1))

	_, err := Read(&buf)
	if err == nil {
		t.Fatal("expected error on oversized message, got nil")
	}
	if !strings.Contains(err.Error(), "too large") {
		t.Errorf("expected 'too large' in error, got %v", err)
	}
}

func TestWrite_OversizedPayload_Rejected(t *testing.T) {
	var buf bytes.Buffer
	huge := make([]byte, MaxMessageSize+1)

	err := Write(&buf, huge)
	if err == nil {
		t.Fatal("expected error on oversized payload, got nil")
	}
}

func TestWriteJSON_EncodesAndFrames(t *testing.T) {
	var buf bytes.Buffer
	payload := map[string]string{"type": "hello"}

	if err := WriteJSON(&buf, payload); err != nil {
		t.Fatalf("WriteJSON failed: %v", err)
	}

	got, err := Read(&buf)
	if err != nil {
		t.Fatalf("Read failed: %v", err)
	}
	if string(got) != `{"type":"hello"}` {
		t.Errorf("got %q want %q", got, `{"type":"hello"}`)
	}
}
```

- [ ] **Step 2: Verify tests fail (no implementation yet)**

```bash
cd native-host
go test ./internal/nmproto/...
```

Expected: build failure — the package doesn't exist yet. That's the "failing test" state for TDD on Go.

- [ ] **Step 3: Implement the codec**

Create `native-host/internal/nmproto/codec.go`:

```go
package nmproto

import (
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
)

const MaxMessageSize = 1 << 20 // 1MB, Chrome hard limit

func Read(r io.Reader) ([]byte, error) {
	var length uint32
	if err := binary.Read(r, binary.LittleEndian, &length); err != nil {
		return nil, err
	}
	if length > MaxMessageSize {
		return nil, fmt.Errorf("message too large: %d bytes", length)
	}
	buf := make([]byte, length)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	return buf, nil
}

func Write(w io.Writer, payload []byte) error {
	if len(payload) > MaxMessageSize {
		return fmt.Errorf("payload too large: %d bytes", len(payload))
	}
	if err := binary.Write(w, binary.LittleEndian, uint32(len(payload))); err != nil {
		return err
	}
	_, err := w.Write(payload)
	return err
}

func WriteJSON(w io.Writer, v any) error {
	payload, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return Write(w, payload)
}
```

- [ ] **Step 4: Verify tests pass**

```bash
go test ./internal/nmproto/... -v
```

Expected: all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
git add native-host/internal/nmproto/
git commit -m "feat(host): native messaging frame codec with tests"
```

---

### Task 3: Logger package

**Files:**
- Create: `native-host/internal/logging/logger.go`

This task does NOT have automated tests — the logger is thin glue around `lumberjack` and stdlib `log`. Verification is "the binary doesn't crash and writes to the right file."

- [ ] **Step 1: Add lumberjack dependency**

```bash
cd native-host
go get gopkg.in/natefinch/lumberjack.v2
```

This updates `go.mod` and `go.sum`.

- [ ] **Step 2: Implement the logger**

Create `native-host/internal/logging/logger.go`:

```go
package logging

import (
	"fmt"
	"io"
	"log"
	"os"
	"path/filepath"
	"time"

	"gopkg.in/natefinch/lumberjack.v2"
)

type Level int

const (
	LevelDebug Level = iota
	LevelInfo
	LevelWarn
	LevelError
	LevelFatal
)

func (l Level) String() string {
	switch l {
	case LevelDebug:
		return "DEBUG"
	case LevelInfo:
		return "INFO"
	case LevelWarn:
		return "WARN"
	case LevelError:
		return "ERROR"
	case LevelFatal:
		return "FATAL"
	}
	return "UNKNOWN"
}

type Logger struct {
	out   io.Writer
	level Level
	inner *log.Logger
}

func New(logDir string) (*Logger, error) {
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return nil, fmt.Errorf("create log dir: %w", err)
	}
	rot := &lumberjack.Logger{
		Filename:   filepath.Join(logDir, "host.log"),
		MaxSize:    1, // 1 MB
		MaxBackups: 3,
		MaxAge:     30, // days
		Compress:   false,
	}
	return &Logger{
		out:   rot,
		level: LevelInfo,
		inner: log.New(rot, "", 0),
	}, nil
}

func (l *Logger) SetLevel(lvl Level) {
	l.level = lvl
}

func (l *Logger) log(lvl Level, args ...any) {
	if lvl < l.level {
		return
	}
	prefix := fmt.Sprintf("%s [%s] ", time.Now().Format(time.RFC3339), lvl)
	l.inner.Println(prefix + fmt.Sprint(args...))
}

func (l *Logger) Debug(args ...any) { l.log(LevelDebug, args...) }
func (l *Logger) Info(args ...any)  { l.log(LevelInfo, args...) }
func (l *Logger) Warn(args ...any)  { l.log(LevelWarn, args...) }
func (l *Logger) Error(args ...any) { l.log(LevelError, args...) }
func (l *Logger) Fatal(args ...any) {
	l.log(LevelFatal, args...)
	os.Exit(1)
}

func (l *Logger) Close() error {
	if c, ok := l.out.(io.Closer); ok {
		return c.Close()
	}
	return nil
}
```

- [ ] **Step 3: Verify it compiles**

```bash
go build ./internal/logging/
```

Expected: no output (success).

- [ ] **Step 4: Commit**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
git add native-host/internal/logging/ native-host/go.mod native-host/go.sum
git commit -m "feat(host): rotating file logger using lumberjack"
```

---

### Task 4: State file store (TDD)

**Files:**
- Create: `native-host/internal/store/state.go`
- Create: `native-host/internal/store/state_test.go`

- [ ] **Step 1: Write the failing tests**

Create `native-host/internal/store/state_test.go`:

```go
package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func tempStoreDir(t *testing.T) string {
	t.Helper()
	dir := t.TempDir()
	if err := EnsureDirs(dir); err != nil {
		t.Fatal(err)
	}
	return dir
}

func TestEnsureDirs_CreatesStateAndActions(t *testing.T) {
	dir := t.TempDir()
	if err := EnsureDirs(dir); err != nil {
		t.Fatal(err)
	}
	for _, sub := range []string{"state", "actions", "logs"} {
		if _, err := os.Stat(filepath.Join(dir, sub)); err != nil {
			t.Errorf("expected %s to exist: %v", sub, err)
		}
	}
}

func TestWriteState_CreatesFileWithFreshHeartbeat(t *testing.T) {
	dir := tempStoreDir(t)
	p := Profile{
		SchemaVersion: 1,
		ProfileUuid:   "test-uuid-1",
		Label:         "Test",
		Tabs:          []Tab{},
	}

	before := time.Now().UnixMilli()
	if err := WriteState(dir, p); err != nil {
		t.Fatal(err)
	}
	after := time.Now().UnixMilli()

	data, err := os.ReadFile(filepath.Join(dir, "state", "test-uuid-1.json"))
	if err != nil {
		t.Fatal(err)
	}
	var got Profile
	if err := json.Unmarshal(data, &got); err != nil {
		t.Fatal(err)
	}
	if got.HeartbeatUnixMs < before || got.HeartbeatUnixMs > after {
		t.Errorf("heartbeat %d not in [%d, %d]", got.HeartbeatUnixMs, before, after)
	}
	if got.Label != "Test" {
		t.Errorf("label = %q, want Test", got.Label)
	}
}

func TestWriteState_AtomicViaTempRename(t *testing.T) {
	dir := tempStoreDir(t)
	p := Profile{SchemaVersion: 1, ProfileUuid: "atomic-test", Label: "X"}
	if err := WriteState(dir, p); err != nil {
		t.Fatal(err)
	}
	// no .tmp leftover
	leftover := filepath.Join(dir, "state", "atomic-test.json.tmp")
	if _, err := os.Stat(leftover); !os.IsNotExist(err) {
		t.Errorf("expected no .tmp leftover, got %v", err)
	}
}

func TestReadAllStates_FiltersStale(t *testing.T) {
	dir := tempStoreDir(t)

	fresh := Profile{SchemaVersion: 1, ProfileUuid: "fresh", Label: "F"}
	stale := Profile{
		SchemaVersion:   1,
		ProfileUuid:     "stale",
		Label:           "S",
		HeartbeatUnixMs: time.Now().UnixMilli() - HeartbeatThresholdMs - 1000,
	}

	if err := WriteState(dir, fresh); err != nil {
		t.Fatal(err)
	}
	// write stale directly without going through WriteState (which refreshes heartbeat)
	data, _ := json.MarshalIndent(stale, "", "  ")
	staleFile := filepath.Join(dir, "state", "stale.json")
	os.WriteFile(staleFile, data, 0644)

	profiles, err := ReadAllStates(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 1 {
		t.Fatalf("expected 1 fresh profile, got %d", len(profiles))
	}
	if profiles[0].ProfileUuid != "fresh" {
		t.Errorf("got profile %q, want fresh", profiles[0].ProfileUuid)
	}
}

func TestReadAllStates_SkipsNonJsonAndUnreadable(t *testing.T) {
	dir := tempStoreDir(t)
	stateDir := filepath.Join(dir, "state")
	os.WriteFile(filepath.Join(stateDir, "not-json.txt"), []byte("hello"), 0644)
	os.WriteFile(filepath.Join(stateDir, "broken.json"), []byte("{not json"), 0644)

	good := Profile{SchemaVersion: 1, ProfileUuid: "good", Label: "G"}
	if err := WriteState(dir, good); err != nil {
		t.Fatal(err)
	}

	profiles, err := ReadAllStates(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(profiles) != 1 {
		t.Errorf("expected 1 valid profile, got %d", len(profiles))
	}
}
```

- [ ] **Step 2: Verify tests fail**

```bash
cd native-host
go test ./internal/store/...
```

Expected: build failure — package doesn't exist.

- [ ] **Step 3: Implement state store**

Create `native-host/internal/store/state.go`:

```go
package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const HeartbeatThresholdMs = 60_000

type Tab struct {
	TabId      int    `json:"tab_id"`
	WindowId   int    `json:"window_id"`
	Title      string `json:"title"`
	Url        string `json:"url"`
	FaviconUrl string `json:"favicon_url"`
	Muted      bool   `json:"muted"`
}

type Profile struct {
	SchemaVersion   int    `json:"schema_version"`
	ProfileUuid     string `json:"profile_uuid"`
	Label           string `json:"label"`
	HeartbeatUnixMs int64  `json:"heartbeat_unix_ms"`
	Tabs            []Tab  `json:"tabs"`
}

func DefaultDir() (string, error) {
	cfg, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(cfg, "AudioTabFinder"), nil
}

func EnsureDirs(base string) error {
	for _, sub := range []string{"state", "actions", "logs"} {
		if err := os.MkdirAll(filepath.Join(base, sub), 0755); err != nil {
			return fmt.Errorf("mkdir %s: %w", sub, err)
		}
	}
	return nil
}

func WriteState(dir string, p Profile) error {
	p.HeartbeatUnixMs = time.Now().UnixMilli()
	if p.Tabs == nil {
		p.Tabs = []Tab{}
	}
	final := filepath.Join(dir, "state", p.ProfileUuid+".json")
	tmp := final + ".tmp"
	data, err := json.MarshalIndent(p, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, final)
}

func ReadAllStates(dir string) ([]Profile, error) {
	entries, err := os.ReadDir(filepath.Join(dir, "state"))
	if err != nil {
		return nil, err
	}
	now := time.Now().UnixMilli()
	var profiles []Profile
	for _, e := range entries {
		name := e.Name()
		if !strings.HasSuffix(name, ".json") || strings.HasSuffix(name, ".tmp") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, "state", name))
		if err != nil {
			continue
		}
		var p Profile
		if err := json.Unmarshal(data, &p); err != nil {
			continue
		}
		if now-p.HeartbeatUnixMs > HeartbeatThresholdMs {
			continue
		}
		profiles = append(profiles, p)
	}
	return profiles, nil
}
```

- [ ] **Step 4: Verify tests pass**

```bash
go test ./internal/store/... -v
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
git add native-host/internal/store/state.go native-host/internal/store/state_test.go
git commit -m "feat(host): state file store with atomic writes and stale filtering"
```

---

### Task 5: Action file store (TDD)

**Files:**
- Create: `native-host/internal/store/action.go`
- Create: `native-host/internal/store/action_test.go`

- [ ] **Step 1: Write the failing tests**

Create `native-host/internal/store/action_test.go`:

```go
package store

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestWriteAction_CreatesFile(t *testing.T) {
	dir := tempStoreDir(t)
	a := Action{
		SchemaVersion:     1,
		ActionId:          "act-1",
		SourceProfileUuid: "src",
		TargetProfileUuid: "tgt",
		Action:            "mute",
		TargetTabId:       42,
		TargetWindowId:    7,
		CreatedAtUnixMs:   time.Now().UnixMilli(),
		TtlMs:             5000,
	}
	if err := WriteAction(dir, a); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "actions", "act-1.json")); err != nil {
		t.Errorf("expected action file, got %v", err)
	}
}

func TestReadAction_ReadsBackWhatWasWritten(t *testing.T) {
	dir := tempStoreDir(t)
	a := Action{
		SchemaVersion:     1,
		ActionId:          "round-trip",
		SourceProfileUuid: "src",
		TargetProfileUuid: "tgt",
		Action:            "close",
		TargetTabId:       99,
		TargetWindowId:    3,
		CreatedAtUnixMs:   time.Now().UnixMilli(),
		TtlMs:             5000,
	}
	if err := WriteAction(dir, a); err != nil {
		t.Fatal(err)
	}
	got, err := ReadAction(filepath.Join(dir, "actions", "round-trip.json"))
	if err != nil {
		t.Fatal(err)
	}
	if got.ActionId != "round-trip" || got.Action != "close" || got.TargetTabId != 99 {
		t.Errorf("read mismatch: %+v", got)
	}
}

func TestAction_Expired(t *testing.T) {
	notExpired := Action{
		CreatedAtUnixMs: time.Now().UnixMilli() - 1000,
		TtlMs:           5000,
	}
	expired := Action{
		CreatedAtUnixMs: time.Now().UnixMilli() - 10_000,
		TtlMs:           5000,
	}
	if notExpired.Expired() {
		t.Error("expected not expired")
	}
	if !expired.Expired() {
		t.Error("expected expired")
	}
}

func TestDeleteAction(t *testing.T) {
	dir := tempStoreDir(t)
	a := Action{
		SchemaVersion: 1, ActionId: "del-test",
		SourceProfileUuid: "s", TargetProfileUuid: "t",
		Action: "mute", CreatedAtUnixMs: time.Now().UnixMilli(), TtlMs: 5000,
	}
	if err := WriteAction(dir, a); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, "actions", "del-test.json")
	if err := DeleteActionFile(path); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("expected file gone, got %v", err)
	}
}

func TestDeleteAction_IdempotentOnMissingFile(t *testing.T) {
	dir := tempStoreDir(t)
	path := filepath.Join(dir, "actions", "never-existed.json")
	if err := DeleteActionFile(path); err != nil {
		t.Errorf("expected nil error on missing file, got %v", err)
	}
}
```

- [ ] **Step 2: Verify tests fail**

```bash
go test ./internal/store/... -run Action
```

Expected: build failure (Action type doesn't exist).

- [ ] **Step 3: Implement action store**

Create `native-host/internal/store/action.go`:

```go
package store

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"time"
)

type Action struct {
	SchemaVersion     int    `json:"schema_version"`
	ActionId          string `json:"action_id"`
	SourceProfileUuid string `json:"source_profile_uuid"`
	TargetProfileUuid string `json:"target_profile_uuid"`
	Action            string `json:"action"`
	TargetTabId       int    `json:"target_tab_id"`
	TargetWindowId    int    `json:"target_window_id"`
	CreatedAtUnixMs   int64  `json:"created_at_unix_ms"`
	TtlMs             int64  `json:"ttl_ms"`
}

func (a Action) Expired() bool {
	return time.Now().UnixMilli() > a.CreatedAtUnixMs+a.TtlMs
}

func WriteAction(dir string, a Action) error {
	final := filepath.Join(dir, "actions", a.ActionId+".json")
	tmp := final + ".tmp"
	data, err := json.MarshalIndent(a, "", "  ")
	if err != nil {
		return err
	}
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, final)
}

func ReadAction(path string) (Action, error) {
	var a Action
	data, err := os.ReadFile(path)
	if err != nil {
		return a, err
	}
	if err := json.Unmarshal(data, &a); err != nil {
		return a, err
	}
	return a, nil
}

func DeleteActionFile(path string) error {
	err := os.Remove(path)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	return nil
}
```

- [ ] **Step 4: Verify tests pass**

```bash
go test ./internal/store/... -v
```

Expected: 5 new tests pass + the 5 from Task 4 still pass = 10 total.

- [ ] **Step 5: Commit**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
git add native-host/internal/store/action.go native-host/internal/store/action_test.go
git commit -m "feat(host): action file store with TTL expiry and idempotent delete"
```

---

### Task 6: FSEvents watcher (TDD)

**Files:**
- Create: `native-host/internal/watcher/watcher.go`
- Create: `native-host/internal/watcher/watcher_test.go`

- [ ] **Step 1: Add fsnotify dependency**

```bash
cd native-host
go get github.com/fsnotify/fsnotify
```

- [ ] **Step 2: Write the failing tests**

Create `native-host/internal/watcher/watcher_test.go`:

```go
package watcher

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/store"
)

func TestWatcher_DeliversActionsForOwnUuid(t *testing.T) {
	dir := t.TempDir()
	if err := store.EnsureDirs(dir); err != nil {
		t.Fatal(err)
	}

	var mu sync.Mutex
	var received []store.Action

	w, err := New(filepath.Join(dir, "actions"), "my-uuid", func(a store.Action) {
		mu.Lock()
		defer mu.Unlock()
		received = append(received, a)
	})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	a := store.Action{
		SchemaVersion: 1, ActionId: "for-me",
		SourceProfileUuid: "other", TargetProfileUuid: "my-uuid",
		Action: "mute", TargetTabId: 1, TargetWindowId: 2,
		CreatedAtUnixMs: time.Now().UnixMilli(), TtlMs: 5000,
	}
	if err := store.WriteAction(dir, a); err != nil {
		t.Fatal(err)
	}

	waitForCondition(t, 2*time.Second, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(received) == 1
	})

	mu.Lock()
	defer mu.Unlock()
	if received[0].ActionId != "for-me" {
		t.Errorf("got %q want for-me", received[0].ActionId)
	}
}

func TestWatcher_IgnoresActionsForOtherUuid(t *testing.T) {
	dir := t.TempDir()
	store.EnsureDirs(dir)

	var mu sync.Mutex
	var received []store.Action

	w, err := New(filepath.Join(dir, "actions"), "my-uuid", func(a store.Action) {
		mu.Lock()
		defer mu.Unlock()
		received = append(received, a)
	})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	a := store.Action{
		SchemaVersion: 1, ActionId: "not-for-me",
		SourceProfileUuid: "other", TargetProfileUuid: "someone-else",
		Action: "mute", TargetTabId: 1,
		CreatedAtUnixMs: time.Now().UnixMilli(), TtlMs: 5000,
	}
	store.WriteAction(dir, a)

	time.Sleep(500 * time.Millisecond)
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 0 {
		t.Errorf("expected 0 received, got %d", len(received))
	}
}

func TestWatcher_GarbageCollectsExpiredActions(t *testing.T) {
	dir := t.TempDir()
	store.EnsureDirs(dir)

	w, err := New(filepath.Join(dir, "actions"), "my-uuid", func(a store.Action) {
		t.Errorf("callback should not fire for expired action")
	})
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()

	expired := store.Action{
		SchemaVersion: 1, ActionId: "expired",
		SourceProfileUuid: "other", TargetProfileUuid: "my-uuid",
		Action: "mute",
		CreatedAtUnixMs: time.Now().UnixMilli() - 10_000,
		TtlMs:           5000,
	}
	store.WriteAction(dir, expired)

	path := filepath.Join(dir, "actions", "expired.json")
	waitForCondition(t, 2*time.Second, func() bool {
		_, err := os.Stat(path)
		return os.IsNotExist(err)
	})
}

func waitForCondition(t *testing.T, timeout time.Duration, fn func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if fn() {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("condition not met within %v", timeout)
}
```

- [ ] **Step 3: Verify tests fail**

```bash
cd native-host
go test ./internal/watcher/...
```

Expected: build failure (package doesn't exist).

- [ ] **Step 4: Implement watcher**

Create `native-host/internal/watcher/watcher.go`:

```go
package watcher

import (
	"os"
	"strings"

	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/store"
	"github.com/fsnotify/fsnotify"
)

type Watcher struct {
	dir        string
	targetUuid string
	onAction   func(store.Action)
	fsw        *fsnotify.Watcher
	done       chan struct{}
}

func New(actionsDir, profileUuid string, onAction func(store.Action)) (*Watcher, error) {
	fsw, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}
	if err := fsw.Add(actionsDir); err != nil {
		fsw.Close()
		return nil, err
	}
	w := &Watcher{
		dir:        actionsDir,
		targetUuid: profileUuid,
		onAction:   onAction,
		fsw:        fsw,
		done:       make(chan struct{}),
	}
	go w.loop()
	return w, nil
}

func (w *Watcher) Close() error {
	close(w.done)
	return w.fsw.Close()
}

func (w *Watcher) loop() {
	for {
		select {
		case <-w.done:
			return
		case ev, ok := <-w.fsw.Events:
			if !ok {
				return
			}
			w.handleEvent(ev)
		case <-w.fsw.Errors:
			// swallow individual errors, keep watching
		}
	}
}

func (w *Watcher) handleEvent(ev fsnotify.Event) {
	if ev.Op&fsnotify.Create != fsnotify.Create {
		return
	}
	name := ev.Name
	if !strings.HasSuffix(name, ".json") || strings.HasSuffix(name, ".tmp") {
		return
	}
	a, err := store.ReadAction(name)
	if err != nil {
		return
	}
	if a.TargetProfileUuid != w.targetUuid {
		return
	}
	if a.Expired() {
		os.Remove(name)
		return
	}
	w.onAction(a)
}
```

- [ ] **Step 5: Verify tests pass**

```bash
go test ./internal/watcher/... -v
```

Expected: 3 tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
git add native-host/internal/watcher/ native-host/go.mod native-host/go.sum
git commit -m "feat(host): FSEvents watcher with profile filtering and TTL GC"
```

---

### Task 7: Native messaging message types

**Files:**
- Create: `native-host/internal/nmproto/messages.go`

This is a thin file of typed message structs. No tests — they're just data carriers, exercised in Task 8 (handler tests).

- [ ] **Step 1: Implement message types**

Create `native-host/internal/nmproto/messages.go`:

```go
package nmproto

import "github.com/FrancisGregori/audio-tab-finder/native-host/internal/store"

// Incoming (extension -> host)

type Hello struct {
	Type        string `json:"type"`
	RequestId   string `json:"request_id"`
	ProfileUuid string `json:"profile_uuid"`
	Label       string `json:"label"`
}

type UpdateState struct {
	Type      string     `json:"type"`
	RequestId string     `json:"request_id"`
	Label     string     `json:"label"`
	Tabs      []store.Tab `json:"tabs"`
}

type GetAggregate struct {
	Type      string `json:"type"`
	RequestId string `json:"request_id"`
}

type SendAction struct {
	Type              string `json:"type"`
	RequestId         string `json:"request_id"`
	TargetProfileUuid string `json:"target_profile_uuid"`
	Action            string `json:"action"`
	TargetTabId       int    `json:"target_tab_id"`
	TargetWindowId    int    `json:"target_window_id"`
}

type ActionResult struct {
	Type     string `json:"type"`
	ActionId string `json:"action_id"`
	Success  bool   `json:"success"`
	Error    string `json:"error,omitempty"`
}

// Outgoing (host -> extension)

type HelloAck struct {
	Type        string `json:"type"`
	RequestId   string `json:"request_id"`
	HostVersion string `json:"host_version"`
}

type UpdateStateAck struct {
	Type      string `json:"type"`
	RequestId string `json:"request_id"`
}

type AggregateProfile struct {
	ProfileUuid string      `json:"profile_uuid"`
	Label       string      `json:"label"`
	IsSelf      bool        `json:"is_self"`
	Tabs        []store.Tab `json:"tabs"`
}

type Aggregate struct {
	Type      string             `json:"type"`
	RequestId string             `json:"request_id"`
	Profiles  []AggregateProfile `json:"profiles"`
}

type SendActionAck struct {
	Type      string `json:"type"`
	RequestId string `json:"request_id"`
	ActionId  string `json:"action_id"`
}

type ActionRequest struct {
	Type              string `json:"type"`
	ActionId          string `json:"action_id"`
	SourceProfileUuid string `json:"source_profile_uuid"`
	Action            string `json:"action"`
	TargetTabId       int    `json:"target_tab_id"`
	TargetWindowId    int    `json:"target_window_id"`
}

type ErrorMsg struct {
	Type      string `json:"type"`
	RequestId string `json:"request_id"`
	Code      string `json:"code"`
	Message   string `json:"message"`
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd native-host
go build ./internal/nmproto/
```

Expected: success.

- [ ] **Step 3: Commit**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
git add native-host/internal/nmproto/messages.go
git commit -m "feat(host): typed message structs for native messaging protocol"
```

---

### Task 8: Message handler dispatch (TDD)

**Files:**
- Create: `native-host/internal/handler/handler.go`
- Create: `native-host/internal/handler/handler_test.go`

- [ ] **Step 1: Add UUID dependency**

```bash
cd native-host
go get github.com/google/uuid
```

- [ ] **Step 2: Write failing tests**

Create `native-host/internal/handler/handler_test.go`:

```go
package handler

import (
	"bytes"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/nmproto"
	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/store"
)

type captureWriter struct {
	bytes.Buffer
}

func (c *captureWriter) lastMessage(t *testing.T) []byte {
	t.Helper()
	data, err := nmproto.Read(&c.Buffer)
	if err != nil {
		t.Fatalf("no message captured: %v", err)
	}
	return data
}

func newHandler(t *testing.T) (*Handler, *captureWriter, string) {
	t.Helper()
	dir := t.TempDir()
	if err := store.EnsureDirs(dir); err != nil {
		t.Fatal(err)
	}
	out := &captureWriter{}
	h := New(dir, out, nil) // logger nil = silent
	return h, out, dir
}

func TestHandleHello_RegistersProfileAndAcks(t *testing.T) {
	h, out, _ := newHandler(t)
	hello, _ := json.Marshal(nmproto.Hello{
		Type: "hello", RequestId: "r1",
		ProfileUuid: "uuid-1", Label: "Test",
	})
	if err := h.Dispatch(hello); err != nil {
		t.Fatal(err)
	}
	if h.profileUuid != "uuid-1" {
		t.Errorf("profileUuid = %q, want uuid-1", h.profileUuid)
	}
	var ack nmproto.HelloAck
	json.Unmarshal(out.lastMessage(t), &ack)
	if ack.Type != "hello_ack" || ack.RequestId != "r1" {
		t.Errorf("unexpected ack: %+v", ack)
	}
}

func TestHandleUpdateState_WritesStateFile(t *testing.T) {
	h, out, dir := newHandler(t)
	hello, _ := json.Marshal(nmproto.Hello{
		Type: "hello", RequestId: "r1",
		ProfileUuid: "uuid-1", Label: "Test",
	})
	h.Dispatch(hello)
	out.Reset()

	upd, _ := json.Marshal(nmproto.UpdateState{
		Type: "update_state", RequestId: "r2",
		Label: "Test",
		Tabs:  []store.Tab{{TabId: 1, WindowId: 1, Title: "t", Url: "u", Muted: false}},
	})
	if err := h.Dispatch(upd); err != nil {
		t.Fatal(err)
	}

	stateFile := filepath.Join(dir, "state", "uuid-1.json")
	data, err := readFile(stateFile)
	if err != nil {
		t.Fatal(err)
	}
	var p store.Profile
	json.Unmarshal(data, &p)
	if len(p.Tabs) != 1 || p.Tabs[0].TabId != 1 {
		t.Errorf("state not written correctly: %+v", p)
	}
}

func TestHandleGetAggregate_ReturnsAllFreshProfiles(t *testing.T) {
	h, out, dir := newHandler(t)
	helloRaw, _ := json.Marshal(nmproto.Hello{
		Type: "hello", RequestId: "r1",
		ProfileUuid: "self-uuid", Label: "Self",
	})
	h.Dispatch(helloRaw)
	out.Reset()

	// Pre-populate another profile's state
	other := store.Profile{
		SchemaVersion: 1, ProfileUuid: "other-uuid", Label: "Other",
		Tabs: []store.Tab{{TabId: 99, Title: "x"}},
	}
	store.WriteState(dir, other)

	// Self has no tabs yet — write its own state through update
	upd, _ := json.Marshal(nmproto.UpdateState{
		Type: "update_state", RequestId: "r2", Label: "Self", Tabs: []store.Tab{},
	})
	h.Dispatch(upd)
	out.Reset()

	getAgg, _ := json.Marshal(nmproto.GetAggregate{Type: "get_aggregate", RequestId: "r3"})
	h.Dispatch(getAgg)

	var agg nmproto.Aggregate
	json.Unmarshal(out.lastMessage(t), &agg)
	if agg.Type != "aggregate" || agg.RequestId != "r3" {
		t.Errorf("unexpected response: %+v", agg)
	}
	if len(agg.Profiles) != 2 {
		t.Errorf("expected 2 profiles, got %d", len(agg.Profiles))
	}
	var sawSelf, sawOther bool
	for _, p := range agg.Profiles {
		if p.ProfileUuid == "self-uuid" && p.IsSelf {
			sawSelf = true
		}
		if p.ProfileUuid == "other-uuid" && !p.IsSelf {
			sawOther = true
		}
	}
	if !sawSelf || !sawOther {
		t.Errorf("missing profiles: self=%v other=%v", sawSelf, sawOther)
	}
}

func TestHandleSendAction_CreatesActionFileAndAcks(t *testing.T) {
	h, out, dir := newHandler(t)
	helloRaw, _ := json.Marshal(nmproto.Hello{
		Type: "hello", RequestId: "r1",
		ProfileUuid: "src-uuid", Label: "Source",
	})
	h.Dispatch(helloRaw)
	out.Reset()

	send, _ := json.Marshal(nmproto.SendAction{
		Type: "send_action", RequestId: "r2",
		TargetProfileUuid: "tgt-uuid",
		Action:            "mute",
		TargetTabId:       42, TargetWindowId: 7,
	})
	if err := h.Dispatch(send); err != nil {
		t.Fatal(err)
	}

	var ack nmproto.SendActionAck
	json.Unmarshal(out.lastMessage(t), &ack)
	if ack.Type != "send_action_ack" || ack.ActionId == "" {
		t.Errorf("unexpected ack: %+v", ack)
	}

	// Verify file written
	files, _ := readDir(filepath.Join(dir, "actions"))
	if len(files) != 1 {
		t.Errorf("expected 1 action file, got %d", len(files))
	}
}

func TestHandleSendAction_RejectsSelfTarget(t *testing.T) {
	h, out, _ := newHandler(t)
	helloRaw, _ := json.Marshal(nmproto.Hello{
		Type: "hello", RequestId: "r1",
		ProfileUuid: "uuid", Label: "X",
	})
	h.Dispatch(helloRaw)
	out.Reset()

	send, _ := json.Marshal(nmproto.SendAction{
		Type: "send_action", RequestId: "r2",
		TargetProfileUuid: "uuid", // same as self
		Action:            "mute", TargetTabId: 1,
	})
	h.Dispatch(send)

	var errMsg nmproto.ErrorMsg
	json.Unmarshal(out.lastMessage(t), &errMsg)
	if errMsg.Type != "error" || errMsg.Code != "SELF_TARGET" {
		t.Errorf("expected SELF_TARGET error, got %+v", errMsg)
	}
}

func TestHandleActionResult_DeletesActionFile(t *testing.T) {
	h, out, dir := newHandler(t)
	helloRaw, _ := json.Marshal(nmproto.Hello{
		Type: "hello", RequestId: "r1",
		ProfileUuid: "tgt-uuid", Label: "T",
	})
	h.Dispatch(helloRaw)
	out.Reset()

	a := store.Action{
		SchemaVersion: 1, ActionId: "to-delete",
		SourceProfileUuid: "src", TargetProfileUuid: "tgt-uuid",
		Action: "mute", TargetTabId: 1,
		CreatedAtUnixMs: time.Now().UnixMilli(), TtlMs: 5000,
	}
	store.WriteAction(dir, a)

	res, _ := json.Marshal(nmproto.ActionResult{
		Type: "action_result", ActionId: "to-delete", Success: true,
	})
	h.Dispatch(res)

	path := filepath.Join(dir, "actions", "to-delete.json")
	if _, err := readFile(path); err == nil {
		t.Errorf("expected action file deleted")
	}
}

func TestHandleUnknownType_ReturnsError(t *testing.T) {
	h, out, _ := newHandler(t)
	raw := []byte(`{"type":"bogus","request_id":"r1"}`)
	h.Dispatch(raw)

	var errMsg nmproto.ErrorMsg
	json.Unmarshal(out.lastMessage(t), &errMsg)
	if errMsg.Type != "error" || errMsg.Code != "UNKNOWN_TYPE" {
		t.Errorf("expected UNKNOWN_TYPE error, got %+v", errMsg)
	}
}

// helpers
func readFile(path string) ([]byte, error) {
	return os.ReadFile(path)
}

func readDir(path string) ([]string, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	out := make([]string, 0, len(entries))
	for _, e := range entries {
		out = append(out, e.Name())
	}
	return out, nil
}
```

Make sure the test file's import block includes `"os"` along with the other imports:

```go
import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/nmproto"
	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/store"
)
```

- [ ] **Step 3: Verify tests fail**

```bash
cd native-host
go test ./internal/handler/...
```

Expected: build failure.

- [ ] **Step 4: Implement handler**

Create `native-host/internal/handler/handler.go`:

```go
package handler

import (
	"encoding/json"
	"fmt"
	"io"
	"path/filepath"
	"sync"
	"time"

	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/logging"
	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/nmproto"
	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/store"
	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/watcher"
	"github.com/google/uuid"
)

const HostVersion = "0.1.0"
const DefaultActionTtlMs = 5000

type Handler struct {
	storeDir    string
	profileUuid string
	label       string
	out         io.Writer
	logger      *logging.Logger
	watcher     *watcher.Watcher
	mu          sync.Mutex
}

func New(storeDir string, out io.Writer, logger *logging.Logger) *Handler {
	return &Handler{
		storeDir: storeDir,
		out:      out,
		logger:   logger,
	}
}

func (h *Handler) Close() {
	if h.watcher != nil {
		h.watcher.Close()
	}
}

func (h *Handler) Dispatch(raw []byte) error {
	var base struct {
		Type      string `json:"type"`
		RequestId string `json:"request_id"`
	}
	if err := json.Unmarshal(raw, &base); err != nil {
		return h.replyError("", "BAD_JSON", err.Error())
	}
	switch base.Type {
	case "hello":
		return h.handleHello(raw)
	case "update_state":
		return h.handleUpdateState(raw)
	case "get_aggregate":
		return h.handleGetAggregate(raw)
	case "send_action":
		return h.handleSendAction(raw)
	case "action_result":
		return h.handleActionResult(raw)
	default:
		return h.replyError(base.RequestId, "UNKNOWN_TYPE", "unknown message type: "+base.Type)
	}
}

func (h *Handler) handleHello(raw []byte) error {
	var msg nmproto.Hello
	if err := json.Unmarshal(raw, &msg); err != nil {
		return h.replyError("", "BAD_JSON", err.Error())
	}
	h.mu.Lock()
	h.profileUuid = msg.ProfileUuid
	h.label = msg.Label
	h.mu.Unlock()

	if err := h.startWatcher(); err != nil {
		return h.replyError(msg.RequestId, "WATCHER_FAIL", err.Error())
	}
	return nmproto.WriteJSON(h.out, nmproto.HelloAck{
		Type: "hello_ack", RequestId: msg.RequestId, HostVersion: HostVersion,
	})
}

func (h *Handler) startWatcher() error {
	if h.watcher != nil {
		return nil
	}
	w, err := watcher.New(
		filepath.Join(h.storeDir, "actions"),
		h.profileUuid,
		h.onActionPushed,
	)
	if err != nil {
		return err
	}
	h.watcher = w
	return nil
}

func (h *Handler) onActionPushed(a store.Action) {
	_ = nmproto.WriteJSON(h.out, nmproto.ActionRequest{
		Type:              "action_request",
		ActionId:          a.ActionId,
		SourceProfileUuid: a.SourceProfileUuid,
		Action:            a.Action,
		TargetTabId:       a.TargetTabId,
		TargetWindowId:    a.TargetWindowId,
	})
}

func (h *Handler) handleUpdateState(raw []byte) error {
	var msg nmproto.UpdateState
	if err := json.Unmarshal(raw, &msg); err != nil {
		return h.replyError("", "BAD_JSON", err.Error())
	}
	h.mu.Lock()
	h.label = msg.Label
	uuid := h.profileUuid
	h.mu.Unlock()
	if uuid == "" {
		return h.replyError(msg.RequestId, "NO_HELLO", "must send hello first")
	}
	p := store.Profile{
		SchemaVersion: 1,
		ProfileUuid:   uuid,
		Label:         msg.Label,
		Tabs:          msg.Tabs,
	}
	if err := store.WriteState(h.storeDir, p); err != nil {
		return h.replyError(msg.RequestId, "WRITE_FAILED", err.Error())
	}
	return nmproto.WriteJSON(h.out, nmproto.UpdateStateAck{
		Type: "update_state_ack", RequestId: msg.RequestId,
	})
}

func (h *Handler) handleGetAggregate(raw []byte) error {
	var msg nmproto.GetAggregate
	if err := json.Unmarshal(raw, &msg); err != nil {
		return h.replyError("", "BAD_JSON", err.Error())
	}
	profiles, err := store.ReadAllStates(h.storeDir)
	if err != nil {
		return h.replyError(msg.RequestId, "READ_FAILED", err.Error())
	}
	out := make([]nmproto.AggregateProfile, 0, len(profiles))
	for _, p := range profiles {
		out = append(out, nmproto.AggregateProfile{
			ProfileUuid: p.ProfileUuid,
			Label:       p.Label,
			IsSelf:      p.ProfileUuid == h.profileUuid,
			Tabs:        p.Tabs,
		})
	}
	return nmproto.WriteJSON(h.out, nmproto.Aggregate{
		Type: "aggregate", RequestId: msg.RequestId, Profiles: out,
	})
}

func (h *Handler) handleSendAction(raw []byte) error {
	var msg nmproto.SendAction
	if err := json.Unmarshal(raw, &msg); err != nil {
		return h.replyError("", "BAD_JSON", err.Error())
	}
	if msg.TargetProfileUuid == h.profileUuid {
		return h.replyError(msg.RequestId, "SELF_TARGET", "cannot target self")
	}
	a := store.Action{
		SchemaVersion:     1,
		ActionId:          uuid.NewString(),
		SourceProfileUuid: h.profileUuid,
		TargetProfileUuid: msg.TargetProfileUuid,
		Action:            msg.Action,
		TargetTabId:       msg.TargetTabId,
		TargetWindowId:    msg.TargetWindowId,
		CreatedAtUnixMs:   time.Now().UnixMilli(),
		TtlMs:             DefaultActionTtlMs,
	}
	if err := store.WriteAction(h.storeDir, a); err != nil {
		return h.replyError(msg.RequestId, "WRITE_FAILED", err.Error())
	}
	return nmproto.WriteJSON(h.out, nmproto.SendActionAck{
		Type: "send_action_ack", RequestId: msg.RequestId, ActionId: a.ActionId,
	})
}

func (h *Handler) handleActionResult(raw []byte) error {
	var msg nmproto.ActionResult
	if err := json.Unmarshal(raw, &msg); err != nil {
		return h.replyError("", "BAD_JSON", err.Error())
	}
	path := filepath.Join(h.storeDir, "actions", msg.ActionId+".json")
	return store.DeleteActionFile(path)
}

func (h *Handler) replyError(requestId, code, message string) error {
	return nmproto.WriteJSON(h.out, nmproto.ErrorMsg{
		Type: "error", RequestId: requestId, Code: code, Message: message,
	})
}

func (h *Handler) logf(format string, args ...any) {
	if h.logger == nil {
		return
	}
	h.logger.Info(fmt.Sprintf(format, args...))
}
```

- [ ] **Step 5: Verify tests pass**

```bash
go test ./internal/handler/... -v
```

Expected: 7 tests pass.

- [ ] **Step 6: Run all tests to make sure nothing regressed**

```bash
go test ./... -v
```

Expected: all tests pass (codec 6 + state 5 + action 5 + watcher 3 + handler 7 = 26).

- [ ] **Step 7: Commit**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
git add native-host/internal/handler/ native-host/go.mod native-host/go.sum
git commit -m "feat(host): message dispatch with hello/update_state/aggregate/action handlers"
```

---

### Task 9: Main entry point + NM manifest template + install script

**Files:**
- Create: `native-host/cmd/audio-tab-finder-host/main.go`
- Create: `native-host/manifest/com.fgregori.audio_tab_finder.json.tmpl`
- Create: `scripts/install-local.sh`

- [ ] **Step 1: Implement main.go**

Create `native-host/cmd/audio-tab-finder-host/main.go`:

```go
package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"

	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/handler"
	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/logging"
	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/nmproto"
	"github.com/FrancisGregori/audio-tab-finder/native-host/internal/store"
)

func main() {
	storeDir, err := store.DefaultDir()
	if err != nil {
		os.Exit(2)
	}
	if err := store.EnsureDirs(storeDir); err != nil {
		os.Exit(3)
	}

	logger, err := logging.New(filepath.Join(storeDir, "logs"))
	if err != nil {
		os.Exit(4)
	}
	defer logger.Close()
	logger.Info("native host started, pid=", os.Getpid())

	h := handler.New(storeDir, os.Stdout, logger)
	defer h.Close()

	for {
		msg, err := nmproto.Read(os.Stdin)
		if err != nil {
			if errors.Is(err, io.EOF) {
				logger.Info("stdin closed, exiting")
			} else {
				logger.Error("read failed: ", err)
			}
			return
		}
		if err := h.Dispatch(msg); err != nil {
			logger.Error("dispatch failed: ", err)
		}
	}
}
```

- [ ] **Step 2: Create the NM manifest template**

Create `native-host/manifest/com.fgregori.audio_tab_finder.json.tmpl`:

```json
{
  "name": "com.fgregori.audio_tab_finder",
  "description": "Audio Tab Finder native helper",
  "path": "{{HOST_BINARY_PATH}}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://{{EXTENSION_ID}}/"
  ]
}
```

- [ ] **Step 3: Create the install script**

Create `scripts/install-local.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -d "native-host" ]; then
  echo "native-host directory not found"
  exit 1
fi

echo "Audio Tab Finder — local install"
echo ""
echo "Step 1: Make sure the extension is loaded in chrome://extensions (Developer mode → Load unpacked, select this repo root)."
echo "Step 2: Copy the Extension ID shown on the extension card and paste it below."
echo ""
read -rp "Extension ID: " EXT_ID

if [[ ! "$EXT_ID" =~ ^[a-p]{32}$ ]]; then
  echo "Invalid Extension ID (expected 32 chars, a-p)."
  exit 1
fi

cd native-host
make install EXT_ID="$EXT_ID"
cd ..

echo ""
echo "Done. Reload the extension in chrome://extensions."
echo "Logs: ~/Library/Application Support/AudioTabFinder/logs/host.log"
```

Make it executable:

```bash
chmod +x scripts/install-local.sh
```

- [ ] **Step 4: Build the binary**

```bash
cd native-host
make build
```

Expected: `bin/audio-tab-finder-host` is created. Verify with `file bin/audio-tab-finder-host` (should report a Mach-O executable on macOS).

- [ ] **Step 5: Verify the host doesn't crash on stdin EOF**

```bash
echo "" | ./bin/audio-tab-finder-host
```

Expected: silent exit code 0 (or non-zero from EOF handling). Check `~/Library/Application\ Support/AudioTabFinder/logs/host.log` — should contain the "native host started" line and "stdin closed, exiting".

- [ ] **Step 6: Run all tests**

```bash
make test
```

Expected: 26 tests pass.

- [ ] **Step 7: Commit**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
git add native-host/cmd/ native-host/manifest/ scripts/install-local.sh
git commit -m "feat(host): main entry point, NM manifest template, install script"
```

---

# Part B — Extension

### Task 10: Extension manifest + i18n strings

**Files:**
- Modify: `manifest.json`
- Modify: `_locales/en/messages.json`
- Modify: `_locales/pt_BR/messages.json`

- [ ] **Step 1: Update `manifest.json` permissions and version**

Replace lines 5 and 10 of `manifest.json`:

```diff
-  "version": "1.0.4",
+  "version": "2.0.0",
```

```diff
-  "permissions": ["tabs"],
+  "permissions": ["tabs", "storage", "nativeMessaging"],
```

The full final permissions array should be `["tabs", "storage", "nativeMessaging"]`.

- [ ] **Step 2: Add new i18n keys to `_locales/en/messages.json`**

Replace the `emptyStateMessage` block:

```json
  "emptyStateMessage": {
    "message": "No tabs playing audio in this profile",
    "description": "Message shown when no tabs are playing audio in the current profile"
  },
```

Add these new keys after `emptyStateMessage` (before `muteTab`):

```json
  "noAudioAnywhere": {
    "message": "No tabs playing audio in any profile",
    "description": "Message shown when no profiles have audio (cross-profile)"
  },
  "thisProfileSilent": {
    "message": "This profile is silent",
    "description": "Subtle line shown above 'Other profiles' section when own profile has no audio"
  },
  "otherProfilesHeader": {
    "message": "Other profiles",
    "description": "Header for the cross-profile section"
  },
  "nativeHostMissing": {
    "message": "Install the native helper to see audio across profiles",
    "description": "Banner text when native messaging host is not installed"
  },
  "installInstructions": {
    "message": "Install instructions",
    "description": "Link text for native helper install instructions"
  },
  "actionFailedToast": {
    "message": "Action failed. The other profile may be offline.",
    "description": "Toast shown when a cross-profile action fails or times out"
  },
  "profileLabelEmpty": {
    "message": "Name this profile…",
    "description": "Placeholder shown in profile header when no label is set"
  },
  "profileLabelEditAria": {
    "message": "Edit profile name",
    "description": "ARIA label for the profile header click-to-edit affordance"
  },
  "profileLabelInputAria": {
    "message": "Profile name",
    "description": "ARIA label for the profile name input in edit mode"
  },
  "profileLabelSave": {
    "message": "Save profile name",
    "description": "ARIA label for save icon in profile name edit mode"
  },
  "thisProfileSuffix": {
    "message": "(this profile)",
    "description": "Suffix shown next to own profile label in popup"
  },
```

- [ ] **Step 3: Add new i18n keys to `_locales/pt_BR/messages.json`** (ASCII only)

Replace the `emptyStateMessage` block:

```json
  "emptyStateMessage": {
    "message": "Nenhuma aba tocando audio neste perfil",
    "description": "Message shown when no tabs are playing audio in the current profile"
  },
```

Add these new keys after `emptyStateMessage`:

```json
  "noAudioAnywhere": {
    "message": "Nenhuma aba tocando audio em nenhum perfil",
    "description": "Message shown when no profiles have audio (cross-profile)"
  },
  "thisProfileSilent": {
    "message": "Este perfil esta silencioso",
    "description": "Subtle line shown above 'Other profiles' section when own profile has no audio"
  },
  "otherProfilesHeader": {
    "message": "Outros perfis",
    "description": "Header for the cross-profile section"
  },
  "nativeHostMissing": {
    "message": "Instale o helper nativo para ver audio entre perfis",
    "description": "Banner text when native messaging host is not installed"
  },
  "installInstructions": {
    "message": "Instrucoes de instalacao",
    "description": "Link text for native helper install instructions"
  },
  "actionFailedToast": {
    "message": "Acao falhou. O outro perfil pode estar offline.",
    "description": "Toast shown when a cross-profile action fails or times out"
  },
  "profileLabelEmpty": {
    "message": "Nomeie este perfil…",
    "description": "Placeholder shown in profile header when no label is set"
  },
  "profileLabelEditAria": {
    "message": "Editar nome do perfil",
    "description": "ARIA label for the profile header click-to-edit affordance"
  },
  "profileLabelInputAria": {
    "message": "Nome do perfil",
    "description": "ARIA label for the profile name input in edit mode"
  },
  "profileLabelSave": {
    "message": "Salvar nome do perfil",
    "description": "ARIA label for save icon in profile name edit mode"
  },
  "thisProfileSuffix": {
    "message": "(este perfil)",
    "description": "Suffix shown next to own profile label in popup"
  },
```

- [ ] **Step 4: Verify all three files are valid JSON**

```bash
python3 -m json.tool < manifest.json > /dev/null && echo OK
python3 -m json.tool < _locales/en/messages.json > /dev/null && echo OK
python3 -m json.tool < _locales/pt_BR/messages.json > /dev/null && echo OK
```

All three should print OK.

Verify pt_BR uses ASCII only (except the U+2026 ellipsis in `profileLabelEmpty`):

```bash
python3 -c "
import json
d = json.load(open('_locales/pt_BR/messages.json'))
for k, v in d.items():
    msg = v['message']
    for c in msg:
        if ord(c) > 127 and c != '…':
            print(f'NON-ASCII in {k}: {c!r}')
"
```

Expected: no output (no non-ASCII besides …).

- [ ] **Step 5: Manually verify extension loads**

Reload extension at `chrome://extensions`. The card should show **version 2.0.0**. No errors.

- [ ] **Step 6: Commit**

```bash
git add manifest.json _locales/en/messages.json _locales/pt_BR/messages.json
git commit -m "chore: bump to 2.0.0, add nativeMessaging+storage perms, add cross-profile i18n"
```

---

### Task 11: profile.js module — UUID and label management

**Files:**
- Create: `profile.js`

This module is loaded into the service worker via `importScripts`. It exposes top-level functions (no module system in MV3 SW with `importScripts`).

- [ ] **Step 1: Implement profile.js**

Create `profile.js` at the repo root:

```js
async function getOrCreateProfileUuid() {
  const stored = await chrome.storage.local.get('profileUuid');
  if (typeof stored.profileUuid === 'string' && stored.profileUuid.length > 0) {
    return stored.profileUuid;
  }
  const newUuid = crypto.randomUUID();
  await chrome.storage.local.set({ profileUuid: newUuid });
  return newUuid;
}

async function getProfileLabel() {
  const stored = await chrome.storage.local.get('profileLabel');
  if (typeof stored.profileLabel !== 'string') return '';
  return stored.profileLabel.trim();
}

async function setProfileLabel(label) {
  const trimmed = (label ?? '').trim().slice(0, 30);
  if (trimmed.length === 0) {
    await chrome.storage.local.remove('profileLabel');
    return '';
  }
  await chrome.storage.local.set({ profileLabel: trimmed });
  return trimmed;
}
```

- [ ] **Step 2: Manually verify**

This module is exercised in Task 16 when wired into the service worker. For now, just confirm it parses as valid JS:

```bash
node --check profile.js
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add profile.js
git commit -m "feat(ext): profile UUID and label storage helpers"
```

---

### Task 12: host-connection.js module — NM connect/reconnect

**Files:**
- Create: `host-connection.js`

This module owns the persistent NM connection. Handles connect, reconnect with exponential backoff, send, and dispatch of incoming messages.

- [ ] **Step 1: Implement host-connection.js**

Create `host-connection.js` at the repo root:

```js
const NATIVE_HOST_NAME = 'com.fgregori.audio_tab_finder';

const _hostState = {
  port: null,
  connected: false,
  reconnectMs: 1000,
  pending: new Map(), // request_id -> { resolve, reject, timeoutId }
  onMessage: null,    // callback(msg) for unsolicited pushes (action_request)
  onConnectionChange: null, // callback(connected: boolean)
};

const HOST_REQUEST_TIMEOUT_MS = 3000;
const HOST_MAX_BACKOFF_MS = 60_000;
const HOST_BACKOFF_RESET_MS = 30_000;

function isHostConnected() {
  return _hostState.connected;
}

function setHostMessageHandler(fn) {
  _hostState.onMessage = fn;
}

function setHostConnectionChangeHandler(fn) {
  _hostState.onConnectionChange = fn;
}

async function connectToHost() {
  if (_hostState.port) return _hostState.port;
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST_NAME);
    _hostState.port = port;
    _hostState.connected = true;
    if (_hostState.onConnectionChange) _hostState.onConnectionChange(true);

    port.onMessage.addListener(handleIncomingMessage);
    port.onDisconnect.addListener(handleDisconnect);

    setTimeout(() => {
      if (_hostState.connected) _hostState.reconnectMs = 1000;
    }, HOST_BACKOFF_RESET_MS);

    return port;
  } catch (e) {
    handleDisconnect();
    throw e;
  }
}

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

function handleDisconnect() {
  _hostState.port = null;
  _hostState.connected = false;
  if (_hostState.onConnectionChange) _hostState.onConnectionChange(false);

  for (const { reject, timeoutId } of _hostState.pending.values()) {
    clearTimeout(timeoutId);
    reject(new Error('host disconnected'));
  }
  _hostState.pending.clear();

  const delay = _hostState.reconnectMs;
  _hostState.reconnectMs = Math.min(delay * 2, HOST_MAX_BACKOFF_MS);
  setTimeout(() => {
    connectToHost().catch(() => { /* will retry via the next disconnect */ });
  }, delay);
}

function sendToHost(message) {
  return new Promise((resolve, reject) => {
    if (!_hostState.connected || !_hostState.port) {
      reject(new Error('host not connected'));
      return;
    }
    const requestId = crypto.randomUUID();
    const messageWithId = { ...message, request_id: requestId };

    const timeoutId = setTimeout(() => {
      _hostState.pending.delete(requestId);
      reject(new Error('host request timeout'));
    }, HOST_REQUEST_TIMEOUT_MS);

    _hostState.pending.set(requestId, { resolve, reject, timeoutId });

    try {
      _hostState.port.postMessage(messageWithId);
    } catch (e) {
      clearTimeout(timeoutId);
      _hostState.pending.delete(requestId);
      reject(e);
    }
  });
}

function sendToHostFireAndForget(message) {
  if (!_hostState.connected || !_hostState.port) return;
  try {
    _hostState.port.postMessage(message);
  } catch (e) {
    // swallow; will reconnect on next attempt
  }
}
```

- [ ] **Step 2: Manually verify it parses**

```bash
node --check host-connection.js
```

Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add host-connection.js
git commit -m "feat(ext): native messaging connection module with reconnect and request/response"
```

---

### Task 13: state-sync.js module — audio detection and heartbeat

**Files:**
- Create: `state-sync.js`

This module watches `chrome.tabs` events for audio changes and sends `update_state` messages to the host. Also handles the periodic heartbeat.

- [ ] **Step 1: Implement state-sync.js**

Create `state-sync.js` at the repo root:

```js
const HEARTBEAT_INTERVAL_MS = 20_000;

let _stateSyncProfileUuid = null;
let _stateSyncHeartbeatHandle = null;

function setupStateSync(profileUuid) {
  _stateSyncProfileUuid = profileUuid;

  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.audible !== undefined || changeInfo.mutedInfo !== undefined) {
      sendCurrentState();
    }
  });

  chrome.tabs.onRemoved.addListener(() => sendCurrentState());

  startHeartbeat();
  sendCurrentState();
}

function startHeartbeat() {
  if (_stateSyncHeartbeatHandle !== null) return;
  _stateSyncHeartbeatHandle = setInterval(() => {
    sendCurrentState();
  }, HEARTBEAT_INTERVAL_MS);
}

async function sendCurrentState() {
  if (!isHostConnected() || _stateSyncProfileUuid === null) return;
  try {
    const tabs = await chrome.tabs.query({ audible: true });
    const label = await getProfileLabel();
    const payload = {
      type: 'update_state',
      label,
      tabs: tabs.map((t) => ({
        tab_id: t.id,
        window_id: t.windowId,
        title: t.title || '',
        url: t.url || '',
        favicon_url: t.favIconUrl || '',
        muted: !!(t.mutedInfo && t.mutedInfo.muted),
      })),
    };
    await sendToHost(payload);
  } catch (e) {
    // host disconnected or timed out — heartbeat will retry next tick
  }
}

async function sendInitialHello() {
  if (_stateSyncProfileUuid === null) return;
  const label = await getProfileLabel();
  await sendToHost({
    type: 'hello',
    profile_uuid: _stateSyncProfileUuid,
    label,
  });
}
```

- [ ] **Step 2: Verify it parses**

```bash
node --check state-sync.js
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add state-sync.js
git commit -m "feat(ext): state sync module with audio detection and 20s heartbeat"
```

---

### Task 14: action-handler.js module — execute pushed actions

**Files:**
- Create: `action-handler.js`

When the host pushes an `action_request` message, this module executes it via Chrome APIs and reports the result back.

- [ ] **Step 1: Implement action-handler.js**

Create `action-handler.js` at the repo root:

```js
async function handleActionRequest(msg) {
  if (!msg || msg.type !== 'action_request') return;

  let success = false;
  let errorMessage = '';

  try {
    switch (msg.action) {
      case 'mute':
        await chrome.tabs.update(msg.target_tab_id, { muted: true });
        success = true;
        break;
      case 'unmute':
        await chrome.tabs.update(msg.target_tab_id, { muted: false });
        success = true;
        break;
      case 'close':
        await chrome.tabs.remove(msg.target_tab_id);
        success = true;
        break;
      case 'activate':
        await chrome.tabs.update(msg.target_tab_id, { active: true });
        if (msg.target_window_id) {
          await chrome.windows.update(msg.target_window_id, { focused: true });
        }
        success = true;
        break;
      default:
        errorMessage = 'unknown action: ' + msg.action;
    }
  } catch (e) {
    errorMessage = (e && e.message) || String(e);
  }

  sendToHostFireAndForget({
    type: 'action_result',
    action_id: msg.action_id,
    success,
    error: errorMessage || undefined,
  });
}
```

- [ ] **Step 2: Verify it parses**

```bash
node --check action-handler.js
```

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add action-handler.js
git commit -m "feat(ext): action handler executes pushed mute/close/activate via chrome.tabs APIs"
```

---

### Task 15: popup-bridge.js module — handle popup messages

**Files:**
- Create: `popup-bridge.js`

The popup talks to the SW via `chrome.runtime.sendMessage`. This module handles those messages and forwards them to the host (or returns local data).

- [ ] **Step 1: Implement popup-bridge.js**

Create `popup-bridge.js` at the repo root:

```js
function setupPopupBridge() {
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    handlePopupMessage(msg).then(sendResponse).catch((e) => {
      sendResponse({ ok: false, error: (e && e.message) || String(e) });
    });
    return true; // keep channel open for async response
  });
}

async function handlePopupMessage(msg) {
  switch (msg && msg.type) {
    case 'get_aggregate':
      return await handleGetAggregate();
    case 'send_action':
      return await handleSendAction(msg);
    case 'update_label':
      return await handleUpdateLabel(msg);
    default:
      return { ok: false, error: 'unknown popup message type' };
  }
}

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

async function handleSendAction(msg) {
  if (!isHostConnected()) {
    return { ok: false, error: 'host not connected' };
  }
  try {
    const resp = await sendToHost({
      type: 'send_action',
      target_profile_uuid: msg.target_profile_uuid,
      action: msg.action,
      target_tab_id: msg.target_tab_id,
      target_window_id: msg.target_window_id,
    });
    return { ok: true, action_id: resp.action_id };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function handleUpdateLabel(msg) {
  const saved = await setProfileLabel(msg.label);
  await sendCurrentState(); // push fresh state with new label
  return { ok: true, label: saved };
}

function formatTab(tab) {
  return {
    tab_id: tab.id,
    window_id: tab.windowId,
    title: tab.title || '',
    url: tab.url || '',
    favicon_url: tab.favIconUrl || '',
    muted: !!(tab.mutedInfo && tab.mutedInfo.muted),
  };
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
git commit -m "feat(ext): popup-bridge module for popup-to-SW messaging"
```

---

### Task 16: background.js — wire up service worker

**Files:**
- Modify: `background.js` (full rewrite)

This is the SW entry point. It loads all modules via `importScripts` and wires the lifecycle.

- [ ] **Step 1: Replace background.js**

Replace the entire content of `background.js` with:

```js
importScripts(
  'profile.js',
  'host-connection.js',
  'state-sync.js',
  'action-handler.js',
  'popup-bridge.js'
);

chrome.runtime.onStartup.addListener(initialize);
chrome.runtime.onInstalled.addListener(initialize);

setupPopupBridge();

setHostMessageHandler((msg) => {
  if (msg && msg.type === 'action_request') {
    handleActionRequest(msg);
  }
});

setHostConnectionChangeHandler(async (connected) => {
  if (connected) {
    await sendInitialHello();
    sendCurrentState();
  }
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.audible !== undefined) {
    updateBadge();
  }
});

chrome.tabs.onRemoved.addListener(updateBadge);

async function initialize() {
  const profileUuid = await getOrCreateProfileUuid();
  setupStateSync(profileUuid);
  updateBadge();
  try {
    await connectToHost();
  } catch (e) {
    // host not installed; popup will degrade. Reconnect attempts continue.
  }
}

async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({ audible: true });
    const count = tabs.length;
    if (count > 0) {
      chrome.action.setBadgeText({ text: count.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#4ade80' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (e) {
    // ignore
  }
}

initialize();
```

- [ ] **Step 2: Verify it parses**

```bash
node --check background.js
```

Expected: no output.

- [ ] **Step 3: Manually verify SW loads without error**

Reload extension at `chrome://extensions`. Click the "service worker" link to open DevTools for the SW. Confirm:
- No syntax errors in console
- Console shows "host not connected" or similar (host not installed yet — expected)

In DevTools console of the SW:

```js
await getOrCreateProfileUuid()
// Expected: a UUID string like "7c4f2a8b-..."

await chrome.storage.local.get('profileUuid')
// Expected: {profileUuid: "7c4f2a8b-..."}
```

- [ ] **Step 4: Commit**

```bash
git add background.js
git commit -m "feat(ext): rewrite background.js as modular service worker entry point"
```

---

### Task 17: First end-to-end smoke test (single profile)

**Files:** None (verification only)

Now we've built the host and the extension's SW side. Let's verify they connect successfully before continuing with popup work.

- [ ] **Step 1: Build the host (if not already built)**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder/native-host
make build
```

- [ ] **Step 2: Get the extension ID**

Open `chrome://extensions`. The extension card shows an ID like `abcdefghijklmnopabcdefghijklmnop` (32 chars, a-p only). Copy it.

- [ ] **Step 3: Install the host**

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder
./scripts/install-local.sh
# paste the extension ID when prompted
```

Expected output:

```
Installed. Reload extension to connect.
Done. Reload the extension in chrome://extensions.
```

Verify the manifest was written:

```bash
cat "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.fgregori.audio_tab_finder.json"
```

Should show:

```json
{
  "name": "com.fgregori.audio_tab_finder",
  "description": "Audio Tab Finder native helper",
  "path": "/usr/local/bin/audio-tab-finder-host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://YOUR-ID-HERE/"
  ]
}
```

- [ ] **Step 4: Reload the extension and verify connection**

`chrome://extensions` → reload icon on the extension card → click "service worker" link.

In the SW DevTools console:

```js
isHostConnected()
// Expected: true
```

Open the host log:

```bash
tail -f "$HOME/Library/Application Support/AudioTabFinder/logs/host.log"
```

Expected lines (timestamps will vary):
```
2026-04-25T... [INFO] native host started, pid=12345
```

In the SW console:

```js
await sendToHost({type: 'get_aggregate'})
// Expected: {type: 'aggregate', request_id: '...', profiles: [{profile_uuid: '...', label: '', is_self: true, tabs: []}]}
```

Open a tab playing audio (e.g., a YouTube video). Wait a second. Then re-run:

```js
await sendToHost({type: 'get_aggregate'})
// Expected: profiles[0].tabs has 1 entry for the YouTube tab
```

Check the state file directly:

```bash
ls "$HOME/Library/Application Support/AudioTabFinder/state/"
# Expected: one .json file (your profile UUID)

cat "$HOME/Library/Application Support/AudioTabFinder/state/"*.json
# Expected: JSON with the audio tab listed
```

- [ ] **Step 5: Verify reconnection**

In a new terminal:

```bash
pkill audio-tab-finder-host
```

Within ~5 seconds, the SW should reconnect (host process spawned again by Chrome). Check:

```js
isHostConnected()
// Expected: true (after a brief moment of false during reconnect)
```

Verify the log shows multiple "native host started" entries.

- [ ] **Step 6: No commit needed** (verification only)

If everything works, proceed to Task 18. If anything fails:
- Check `host.log` for errors
- Check the SW console for thrown errors
- Check that the manifest has the right Extension ID
- Check `chmod +x` on the binary

---

### Task 18: popup.html and popup.css

**Files:**
- Modify: `popup.html`
- Modify: `popup.css`

- [ ] **Step 1: Replace popup.html**

Replace the entire content of `popup.html` with:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Audio Tab Finder</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <div class="container" role="main" aria-label="Audio Tab Finder">
    <h1 id="popup-title"></h1>
    <div id="profile-header" class="profile-header" aria-live="polite"></div>
    <div id="host-banner" class="host-banner hidden" role="status"></div>
    <div id="own-tabs-section" class="tabs-section">
      <div id="own-tabs-list" role="list" aria-label="Tabs playing audio in this profile"></div>
      <div id="own-empty" class="own-empty hidden"></div>
    </div>
    <div id="other-profiles-section" class="other-section hidden">
      <div class="section-divider" id="other-profiles-header"></div>
      <div id="other-profiles-list"></div>
    </div>
    <div id="empty-state" class="empty-state hidden" role="status" aria-live="polite">
      <p id="empty-message"></p>
    </div>
    <div id="toast" class="toast hidden" role="alert" aria-live="assertive"></div>
  </div>
  <script src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Replace popup.css**

Replace the entire content of `popup.css` with:

```css
* { margin: 0; padding: 0; box-sizing: border-box; }
html { background: transparent; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  min-width: 340px;
  max-width: 420px;
  background: transparent;
  color: #eaeaea;
}

.container {
  padding: 16px;
  background-color: #1a1a2e;
  overflow: hidden;
}

h1 {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 12px;
  color: #fff;
  display: flex;
  align-items: center;
  gap: 8px;
}

h1::before {
  content: '';
  display: inline-block;
  width: 8px;
  height: 8px;
  background-color: #4ade80;
  border-radius: 50%;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

/* Profile header */
.profile-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background-color: #16213e;
  border-radius: 8px;
  margin-bottom: 12px;
  min-height: 36px;
}
.profile-header__icon { width: 16px; height: 16px; flex-shrink: 0; color: #888;
  display: flex; align-items: center; justify-content: center; }
.profile-header__icon svg { width: 16px; height: 16px; fill: currentColor; }
.profile-header__text {
  flex: 1; min-width: 0; font-size: 13px; font-weight: 500; color: #eaeaea;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: pointer;
}
.profile-header__text--empty { color: #888; font-style: italic; font-weight: 400; }
.profile-header__suffix { color: #888; font-size: 12px; font-weight: 400; margin-left: 4px; }
.profile-header__edit-btn, .profile-header__save-btn {
  width: 24px; height: 24px; border: none; background-color: transparent; color: #888;
  cursor: pointer; border-radius: 4px; display: flex; align-items: center;
  justify-content: center; transition: all 0.2s ease; flex-shrink: 0; padding: 0;
}
.profile-header__edit-btn:hover, .profile-header__save-btn:hover { background-color: #1f4068; color: #fff; }
.profile-header__edit-btn svg, .profile-header__save-btn svg { width: 14px; height: 14px; fill: currentColor; }
.profile-header__edit-btn:focus-visible, .profile-header__save-btn:focus-visible {
  outline: 2px solid #4ade80; outline-offset: 2px;
}
.profile-header__text:focus-visible {
  outline: 2px solid #4ade80; outline-offset: 2px; border-radius: 2px;
}
.profile-header__input {
  flex: 1; min-width: 0; font-family: inherit; font-size: 13px; font-weight: 500;
  color: #fff; background-color: #0f1626; border: 1px solid #1f4068;
  border-radius: 4px; padding: 4px 6px; outline: none;
}
.profile-header__input:focus { border-color: #4ade80; }

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

/* Section divider */
.section-divider {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: #888;
  letter-spacing: 0.5px;
  margin: 16px 0 8px 0;
  padding: 0 4px;
}

/* Sub-profile heading inside other profiles */
.other-profile-heading {
  font-size: 12px;
  font-weight: 500;
  color: #b0b0b0;
  margin: 8px 0 4px 4px;
}

/* Own profile silent line */
.own-empty {
  text-align: center;
  padding: 8px 16px;
  color: #888;
  font-size: 12px;
  font-style: italic;
}

/* Tab item — shared between own and cross-profile */
.tab-item {
  display: flex; align-items: center;
  padding: 10px 12px;
  background-color: #16213e;
  border-radius: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  transition: background-color 0.2s ease;
}
.tab-item:hover { background-color: #1f4068; }
.tab-item:last-child { margin-bottom: 0; }
.tab-item--cross { background-color: #14203a; }
.tab-item--cross:hover { background-color: #1d3859; }

.tab-favicon { width: 20px; height: 20px; margin-right: 12px; border-radius: 4px; flex-shrink: 0; }
.tab-info { flex: 1; min-width: 0; margin-right: 8px; }
.tab-title { font-size: 14px; font-weight: 500; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; color: #fff; }
.tab-url { font-size: 11px; color: #888; white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; margin-top: 2px; }

.mute-btn, .close-btn {
  width: 28px; height: 28px; border: none; background-color: transparent; color: #888;
  cursor: pointer; border-radius: 6px; display: flex; align-items: center;
  justify-content: center; transition: all 0.2s ease; flex-shrink: 0;
}
.mute-btn { margin-right: 4px; }
.mute-btn:hover { background-color: #3b82f6; color: #fff; }
.mute-btn svg { width: 16px; height: 16px; fill: currentColor; }
.close-btn:hover { background-color: #e74c3c; color: #fff; }
.close-btn svg { width: 16px; height: 16px; }

.empty-state { text-align: center; padding: 32px 16px; color: #888; }
.empty-state p { font-size: 14px; }

.audio-indicator { width: 16px; height: 16px; margin-right: 8px; flex-shrink: 0; }
.audio-indicator svg { width: 16px; height: 16px; fill: #4ade80; }
.audio-indicator.muted svg { fill: #888; }

.hidden { display: none; }
.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}

/* Focus styles */
.tab-item:focus { outline: 2px solid #4ade80; outline-offset: -2px; background-color: #1f4068; }
.tab-item:focus-visible { outline: 2px solid #4ade80; outline-offset: -2px; }
.mute-btn:focus, .close-btn:focus { outline: 2px solid #4ade80; outline-offset: 2px; }
.mute-btn:focus-visible, .close-btn:focus-visible { outline: 2px solid #4ade80; outline-offset: 2px; }

/* Toast */
.toast {
  position: fixed;
  bottom: 12px;
  left: 12px;
  right: 12px;
  background-color: #4a1010;
  color: #ffd6d6;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  border-left: 3px solid #e74c3c;
  z-index: 100;
}

@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; transition: none !important; }
}
```

- [ ] **Step 3: Manually verify HTML/CSS load**

Reload extension. Open the popup. You should see the title and an empty container. Functional rendering happens after Task 19.

- [ ] **Step 4: Commit**

```bash
git add popup.html popup.css
git commit -m "feat(ext): popup HTML scaffold + CSS for cross-profile sections"
```

---

### Task 19: popup.js — render skeleton + own-profile rendering

**Files:**
- Modify: `popup.js` (full rewrite, in two tasks)

This task creates the popup skeleton: it queries the SW for aggregate state, renders the profile header (display mode only), and renders own-profile tabs. Cross-profile rendering and edit mode come in subsequent tasks.

- [ ] **Step 1: Replace popup.js**

Replace the entire content of `popup.js` with:

```js
document.addEventListener('DOMContentLoaded', async () => {
  initializeI18n();
  await loadAndRender();
});

function initializeI18n() {
  document.getElementById('popup-title').textContent = chrome.i18n.getMessage('popupTitle');
  document.getElementById('empty-message').textContent = chrome.i18n.getMessage('noAudioAnywhere');
  document.getElementById('other-profiles-header').textContent = chrome.i18n.getMessage('otherProfilesHeader');
  document.getElementById('own-empty').textContent = chrome.i18n.getMessage('thisProfileSilent');
}

async function loadAndRender() {
  const resp = await chrome.runtime.sendMessage({ type: 'get_aggregate' });
  if (!resp || !resp.ok) {
    showToast((resp && resp.error) || 'failed to load');
    return;
  }
  renderHostBanner(resp.hostInstalled);
  renderProfileHeader(resp.profiles);
  renderOwnProfileTabs(resp.profiles);
  renderOtherProfiles(resp.profiles);
  renderEmptyState(resp.profiles);
}

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

function getOwnProfile(profiles) {
  return profiles.find((p) => p.is_self) || null;
}

function getOtherProfiles(profiles) {
  return profiles.filter((p) => !p.is_self);
}

function renderProfileHeader(profiles) {
  const header = document.getElementById('profile-header');
  header.innerHTML = '';
  const own = getOwnProfile(profiles);
  const label = (own && own.label) || '';

  const icon = document.createElement('span');
  icon.className = 'profile-header__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
    </svg>
  `;

  const text = document.createElement('span');
  text.className = 'profile-header__text';
  text.tabIndex = 0;
  text.setAttribute('role', 'button');
  text.setAttribute('aria-label', chrome.i18n.getMessage('profileLabelEditAria'));
  if (label) {
    text.textContent = label;
  } else {
    text.textContent = chrome.i18n.getMessage('profileLabelEmpty');
    text.classList.add('profile-header__text--empty');
  }

  const suffix = document.createElement('span');
  suffix.className = 'profile-header__suffix';
  suffix.textContent = chrome.i18n.getMessage('thisProfileSuffix');

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'profile-header__edit-btn';
  editBtn.setAttribute('aria-label', chrome.i18n.getMessage('profileLabelEditAria'));
  editBtn.title = chrome.i18n.getMessage('profileLabelEditAria');
  editBtn.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
    </svg>
  `;

  header.appendChild(icon);
  header.appendChild(text);
  header.appendChild(suffix);
  header.appendChild(editBtn);
}

function renderOwnProfileTabs(profiles) {
  const list = document.getElementById('own-tabs-list');
  const empty = document.getElementById('own-empty');
  list.innerHTML = '';
  const own = getOwnProfile(profiles);
  const tabs = (own && own.tabs) || [];

  if (tabs.length === 0) {
    list.classList.add('hidden');
    const others = getOtherProfiles(profiles);
    const anyOtherHasTabs = others.some((p) => p.tabs && p.tabs.length > 0);
    if (anyOtherHasTabs) empty.classList.remove('hidden');
    else empty.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  list.classList.remove('hidden');
  tabs.forEach((tab) => {
    list.appendChild(createTabElement(tab, /*isOwnProfile*/ true, /*ownerProfileUuid*/ null));
  });
}

function renderOtherProfiles(profiles) {
  const section = document.getElementById('other-profiles-section');
  const list = document.getElementById('other-profiles-list');
  list.innerHTML = '';

  const others = getOtherProfiles(profiles).filter((p) => p.tabs && p.tabs.length > 0);
  if (others.length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  others.forEach((p) => {
    const heading = document.createElement('div');
    heading.className = 'other-profile-heading';
    heading.textContent = p.label || chrome.i18n.getMessage('profileLabelEmpty');
    list.appendChild(heading);
    p.tabs.forEach((tab) => {
      list.appendChild(createTabElement(tab, /*isOwnProfile*/ false, /*ownerProfileUuid*/ p.profile_uuid));
    });
  });
}

function renderEmptyState(profiles) {
  const empty = document.getElementById('empty-state');
  const own = getOwnProfile(profiles);
  const others = getOtherProfiles(profiles);
  const ownHasTabs = own && own.tabs && own.tabs.length > 0;
  const othersHaveTabs = others.some((p) => p.tabs && p.tabs.length > 0);
  if (!ownHasTabs && !othersHaveTabs) {
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
  }
}

function createTabElement(tab, isOwnProfile, ownerProfileUuid) {
  const item = document.createElement('div');
  item.className = 'tab-item' + (isOwnProfile ? '' : ' tab-item--cross');
  item.setAttribute('role', 'listitem');
  item.tabIndex = 0;
  item.setAttribute('data-tab-id', tab.tab_id);
  if (!isOwnProfile && ownerProfileUuid) {
    item.setAttribute('data-owner-profile', ownerProfileUuid);
  }

  const favicon = document.createElement('img');
  favicon.className = 'tab-favicon';
  favicon.src = tab.favicon_url || 'icons/icon16.png';
  favicon.alt = '';
  favicon.setAttribute('aria-hidden', 'true');
  favicon.onerror = () => { favicon.src = 'icons/icon16.png'; };

  const audioIndicator = document.createElement('div');
  audioIndicator.className = 'audio-indicator' + (tab.muted ? ' muted' : '');
  audioIndicator.setAttribute('aria-hidden', 'true');
  audioIndicator.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
    </svg>
  `;

  const info = document.createElement('div');
  info.className = 'tab-info';
  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = tab.title || chrome.i18n.getMessage('untitled');
  title.title = tab.title || '';
  const url = document.createElement('div');
  url.className = 'tab-url';
  url.textContent = formatUrl(tab.url);
  url.title = tab.url || '';
  info.appendChild(title);
  info.appendChild(url);

  const muteBtn = createMuteButton(tab, isOwnProfile, ownerProfileUuid, item, audioIndicator);
  const closeBtn = createCloseButton(tab, isOwnProfile, ownerProfileUuid, item);

  item.appendChild(favicon);
  item.appendChild(audioIndicator);
  item.appendChild(info);
  item.appendChild(muteBtn);
  item.appendChild(closeBtn);

  item.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    activateTab(tab, isOwnProfile, ownerProfileUuid);
  });

  return item;
}

function createMuteButton(tab, isOwnProfile, ownerProfileUuid, itemEl, audioIndicator) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mute-btn';
  btn.setAttribute('aria-label', tab.muted ? chrome.i18n.getMessage('unmuteTab') : chrome.i18n.getMessage('muteTab'));
  btn.title = btn.getAttribute('aria-label');
  setMuteIcon(btn, tab.muted);

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const newMuted = !tab.muted;
    setMuteIcon(btn, newMuted);
    if (newMuted) audioIndicator.classList.add('muted');
    else audioIndicator.classList.remove('muted');
    btn.setAttribute('aria-label', newMuted ? chrome.i18n.getMessage('unmuteTab') : chrome.i18n.getMessage('muteTab'));
    btn.title = btn.getAttribute('aria-label');
    tab.muted = newMuted;

    try {
      if (isOwnProfile) {
        await chrome.tabs.update(tab.tab_id, { muted: newMuted });
      } else {
        const resp = await chrome.runtime.sendMessage({
          type: 'send_action',
          target_profile_uuid: ownerProfileUuid,
          action: newMuted ? 'mute' : 'unmute',
          target_tab_id: tab.tab_id,
          target_window_id: tab.window_id,
        });
        if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'send_action failed');
      }
    } catch (err) {
      // revert optimistic UI
      tab.muted = !newMuted;
      setMuteIcon(btn, tab.muted);
      if (tab.muted) audioIndicator.classList.add('muted');
      else audioIndicator.classList.remove('muted');
      btn.setAttribute('aria-label', tab.muted ? chrome.i18n.getMessage('unmuteTab') : chrome.i18n.getMessage('muteTab'));
      showToast(chrome.i18n.getMessage('actionFailedToast'));
    }
  });
  return btn;
}

function createCloseButton(tab, isOwnProfile, ownerProfileUuid, itemEl) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'close-btn';
  btn.setAttribute('aria-label', chrome.i18n.getMessage('closeTab'));
  btn.title = chrome.i18n.getMessage('closeTab');
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const next = itemEl.nextElementSibling || itemEl.previousElementSibling;
    itemEl.remove();
    if (next && next.classList.contains('tab-item')) next.focus();
    try {
      if (isOwnProfile) {
        await chrome.tabs.remove(tab.tab_id);
      } else {
        const resp = await chrome.runtime.sendMessage({
          type: 'send_action',
          target_profile_uuid: ownerProfileUuid,
          action: 'close',
          target_tab_id: tab.tab_id,
          target_window_id: tab.window_id,
        });
        if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'send_action failed');
      }
    } catch (err) {
      showToast(chrome.i18n.getMessage('actionFailedToast'));
    }
  });
  return btn;
}

function setMuteIcon(btn, isMuted) {
  if (isMuted) {
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
      </svg>
    `;
  } else {
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
      </svg>
    `;
  }
}

async function activateTab(tab, isOwnProfile, ownerProfileUuid) {
  try {
    if (isOwnProfile) {
      await chrome.tabs.update(tab.tab_id, { active: true });
      await chrome.windows.update(tab.window_id, { focused: true });
    } else {
      await chrome.runtime.sendMessage({
        type: 'send_action',
        target_profile_uuid: ownerProfileUuid,
        action: 'activate',
        target_tab_id: tab.tab_id,
        target_window_id: tab.window_id,
      });
    }
    window.close();
  } catch (e) {
    showToast(chrome.i18n.getMessage('actionFailedToast'));
  }
}

function formatUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url || '';
  }
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}
```

- [ ] **Step 2: Verify it parses**

```bash
node --check popup.js
```

Expected: no output.

- [ ] **Step 3: Manually verify own-profile rendering**

Reload extension. Open a tab playing audio (YouTube). Click the extension icon.

Expected:
- Profile header at top with placeholder "Name this profile…" (italic gray) + "(this profile)" suffix + pencil edit icon
- The audio tab listed below
- No "Other profiles" section (we're alone)
- No empty-state message
- No host-missing banner (host is connected)

Click the audio tab → should switch to it and close popup.

Open popup again. Click mute on the tab → icon should toggle. Audio should mute.

Open popup again. Click close button → tab should close.

- [ ] **Step 4: Commit**

```bash
git add popup.js
git commit -m "feat(ext): popup rewrite with cross-profile rendering and own-profile fast path"
```

---

### Task 20: Verify cross-profile flow with two profiles

**Files:** None (verification only)

This task verifies cross-profile detection and actions end-to-end before adding edit mode and keyboard nav polish.

- [ ] **Step 1: Set up second profile**

In Chrome: top-right profile picker → "Add" → create a new profile (e.g., "Profile 2"). A new Chrome window opens for that profile.

In the new profile's window: `chrome://extensions` → Developer mode on → Load unpacked → select the same repo root.

Note the new profile's Extension ID. **It may differ from the first profile's** (Chrome generates the ID from the public key, but for unpacked extensions in different profiles, IDs typically match if loaded from the same path — verify).

If the IDs differ, you must re-run the install with the new ID, but this would overwrite the manifest. For Phase 1 local testing, simplest path is:

```bash
cd /Users/fgregori/Projects/personal/audio-tab-finder/native-host
make install EXT_ID=ID_FROM_FIRST_PROFILE
```

Then open the NM manifest and add the second profile's ID:

```bash
nano "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.fgregori.audio_tab_finder.json"
```

Edit `allowed_origins` to include both:

```json
"allowed_origins": [
  "chrome-extension://FIRST-PROFILE-ID/",
  "chrome-extension://SECOND-PROFILE-ID/"
]
```

- [ ] **Step 2: Reload extension in BOTH profiles**

Both SWs should connect. Verify in each profile's `chrome://extensions` → service worker console:

```js
isHostConnected()  // expected: true
```

- [ ] **Step 3: Verify state files**

```bash
ls "$HOME/Library/Application Support/AudioTabFinder/state/"
# Expected: 2 .json files (one per profile UUID)
```

- [ ] **Step 4: Test detection**

Play YouTube audio in Profile 2. Wait 2 seconds. Open popup in Profile 1.

Expected:
- Own profile section: empty + "This profile is silent" line
- "OTHER PROFILES" divider
- Profile 2's name (or "Name this profile…" if not labeled) + the YouTube tab listed below

- [ ] **Step 5: Test cross-profile actions**

In Profile 1's popup, click the mute button on the cross-profile tab.
- Expected: icon updates immediately (optimistic). Audio in Profile 2 stops within ~500ms.
- Reopen popup → mute icon stays in muted state.

Click unmute → audio resumes.

Click close on the cross-profile tab → tab closes in Profile 2 within ~500ms.

Open another audio tab in Profile 2. From Profile 1's popup, click on the tab item itself (not a button). Expected: Profile 2's window comes forward, its tab becomes active, Profile 1's popup closes.

- [ ] **Step 6: Test offline behavior**

Close Profile 2's Chrome window entirely. Wait 60 seconds. In Profile 1, open popup.

Expected: "Other profiles" section is gone. Empty state message shows if Profile 1 has no audio.

Reopen Profile 2 and a YouTube tab. Within ~30 seconds, Profile 1's popup should show Profile 2 again (next time you open it).

- [ ] **Step 7: No commit needed**

If all the above works, proceed to Task 21. Document any issues for fix.

---

### Task 21: popup.js — keyboard navigation across sections

**Files:**
- Modify: `popup.js`

Add keyboard navigation that flows across own-profile and cross-profile sections, skipping non-interactive headers.

- [ ] **Step 1: Add keyboard nav setup**

At the bottom of `popup.js` (after `showToast`), append:

```js
function setupKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;

    const items = Array.from(document.querySelectorAll('.tab-item'));
    if (items.length === 0) return;

    const focused = items.findIndex((el) => el.contains(document.activeElement) || el === document.activeElement);

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (focused === -1) items[0].focus();
        else if (focused < items.length - 1) items[focused + 1].focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (focused > 0) items[focused - 1].focus();
        break;
      case 'Home':
        e.preventDefault();
        items[0].focus();
        break;
      case 'End':
        e.preventDefault();
        items[items.length - 1].focus();
        break;
      case 'Enter':
      case ' ':
        if (focused !== -1 && document.activeElement === items[focused]) {
          e.preventDefault();
          items[focused].click();
        }
        break;
      case 'm':
      case 'M':
        if (focused !== -1) {
          const muteBtn = items[focused].querySelector('.mute-btn');
          if (muteBtn) muteBtn.click();
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (focused !== -1) {
          e.preventDefault();
          const closeBtn = items[focused].querySelector('.close-btn');
          if (closeBtn) closeBtn.click();
        }
        break;
    }
  });
}
```

Update the `DOMContentLoaded` handler at the top to also call `setupKeyboardNavigation()`:

```js
document.addEventListener('DOMContentLoaded', async () => {
  initializeI18n();
  await loadAndRender();
  setupKeyboardNavigation();
});
```

- [ ] **Step 2: Verify it parses**

```bash
node --check popup.js
```

Expected: no output.

- [ ] **Step 3: Manually verify keyboard nav**

Reload extension. Open popup with at least one own-profile tab and one cross-profile tab.

- Press **Tab** → focus moves to profile text → edit button → first tab → ...
- Press **↓** repeatedly → focus moves down through all tabs (across both sections)
- Press **↑** → moves back up
- Press **Home** → first tab
- Press **End** → last tab
- Focus a tab, press **m** → mute toggles (works for both own and cross-profile)
- Focus a tab, press **Backspace** → close (works for both)
- Press **Enter** on a focused tab → switches to that tab

- [ ] **Step 4: Commit**

```bash
git add popup.js
git commit -m "feat(ext): keyboard navigation across own and cross-profile sections"
```

---

### Task 22: popup.js — profile label inline edit

**Files:**
- Modify: `popup.js`

Add the click-to-edit profile label flow (carry over the v1 light pattern: Enter saves, Esc cancels, mousedown on save icon avoids blur race).

- [ ] **Step 1: Add edit handlers to renderProfileHeader**

Replace the existing `renderProfileHeader` function in `popup.js` with the expanded version below (it adds click and keydown listeners on the text and edit button):

```js
function renderProfileHeader(profiles) {
  const header = document.getElementById('profile-header');
  header.innerHTML = '';
  const own = getOwnProfile(profiles);
  const label = (own && own.label) || '';

  const icon = makeProfileHeaderIcon();

  const text = document.createElement('span');
  text.className = 'profile-header__text';
  text.tabIndex = 0;
  text.setAttribute('role', 'button');
  text.setAttribute('aria-label', chrome.i18n.getMessage('profileLabelEditAria'));
  if (label) {
    text.textContent = label;
  } else {
    text.textContent = chrome.i18n.getMessage('profileLabelEmpty');
    text.classList.add('profile-header__text--empty');
  }
  text.addEventListener('click', () => enterLabelEditMode(label));
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      enterLabelEditMode(label);
    }
  });

  const suffix = document.createElement('span');
  suffix.className = 'profile-header__suffix';
  suffix.textContent = chrome.i18n.getMessage('thisProfileSuffix');

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'profile-header__edit-btn';
  editBtn.setAttribute('aria-label', chrome.i18n.getMessage('profileLabelEditAria'));
  editBtn.title = chrome.i18n.getMessage('profileLabelEditAria');
  editBtn.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
    </svg>
  `;
  editBtn.addEventListener('click', () => enterLabelEditMode(label));

  header.appendChild(icon);
  header.appendChild(text);
  header.appendChild(suffix);
  header.appendChild(editBtn);
}

function makeProfileHeaderIcon() {
  const icon = document.createElement('span');
  icon.className = 'profile-header__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
    </svg>
  `;
  return icon;
}

function enterLabelEditMode(currentLabel) {
  const header = document.getElementById('profile-header');
  header.innerHTML = '';

  const icon = makeProfileHeaderIcon();

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'profile-header__input';
  input.maxLength = 30;
  input.value = currentLabel || '';
  input.setAttribute('aria-label', chrome.i18n.getMessage('profileLabelInputAria'));

  let committed = false;

  const commit = async () => {
    if (committed) return;
    committed = true;
    const resp = await chrome.runtime.sendMessage({ type: 'update_label', label: input.value });
    const saved = (resp && resp.ok) ? resp.label : currentLabel;
    await loadAndRender();
  };

  const cancel = () => {
    if (committed) return;
    committed = true;
    loadAndRender();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!header.contains(document.activeElement)) cancel();
    }, 0);
  });

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'profile-header__save-btn';
  saveBtn.setAttribute('aria-label', chrome.i18n.getMessage('profileLabelSave'));
  saveBtn.title = chrome.i18n.getMessage('profileLabelSave');
  saveBtn.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
    </svg>
  `;
  saveBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    commit();
  });

  header.appendChild(icon);
  header.appendChild(input);
  header.appendChild(saveBtn);

  input.focus();
  input.select();
}
```

- [ ] **Step 2: Verify it parses**

```bash
node --check popup.js
```

Expected: no output.

- [ ] **Step 3: Manually verify label editing**

Reload extension, open popup.

- Click the profile name → input appears with focus
- Type "Trabalho", press Enter → header shows "Trabalho"
- Reopen popup → label persists
- Click pencil icon → input prefilled with "Trabalho" → press Esc → no change
- Click pencil → save with empty input → header returns to "Name this profile…"
- Verify state file has updated label:

```bash
cat "$HOME/Library/Application Support/AudioTabFinder/state/"*.json | python3 -m json.tool
```

Should show `"label": "Trabalho"` (or whatever you set).

In the OTHER profile's popup, the cross-profile section heading should now say "Trabalho" for that profile.

- [ ] **Step 4: Commit**

```bash
git add popup.js
git commit -m "feat(ext): inline edit for profile label with race-safe save"
```

---

### Task 23: Final manual QA pass

**Files:** None (verification only)

Run the full QA checklist from `docs/superpowers/specs/2026-04-25-cross-profile-audio-design.md` (Manual QA checklist section). The previous tasks have exercised most items individually; this is a clean end-to-end pass.

- [ ] **Step 1: Setup checks**

- [ ] `cd native-host && make build` produces binary cleanly
- [ ] `./scripts/install-local.sh` completes (with both profile IDs in manifest)
- [ ] Both profiles' extensions show "service worker" link active in `chrome://extensions`
- [ ] `tail "$HOME/Library/Application Support/AudioTabFinder/logs/host.log"` shows recent "native host started" entries

- [ ] **Step 2: Single-profile regression**

- [ ] In one profile, popup shows audio tabs from that profile (same as v1)
- [ ] Mute/close/switch on own-profile tabs still works (fast path, no NM)
- [ ] Badge shows correct count

- [ ] **Step 3: Cross-profile detection**

- [ ] Play audio in Profile B
- [ ] Open popup in Profile A → Profile B's tab appears under "Other profiles"
- [ ] Heartbeat: state files update every ~20s while audio is playing
- [ ] Profile labels show correctly

- [ ] **Step 4: Cross-profile actions**

- [ ] Mute on B's tab from A's popup → audio stops in B in <500ms
- [ ] Unmute → audio resumes
- [ ] Close on B's tab from A's popup → tab closes in B
- [ ] Click on B's tab item → B's window comes to front, tab activates
- [ ] Optimistic UI: mute icon updates immediately

- [ ] **Step 5: Resilience**

- [ ] Close Profile B → after ~60s, B disappears from A's popup aggregate
- [ ] Reopen Profile B → reconnects automatically
- [ ] `pkill audio-tab-finder-host` → SW reconnects within ~5s (verify via `isHostConnected()` in SW console)
- [ ] Action with offline target (B closed) → 3s timeout → toast "Action failed. The other profile may be offline."

- [ ] **Step 6: Persistence**

- [ ] Profile UUID persists across Chrome restart (verify with `await chrome.storage.local.get('profileUuid')` in SW console before and after)
- [ ] Profile label persists across restart
- [ ] State files cleaned up on `make uninstall` and removed from disk

- [ ] **Step 7: No native host (degradation)**

- [ ] `cd native-host && make uninstall` → reload extension in both profiles
- [ ] Popup shows amber banner "Install the native helper to see audio across profiles"
- [ ] Mute/close/switch on own-profile tabs still works
- [ ] Reinstall via `./scripts/install-local.sh` → reload → banner disappears

- [ ] **Step 8: i18n**

- [ ] Switch Chrome to pt-BR: chrome://settings/languages → move Português (Brasil) to top → relaunch
- [ ] Reload extension. All new strings should be in pt_BR ASCII (no diacritics)
- [ ] Switch back to English

- [ ] **Step 9: Performance / leak**

- [ ] Leave Chrome open with 3 profiles for 1 hour, open popup multiple times
- [ ] In Activity Monitor, `audio-tab-finder-host` processes shouldn't grow above ~10MB each
- [ ] `ls -lh "$HOME/Library/Application Support/AudioTabFinder/logs/"` — confirm logs rotate at ~1MB

- [ ] **Step 10: Document any failures**

If any check fails, file a follow-up task with description and minimal reproduction. Do not declare done until all checks pass or are explicitly accepted as known-issues with rationale.

- [ ] **Step 11: Final commit (if any fixes were made)**

If you needed to fix anything during QA, commit those fixes individually. If no fixes, no commit needed.

---

## Done criteria

After Task 23 passes:
- All 26+ Go tests pass (`cd native-host && make test`)
- Manual QA checklist 100% green (or known issues documented)
- Both profiles can detect each other's audio
- Cross-profile mute/close/activate work with sub-second latency
- Profile labels persist across restarts
- Native host reconnect works after kill
- Graceful degradation when host is uninstalled

After Phase 1 ships locally:
- (Out of scope for this plan) Phase 2 spec for code signing, notarization, `.pkg` installer, Chrome Web Store submission
- Update `STORE_LISTING.md`, `PUBLISHING_GUIDE.md`, `README.md` for v2.0.0 launch
