// Update badge when extension loads
updateBadge();

// Listen for tab updates (audio state changes)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.audible !== undefined) {
    updateBadge();
  }
});

// Listen for tab removal
chrome.tabs.onRemoved.addListener(() => {
  updateBadge();
});

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
  } catch (error) {
    console.error('Error updating badge:', error);
  }
}
