importScripts(
  'profile.js',
  'host-connection.js',
  'state-sync.js',
  'action-handler.js',
  'popup-bridge.js'
);

chrome.runtime.onStartup.addListener(initialize);
chrome.runtime.onInstalled.addListener(initialize);

setupPopupBridge();

setHostMessageHandler((msg) => {
  if (msg && msg.type === 'action_request') {
    handleActionRequest(msg);
  }
});

setHostConnectionChangeHandler(async (connected) => {
  if (connected) {
    await sendInitialHello();
    sendCurrentState();
  }
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.audible !== undefined) {
    updateBadge();
  }
});

chrome.tabs.onRemoved.addListener(updateBadge);

async function initialize() {
  const profileUuid = await getOrCreateProfileUuid();
  setupStateSync(profileUuid);
  updateBadge();
  try {
    await connectToHost();
  } catch (e) {
    // host not installed; popup will degrade. Reconnect attempts continue.
  }
}

async function updateBadge() {
  try {
    const tabs = await chrome.tabs.query({ audible: true });
    const count = tabs.length;
    if (count > 0) {
      chrome.action.setBadgeText({ text: count.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#4ade80' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (e) {
    // ignore
  }
}

initialize();
