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
      hostStatus: 'disconnected',
      hostVersion: null,
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
    return {
      ok: true,
      hostInstalled: true,
      hostStatus: isHostOutdated() ? 'outdated' : 'ok',
      hostVersion: getHostVersion(),
      profiles: resp.profiles,
    };
  } catch (e) {
    return { ok: false, hostInstalled: true, hostStatus: 'unknown', hostVersion: null, error: e.message };
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
