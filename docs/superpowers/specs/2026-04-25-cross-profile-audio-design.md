# Cross-Profile Audio Detection — Design Spec (Phase 1)

**Date:** 2026-04-25
**Status:** Approved (pending implementation plan)
**Target version:** 2.0.0
**Phase:** 1 of 2 (Phase 2 = signing + Chrome Web Store distribution, separate spec)

## Context

Audio Tab Finder (currently v1.0.4) lists tabs playing audio in the **current Chrome profile only**. The user runs 3-4 Chrome profiles simultaneously and cannot identify which profile is playing audio without opening each profile's popup individually. The Chrome extension security model isolates profiles — `chrome.tabs.query` only sees the current profile, and there is no extension-only mechanism to share state across profiles (`chrome.storage.sync` requires same Google account in every profile and has unacceptable latency for "what is playing right now").

A prior "light" attempt (v1.1.0, abandoned) added profile labels and updated empty-state copy, but did not solve the underlying need. This spec covers the full solution: a Native Messaging Host that bridges all profile instances of the extension via shared filesystem state.

## Goal

When the user opens the popup in any Chrome profile, they should:

1. See audio tabs from **all open profiles**, grouped by profile and labeled.
2. Click a cross-profile tab to bring that profile's window forward and activate the tab.
3. Mute/unmute/close any cross-profile tab from the same popup, with sub-second latency.
4. See offline profiles disappear automatically (no stale state).

This is Phase 1 of a 2-phase project:

- **Phase 1 (this spec):** Native host + extension changes. Works locally on the user's Mac via manual install. Validates the architecture without committing to Apple Developer Program ($99/yr) or Chrome Web Store re-review.
- **Phase 2 (separate spec):** Code signing, notarization, `.pkg` installer, Chrome Web Store submission, auto-update. Pure packaging work — does not change the product.

## Non-goals (Phase 1)

- **Code signing or notarization.** Local install only. Phase 2 covers signed distribution.
- **Chrome Web Store submission.** Phase 2.
- **Cross-platform support (Windows, Linux).** Mac-only in Phase 1. Go binary compiles cross-platform; install script is Mac-specific.
- **Other browsers.** Chrome only. Other Chromium browsers (Edge, Brave, Arc) work in theory if the user manually copies the NM manifest to the right path, but not validated.
- **Live state push to popup.** Popup shows snapshot at open time. Live updates while popup is open is a possible v2.x addition.
- **System-wide audio detection (non-Chrome apps).** macOS does not expose per-process audio activity through public APIs. Different product, different tech, doesn't solve the stated problem (Chrome appears as one process to macOS regardless of profile).
- **Action history, search/filter in popup, per-tab volume control, custom global shortcuts, telemetry.** YAGNI; address if demand emerges.

## Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│  Chrome Profile A          Chrome Profile B                  │
│  ┌────────────────┐        ┌────────────────┐               │
│  │  Extension A   │        │  Extension B   │               │
│  │  ┌──────────┐  │        │  ┌──────────┐  │               │
│  │  │ Popup    │  │        │  │ Popup    │  │               │
│  │  └──────────┘  │        │  └──────────┘  │               │
│  │  ┌──────────┐  │        │  ┌──────────┐  │               │
│  │  │ Service  │  │        │  │ Service  │  │               │
│  │  │ Worker   │  │        │  │ Worker   │  │               │
│  │  └─────┬────┘  │        │  └─────┬────┘  │               │
│  └────────┼───────┘        └────────┼───────┘               │
│           │ persistent NM           │ persistent NM          │
│           ↓                         ↓                        │
│  ┌────────────────┐        ┌────────────────┐               │
│  │  Native Host A │        │  Native Host B │               │
│  │  (Go binary)   │        │  (Go binary)   │               │
│  └────┬─────┬─────┘        └────┬─────┬─────┘               │
│       │     │ FSEvents           │     │ FSEvents            │
│       ↓     ↓                    ↓     ↓                     │
│  ┌──────────────────────────────────────────────┐           │
│  │  ~/Library/Application Support/AudioTabFinder│           │
│  │   ├── state/                                 │           │
│  │   │   ├── {uuid-A}.json  ← A writes          │           │
│  │   │   └── {uuid-B}.json  ← B writes          │           │
│  │   └── actions/                               │           │
│  │       └── {action-id}.json ← any writes,     │           │
│  │                              target reads     │           │
│  └──────────────────────────────────────────────┘           │
└─────────────────────────────────────────────────────────────┘
```

### Components

| Component | Responsibility |
|-----------|---------------|
| **Service Worker (1 per profile)** | Persistent NM connection (keeps SW alive). Detects audio changes via `chrome.tabs.onUpdated`. Sends `update_state` to host. Heartbeats every 20s. Receives push `action_request` from host, executes via Chrome APIs. |
| **Popup (transient)** | Queries SW for aggregate state on open. Renders own profile + other profiles sections. Click events → SW → host. |
| **Native Host (1 process per profile, alive while SW alive)** | Bridge between extension and filesystem. Watches `actions/` via FSEvents for action requests targeting its profile. Reads/writes state files. |
| **State files** | Per-profile JSON in `state/{uuid}.json`. Source of truth for "what each profile is playing." Heartbeat embedded. |
| **Action files** | Transient JSON in `actions/{action-id}.json`. Created by source profile, read and deleted by target profile. TTL = 5s. |

### Design principles

- **Stateless host:** all durable state is on the filesystem. Host can crash and restart without data loss.
- **Each profile is the source of truth for its own tabs.** No profile writes to another profile's state.
- **Filesystem is the IPC bus between host processes.** No central daemon, no socket coordination, no leader election.
- **Graceful degradation:** if the native host is not installed, the extension falls back to single-profile mode (current v1 behavior) with an install banner.

## Data model

### Filesystem layout

```
~/Library/Application Support/AudioTabFinder/
├── state/
│   ├── {uuid-A}.json         ← Profile A writes
│   ├── {uuid-B}.json         ← Profile B writes
│   └── ...                   ← one per active profile
├── actions/
│   ├── {action-id}.json      ← transient request files
│   └── ...
└── logs/
    └── host.log              ← rotating log (1MB × 3 files)
```

Created by native host on first start via `os.UserConfigDir()`.

### State file schema

**Path:** `state/{profile_uuid}.json`

```json
{
  "schema_version": 1,
  "profile_uuid": "7c4f2a8b-9d3e-4561-b2a8-1f4c5e6d7a9b",
  "label": "Trabalho",
  "heartbeat_unix_ms": 1745601234567,
  "tabs": [
    {
      "tab_id": 42,
      "window_id": 7,
      "title": "YouTube — Some video",
      "url": "https://youtube.com/watch?v=...",
      "favicon_url": "https://www.youtube.com/favicon.ico",
      "muted": false
    }
  ]
}
```

**Rules:**
- Owner profile **overwrites** its own file on every state change and on heartbeat (every 20s).
- Other profiles **only read**, never write to another profile's file.
- Atomic write: `.tmp` file + `os.Rename()` (atomic on POSIX).
- `heartbeat_unix_ms` updated on every write.
- Stale threshold: **60 seconds** without update → ignored by aggregation.
- `schema_version` enables future migration.

### Action file schema

**Path:** `actions/{action_id}.json`

```json
{
  "schema_version": 1,
  "action_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "source_profile_uuid": "7c4f2a8b-...",
  "target_profile_uuid": "2d8f1c4a-...",
  "action": "mute",
  "target_tab_id": 42,
  "target_window_id": 7,
  "created_at_unix_ms": 1745601234567,
  "ttl_ms": 5000
}
```

**Valid `action` values:** `"mute"`, `"unmute"`, `"close"`, `"activate"` (= switch + focus window).

**Rules:**
- Source creates; target reads, executes, deletes.
- TTL = 5000ms. Expired files can be GC'd by any host.
- Atomic write: `.tmp` + `os.Rename()`.
- Self-targeting (source == target) is rejected by host.

### Profile identification

**`profile_uuid`** — generated once on first SW startup, persisted in `chrome.storage.local`:

```js
async function getOrCreateProfileUuid() {
  const { profileUuid } = await chrome.storage.local.get('profileUuid');
  if (profileUuid) return profileUuid;
  const newUuid = crypto.randomUUID();
  await chrome.storage.local.set({ profileUuid: newUuid });
  return newUuid;
}
```

Survives Chrome restart, extension update. Lost only if user deletes profile or clears extension storage.

**`label`** — ASCII string, max 30 chars, editable in popup, persisted in `chrome.storage.local`. Default empty (popup shows "Name this profile…" placeholder).

### Concurrency and races

| Scenario | Resolution |
|----------|-----------|
| Two profiles write state files simultaneously | Different files (different UUID) — no conflict |
| Source writes action while target reads dir | FSEvents is eventually-consistent; target sees on next event |
| Action created twice (UI double-click) | Different `action_id` UUIDs; target executes idempotently (mute on already-muted tab is no-op) |
| Target executed but crashed before delete | TTL expires → passive GC |
| Target offline at action creation time | File sits unread; TTL expires; GC. Popup can show "profile is offline" before sending (knows from aggregate) |

### Garbage collection

- **State files (stale, >60s):** kept on disk but filtered from aggregation. Profile may come back.
- **Action files (>TTL):** any host doing a directory scan deletes expired ones (passive GC).
- **Logs:** lumberjack rotates at 1MB, keeps 3 files.

## Communication protocol

### Topology

```
┌─────────────┐  chrome.runtime    ┌──────────────────┐  Native Messaging  ┌─────────────┐
│   Popup     │  sendMessage       │  Service Worker  │  (length-prefixed  │ Native Host │
│             │ ◄─────────────────►│                  │   JSON over        │             │
└─────────────┘                    └──────────────────┘   stdin/stdout)    └──────┬──────┘
                                                                                  │
                                                                                  │ FSEvents +
                                                                                  │ read/write
                                                                                  ↓
                                                                             ┌─────────┐
                                                                             │   FS    │
                                                                             └─────────┘
```

The popup **does not connect** to the native host directly. Only the service worker maintains the persistent NM connection. Popup ↔ SW via `chrome.runtime.sendMessage`; SW ↔ Host via `connectNative`. This avoids spawning a new host process every time the popup opens.

### Native Messaging frame format (Chrome standard)

- 4 bytes: payload length, uint32 little-endian
- N bytes: UTF-8 JSON payload
- Max 1MB per message (Chrome hard limit). Our messages are 1-10KB.

### Messages: Extension → Host

All messages have `type` and `request_id` (short UUID for response correlation).

**`hello`** — first message after connecting. Identifies the profile.

```json
{
  "type": "hello",
  "request_id": "r1",
  "profile_uuid": "7c4f2a8b-...",
  "label": "Trabalho"
}
```

**`update_state`** — reports tabs with audio. Triggered on change or heartbeat.

```json
{
  "type": "update_state",
  "request_id": "r2",
  "label": "Trabalho",
  "tabs": [
    {"tab_id": 42, "window_id": 7, "title": "...", "url": "...",
     "favicon_url": "...", "muted": false}
  ]
}
```

Host re-writes `state/{uuid}.json` with refreshed timestamp.

**`get_aggregate`** — popup requests aggregate state.

```json
{"type": "get_aggregate", "request_id": "r3"}
```

**`send_action`** — popup wants to fire a cross-profile action.

```json
{
  "type": "send_action",
  "request_id": "r4",
  "target_profile_uuid": "2d8f1c4a-...",
  "action": "mute",
  "target_tab_id": 42,
  "target_window_id": 7
}
```

Host creates `actions/{action-id}.json`. Self-targeting rejected.

**`action_result`** — SW reports result of an action it executed (response to host push).

```json
{
  "type": "action_result",
  "action_id": "a1b2-...",
  "success": true,
  "error": null
}
```

Host deletes the action file.

### Messages: Host → Extension

**`hello_ack`**

```json
{"type": "hello_ack", "request_id": "r1", "host_version": "0.1.0"}
```

**`update_state_ack`**

```json
{"type": "update_state_ack", "request_id": "r2"}
```

**`aggregate`** — response to `get_aggregate`.

```json
{
  "type": "aggregate",
  "request_id": "r3",
  "profiles": [
    {
      "profile_uuid": "7c4f2a8b-...",
      "label": "Trabalho",
      "is_self": true,
      "tabs": [...]
    },
    {
      "profile_uuid": "2d8f1c4a-...",
      "label": "Pessoal",
      "is_self": false,
      "tabs": [...]
    }
  ]
}
```

Host filters profiles with stale heartbeats (>60s); they are omitted from the response.

**`send_action_ack`**

```json
{"type": "send_action_ack", "request_id": "r4", "action_id": "a1b2-..."}
```

**`action_request`** — **PUSH** (no corresponding `request_id`). Sent when FSEvents detects a new action file targeting this profile.

```json
{
  "type": "action_request",
  "action_id": "a1b2-...",
  "source_profile_uuid": "7c4f2a8b-...",
  "action": "mute",
  "target_tab_id": 42,
  "target_window_id": 7
}
```

SW executes via Chrome APIs (`chrome.tabs.update(42, {muted: true})`), responds with `action_result`. Host then deletes the file.

**`error`** — generic failure response.

```json
{
  "type": "error",
  "request_id": "r2",
  "code": "WRITE_FAILED",
  "message": "Permission denied on state/..."
}
```

### Connection lifecycle

**SW startup:**

```js
chrome.runtime.onStartup.addListener(connectToHost);
chrome.runtime.onInstalled.addListener(connectToHost);

function connectToHost() {
  const port = chrome.runtime.connectNative('com.fgregori.audio_tab_finder');
  port.onMessage.addListener(handleHostMessage);
  port.onDisconnect.addListener(scheduleReconnect);
  port.postMessage({ type: 'hello', request_id: '...', profile_uuid, label });
}
```

**Reconnect with exponential backoff:** 1s → 2s → 5s → ... max 60s. Reset after stable connection > 30s.

**Heartbeat:** SW sends `update_state` every **20 seconds** even without change. Implemented via `setInterval` (the persistent NM connection keeps SW alive, so `setInterval` is reliable; `chrome.alarms` minimum is 30s in MV3, too coarse).

**Graceful disconnect:** when Chrome closes the profile, port closes, host process exits via stdin EOF. State file remains on disk with stale timestamp → other profiles see as offline after 60s.

### Audio change detection in extension

```js
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.audible !== undefined || changeInfo.mutedInfo !== undefined) {
    sendStateUpdate();
  }
});

chrome.tabs.onRemoved.addListener(sendStateUpdate);
```

`sendStateUpdate()` queries `chrome.tabs.query({ audible: true })`, builds payload, sends via NM.

### Error handling

| Error | Behavior |
|-------|----------|
| Native host not installed (`connectNative` fails) | SW degrades to single-profile mode. Popup shows current profile tabs + amber banner: "Install native helper for cross-profile" |
| Host crashes mid-message | Port `onDisconnect` fires, schedule reconnect. SW continues working locally |
| Action timeout (host never confirms) | Popup shows error after 3s; action likely expired its TTL. User can retry |
| Target profile offline at action time | Source host writes file; no target reads; TTL expires; GC. Popup can preempt by checking aggregate first |
| Aggregate returns empty list | Host shows only its own state |

## Extension changes

### Popup layout (UX)

```
┌──────────────────────────────────────────────┐
│ Audio Tabs                                   │
├──────────────────────────────────────────────┤
│ 👤 Trabalho (this profile)              ✏️   │  ← profile header (label editable)
├──────────────────────────────────────────────┤
│ ▶ 🎵 YouTube — Some video       [🔇] [×]    │  ← own profile tabs (chrome.tabs APIs)
│ ▶ 🎵 Spotify Web                [🔇] [×]    │
├──────────────────────────────────────────────┤
│ 👥 Other profiles                           │  ← divider
├──────────────────────────────────────────────┤
│ Pessoal                                      │  ← per-profile sub-header
│   ▶ 🎵 Discord call             [🔇] [×]    │  ← cross-profile actions via NM
├──────────────────────────────────────────────┤
│ Estudo                                       │
│   ▶ 🎵 Lecture YouTube          [🔇] [×]    │
└──────────────────────────────────────────────┘
```

**States:**

| Scenario | Display |
|----------|---------|
| All silent across all profiles | "No tabs playing audio in any profile" |
| Only this profile silent, others playing | "Other profiles" section visible; subtle "This profile is silent" line above |
| Native host not installed | Only current profile tabs + amber banner: "Install the native helper to see audio across profiles" + link |
| Host installed but only one profile open | List for current profile only; no "Other profiles" section |

### Click behavior

| Click on... | Behavior |
|-------------|----------|
| Tab from current profile | `chrome.tabs.update(id, {active:true})` + `chrome.windows.update(wId, {focused:true})`. Fast path, no NM. Popup closes |
| Tab from another profile | `send_action` with `action: "activate"` → target host executes the same sequence → target window comes forward. Popup closes in both cases |
| Mute btn on current profile | `chrome.tabs.update(id, {muted: true})`, in-place icon update, popup stays open |
| Mute btn on another profile | `send_action` with `action: "mute"`. Optimistic UI: icon updates immediately. If host returns error within 3s, revert + toast |
| Close btn on current profile | `chrome.tabs.remove(id)`, remove item from list |
| Close btn on another profile | `send_action` with `action: "close"`. Optimistic remove |
| Click on header "Trabalho ✏️" | In-line edit mode (same pattern as v1 light) |

**Optimistic UI** is essential: popup is open ~3s between click and confirmation. Waiting for ack before updating the UI feels laggy. Update visually immediately; revert on error.

### Keyboard navigation

- **Tab:** profile header → first own tab → ... → last item
- **↓/↑:** moves between tabs, **skips section headers** (non-interactive)
- **Enter/Space:** activate (switch to) the focused tab
- **m:** toggle mute on focused tab
- **Delete/Backspace:** close focused tab
- Profile section sub-headers (e.g., "Pessoal") are non-focusable, purely visual

### Service Worker (`background.js`)

Currently ~30 LOC (badge update only). Will grow to ~250-300 LOC. Modular structure:

```
background.js                   ← entry point, event wiring, importScripts
  ├─ profile.js                 ← getOrCreateProfileUuid, label management
  ├─ host-connection.js         ← NM connect/reconnect/send/receive
  ├─ state-sync.js              ← detect audio changes, send update_state, heartbeat
  ├─ action-handler.js          ← handle action_request push from host
  └─ popup-bridge.js            ← chrome.runtime.onMessage handlers for popup
```

Each module loaded via `importScripts(...)` (MV3 pattern, no build step).

**SW lifecycle:**

```js
importScripts('profile.js', 'host-connection.js', 'state-sync.js',
              'action-handler.js', 'popup-bridge.js');

let port = null;

chrome.runtime.onStartup.addListener(initialize);
chrome.runtime.onInstalled.addListener(initialize);

async function initialize() {
  await ensureProfileUuid();
  port = await connectToHost();      // tries NM, sets up reconnect on failure
  setupAudioWatcher();                // chrome.tabs.onUpdated + onRemoved
  startHeartbeat();                   // setInterval 20s while port alive
  setupBadgeUpdater();                // existing badge logic, unchanged
}

chrome.runtime.onMessage.addListener(handlePopupMessage);
chrome.tabs.onUpdated.addListener(/* ... */);
```

### Popup (`popup.html`, `popup.js`, `popup.css`)

Significant rewrite from v1. Module structure:

```
popup.js
  ├─ DOMContentLoaded → query SW for aggregate
  ├─ render(aggregate)                  ← orchestrates section rendering
  ├─ renderProfileHeader(label)         ← editable
  ├─ renderOwnProfileTabs(tabs)         ← fast path with chrome.tabs APIs
  ├─ renderOtherProfileSection(profile) ← each other profile
  ├─ handleTabClick(tab, isOwnProfile)  ← decides fast path vs NM
  ├─ handleMuteClick(tab, isOwnProfile)
  ├─ handleCloseClick(tab, isOwnProfile)
  ├─ sendCrossProfileAction(action, profileUuid, tabId, windowId)
  └─ keyboard nav (generalize across sections)
```

**Popup ↔ SW messages:**

```js
// Popup -> SW
{ type: 'get_aggregate' }
// SW responds with aggregate from host (or single-profile fallback)

{ type: 'send_action', target_profile_uuid, action, target_tab_id, target_window_id }
// SW forwards to host, returns ack/error

{ type: 'update_label', label }
// SW updates chrome.storage.local + sends update_state via NM
```

### Storage schema (`chrome.storage.local`)

```
{
  "profileUuid": "7c4f2a8b-...",   // generated once, never changes
  "profileLabel": "Trabalho"        // user-editable, defaults to ""
}
```

No migrations for Phase 1 (greenfield for v2). Reset/clear of storage = generate new UUID, empty label.

### Manifest changes

```diff
- "version": "1.0.4",
+ "version": "2.0.0",
- "permissions": ["tabs"],
+ "permissions": ["tabs", "storage", "nativeMessaging"],
```

`nativeMessaging` is the new critical permission. Chrome Web Store flags it for review (Phase 2 concern, not Phase 1). For local install during Phase 1, no review involved.

### i18n

New strings (en + pt_BR ASCII):

| Key | en | pt_BR |
|-----|----|----|
| `otherProfilesHeader` | Other profiles | Outros perfis |
| `thisProfileSilent` | This profile is silent | Este perfil esta silencioso |
| `noAudioAnywhere` | No tabs playing audio in any profile | Nenhuma aba tocando audio em nenhum perfil |
| `nativeHostMissing` | Install the native helper to see audio across profiles | Instale o helper nativo para ver audio entre perfis |
| `installInstructions` | Install instructions | Instrucoes de instalacao |
| `actionFailedToast` | Action failed. The other profile may be offline. | Acao falhou. O outro perfil pode estar offline. |
| `profileLabelEmpty` | Name this profile… | Nomeie este perfil… |
| `profileLabelEditAria` | Edit profile name | Editar nome do perfil |
| `profileLabelInputAria` | Profile name | Nome do perfil |
| `profileLabelSave` | Save profile name | Salvar nome do perfil |

The `profileLabel*` keys mirror the v1 light design (which was abandoned but the label-editing UX carries over).

## Native host (Go binary)

### Project layout

```
native-host/
├── go.mod
├── go.sum
├── Makefile                            ← build, install (local), uninstall
├── cmd/
│   └── audio-tab-finder-host/
│       └── main.go                     ← entry point: NM read loop, dispatch
├── internal/
│   ├── nmproto/
│   │   ├── codec.go                    ← length-prefixed JSON encode/decode
│   │   └── messages.go                 ← typed structs (Hello, UpdateState, ...)
│   ├── store/
│   │   ├── state.go                    ← state file read/write + heartbeat filter
│   │   └── action.go                   ← action file read/write/delete + GC
│   ├── watcher/
│   │   └── watcher.go                  ← fsnotify wrapper, filters by target UUID
│   ├── handler/
│   │   └── handler.go                  ← message dispatch (one func per type)
│   └── logging/
│       └── logger.go                   ← rotating file logger
└── manifest/
    └── com.fgregori.audio_tab_finder.json.tmpl  ← template, install fills paths
```

**Estimated size:** 700-1000 LOC including tests.

### Dependencies

| Package | Use | Justification |
|---------|-----|---------------|
| `github.com/fsnotify/fsnotify` | FSEvents wrapper | Cross-platform (FSEvents on macOS, inotify on Linux, ReadDirectoryChangesW on Windows). Forward-thinking for Phase 3+ |
| `github.com/google/uuid` | Action ID generation | stdlib lacks UUID v4 |
| `gopkg.in/natefinch/lumberjack.v2` | Log rotation | Trivial; could roll our own ~100 LOC if dep-aversion is strong |

Everything else (JSON, stdin/stdout, filesystem) uses stdlib. No HTTP framework, no heavy dependencies.

### Native Messaging codec (`internal/nmproto/codec.go`)

Chrome standard: 4-byte uint32 little-endian length prefix, then JSON UTF-8 payload.

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

### Main loop (`cmd/audio-tab-finder-host/main.go`)

```go
func main() {
    logger := logging.New()
    defer logger.Close()

    storeDir, err := store.DefaultDir() // ~/Library/Application Support/AudioTabFinder
    if err != nil { logger.Fatal(err) }

    if err := store.EnsureDirs(storeDir); err != nil {
        logger.Fatal(err)
    }

    h := handler.New(storeDir, logger, os.Stdout)

    for {
        msg, err := nmproto.Read(os.Stdin)
        if err == io.EOF {
            logger.Info("stdin closed, exiting")
            return // chrome closed the port
        }
        if err != nil {
            logger.Error("read failed:", err)
            return
        }
        if err := h.Dispatch(msg); err != nil {
            logger.Error("dispatch failed:", err)
            // continue — don't crash on one bad message
        }
    }
}
```

### Handler (`internal/handler/handler.go`)

```go
type Handler struct {
    storeDir    string
    profileUuid string  // set on hello
    label       string  // set on hello, updated on update_state
    out         io.Writer  // os.Stdout (NM out)
    logger      *logging.Logger
    watcher     *watcher.Watcher  // started after hello
    mu          sync.Mutex
}

func (h *Handler) Dispatch(raw []byte) error {
    var base struct{ Type string `json:"type"` }
    if err := json.Unmarshal(raw, &base); err != nil { return err }

    switch base.Type {
    case "hello":          return h.handleHello(raw)
    case "update_state":   return h.handleUpdateState(raw)
    case "get_aggregate":  return h.handleGetAggregate(raw)
    case "send_action":    return h.handleSendAction(raw)
    case "action_result":  return h.handleActionResult(raw)
    default:
        return h.replyError("", "UNKNOWN_TYPE", "unknown message type: "+base.Type)
    }
}
```

Individual handlers ~30-50 LOC each. `handleHello` is where the FSEvents watcher starts (needs `profile_uuid` to filter action files).

### Store (`internal/store/state.go`)

```go
type Profile struct {
    SchemaVersion   int    `json:"schema_version"`
    ProfileUuid     string `json:"profile_uuid"`
    Label           string `json:"label"`
    HeartbeatUnixMs int64  `json:"heartbeat_unix_ms"`
    Tabs            []Tab  `json:"tabs"`
}

const HeartbeatThresholdMs = 60_000

func WriteState(dir string, p Profile) error {
    p.HeartbeatUnixMs = time.Now().UnixMilli()
    final := filepath.Join(dir, "state", p.ProfileUuid+".json")
    tmp := final + ".tmp"
    data, err := json.MarshalIndent(p, "", "  ")
    if err != nil { return err }
    if err := os.WriteFile(tmp, data, 0644); err != nil { return err }
    return os.Rename(tmp, final) // atomic on POSIX
}

func ReadAllStates(dir string) ([]Profile, error) {
    files, err := os.ReadDir(filepath.Join(dir, "state"))
    if err != nil { return nil, err }
    now := time.Now().UnixMilli()
    var profiles []Profile
    for _, f := range files {
        if !strings.HasSuffix(f.Name(), ".json") { continue }
        data, err := os.ReadFile(filepath.Join(dir, "state", f.Name()))
        if err != nil { continue }
        var p Profile
        if err := json.Unmarshal(data, &p); err != nil { continue }
        if now-p.HeartbeatUnixMs > HeartbeatThresholdMs { continue }
        profiles = append(profiles, p)
    }
    return profiles, nil
}
```

### Watcher (`internal/watcher/watcher.go`)

`fsnotify` wrapper with filtering by `target_profile_uuid`. On new `actions/*.json`:

1. Read the file.
2. If `target_profile_uuid` ≠ own: ignore (another host will handle).
3. If TTL expired: delete and ignore.
4. Otherwise: invoke callback that sends `action_request` via NM out.

```go
type Watcher struct {
    dir          string
    targetUuid   string
    onAction     func(action Action)
    fsw          *fsnotify.Watcher
    logger       *logging.Logger
}

func New(actionsDir, profileUuid string, onAction func(Action), logger *logging.Logger) (*Watcher, error) {
    fsw, err := fsnotify.NewWatcher()
    if err != nil { return nil, err }
    if err := fsw.Add(actionsDir); err != nil { return nil, err }
    w := &Watcher{actionsDir, profileUuid, onAction, fsw, logger}
    go w.loop()
    return w, nil
}

func (w *Watcher) loop() {
    for ev := range w.fsw.Events {
        if ev.Op&fsnotify.Create != fsnotify.Create { continue }
        if !strings.HasSuffix(ev.Name, ".json") { continue }
        if strings.HasSuffix(ev.Name, ".tmp") { continue }

        action, err := store.ReadAction(ev.Name)
        if err != nil {
            w.logger.Debug("skip unreadable action:", err)
            continue
        }
        if action.TargetProfileUuid != w.targetUuid { continue }
        if action.Expired() {
            os.Remove(ev.Name)
            continue
        }
        w.onAction(action)
    }
}
```

### NM manifest template (`manifest/com.fgregori.audio_tab_finder.json.tmpl`)

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

Install script substitutes the two variables at install time.

### Logging

`~/Library/Application Support/AudioTabFinder/logs/host.log`. Rotation: 1MB max, 3 files. Levels: Debug/Info/Warn/Error/Fatal.

When Chrome spawns the host, **stdout and stderr are bound to Chrome**. File logging is the only way to debug.

## Local installation (Phase 1)

### Repo structure

Single repo (`audio-tab-finder/`):

```
audio-tab-finder/
├── manifest.json                       ← extension
├── popup.html, popup.js, popup.css     ← extension
├── background.js + modules             ← extension
├── _locales/                           ← extension
├── icons/                              ← extension
├── native-host/                        ← NEW: Go binary
│   └── (structure above)
├── docs/superpowers/
├── scripts/
│   └── install-local.sh                ← friendly wrapper around make install
└── README.md
```

Reasons to keep together: synchronized versioning (extension and host must agree on protocol), one place for docs/issues, Phase 2 installer packages both.

### Install flow (Phase 1)

```bash
# 1. Load extension unpacked
open -a "Google Chrome" chrome://extensions
# (toggle Developer mode, Load unpacked, select repo root, copy Extension ID)

# 2. Run install script
./scripts/install-local.sh
# Prompts for Extension ID, runs `make install EXT_ID=...`

# 3. Reload extension
# Service worker connects to host. Done.
```

### Makefile

```make
.PHONY: build install uninstall test

BINARY := bin/audio-tab-finder-host
INSTALL_DIR := /usr/local/bin
NM_MANIFEST_DIR := $(HOME)/Library/Application Support/Google/Chrome/NativeMessagingHosts
NM_NAME := com.fgregori.audio_tab_finder

build:
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
```

## Testing strategy

**Native host (Go) — automated tests** via stdlib `testing`. Coverage target: ~70-80% (skip `main`, stdin/stdout direct).

```
native-host/internal/
├── nmproto/codec_test.go       ← round-trip encoding
├── store/state_test.go         ← atomic writes, heartbeat filtering
├── store/action_test.go        ← TTL expiry, GC
├── watcher/watcher_test.go     ← fsnotify integration in temp dir
└── handler/handler_test.go     ← message dispatch with mocks
```

`make test` runs `go test ./...`.

**Extension — manual QA only.** Same as v1 convention. No test framework introduced.

**Integration tests (extension + host together)** — out of scope for Phase 1. Requires Chrome automation (Puppeteer/Playwright) with multi-profile management. Possible Phase 2.

### Manual QA checklist

**Setup**
- [ ] `make build` produces binary
- [ ] `./scripts/install-local.sh` installs NM manifest correctly
- [ ] Extension loads in `chrome://extensions` without errors
- [ ] Service worker connects to host (verified in `host.log`)

**Single-profile (regression)**
- [ ] Popup shows audio tabs for current profile (same as v1)
- [ ] Mute/close/switch in current profile works (fast path, no NM)
- [ ] Badge shows current profile count

**Cross-profile detection**
- [ ] Load extension in 2nd profile. SW of 2nd profile connects too
- [ ] Play audio in Profile B (YouTube, Spotify Web)
- [ ] Open popup in Profile A → "Other profiles" section shows B's tab
- [ ] Heartbeats: `state/{uuid-A}.json` and `state/{uuid-B}.json` update every ~20s

**Cross-profile actions**
- [ ] Click "mute" on B's tab from A's popup → audio stops in B in <500ms
- [ ] Click "unmute" → audio returns
- [ ] Click "close" on B's tab → tab closes in B in <500ms
- [ ] Click on B's tab item → B's window comes forward, tab activates
- [ ] Optimistic UI: mute icon changes immediately, even before ack

**Resilience**
- [ ] Close Profile B → B disappears from A's popup after ~60s
- [ ] Reopen Profile B → reconnects, returns to A's popup
- [ ] Kill native host process (`pkill audio-tab-finder-host`) → SW reconnects with backoff
- [ ] Cross-profile action with offline target → 3s timeout → error toast + UI revert

**Persistence**
- [ ] Profile UUID persists across Chrome restart
- [ ] Profile label persists across restart
- [ ] State files cleaned up on `make uninstall`

**No native host (degradation)**
- [ ] `make uninstall` → reload extension → popup shows amber "Install native helper" banner
- [ ] Mute/close/switch on current profile still works
- [ ] Reinstall host → reload → banner disappears, aggregation returns

**i18n**
- [ ] Switch Chrome to pt-BR → new strings appear in pt-BR ASCII
- [ ] Switch back to en

**Performance / leak**
- [ ] Leave Chrome open with 3 profiles for 1h, open popup multiple times → host process RAM doesn't grow above baseline (~10MB)
- [ ] Logs rotate correctly when crossing 1MB

### Debugging

Sources of info, in order of utility:

1. **Native host log:** `~/Library/Application Support/AudioTabFinder/logs/host.log`
2. **Service worker console:** `chrome://extensions` → "service worker" link
3. **State files:** `cat ~/Library/Application\ Support/AudioTabFinder/state/*.json`
4. **Action files (if any pending):** `ls ~/Library/Application\ Support/AudioTabFinder/actions/`
5. **NM manifest:** `cat ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.fgregori.audio_tab_finder.json` — verify path and extension ID

Common `connectNative` failures:
- Extension ID in manifest ≠ current extension ID → re-run install script
- Binary path in manifest no longer exists → rebuild and reinstall
- Missing execute permission → `chmod +x` on binary

## Out of scope

### Phase 2 (separate spec, packaging only)

- Apple Developer Program ($99/yr)
- Code signing the Go binary (Developer ID Application certificate)
- Notarization via `notarytool`
- `.pkg` installer (signed, with pre/postinstall scripts)
- Chrome Web Store submission of v2.0.0 (requires `nativeMessaging` permission justification)
- Auto-update mechanism (Sparkle or custom)
- Polished public docs (README with screenshots)
- Updating existing `STORE_LISTING.md` and `PUBLISHING_GUIDE.md`

### Deferred features (YAGNI)

- Live state push to popup (host watches `state/` and pushes; ~50 LOC addition if needed)
- Action history (action files are deleted after execution; no durable history)
- Search/filter in popup (list is short)
- Per-tab volume control (Chrome API doesn't expose)
- Custom global shortcuts ("Cmd+Shift+M to mute everything everywhere")
- Settings/options page (Phase 1 only has profile label, edited inline)
- Telemetry / analytics

### Cross-platform (deferred to v3+)

- Windows: Go cross-compiles; NM manifest path is registry, state dir is `%LOCALAPPDATA%`. ~1-2 days of work.
- Linux: similar to Windows but `~/.config/google-chrome/NativeMessagingHosts/`. fsnotify uses inotify. Minimal differences.
- Other Chromium browsers (Edge, Brave, Arc): same extension and binary; manifest replicated to additional paths. Documented as manual install in Phase 2+.
- Firefox: WebExtensions APIs differ enough to require service worker rewrite. Out of scope.
- Safari: requires Swift + App Extension model. Complete rewrite. Never planned.

### Definitively not — never planned

- System-wide audio detection (non-Chrome apps): brutal complexity, doesn't solve "which Chrome profile is playing" anyway
- Backend / cloud sync of state: privacy, cost, latency. Doesn't fit
- LaunchAgent background daemon: discussed and rejected — over-engineering. State files + per-profile native host is sufficient

## Effort estimate

| Component | LOC | Effort (focused) |
|-----------|-----|------------------|
| Native host Go (with tests) | ~700-1000 | 1-2 days |
| Service worker (modular, near-rewrite) | ~250-300 | 0.5-1 day |
| Popup rewrite (HTML + JS + CSS) | ~400-500 | 0.5-1 day |
| i18n (en + pt_BR ASCII) | ~30 strings | 1h |
| Install script + Makefile | ~80 | 1h |
| Manual QA (checklist above) | — | 2-3h |
| **Total** | **~1500-2000 LOC** | **3-5 days focused** |
