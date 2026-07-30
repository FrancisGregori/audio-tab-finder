const HEARTBEAT_INTERVAL_MS = 20_000;
const STATE_SYNC_DEBOUNCE_MS = 150;

let _stateSyncProfileUuid = null;
let _stateSyncHeartbeatHandle = null;
let _stateSyncDebounceHandle = null;

function setupStateSync(profileUuid) {
  _stateSyncProfileUuid = profileUuid;

  chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.audible !== undefined || changeInfo.mutedInfo !== undefined) {
      scheduleStateSync();
    }
  });

  chrome.tabs.onRemoved.addListener(() => scheduleStateSync());

  startHeartbeat();
  sendCurrentState();
}

// A bulk mute fires one onUpdated per tab. Coalesce the burst into a single
// push instead of rewriting the state file once per tab.
function scheduleStateSync() {
  if (_stateSyncDebounceHandle !== null) clearTimeout(_stateSyncDebounceHandle);
  _stateSyncDebounceHandle = setTimeout(() => {
    _stateSyncDebounceHandle = null;
    sendCurrentState();
  }, STATE_SYNC_DEBOUNCE_MS);
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
