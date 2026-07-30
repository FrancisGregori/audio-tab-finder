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
      case 'mute_all':
        await setMutedForAll(true);
        success = true;
        break;
      case 'unmute_all':
        await setMutedForAll(false);
        success = true;
        break;
      case 'mute_others':
        await setMutedForAll(true, msg.target_tab_id);
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

// Muting targets tabs that are producing sound; unmuting targets every muted
// tab, including ones that went silent while muted and so no longer show up in
// the other profile's list.
async function setMutedForAll(muted, exceptTabId) {
  const tabs = await chrome.tabs.query(muted ? { audible: true } : { muted: true });
  await Promise.all(
    tabs.map(async (tab) => {
      if (exceptTabId !== undefined && tab.id === exceptTabId) return;
      if (muted && tab.mutedInfo && tab.mutedInfo.muted) return;
      try {
        await chrome.tabs.update(tab.id, { muted });
      } catch (e) {
        // tab closed between the query and the update — skip it
      }
    })
  );
}
