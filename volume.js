/*
 * Per-tab volume. Loaded by both the popup and the service worker — the popup
 * drives its own tabs directly, the service worker does the same on behalf of
 * another profile that asked through the native host.
 *
 * Chrome has no volume API for tabs — only mute — so we inject a tiny script
 * that sets `volume` on the page's media elements. That needs `scripting` plus
 * a host permission, both declared *optional* in the manifest: asking for them
 * at install time would force every existing user to re-accept permissions
 * before the extension would run again.
 *
 * `<all_urls>` rather than per-origin because the player is often in a
 * cross-origin iframe (an embedded YouTube video on a blog), and each frame
 * needs its own permission.
 */

const VOLUME_PERMISSIONS = { permissions: ['scripting'], origins: ['<all_urls>'] };
const VOLUME_PANEL_SESSION_KEY = 'openVolumePanelTabId';
const REMOTE_VOLUME_SESSION_KEY = 'remoteTabVolumes';

// Cross-profile volume rides the action string, which the native host copies
// verbatim without interpreting it. That keeps the feature working against the
// host people already have installed.
const VOLUME_ACTION_PREFIX = 'volume:';

async function hasVolumePermission() {
  try {
    return await chrome.permissions.contains(VOLUME_PERMISSIONS);
  } catch (e) {
    return false;
  }
}

async function requestVolumePermission() {
  try {
    return await chrome.permissions.request(VOLUME_PERMISSIONS);
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
  if (!(await hasVolumePermission())) {
    throw new Error('volume control not enabled in this profile');
  }
  await writeTabVolume(tabId, Math.max(0, Math.min(1, percent / 100)));
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
