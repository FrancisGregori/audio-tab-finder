# Bulk Mute Controls & Per-Tab Volume

**Date:** 2026-07-30
**Status:** Approved (pending implementation plan)
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

Two findings shape the design:

1. **Bulk actions are free on the existing native host.** `handleSendAction` in `native-host/internal/handler/handler.go` copies the `action` string into the action file without validating it, and `watcher.go` relays it verbatim. New action verbs therefore work against the **already-installed host 2.0.x** — no Go change, no host reinstall, no version bump on the helper.

2. **Volume needs a content script, and permissions are the risk.** Chrome exposes no per-tab volume API. Setting volume requires `scripting` plus a host permission for the page. Declaring `<all_urls>` as a *required* permission would make Chrome disable the extension for every existing user until they re-accept — unacceptable for a published extension. The design uses optional permissions requested on first use.

## Goal

Ship v2.1.0 with every item from the review that can be delivered without degrading the existing install:

1. **Mute all / Unmute all** at four scopes: this window, other windows, a specific other profile, and everything (global, across all profiles).
2. **Mute all but this tab** (solo) from any tab row, including cross-profile rows.
3. **Mute tabs in other windows** as a first-class control, not a hidden menu item.
4. **Per-tab volume slider** (0–100%) for tabs in the current profile, gated behind an optional permission.
5. **No disruption to existing users** — the base install's permission set is unchanged.
6. **No native host reinstall** — v2.1.0 works with the host 2.0.x users already have.

## Non-goals

- **Volume above 100% (amplification).** Requires routing through a Web Audio `GainNode`. Two hard failure modes: cross-origin media without CORS headers goes **silent** when routed through `MediaElementAudioSourceNode`, and DRM/EME content (Netflix, Spotify, Prime Video) cannot be routed at all. Not worth breaking playback on major sites.
- **Cross-profile volume control.** The target profile would need its own grant of the optional permission, and there is no way to detect that from the source profile. The volume button is simply not rendered on cross-profile rows rather than failing silently.
- **Volume persistence across page reloads.** Would require `chrome.scripting.registerContentScripts` and per-origin storage. Volume applies to the live page only; a reload restores the site's own volume.
- **Muting tabs that are not producing audio.** "Mute all" targets audible tabs. This extension is about audio tabs; pre-emptively muting 200 silent tabs is not what the control implies.
- **Undo for bulk operations.** "Unmute all" is the inverse and is one click away. Restoring the exact prior mute state of each tab would need session storage and a toast affordance for marginal benefit.
- **Global keyboard shortcuts (`commands` in the manifest).** Popup-scoped keys only. Browser-wide shortcuts are a separate feature with their own conflict-management UX.
- **JS test suite.** The repo has no JS test infrastructure and the code is entirely DOM + `chrome.*` calls. Same convention as Phase 1 and Phase 2: manual QA. A checklist is in this spec.

## Architecture overview

### Scope model

Every bulk operation is expressed as a **scope descriptor** — a plain object naming a set of tabs. This is the single abstraction that keeps the UI, the keyboard handler, and the dispatch layer decoupled.

```
{ kind: 'window',        windowId }            own profile, one window
{ kind: 'other-windows', excludeWindowId }     own profile, every window but that one
{ kind: 'own' }                                own profile, every window
{ kind: 'profile',       profileUuid }         one other profile, via native host
{ kind: 'global' }                             own profile + every other profile
{ kind: 'solo',          tab, profileUuid }    everything except one tab
```

`popup-actions.js` owns the mapping from descriptor to `chrome.tabs` calls and/or `send_action` messages. Nothing else in the popup knows how a scope is executed.

### Mute vs unmute asymmetry

- **Mute** operates on `chrome.tabs.query({ audible: true })` — what is making noise now.
- **Unmute** operates on `chrome.tabs.query({ muted: true })` — every muted tab, including ones that stopped producing audio while muted and therefore no longer appear in the popup list.

This asymmetry is deliberate. A tab muted ten minutes ago is invisible in the list but still muted; "Unmute all" must free it.

### New action verbs (cross-profile)

Three new values for the existing `action` string field, handled by `action-handler.js` in the *target* profile:

| Verb | Target profile behavior | Uses `target_tab_id` |
|---|---|---|
| `mute_all` | mute every audible tab | no |
| `unmute_all` | unmute every muted tab | no |
| `mute_others` | mute every audible tab except `target_tab_id` | yes |

`mute_others` reuses the `TargetTabId` field already present in `store.Action`, so the Go structs are untouched.

**Backward compatibility:** a profile still running extension v2.0.x hits the `default:` branch of `handleActionRequest` and replies `unknown action: mute_all`. That reply does not reach the sender — `handleActionResult` in the host only deletes the action file and ignores `success`, and `send_action` is acknowledged as soon as the file is written. So the failure is not reported as a toast; it shows up as tabs that stay unmuted after the list refreshes. This is the same guarantee the existing per-tab cross-profile mute has always had. There is also no way to detect a peer's extension version (the state file schema is fixed by the Go structs), so the controls are always shown.

### Solo semantics

Solo from a row belonging to profile P mutes everything except that one tab:

- own profile audible tabs, excluding the tab itself if P is the own profile → direct `chrome.tabs.update`
- for each other profile Q ≠ P → `send_action('mute_all')`
- if P is another profile → `send_action('mute_others', target_tab_id = tab.tab_id)` to P

The same code path serves own-profile and cross-profile rows.

### Volume architecture

```
popup (slider)
   │  chrome.permissions.contains / .request   ← optional scripting + <all_urls>
   ↓
chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func, args })
   ↓
page + every same-tab frame
   ├── read:  max(volume) across <video>/<audio>, or null if none
   └── write: el.volume = v for all, plus capture-phase 'play'/'loadstart'
              listeners so media created later inherits the value
```

Capture-phase event listeners are used rather than a `MutationObserver`. On a heavy SPA (YouTube) a subtree observer firing `querySelectorAll` on every mutation is a measurable cost; `play`/`loadstart` fire exactly when a new media element starts and cover the real case. A `volumechange` hook is deliberately **not** installed — it would fight the site's own volume slider.

`allFrames: true` is why the permission is `<all_urls>` rather than per-origin: an embedded player (YouTube iframe on a blog) lives in a different origin than the top frame, and per-origin grants would leave it uncontrolled.

Failure modes and their UI:

| Situation | Result |
|---|---|
| Permission not yet granted | Panel shows explanation + "Enable" button |
| Permission denied by user | Panel keeps showing the button; nothing breaks |
| `chrome://`, Web Store, PDF viewer | `executeScript` throws → slider disabled, tooltip explains |
| Page has no `<video>`/`<audio>` | read returns `null` → slider disabled, tooltip explains |
| Audio produced only via Web Audio API | same as above — honest "not available" rather than a slider that does nothing |

### Permission model

```json
"optional_permissions": ["scripting"],
"optional_host_permissions": ["<all_urls>"]
```

Optional permissions do not appear in the install prompt and do not trigger re-acceptance on update, so existing users are untouched. Chrome closes the popup when the permission prompt opens; a flag in `chrome.storage.session` records which tab's volume panel was open so the popup re-opens in the same state.

## UI

```
● Audio Tabs                            🔇 🔊   ← global scope; always present when any audio
┌───────────────────────────────────────────┐
│ 👤 Work (this profile)                 ✏️ │
└───────────────────────────────────────────┘
 THIS WINDOW                            🔇 🔊   ← only rendered when own audio spans >1 window
 ┌─────────────────────────────────────────┐
 │ ▶ YouTube — Lofi         🎚 🎧 🔇 ✕    │
 └─────────────────────────────────────────┘
 OTHER WINDOWS                          🔇 🔊
 ┌─────────────────────────────────────────┐
 │ ▶ Twitch                 🎚 🎧 🔇 ✕    │
 └─────────────────────────────────────────┘
 OTHER PROFILES
 Personal                               🔇 🔊   ← per-profile scope
 ┌─────────────────────────────────────────┐
 │ ▶ Netflix                   🎧 🔇 ✕    │   ← no 🎚 on cross-profile rows
 └─────────────────────────────────────────┘
```

Design rules:

- The global controls live on the `h1` row — no extra vertical space in a popup that is already tall.
- Window subgroups appear **only** when own-profile audible tabs span more than one window. The common single-window case renders exactly as it does today, plus the `h1` controls.
- With one window and no other profiles, the `h1` controls are the only bulk affordance — no redundant "this window" header.
- Cross-profile rows carry solo, mute and close; no volume.
- The volume panel is an expandable region below its row, so closed rows keep today's height.

Row width: four 26px buttons plus gaps consume ~112px. `body { min-width }` goes from 340px to 360px to keep the title readable.

## Files

### New

```
popup-actions.js     scope descriptors → chrome.tabs calls and/or send_action
popup-volume.js      optional permission handling + volume read/write injection
```

Loaded as additional classic `<script>` tags in `popup.html`, matching the existing no-build, no-module convention (the service worker uses `importScripts` for the same reason).

### Modified

```
manifest.json        version 2.1.0; optional_permissions; optional_host_permissions
action-handler.js    + mute_all, unmute_all, mute_others
popup.html           global controls in the h1 row; window subgroup containers
popup.css            bulk control buttons, group headers, volume panel, permission notice
popup.js             window grouping, group headers, solo + volume buttons, new keys
_locales/en          new keys
_locales/pt_BR       new keys (ASCII only, per existing convention)
README.md            feature list
STORE_LISTING.md     feature list + optional-permission justification for the CWS form
```

`popup.js` is 574 lines today and the additions would push it past 1100. Splitting mutation logic and volume logic out keeps each file focused: if volume is ever pulled, one file disappears.

`scripts/build-extension-zip.sh` needs no change — it excludes by blacklist, so new root-level `.js` files are packaged automatically.

### Untouched

The entire `native-host/` tree. This is the point of encoding bulk operations as opaque action strings.

## i18n keys

| Key | en |
|---|---|
| `muteAllEverywhere` | Mute all tabs everywhere |
| `unmuteAllEverywhere` | Unmute all tabs everywhere |
| `muteAllThisWindow` | Mute all tabs in this window |
| `unmuteAllThisWindow` | Unmute all tabs in this window |
| `muteAllOtherWindows` | Mute all tabs in other windows |
| `unmuteAllOtherWindows` | Unmute all tabs in other windows |
| `muteAllInProfile` | Mute all tabs in $PROFILE$ |
| `unmuteAllInProfile` | Unmute all tabs in $PROFILE$ |
| `thisWindowHeader` | This window |
| `otherWindowsHeader` | Other windows |
| `muteOthers` | Mute all other tabs |
| `volumeLabel` | Volume |
| `volumeAria` | Tab volume |
| `volumeUnavailable` | Volume control is not available on this tab |
| `volumePermissionBody` | Volume control needs permission to adjust media on the page. |
| `volumePermissionButton` | Enable volume control |
| `nothingToMuteToast` | Nothing to mute |
| `nothingToUnmuteToast` | Nothing to unmute |

`pt_BR` values follow the existing accent-free convention ("audio", not "áudio").

A bulk operation shows **no** success toast. The toast is `position: fixed` over the bottom of the list for three seconds; firing it on every bulk click would cover the very rows the user is looking at. The list re-rendering with flipped icons is the feedback. Only the two "nothing matched" cases speak up, because there the UI would otherwise appear not to have reacted at all.

## Keyboard

Added to the existing `setupKeyboardNavigation` handler:

| Key | Action |
|---|---|
| `Shift+M` | Mute all (global scope) |
| `Shift+U` | Unmute all (global scope) |
| `s` | Solo the focused row |
| `v` | Toggle the volume panel of the focused row |

Existing bindings (`↑ ↓ Home End Enter Space m Delete Backspace`) are unchanged. The handler already ignores events originating in `input`/`textarea`, which covers the range slider.

## Error handling

- Own-profile `chrome.tabs.update` failures inside a bulk loop are counted, not thrown — a discarded or closed tab must not abort the batch. The toast reports how many actually changed.
- Cross-profile `send_action` is fire-and-check: a failed or timed-out send shows `actionFailedToast`, exactly as the existing per-tab path does.
- After a cross-profile bulk action the popup optimistically updates icons, then re-reads the aggregate after ~400ms to reflect the target profile's real state.
- `chrome.permissions.request` rejection (user dismissed) is a no-op; the panel keeps offering the button.
- `executeScript` rejection is caught and rendered as the disabled-slider state, never as a toast.

## Manual QA checklist

Extension:

- [ ] Single window, several audio tabs — no window subgroup headers, `h1` controls mute/unmute all.
- [ ] Two windows with audio — "This window" / "Other windows" headers appear with working controls.
- [ ] "Other windows" mute leaves the current window's audio untouched.
- [ ] Unmute all frees a tab that was muted earlier and is no longer audible.
- [ ] Solo from an own-profile row silences everything else, including other profiles.
- [ ] Solo from a cross-profile row silences everything else, including the own profile.
- [ ] Toast counts match the number of tabs actually changed.

Cross-profile:

- [ ] Two profiles, both on v2.1.0, host running — per-profile mute/unmute works and the list refreshes.
- [ ] Peer profile on v2.0.x — action fails visibly with `actionFailedToast`, nothing hangs.
- [ ] Host not installed — no other-profile section; `h1` controls still work on the own profile.

Volume:

- [ ] First 🎚 click shows the permission notice; granting it makes the slider live.
- [ ] Popup reopens with the same volume panel expanded after the permission prompt closes it.
- [ ] Denying permission leaves the notice in place with no console errors.
- [ ] YouTube: slider changes volume; navigating to another video keeps the chosen volume.
- [ ] Blog page with an embedded YouTube iframe: slider reaches the iframe player.
- [ ] Netflix (DRM): slider changes volume and audio does not cut out.
- [ ] `chrome://extensions` or a PDF tab: slider is disabled with the explanatory tooltip.
- [ ] Page reload restores the site's own volume (documented behavior, not a bug).

Accessibility:

- [ ] All new buttons reachable by Tab with visible focus rings.
- [ ] `Shift+M`, `Shift+U`, `s`, `v` behave as specified and do not fire while the profile-name input has focus.
- [ ] Slider is operable with arrow keys and announces its value.

## Rollout

Ships as extension v2.1.0 through the Chrome Web Store. No GitHub release, no installer rebuild — the native host stays at 2.0.0 and `EXPECTED_HOST_VERSION` in `host-connection.js` is unchanged, so no user sees the "update available" banner.

The CWS submission must justify two optional permissions:

- `scripting` — "Injects a small script into a tab, only when the user moves that tab's volume slider, to set the volume of its audio and video elements."
- `<all_urls>` (optional host permission) — "Requested only when the user first uses the volume slider. Needed because the media element may live in a cross-origin iframe. Never requested at install time and never used for reading page content."
