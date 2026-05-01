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

let _lastAggregateProfiles = null;

setHostMessageHandler((msg) => {
  if (!msg) return;
  if (msg.type === 'action_request') {
    handleActionRequest(msg);
    return;
  }
  if (msg.type === 'state_changed') {
    _lastAggregateProfiles = Array.isArray(msg.profiles) ? msg.profiles : null;
    updateBadge();
  }
});

setHostConnectionChangeHandler(async (connected) => {
  if (connected) {
    await sendInitialHello();
    sendCurrentState();
  } else {
    _lastAggregateProfiles = null;
    updateBadge();
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
    const ownTabs = await chrome.tabs.query({ audible: true });
    const ownCount = ownTabs.length;

    let totalCount = ownCount;
    if (_lastAggregateProfiles) {
      totalCount = 0;
      for (const p of _lastAggregateProfiles) {
        if (p && Array.isArray(p.tabs)) totalCount += p.tabs.length;
      }
    }

    let text = '';
    if (totalCount === 0) {
      text = '';
    } else if (totalCount === ownCount) {
      text = String(ownCount);
    } else {
      text = `${ownCount}/${totalCount}`;
    }

    if (text) {
      chrome.action.setBadgeText({ text });
      chrome.action.setBadgeBackgroundColor({ color: '#4ade80' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
  } catch (e) {
    // ignore
  }
}

initialize();
