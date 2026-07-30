/*
 * Every mute/close/activate the popup performs, for this profile and — through
 * the native host — for other profiles.
 *
 * Bulk operations are expressed as a scope descriptor so the UI never has to
 * know whether a set of tabs lives in this profile, another window, or another
 * Chrome profile:
 *
 *   { kind: 'window',        windowId }          this profile, one window
 *   { kind: 'other-windows', excludeWindowId }   this profile, every other window
 *   { kind: 'own' }                              this profile, every window
 *   { kind: 'profile',       profileUuid }       one other profile
 *   { kind: 'global' }                           this profile + every other one
 *
 * The three bulk verbs (mute_all, unmute_all, mute_others) are new in extension
 * v2.1.0 but need no native host change: the host copies the action string into
 * the action file without interpreting it.
 */

async function getCurrentWindowId() {
  try {
    const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (active && typeof active.windowId === 'number') return active.windowId;
  } catch (e) {
    // fall through to the focused-window lookup
  }
  try {
    const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
    if (win && typeof win.id === 'number') return win.id;
  } catch (e) {
    // no window we can identify
  }
  return null;
}

// ---------------------------------------------------------------- single tab

async function setTabMuted(tab, isOwnProfile, ownerProfileUuid, muted) {
  if (isOwnProfile) {
    await chrome.tabs.update(tab.tab_id, { muted });
    return;
  }
  const ok = await sendProfileAction({
    profileUuid: ownerProfileUuid,
    action: muted ? 'mute' : 'unmute',
    targetTabId: tab.tab_id,
    targetWindowId: tab.window_id,
  });
  if (!ok) throw new Error('send_action failed');
}

async function removeTab(tab, isOwnProfile, ownerProfileUuid) {
  if (isOwnProfile) {
    await chrome.tabs.remove(tab.tab_id);
    return;
  }
  const ok = await sendProfileAction({
    profileUuid: ownerProfileUuid,
    action: 'close',
    targetTabId: tab.tab_id,
    targetWindowId: tab.window_id,
  });
  if (!ok) throw new Error('send_action failed');
}

async function setRemoteTabVolume(tab, ownerProfileUuid, percent) {
  const ok = await sendProfileAction({
    profileUuid: ownerProfileUuid,
    action: VOLUME_ACTION_PREFIX + Math.round(percent),
    targetTabId: tab.tab_id,
    targetWindowId: tab.window_id,
  });
  if (!ok) throw new Error('send_action failed');
}

async function focusTab(tab, isOwnProfile, ownerProfileUuid) {
  if (isOwnProfile) {
    await chrome.tabs.update(tab.tab_id, { active: true });
    await chrome.windows.update(tab.window_id, { focused: true });
    return;
  }
  const ok = await sendProfileAction({
    profileUuid: ownerProfileUuid,
    action: 'activate',
    targetTabId: tab.tab_id,
    targetWindowId: tab.window_id,
  });
  if (!ok) throw new Error('send_action failed');
}

// ---------------------------------------------------------------- bulk scopes

/**
 * Applies a bulk mute/unmute over a scope.
 * Returns { ownTargets, ownChanged, remoteSent } so the caller can tell the
 * difference between "nothing matched" and "everything worked".
 */
async function applyBulkMute(scope, muted, profiles) {
  const filter = ownFilterForScope(scope);
  const remote = remoteTargetsForScope(scope, profiles, muted);

  let ownTargets = 0;
  let ownChanged = 0;
  if (filter) {
    const result = await setMutedInOwnProfile(muted, filter);
    ownTargets = result.targets;
    ownChanged = result.changed;
  }

  let remoteSent = 0;
  for (const target of remote) {
    if (await sendProfileAction(target)) remoteSent++;
  }

  return { ownTargets, ownChanged, remoteSent, remoteRequested: remote.length };
}

/**
 * "Mute all but this tab." Silences everything the popup can reach, then makes
 * sure the surviving tab is actually audible — soloing a muted tab should let
 * you hear it.
 */
async function applySolo(tab, isOwnProfile, ownerProfileUuid, profiles) {
  const scope = {
    kind: 'solo',
    tabId: tab.tab_id,
    ownerProfileUuid: isOwnProfile ? null : ownerProfileUuid,
  };
  const result = await applyBulkMute(scope, true, profiles);
  await setTabMuted(tab, isOwnProfile, ownerProfileUuid, false);
  return result;
}

function ownFilterForScope(scope) {
  switch (scope.kind) {
    case 'window':
      return (tab) => tab.windowId === scope.windowId;
    case 'other-windows':
      return (tab) => tab.windowId !== scope.excludeWindowId;
    case 'own':
    case 'global':
      return () => true;
    case 'solo':
      // when the soloed tab belongs to another profile, every tab here is fair game
      return (tab) => scope.ownerProfileUuid !== null || tab.id !== scope.tabId;
    case 'profile':
      return null;
    default:
      return null;
  }
}

function remoteTargetsForScope(scope, profiles, muted) {
  const others = (profiles || []).filter((p) => !p.is_self && p.profile_uuid);
  const bulkVerb = muted ? 'mute_all' : 'unmute_all';

  switch (scope.kind) {
    case 'profile':
      return [{ profileUuid: scope.profileUuid, action: bulkVerb }];
    case 'global':
      return others.map((p) => ({ profileUuid: p.profile_uuid, action: bulkVerb }));
    case 'solo':
      return others.map((p) =>
        p.profile_uuid === scope.ownerProfileUuid
          ? { profileUuid: p.profile_uuid, action: 'mute_others', targetTabId: scope.tabId }
          : { profileUuid: p.profile_uuid, action: 'mute_all' }
      );
    default:
      return [];
  }
}

// Mute looks at what is making noise; unmute looks at everything currently
// muted, including tabs that went quiet while muted and dropped off the list.
async function setMutedInOwnProfile(muted, filter) {
  const tabs = await chrome.tabs.query(muted ? { audible: true } : { muted: true });
  const targets = tabs.filter((tab) => filter(tab) && isTabMuted(tab) !== muted);

  let changed = 0;
  await Promise.all(
    targets.map(async (tab) => {
      try {
        await chrome.tabs.update(tab.id, { muted });
        changed++;
      } catch (e) {
        // tab closed between the query and the update — not an error worth surfacing
      }
    })
  );
  return { targets: targets.length, changed };
}

function isTabMuted(tab) {
  return !!(tab.mutedInfo && tab.mutedInfo.muted);
}

// The host acknowledges that the action file was written, not that the other
// profile carried it out. A profile still on v2.0.x silently ignores the bulk
// verbs; the refreshed list is what tells the user it did not happen.
async function sendProfileAction({ profileUuid, action, targetTabId, targetWindowId }) {
  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'send_action',
      target_profile_uuid: profileUuid,
      action,
      target_tab_id: targetTabId || 0,
      target_window_id: targetWindowId || 0,
    });
    return !!(resp && resp.ok);
  } catch (e) {
    return false;
  }
}
