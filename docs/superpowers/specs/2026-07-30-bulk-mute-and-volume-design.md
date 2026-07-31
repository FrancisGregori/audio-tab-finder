# Bulk Mute Controls, Per-Tab Volume, and Pause

**Date:** 2026-07-30
**Status:** Implemented
**Target version:** 2.1.0
**Phase:** 3

## Context

A Chrome Web Store reviewer left this feedback on v2.0.1:

> Love the drop down listing of all active audio tabs. Does what it says but would be way better if some essential features would be added as well: • Mute this tab • Unmute this tab • Mute all tabs • Unmute all tabs • Mute all but this tab • Mute tabs in other windows etc. and VOLUME CONTROL for individual tabs

Audit of the current code against that list:

| Requested | v2.0.1 |
|---|---|
| Mute this tab | Present — `createMuteButton` in `popup.js`, works locally and cross-profile |
| Unmute this tab | Present — same button, toggles |
| Mute all tabs | Missing |
| Unmute all tabs | Missing |
| Mute all but this tab | Missing |
| Mute tabs in other windows | Missing |
| Volume control per tab | Missing |

Pause/resume was added during implementation, on the observation that once the injection machinery exists for volume it costs almost nothing, and that pause is what people usually want — muting leaves the video running.

Two findings shaped the design:

1. **Bulk actions are free on the existing native host.** `handleSendAction` in `native-host/internal/handler/handler.go` copies the `action` string into the action file without validating it, and `watcher.go` relays it verbatim. New action verbs therefore work against the **already-installed host 2.0.x** — no Go change, no host reinstall, no version bump on the helper.

2. **Volume needs a content script, and permissions are the risk.** Chrome exposes no per-tab volume or playback API. Driving either requires `scripting` plus a host permission for the page. Declaring `<all_urls>` as a *required* permission would make Chrome disable the extension for every existing user until they re-accept — unacceptable for a published extension. The design uses optional permissions requested on first use.

## Goal

1. **Mute all / Unmute all** at five scopes: this window, other windows, this profile, another profile, and everything.
2. **Mute all but this tab** (solo) from any tab row, including cross-profile rows.
3. **Mute tabs in other windows** as a first-class control, not a hidden menu item.
4. **Per-tab volume** (0–100%), for this profile's tabs and — with stated limits — for other profiles' tabs.
5. **Pause / resume playback** for this profile's tabs, with paused tabs staying visible so they can be resumed.
6. **No disruption to existing users** — the base install's permission set is unchanged.
7. **No native host reinstall** — v2.1.0 works with the host 2.0.x users already have.

## Non-goals

- **Volume above 100% (amplification).** Requires routing through a Web Audio `GainNode`. Two hard failure modes: cross-origin media without CORS headers goes **silent** when routed through `MediaElementAudioSourceNode`, and DRM/EME content (Netflix, Spotify, Prime Video) cannot be routed at all.
- **Reading back the volume of another profile's tab.** The real level would have to travel in the state file, whose Go structs are fixed, so it would mean a helper reinstall for everyone. See "Cross-profile volume" below for what is shipped instead.
- **Cross-profile pause/resume.** A paused tab stops being audible and drops out of the other profile's reported state, so it could be paused but never resumed. Needs a `paused` field in `store.Tab`, i.e. host 2.1.0.
- **Volume or pause persistence across page reloads.** Both apply to the live page only.
- **Muting tabs that are not producing audio.** "Mute all" targets audible tabs.
- **Undo for bulk operations.** "Unmute all" is the inverse and is one click away.
- **Global keyboard shortcuts (`commands` in the manifest).** Popup-scoped keys only.
- **JS test suite.** The repo has no JS test infrastructure and the code is entirely DOM + `chrome.*` calls. Same convention as Phase 1 and Phase 2: manual QA. Checklist below.

## Architecture

### Scope model

Every bulk operation is a **scope descriptor**, so the UI never has to know whether a set of tabs lives in this profile, another window, or another Chrome profile:

```
{ kind: 'window',        windowId }          this profile, one window
{ kind: 'other-windows', excludeWindowId }   this profile, every other window
{ kind: 'own' }                              this profile, every window
{ kind: 'profile',       profileUuid }       one other profile
{ kind: 'global' }                           this profile + every other one
{ kind: 'solo',          tabId, ownerProfileUuid }
```

`popup-actions.js` owns the mapping from descriptor to `chrome.tabs` calls and/or `send_action` messages.

### Mute vs unmute asymmetry

- **Mute** operates on `chrome.tabs.query({ audible: true })` — what is making noise now.
- **Unmute** operates on `chrome.tabs.query({ muted: true })` — every muted tab, including ones that went silent while muted and therefore no longer appear in the popup list.

A tab muted ten minutes ago is invisible in the list but still muted; "Unmute all" must free it.

### Action verbs (cross-profile)

Four new values for the existing `action` string field, handled by `action-handler.js` in the *target* profile:

| Verb | Target profile behavior | Uses `target_tab_id` |
|---|---|---|
| `mute_all` | mute every audible tab | no |
| `unmute_all` | unmute every muted tab | no |
| `mute_others` | mute every audible tab except `target_tab_id` | yes |
| `volume:NN` | set volume to NN% on that tab's media | yes |

`mute_others` reuses the `TargetTabId` field already in `store.Action`. `volume:NN` carries its value inside the action string for the same reason: the struct's fields are fixed, and adding one would force a helper reinstall.

**Backward compatibility:** a profile still running v2.0.x hits the `default:` branch of `handleActionRequest` and replies `unknown action`. That reply does not reach the sender — `handleActionResult` in the host only deletes the action file and ignores `success`, and `send_action` is acknowledged as soon as the file is written. The failure shows up as tabs that stay unmuted after the list refreshes, the same guarantee the existing per-tab cross-profile mute has always had.

### Solo

Solo from a row belonging to profile P mutes everything except that tab, then unmutes it — soloing a muted tab should let you hear it:

- own profile audible tabs, excluding the tab itself if P is the own profile → direct `chrome.tabs.update`
- for each other profile Q ≠ P → `send_action('mute_all')`
- if P is another profile → `send_action('mute_others', target_tab_id = tab)` to P

### Media control (volume and pause)

```
popup / service worker
   │  chrome.permissions.contains / .request   ← optional scripting + <all_urls>
   ↓
chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func, args })
   ↓
page + every same-tab frame
   ├── atfReadVolume     max(volume) across media, or null when there is none
   ├── atfApplyVolume    set volume on all, plus capture-phase play/loadstart
   │                     listeners so media created later inherits the level
   ├── atfSetPaused      pause all playing; resume only what we paused
   └── atfHasPausedByUs  is anything we paused still paused?
```

`media.js` holds all of this and is loaded by **both** the popup and the service worker — the worker needs it to carry out a `volume:NN` request arriving from another profile.

Capture-phase event listeners rather than a `MutationObserver`: on a heavy SPA a subtree observer firing `querySelectorAll` on every mutation is a measurable cost, while `play`/`loadstart` fire exactly when new media starts. A `volumechange` hook is deliberately **not** installed — it would fight the site's own volume slider.

`allFrames: true` is why the permission is `<all_urls>` rather than per-origin: the player is often in a cross-origin iframe (an embedded video on a blog), and each frame needs its own permission.

**Resume only touches what we paused.** A page can hold a dozen media elements; calling `play()` on all of them would turn "resume" into a cacophony. The elements we paused go into a `WeakSet` on the isolated world's `window`, which persists across injections into the same document.

### Paused tabs must stay listed

A paused tab stops being `audible` within a couple of seconds and would vanish from the popup, stranding the user with no way to resume it. So paused tab ids are tracked in `chrome.storage.session` (tab ids are meaningless after a restart, and this way nothing accumulates) and merged back into the own profile's list on every render.

Two traps this has to avoid, both found in review:

- **`tab.audible` is the wrong liveness question.** It lags a couple of seconds behind the pause and says nothing about whether the user pressed play in the page itself. `resolvePausedTabs` asks the page via `atfHasPausedByUs` instead.
- **Duplicate rows.** Right after a pause the tab is still in the audible query (and in a possibly stale state file) *and* in the paused list. The merge filters the audible entry out by tab id, so the paused state wins.

### Cross-profile volume

Writing works today. Reading does not, and cannot without a host bump:

| | Own profile | Another profile |
|---|---|---|
| Set level | `executeScript` | `send_action('volume:NN')` |
| Read current level | `executeScript` | **not possible** — would need a field in `store.Tab` |
| Knows if the target can do it | yes | **no** — the target's permission state is equally unreportable |

So a cross-profile slider starts at the last level *this* profile set (session-scoped) and the panel states plainly that it depends on the other profile having volume control enabled. A target profile that never granted the permission fails with no signal reaching the source; the note is the only honest answer short of host 2.1.0.

### Permission model

```json
"optional_permissions": ["scripting"],
"optional_host_permissions": ["<all_urls>"]
```

Optional permissions do not appear in the install prompt and do not trigger re-acceptance on update, so existing users are untouched. Volume and pause share the grant.

`chrome.permissions.request` **must be called synchronously inside the click handler** — awaiting anything first loses the user gesture and Chrome rejects the call. The session-storage write that remembers which row was open is therefore fire-and-forget. Chrome closes the popup to show the prompt, and the next open restores that row's panel.

## UI

```
● Audio Tabs                            ALL 🔇 🔊   ← only when another profile has audio
┌───────────────────────────────────────────┐
│ 👤 Work ✏️                        🔇 🔊 │   ← this profile; always present
└───────────────────────────────────────────┘
 THIS WINDOW                            🔇 🔊   ← only when own audio spans >1 window
 ┌─────────────────────────────────────────┐
 │ ▶ YouTube — Lofi            🎚 🔇 ✕     │
 │   ── panel, opened by 🎚 ──             │
 │   🔊 ────●───────  70%                  │
 │   ⏸ Pause playback                      │
 │   🔇 Mute all other tabs                │
 └─────────────────────────────────────────┘
 ┌─────────────────────────────────────────┐
 │ ⏸ Spotify Web                  ▶ ✕     │   ← paused: dimmed, "Paused · open.spotify.com"
 └─────────────────────────────────────────┘
 OTHER PROFILES
 Personal                               🔇 🔊
 ┌─────────────────────────────────────────┐
 │ ▶ Netflix                   🎚 🔇 ✕     │   ← 🎚 opens a write-only slider + note
 └─────────────────────────────────────────┘
```

Design rules, several of them learned from the first round of feedback:

- **Actions live on the right edge of every row, without exception.** The first cut put the edit pencil on the right edge of the profile header, which taught the eye to read that strip as "edit" and made the mute pair invisible. The pencil now sits next to the name it edits.
- **The current profile's pair is always present**, because it is the one people reach for. The global pair only appears when another profile actually has audio; otherwise it would duplicate it.
- **Anything an icon cannot express gets words.** "Mute all other tabs" spent a round as a headphones icon and was unreadable — no 16px glyph says "silence everything except this". It and "Pause playback" are labelled buttons in the panel.
- Window subgroups appear only when own-profile audible tabs span more than one window.
- A paused row drops the volume, mute and solo affordances — there is nothing to mute and nothing to solo — and gives resume the room instead.

`body { min-width }` goes from 340px to 380px.

## Files

### New

```
popup-actions.js   scope descriptors → chrome.tabs calls and/or send_action
media.js           optional permission, volume and pause injection, paused-tab
                   tracking; loaded by the popup AND the service worker
```

Loaded as additional classic `<script>` tags in `popup.html` and via `importScripts` in `background.js`, matching the existing no-build, no-module convention.

### Modified

```
manifest.json      version 2.1.0; optional_permissions; optional_host_permissions
action-handler.js  + mute_all, unmute_all, mute_others, volume:NN
background.js      importScripts media.js
state-sync.js      debounce the state push — a bulk mute fires one onUpdated per tab
popup.html         global controls in the h1 row; window subgroup containers
popup.css          bulk controls, group headers, panel, paused row, permission notice
popup.js           window grouping, profile-header controls, panel, pause, new keys
_locales/en        new keys
_locales/pt_BR     new keys (ASCII only, per existing convention)
README.md          feature list, keyboard table, optional permissions
STORE_LISTING.md   feature list + optional-permission justification for the CWS form
```

`scripts/build-extension-zip.sh` needs no change — it excludes by blacklist, so new root-level `.js` files are packaged automatically.

### Untouched

The entire `native-host/` tree. That is the point of encoding everything as opaque action strings.

## Keyboard

| Key | Action |
|---|---|
| `↑` `↓` `Home` `End` | Move between tabs |
| `Enter` / `Space` | Switch to the focused tab |
| `m` | Mute/unmute the focused tab |
| `s` | Mute every tab except the focused one |
| `p` | Pause/resume the focused tab (own profile only) |
| `v` | Open the focused tab's control panel |
| `Delete` / `Backspace` | Close the focused tab |
| `Shift+M` / `Shift+U` | Mute / unmute everything, every profile |

`s` and `p` dispatch through handles on the row element rather than clicking a button, because those buttons live in a panel that may not be rendered.

## Toasts

A bulk operation shows **no** success toast. The toast is `position: fixed` over the bottom of the list for three seconds; firing it on every bulk click would cover the very rows the user is looking at. The list re-rendering with flipped icons is the feedback. Only these speak up:

- nothing matched (`nothingToMuteToast` / `nothingToUnmuteToast`)
- nothing was playing to pause (`nothingToPauseToast`)
- pause attempted before the permission was granted (`pauseNeedsPermission`)
- the browser refused to restart playback (`resumeFailedToast`)
- a cross-profile send failed outright (`actionFailedToast`)

## Error handling

- Own-profile `chrome.tabs.update` failures inside a bulk loop are counted, not thrown — a closed tab must not abort the batch.
- After a cross-profile bulk action the popup waits ~400ms before re-reading, so the refreshed list reflects the target profile's real state. Resume uses the same delay, to let `audible` come back before rendering.
- `chrome.permissions.request` rejection is a no-op; the panel keeps offering the button.
- `executeScript` rejection renders as the disabled-slider state, never as a toast.
- If the optional permission is revoked, `resolvePausedTabs` clears the tracked list: tabs we can no longer resume must not stay listed as paused.

## Manual QA checklist

Bulk mute:

- [ ] Single window, several audio tabs — no window subgroup headers; the profile header pair mutes/unmutes.
- [ ] Two windows with audio — "This window" / "Other windows" headers appear and work.
- [ ] "Other windows" mute leaves the current window's audio untouched.
- [ ] Unmute all frees a tab that was muted earlier and is no longer audible.
- [ ] The global "ALL" pair appears only when another profile has audio.
- [ ] Solo from an own-profile row silences everything else, including other profiles, and unmutes the soloed tab.
- [ ] Solo from a cross-profile row silences everything else, including this profile.

Cross-profile:

- [ ] Two profiles, both on v2.1.0, host running — per-profile mute/unmute works and the list refreshes.
- [ ] Peer profile on v2.0.x — the bulk action does nothing there and the refreshed list shows it; nothing hangs.
- [ ] Host not installed — no other-profile section; the profile header pair still works.
- [ ] Cross-profile volume changes the audio in the other profile.
- [ ] Cross-profile volume on a profile that never enabled volume control does nothing, and the note explains why.
- [ ] Reopening the popup shows the cross-profile slider where it was left, not at 100%.

Volume:

- [ ] First 🎚 click shows the permission notice; granting it makes the slider live.
- [ ] Popup reopens with the same panel expanded after the permission prompt closes it.
- [ ] Denying permission leaves the notice in place with no console errors.
- [ ] YouTube: slider changes volume; navigating to the next video keeps the level.
- [ ] Blog page with an embedded YouTube iframe: the slider reaches the iframe player.
- [ ] Netflix (DRM): the slider changes volume and audio does not cut out.
- [ ] `chrome://extensions` or a PDF tab: slider disabled with the explanatory tooltip.
- [ ] Page reload restores the site's own volume (documented behavior, not a bug).

Pause:

- [ ] Pause a YouTube tab — it stays in the list, dimmed, showing "Paused", with ▶.
- [ ] It appears exactly once immediately after pausing, not twice.
- [ ] ▶ resumes it and it returns to a normal row without blinking out of the list.
- [ ] Pressing play in the page itself drops it from the paused list on the next popup open.
- [ ] Closing a paused tab from the popup removes it from the list for good.
- [ ] Pause on a tab with no playing media reports "Nothing is playing in this tab".
- [ ] Pause before granting the permission explains what to do instead of failing silently.
- [ ] Netflix pauses and resumes.
- [ ] A page with several videos resumes only the one that was paused.
- [ ] Restarting Chrome clears the paused list (session storage).

Accessibility:

- [ ] All new buttons reachable by Tab with visible focus rings.
- [ ] `m`, `s`, `p`, `v`, `Shift+M`, `Shift+U` behave as specified and do not fire while the profile-name input has focus.
- [ ] The slider is operable with arrow keys and announces its value.

## Rollout

Ships as extension v2.1.0 through the Chrome Web Store. No GitHub release, no installer rebuild — the native host stays at 2.0.0 and `EXPECTED_HOST_VERSION` in `host-connection.js` is unchanged, so nobody sees a spurious "update available" banner.

The CWS submission must justify two optional permissions:

- `scripting` — "Injects a short function into a tab, only when the user moves that tab's volume slider or presses pause, to drive that page's audio and video elements."
- `<all_urls>` (optional host permission) — "Requested only when the user first uses volume or pause. Needed because the media element may live in a cross-origin iframe. Never requested at install time, never used to read page content."

## Follow-up (host 2.1.0)

Whenever something else justifies a helper rebuild, these become possible and should ship together, since each on its own is not worth a forced reinstall:

- `volume` in `store.Tab` → a cross-profile slider that shows the true level.
- a per-profile "media control enabled" flag → disable the cross-profile slider with a reason instead of a standing note.
- `paused` in `store.Tab` → cross-profile pause/resume.
- forwarding `action_result` back to the source → real failure toasts for every cross-profile action, replacing today's silent degradation.
