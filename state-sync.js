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
