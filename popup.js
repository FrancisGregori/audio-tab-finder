document.addEventListener('DOMContentLoaded', () => {
  initializeI18n();
  loadAudioTabs();
  setupKeyboardNavigation();
});

function initializeI18n() {
  document.getElementById('popup-title').textContent = chrome.i18n.getMessage('popupTitle');
  document.getElementById('empty-message').textContent = chrome.i18n.getMessage('emptyStateMessage');
}

function setupKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    const tabItems = document.querySelectorAll('.tab-item');
    if (tabItems.length === 0) return;

    const focusedElement = document.activeElement;
    const currentIndex = Array.from(tabItems).findIndex(item => item.contains(focusedElement));

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (currentIndex < tabItems.length - 1) {
          tabItems[currentIndex + 1].focus();
        } else if (currentIndex === -1) {
          tabItems[0].focus();
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (currentIndex > 0) {
          tabItems[currentIndex - 1].focus();
        }
        break;
      case 'Home':
        e.preventDefault();
        tabItems[0].focus();
        break;
      case 'End':
        e.preventDefault();
        tabItems[tabItems.length - 1].focus();
        break;
      case 'm':
      case 'M':
        if (currentIndex !== -1) {
          const muteBtn = tabItems[currentIndex].querySelector('.mute-btn');
          if (muteBtn) muteBtn.click();
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (currentIndex !== -1 && !e.target.matches('input, textarea')) {
          e.preventDefault();
          const closeBtn = tabItems[currentIndex].querySelector('.close-btn');
          if (closeBtn) closeBtn.click();
        }
        break;
    }
  });
}

async function loadAudioTabs() {
  const tabsList = document.getElementById('tabs-list');
  const emptyState = document.getElementById('empty-state');

  try {
    const tabs = await chrome.tabs.query({ audible: true });

    if (tabs.length === 0) {
      tabsList.classList.add('hidden');
      tabsList.setAttribute('aria-hidden', 'true');
      emptyState.classList.remove('hidden');
      emptyState.setAttribute('aria-hidden', 'false');
      return;
    }

    tabsList.classList.remove('hidden');
    tabsList.setAttribute('aria-hidden', 'false');
    emptyState.classList.add('hidden');
    emptyState.setAttribute('aria-hidden', 'true');
    tabsList.innerHTML = '';

    tabs.forEach((tab, index) => {
      const tabElement = createTabElement(tab, index);
      tabsList.appendChild(tabElement);
    });

    // Focus first item for keyboard accessibility
    const firstItem = tabsList.querySelector('.tab-item');
    if (firstItem) {
      firstItem.setAttribute('tabindex', '0');
    }
  } catch (error) {
    console.error('Error loading tabs:', error);
  }
}

function createTabElement(tab, index) {
  const tabItem = document.createElement('div');
  tabItem.className = 'tab-item';
  tabItem.setAttribute('data-tab-id', tab.id);
  tabItem.setAttribute('role', 'listitem');
  tabItem.setAttribute('tabindex', index === 0 ? '0' : '-1');
  tabItem.setAttribute('aria-label', `${tab.title || chrome.i18n.getMessage('untitled')}. ${chrome.i18n.getMessage('switchToTab')}`);

  const favicon = document.createElement('img');
  favicon.className = 'tab-favicon';
  favicon.src = tab.favIconUrl || 'icons/icon16.png';
  favicon.alt = '';
  favicon.setAttribute('aria-hidden', 'true');
  favicon.onerror = () => {
    favicon.src = 'icons/icon16.png';
  };

  const audioIndicator = document.createElement('div');
  audioIndicator.className = 'audio-indicator' + (tab.mutedInfo?.muted ? ' muted' : '');
  audioIndicator.setAttribute('aria-hidden', 'true');
  audioIndicator.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
    </svg>
  `;

  const srAudioStatus = document.createElement('span');
  srAudioStatus.className = 'sr-only';
  srAudioStatus.textContent = tab.mutedInfo?.muted
    ? chrome.i18n.getMessage('audioMuted')
    : chrome.i18n.getMessage('audioPlaying');

  const tabInfo = document.createElement('div');
  tabInfo.className = 'tab-info';

  const tabTitle = document.createElement('div');
  tabTitle.className = 'tab-title';
  tabTitle.textContent = tab.title || chrome.i18n.getMessage('untitled');
  tabTitle.title = tab.title || chrome.i18n.getMessage('untitled');

  const tabUrl = document.createElement('div');
  tabUrl.className = 'tab-url';
  tabUrl.textContent = formatUrl(tab.url);
  tabUrl.title = tab.url;

  tabInfo.appendChild(tabTitle);
  tabInfo.appendChild(tabUrl);

  const muteBtn = document.createElement('button');
  muteBtn.className = 'mute-btn';
  muteBtn.setAttribute('type', 'button');
  muteBtn.setAttribute('aria-label', tab.mutedInfo?.muted ? chrome.i18n.getMessage('unmuteTab') : chrome.i18n.getMessage('muteTab'));
  muteBtn.title = tab.mutedInfo?.muted ? chrome.i18n.getMessage('unmuteTab') : chrome.i18n.getMessage('muteTab');
  updateMuteButtonIcon(muteBtn, tab.mutedInfo?.muted);

  muteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMute(tab.id, muteBtn, audioIndicator, srAudioStatus);
  });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'close-btn';
  closeBtn.setAttribute('type', 'button');
  closeBtn.setAttribute('aria-label', chrome.i18n.getMessage('closeTab'));
  closeBtn.title = chrome.i18n.getMessage('closeTab');
  closeBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;

  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTab(tab.id, tabItem);
  });

  tabItem.addEventListener('click', () => {
    switchToTab(tab.id, tab.windowId);
  });

  tabItem.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      switchToTab(tab.id, tab.windowId);
    }
  });

  // Update tabindex on focus for roving tabindex pattern
  tabItem.addEventListener('focus', () => {
    document.querySelectorAll('.tab-item').forEach(item => {
      item.setAttribute('tabindex', '-1');
    });
    tabItem.setAttribute('tabindex', '0');
  });

  tabItem.appendChild(favicon);
  tabItem.appendChild(audioIndicator);
  tabItem.appendChild(srAudioStatus);
  tabItem.appendChild(tabInfo);
  tabItem.appendChild(muteBtn);
  tabItem.appendChild(closeBtn);

  return tabItem;
}

function formatUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}

async function switchToTab(tabId, windowId) {
  try {
    await chrome.tabs.update(tabId, { active: true });
    await chrome.windows.update(windowId, { focused: true });
    window.close();
  } catch (error) {
    console.error('Error switching to tab:', error);
  }
}

async function closeTab(tabId, tabElement) {
  try {
    // Find next element to focus before removing
    const nextFocusable = tabElement.nextElementSibling || tabElement.previousElementSibling;

    await chrome.tabs.remove(tabId);
    tabElement.remove();

    const tabsList = document.getElementById('tabs-list');
    const emptyState = document.getElementById('empty-state');

    if (tabsList.children.length === 0) {
      tabsList.classList.add('hidden');
      tabsList.setAttribute('aria-hidden', 'true');
      emptyState.classList.remove('hidden');
      emptyState.setAttribute('aria-hidden', 'false');
    } else if (nextFocusable) {
      nextFocusable.focus();
      nextFocusable.setAttribute('tabindex', '0');
    }
  } catch (error) {
    console.error('Error closing tab:', error);
  }
}

async function toggleMute(tabId, muteBtn, audioIndicator, srAudioStatus) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const newMutedState = !tab.mutedInfo?.muted;
    await chrome.tabs.update(tabId, { muted: newMutedState });

    updateMuteButtonIcon(muteBtn, newMutedState);
    const muteLabel = newMutedState ? chrome.i18n.getMessage('unmuteTab') : chrome.i18n.getMessage('muteTab');
    muteBtn.title = muteLabel;
    muteBtn.setAttribute('aria-label', muteLabel);

    srAudioStatus.textContent = newMutedState
      ? chrome.i18n.getMessage('audioMuted')
      : chrome.i18n.getMessage('audioPlaying');

    if (newMutedState) {
      audioIndicator.classList.add('muted');
    } else {
      audioIndicator.classList.remove('muted');
    }
  } catch (error) {
    console.error('Error toggling mute:', error);
  }
}

function updateMuteButtonIcon(muteBtn, isMuted) {
  if (isMuted) {
    muteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
      </svg>
    `;
  } else {
    muteBtn.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
      </svg>
    `;
  }
}
