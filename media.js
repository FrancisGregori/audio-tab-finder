/*
 * Reaching into a tab's media elements: volume and pause/resume. Loaded by both
 * the popup and the service worker — the popup drives its own tabs directly,
 * the service worker does the same on behalf of another profile that asked
 * through the native host.
 *
 * Chrome has no volume or playback API for tabs — only mute — so we inject a
 * tiny script that drives the page's media elements. That needs `scripting`
 * plus a host permission, both declared *optional* in the manifest: asking for
 * them at install time would force every existing user to re-accept permissions
 * before the extension would run again.
 *
 * `<all_urls>` rather than per-origin because the player is often in a
 * cross-origin iframe (an embedded YouTube video on a blog), and each frame
 * needs its own permission.
 */

const MEDIA_PERMISSIONS = { permissions: ['scripting'], origins: ['<all_urls>'] };
const VOLUME_PANEL_SESSION_KEY = 'openVolumePanelTabId';
const REMOTE_VOLUME_SESSION_KEY = 'remoteTabVolumes';
const PAUSED_TABS_SESSION_KEY = 'pausedTabIds';

// Cross-profile volume rides the action string, which the native host copies
// verbatim without interpreting it. That keeps the feature working against the
// host people already have installed.
const VOLUME_ACTION_PREFIX = 'volume:';

async function hasMediaPermission() {
  try {
    return await chrome.permissions.contains(MEDIA_PERMISSIONS);
  } catch (e) {
    return false;
  }
}

async function requestMediaPermission() {
  try {
    return await chrome.permissions.request(MEDIA_PERMISSIONS);
  } catch (e) {
    return false;
  }
}

/**
 * Loudest media element in the tab, 0..1, or null when the tab has no media
 * we can reach (chrome:// page, PDF viewer, audio produced only via Web Audio).
 * Throws when the tab cannot be scripted at all.
 */
async function readTabVolume(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: atfReadVolume,
  });
  let loudest = null;
  for (const frame of results) {
    if (typeof frame.result === 'number' && (loudest === null || frame.result > loudest)) {
      loudest = frame.result;
    }
  }
  return loudest;
}

async function writeTabVolume(tabId, volume) {
  await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: atfApplyVolume,
    args: [volume],
  });
}

/**
 * Service-worker side of a cross-profile volume change. Throws when this
 * profile never granted the optional permission — the requesting profile has
 * no way to learn that (the host acknowledges the action file, not its
 * execution), which is why its popup shows a note instead.
 */
async function applyRemoteVolumeAction(action, tabId) {
  const percent = Number(action.slice(VOLUME_ACTION_PREFIX.length));
  if (!Number.isFinite(percent)) throw new Error('malformed volume action: ' + action);
  if (!(await hasMediaPermission())) {
    throw new Error('volume control not enabled in this profile');
  }
  await writeTabVolume(tabId, Math.max(0, Math.min(1, percent / 100)));
}

/**
 * Pauses or resumes a tab's media. Returns how many elements actually changed,
 * so the caller can distinguish "paused it" from "there was nothing playing".
 * Throws when the tab cannot be scripted.
 */
async function setTabPaused(tabId, paused) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: atfSetPaused,
    args: [paused],
  });
  let changed = 0;
  for (const frame of results) {
    if (typeof frame.result === 'number') changed += frame.result;
  }
  return changed;
}

// --- injected into the page; cannot reference anything outside themselves ---

function atfReadVolume() {
  const elements = document.querySelectorAll('video, audio');
  if (elements.length === 0) return null;
  let loudest = 0;
  for (const el of elements) {
    if (typeof el.volume === 'number' && el.volume > loudest) loudest = el.volume;
  }
  return loudest;
}

function atfSetPaused(paused) {
  // Only resume what we paused. A page can hold a dozen media elements (a
  // video feed, autoplay previews); calling play() on all of them would turn
  // "resume" into a cacophony. The set lives on the isolated world's window,
  // which persists across injections into the same document.
  if (!window.__audioTabFinderPaused) window.__audioTabFinderPaused = new WeakSet();
  const ours = window.__audioTabFinderPaused;

  let changed = 0;
  for (const el of document.querySelectorAll('video, audio')) {
    try {
      if (paused) {
        if (!el.paused) {
          el.pause();
          ours.add(el);
          changed++;
        }
      } else if (ours.has(el) && el.paused) {
        ours.delete(el);
        const started = el.play();
        // Autoplay policy can reject this; the caller reports it, and the user
        // can always press play in the tab itself.
        if (started && typeof started.catch === 'function') started.catch(() => {});
        changed++;
      }
    } catch (e) {
      // element in a state that rejects the call — leave it alone
    }
  }
  return changed;
}

function atfHasPausedByUs() {
  const ours = window.__audioTabFinderPaused;
  if (!ours) return false;
  for (const el of document.querySelectorAll('video, audio')) {
    if (ours.has(el) && el.paused) return true;
  }
  return false;
}

function atfApplyVolume(volume) {
  const level = Math.max(0, Math.min(1, volume));
  window.__audioTabFinderVolume = level;

  for (const el of document.querySelectorAll('video, audio')) {
    try {
      el.volume = level;
    } catch (e) {
      // element in a state that rejects the assignment — leave it alone
    }
  }

  // Media created later (an SPA loading the next video) has to inherit the
  // level. Capture-phase play/loadstart listeners are far cheaper than a
  // subtree MutationObserver on a heavy page, and they fire exactly when it
  // matters. Deliberately not hooking `volumechange` — that would fight the
  // site's own volume slider.
  if (!window.__audioTabFinderVolumeHooked) {
    window.__audioTabFinderVolumeHooked = true;
    const applyToTarget = (event) => {
      const el = event.target;
      if (el instanceof HTMLMediaElement) {
        try {
          el.volume = window.__audioTabFinderVolume;
        } catch (e) {
          // ignore
        }
      }
    };
    document.addEventListener('play', applyToTarget, true);
    document.addEventListener('loadstart', applyToTarget, true);
  }

  return level;
}

// --- popup reopening -------------------------------------------------------
// Chrome closes the popup when the permission prompt opens, so remember which
// row the user was on and restore it on the next open.

async function rememberOpenVolumePanel(tabId) {
  try {
    await chrome.storage.session.set({ [VOLUME_PANEL_SESSION_KEY]: tabId });
  } catch (e) {
    // session storage unavailable — the panel just won't reopen
  }
}

async function forgetOpenVolumePanel() {
  try {
    await chrome.storage.session.remove(VOLUME_PANEL_SESSION_KEY);
  } catch (e) {
    // ignore
  }
}

// --- remembered cross-profile levels ---------------------------------------
// We cannot read the real volume of a tab in another profile (that would need
// the native host to carry it in the state file, i.e. a helper everyone has to
// reinstall). Remembering what this profile last set keeps the slider from
// snapping back to 100% every time the popup reopens. Session storage, so it
// clears with the browser instead of accumulating dead tab ids forever.

function remoteVolumeKey(profileUuid, tabId) {
  return profileUuid + '|' + tabId;
}

async function getRememberedRemoteVolume(profileUuid, tabId) {
  try {
    const stored = await chrome.storage.session.get(REMOTE_VOLUME_SESSION_KEY);
    const map = stored[REMOTE_VOLUME_SESSION_KEY] || {};
    const value = map[remoteVolumeKey(profileUuid, tabId)];
    return typeof value === 'number' ? value : null;
  } catch (e) {
    return null;
  }
}

async function rememberRemoteVolume(profileUuid, tabId, percent) {
  try {
    const stored = await chrome.storage.session.get(REMOTE_VOLUME_SESSION_KEY);
    const map = stored[REMOTE_VOLUME_SESSION_KEY] || {};
    map[remoteVolumeKey(profileUuid, tabId)] = percent;
    await chrome.storage.session.set({ [REMOTE_VOLUME_SESSION_KEY]: map });
  } catch (e) {
    // the slider still works; it just won't remember where it was
  }
}

// --- paused tabs -----------------------------------------------------------
// A paused tab stops being `audible` within a couple of seconds and would
// vanish from the popup, stranding the user with no way to resume it. So we
// remember which tabs we paused and keep them in the list. Session storage:
// tab ids are meaningless after a restart, and this way nothing accumulates.

async function getPausedTabIds() {
  try {
    const stored = await chrome.storage.session.get(PAUSED_TABS_SESSION_KEY);
    const ids = stored[PAUSED_TABS_SESSION_KEY];
    return Array.isArray(ids) ? ids : [];
  } catch (e) {
    return [];
  }
}

async function setPausedTabIds(ids) {
  try {
    await chrome.storage.session.set({ [PAUSED_TABS_SESSION_KEY]: ids });
  } catch (e) {
    // the pause itself still worked; we just lose track of it
  }
}

async function addPausedTabId(tabId) {
  const ids = await getPausedTabIds();
  if (!ids.includes(tabId)) await setPausedTabIds(ids.concat(tabId));
}

async function removePausedTabId(tabId) {
  const ids = await getPausedTabIds();
  if (ids.includes(tabId)) await setPausedTabIds(ids.filter((id) => id !== tabId));
}

/**
 * Tabs we paused that are still worth showing: drops the ones that were closed,
 * the ones the user restarted from the page, and any we can no longer reach,
 * then writes the pruned list back.
 */
async function resolvePausedTabs() {
  const ids = await getPausedTabIds();
  if (ids.length === 0) return [];
  if (!(await hasMediaPermission())) {
    // Without the permission we could neither have paused these nor resume
    // them; keeping them listed would only strand the user.
    await setPausedTabIds([]);
    return [];
  }

  const resolved = await Promise.all(
    ids.map(async (id) => {
      try {
        const tab = await chrome.tabs.get(id);
        if (!tab) return null;
        // `tab.audible` is the wrong question: it lags a couple of seconds
        // behind the pause, and it says nothing about whether the user hit
        // play in the page. Ask the media elements directly.
        if (!(await isTabPausedByUs(id))) return null;
        return {
          tab_id: tab.id,
          window_id: tab.windowId,
          title: tab.title || '',
          url: tab.url || '',
          favicon_url: tab.favIconUrl || '',
          muted: !!(tab.mutedInfo && tab.mutedInfo.muted),
          paused: true,
        };
      } catch (e) {
        return null; // tab is gone, discarded, or no longer scriptable
      }
    })
  );

  const alive = resolved.filter(Boolean);
  if (alive.length !== ids.length) {
    await setPausedTabIds(alive.map((tab) => tab.tab_id));
  }
  return alive;
}

async function isTabPausedByUs(tabId) {
  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: atfHasPausedByUs,
  });
  return results.some((frame) => frame.result === true);
}

async function takeOpenVolumePanel() {
  try {
    const stored = await chrome.storage.session.get(VOLUME_PANEL_SESSION_KEY);
    const tabId = stored[VOLUME_PANEL_SESSION_KEY];
    if (tabId === undefined) return null;
    await forgetOpenVolumePanel();
    return typeof tabId === 'number' ? tabId : null;
  } catch (e) {
    return null;
  }
}
