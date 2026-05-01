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
