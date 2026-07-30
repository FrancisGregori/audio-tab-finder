document.addEventListener('DOMContentLoaded', async () => {
  initializeI18n();
  await initSupportFooter();
  await loadAndRender();
  await restorePendingVolumePanel();
  setupKeyboardNavigation();
});

const HOST_INSTALL_URL = 'https://github.com/FrancisGregori/audio-tab-finder#installation';
const HOST_RELEASES_URL = 'https://github.com/FrancisGregori/audio-tab-finder/releases/latest';

// A cross-profile action is acknowledged as soon as the host writes the action
// file, not when the other profile carries it out. Give it a beat before
// re-reading, so the refreshed list reflects what actually happened.
const REMOTE_ACTION_SETTLE_MS = 400;
const VOLUME_DEBOUNCE_MS = 60;

const ICON_SPEAKER = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
const ICON_SPEAKER_MUTED = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`;
const ICON_HEADPHONES = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M12 3a9 9 0 0 0-9 9v7a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-4a2 2 0 0 0-2-2H5v-1a7 7 0 0 1 14 0v1h-2a2 2 0 0 0-2 2v4a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-7a9 9 0 0 0-9-9z"/></svg>`;
const ICON_TUNE = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/></svg>`;

let _profiles = [];
let _currentWindowId = null;

function initializeI18n() {
  document.getElementById('popup-title').textContent = chrome.i18n.getMessage('popupTitle');
  document.getElementById('empty-message').textContent = chrome.i18n.getMessage('noAudioAnywhere');
  document.getElementById('other-profiles-header').textContent = chrome.i18n.getMessage('otherProfilesHeader');
  document.getElementById('own-empty').textContent = chrome.i18n.getMessage('thisProfileSilent');
  document.getElementById('support-message').textContent = chrome.i18n.getMessage('supportMessage');
  const bmcButton = document.getElementById('bmc-button');
  bmcButton.setAttribute('aria-label', chrome.i18n.getMessage('supportButtonAria'));
  bmcButton.title = chrome.i18n.getMessage('supportButtonAria');
  const dismissBtn = document.getElementById('support-dismiss');
  dismissBtn.setAttribute('aria-label', chrome.i18n.getMessage('supportDismissAria'));
  dismissBtn.title = chrome.i18n.getMessage('supportDismissAria');
}

const SUPPORT_REMIND_AFTER_MS = 30 * 24 * 60 * 60 * 1000;
const SUPPORT_MAX_DISMISSALS = 3;

async function initSupportFooter() {
  const footer = document.getElementById('support-footer');
  const stored = await chrome.storage.local.get(['supportDismissedAt', 'supportDismissCount']);
  const dismissedAt = stored.supportDismissedAt;
  const dismissCount = typeof stored.supportDismissCount === 'number' ? stored.supportDismissCount : 0;
  const dismissedForever = dismissCount >= SUPPORT_MAX_DISMISSALS;
  const recentlyDismissed =
    typeof dismissedAt === 'number' && Date.now() - dismissedAt < SUPPORT_REMIND_AFTER_MS;
  if (!dismissedForever && !recentlyDismissed) {
    footer.classList.remove('hidden');
  }
  document.getElementById('support-dismiss').addEventListener('click', async () => {
    footer.classList.add('hidden');
    await chrome.storage.local.set({
      supportDismissedAt: Date.now(),
      supportDismissCount: dismissCount + 1,
    });
  });
}

async function loadAndRender() {
  const focusedTabId = getFocusedTabId();
  const [resp, windowId] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'get_aggregate' }),
    getCurrentWindowId(),
  ]);
  if (!resp || !resp.ok) {
    showToast((resp && resp.error) || 'failed to load');
    return;
  }
  _profiles = resp.profiles || [];
  _currentWindowId = windowId;

  renderHostBanner(resp.hostInstalled, resp.hostStatus);
  renderProfileHeader(_profiles);
  renderGlobalBulk(_profiles);
  renderOwnProfileTabs(_profiles);
  renderOtherProfiles(_profiles);
  renderEmptyState(_profiles);

  restoreFocus(focusedTabId);
}

function getFocusedTabId() {
  const active = document.activeElement;
  const item = active && active.closest ? active.closest('.tab-item') : null;
  return item ? item.getAttribute('data-tab-id') : null;
}

function restoreFocus(tabId) {
  if (!tabId) return;
  const item = document.querySelector(`.tab-item[data-tab-id="${CSS.escape(tabId)}"]`);
  if (item) item.focus();
}

function renderHostBanner(hostInstalled, hostStatus) {
  const banner = document.getElementById('host-banner');
  banner.innerHTML = '';
  banner.classList.remove('host-banner--expanded');

  if (hostInstalled && hostStatus === 'ok') {
    banner.classList.add('hidden');
    return;
  }

  banner.classList.remove('hidden');

  const isOutdated = hostInstalled && hostStatus === 'outdated';

  const strip = document.createElement('div');
  strip.className = 'host-banner__strip';
  strip.tabIndex = 0;
  strip.setAttribute('role', 'button');
  strip.setAttribute('aria-expanded', 'false');

  const icon = document.createElement('span');
  icon.className = 'host-banner__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M11 9h2v2h-2zm0 4h2v6h-2zm1-9C6.48 4 2 8.48 2 14s4.48 10 10 10 10-4.48 10-10S17.52 4 12 4zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/>
    </svg>
  `;

  const question = document.createElement('span');
  question.className = 'host-banner__question';
  question.textContent = isOutdated
    ? chrome.i18n.getMessage('hostBannerQuestionOutdated')
    : chrome.i18n.getMessage('hostBannerQuestionMissing');

  const chevron = document.createElement('span');
  chevron.className = 'host-banner__chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.innerHTML = `<svg viewBox="0 0 24 24"><path d="M7 10l5 5 5-5z"/></svg>`;

  strip.appendChild(icon);
  strip.appendChild(question);
  strip.appendChild(chevron);

  const panel = document.createElement('div');
  panel.className = 'host-banner__panel';

  const explanation = document.createElement('p');
  explanation.textContent = isOutdated
    ? chrome.i18n.getMessage('hostBannerExplanationOutdated')
    : chrome.i18n.getMessage('hostBannerExplanationMissing');

  const link = document.createElement('a');
  link.className = 'host-banner__link';
  link.textContent = isOutdated
    ? chrome.i18n.getMessage('hostBannerLinkUpdate')
    : chrome.i18n.getMessage('hostBannerLinkInstall');
  link.href = '#';
  link.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    chrome.tabs.create({ url: isOutdated ? HOST_RELEASES_URL : HOST_INSTALL_URL });
    window.close();
  });

  panel.appendChild(explanation);
  panel.appendChild(link);

  const toggle = () => {
    const expanded = banner.classList.toggle('host-banner--expanded');
    strip.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  };
  strip.addEventListener('click', toggle);
  strip.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      toggle();
    }
  });

  banner.appendChild(strip);
  banner.appendChild(panel);
}

function getOwnProfile(profiles) {
  return profiles.find((p) => p.is_self) || null;
}

function getOtherProfiles(profiles) {
  return profiles.filter((p) => !p.is_self);
}

function hasAnyTabs(profiles) {
  return profiles.some((p) => p.tabs && p.tabs.length > 0);
}

function renderProfileHeader(profiles) {
  const header = document.getElementById('profile-header');
  header.innerHTML = '';
  const own = getOwnProfile(profiles);
  const label = (own && own.label) || '';

  const icon = makeProfileHeaderIcon();

  const text = document.createElement('span');
  text.className = 'profile-header__text';
  text.tabIndex = 0;
  text.setAttribute('role', 'button');
  text.setAttribute('aria-label', chrome.i18n.getMessage('profileLabelEditAria'));
  if (label) {
    text.textContent = label;
  } else {
    text.textContent = chrome.i18n.getMessage('profileLabelEmpty');
    text.classList.add('profile-header__text--empty');
  }
  text.addEventListener('click', () => enterLabelEditMode(label));
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      enterLabelEditMode(label);
    }
  });

  const suffix = document.createElement('span');
  suffix.className = 'profile-header__suffix';
  suffix.textContent = chrome.i18n.getMessage('thisProfileSuffix');

  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'profile-header__edit-btn';
  editBtn.setAttribute('aria-label', chrome.i18n.getMessage('profileLabelEditAria'));
  editBtn.title = chrome.i18n.getMessage('profileLabelEditAria');
  editBtn.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/>
    </svg>
  `;
  editBtn.addEventListener('click', () => enterLabelEditMode(label));

  header.appendChild(icon);
  header.appendChild(text);
  header.appendChild(suffix);
  header.appendChild(editBtn);
}

function makeProfileHeaderIcon() {
  const icon = document.createElement('span');
  icon.className = 'profile-header__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
    </svg>
  `;
  return icon;
}

function enterLabelEditMode(currentLabel) {
  const header = document.getElementById('profile-header');
  header.innerHTML = '';

  const icon = makeProfileHeaderIcon();

  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'profile-header__input';
  input.maxLength = 30;
  input.value = currentLabel || '';
  input.setAttribute('aria-label', chrome.i18n.getMessage('profileLabelInputAria'));

  let committed = false;

  const commit = async () => {
    if (committed) return;
    committed = true;
    await chrome.runtime.sendMessage({ type: 'update_label', label: input.value });
    await loadAndRender();
  };

  const cancel = () => {
    if (committed) return;
    committed = true;
    loadAndRender();
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
  });

  input.addEventListener('blur', () => {
    setTimeout(() => {
      if (!header.contains(document.activeElement)) cancel();
    }, 0);
  });

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'profile-header__save-btn';
  saveBtn.setAttribute('aria-label', chrome.i18n.getMessage('profileLabelSave'));
  saveBtn.title = chrome.i18n.getMessage('profileLabelSave');
  saveBtn.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/>
    </svg>
  `;
  saveBtn.addEventListener('mousedown', (e) => {
    e.preventDefault();
    commit();
  });

  header.appendChild(icon);
  header.appendChild(input);
  header.appendChild(saveBtn);

  input.focus();
  input.select();
}

// ------------------------------------------------------------- bulk controls

function renderGlobalBulk(profiles) {
  const container = document.getElementById('global-bulk');
  container.innerHTML = '';
  if (!hasAnyTabs(profiles)) {
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  appendBulkButtons(
    container,
    { kind: 'global' },
    chrome.i18n.getMessage('muteAllEverywhere'),
    chrome.i18n.getMessage('unmuteAllEverywhere')
  );
}

function appendBulkButtons(container, scope, muteTitle, unmuteTitle) {
  container.appendChild(makeBulkButton(scope, true, muteTitle));
  container.appendChild(makeBulkButton(scope, false, unmuteTitle));
}

function makeBulkButton(scope, muted, title) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'bulk-btn ' + (muted ? 'bulk-btn--mute' : 'bulk-btn--unmute');
  btn.setAttribute('aria-label', title);
  btn.title = title;
  btn.innerHTML = muted ? ICON_SPEAKER_MUTED : ICON_SPEAKER;
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    await runBulkMute(scope, muted);
  });
  return btn;
}

function makeBulkControls(scope, muteTitle, unmuteTitle) {
  const wrap = document.createElement('span');
  wrap.className = 'bulk-controls';
  appendBulkButtons(wrap, scope, muteTitle, unmuteTitle);
  return wrap;
}

function makeGroupHeader(variant, text, scope, muteTitle, unmuteTitle) {
  const row = document.createElement('div');
  row.className = 'group-header group-header--' + variant;
  const label = document.createElement('span');
  label.className = 'group-header__label';
  label.textContent = text;
  row.appendChild(label);
  row.appendChild(makeBulkControls(scope, muteTitle, unmuteTitle));
  return row;
}

async function runBulkMute(scope, muted) {
  let result;
  try {
    result = await applyBulkMute(scope, muted, _profiles);
  } catch (e) {
    showToast(chrome.i18n.getMessage('actionFailedToast'));
    return;
  }
  if (result.ownTargets === 0 && result.remoteRequested === 0) {
    showToast(chrome.i18n.getMessage(muted ? 'nothingToMuteToast' : 'nothingToUnmuteToast'));
    return;
  }
  if (result.remoteRequested > result.remoteSent) {
    showToast(chrome.i18n.getMessage('actionFailedToast'));
  }
  await refreshAfter(result.remoteSent > 0);
}

async function refreshAfter(hadRemoteAction) {
  if (hadRemoteAction) {
    await new Promise((resolve) => setTimeout(resolve, REMOTE_ACTION_SETTLE_MS));
  }
  await loadAndRender();
}

// --------------------------------------------------------------- tab listing

function renderOwnProfileTabs(profiles) {
  const groups = document.getElementById('own-groups');
  const empty = document.getElementById('own-empty');
  groups.innerHTML = '';

  const own = getOwnProfile(profiles);
  const tabs = (own && own.tabs) || [];

  if (tabs.length === 0) {
    const anyOtherHasTabs = getOtherProfiles(profiles).some((p) => p.tabs && p.tabs.length > 0);
    empty.classList.toggle('hidden', !anyOtherHasTabs);
    return;
  }
  empty.classList.add('hidden');

  // Only split by window when there is genuinely more than one to talk about,
  // and the window the popup opened from is one of them. Otherwise the global
  // control already covers every tab and the extra headers are noise.
  const windowIds = new Set(tabs.map((t) => t.window_id));
  const splitByWindow =
    windowIds.size > 1 && _currentWindowId !== null && windowIds.has(_currentWindowId);

  if (!splitByWindow) {
    groups.appendChild(makeTabList(tabs, true, null));
    return;
  }

  groups.appendChild(
    makeGroupHeader(
      'window',
      chrome.i18n.getMessage('thisWindowHeader'),
      { kind: 'window', windowId: _currentWindowId },
      chrome.i18n.getMessage('muteAllThisWindow'),
      chrome.i18n.getMessage('unmuteAllThisWindow')
    )
  );
  groups.appendChild(makeTabList(tabs.filter((t) => t.window_id === _currentWindowId), true, null));

  groups.appendChild(
    makeGroupHeader(
      'window',
      chrome.i18n.getMessage('otherWindowsHeader'),
      { kind: 'other-windows', excludeWindowId: _currentWindowId },
      chrome.i18n.getMessage('muteAllOtherWindows'),
      chrome.i18n.getMessage('unmuteAllOtherWindows')
    )
  );
  groups.appendChild(makeTabList(tabs.filter((t) => t.window_id !== _currentWindowId), true, null));
}

function makeTabList(tabs, isOwnProfile, ownerProfileUuid) {
  const list = document.createElement('div');
  list.className = 'tab-list';
  list.setAttribute('role', 'list');
  tabs.forEach((tab) => {
    list.appendChild(createTabElement(tab, isOwnProfile, ownerProfileUuid));
  });
  return list;
}

function renderOtherProfiles(profiles) {
  const section = document.getElementById('other-profiles-section');
  const list = document.getElementById('other-profiles-list');
  list.innerHTML = '';

  const others = getOtherProfiles(profiles).filter((p) => p.tabs && p.tabs.length > 0);
  if (others.length === 0) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  others.forEach((p) => {
    const label = p.label || chrome.i18n.getMessage('profileLabelEmpty');
    list.appendChild(
      makeGroupHeader(
        'profile',
        label,
        { kind: 'profile', profileUuid: p.profile_uuid },
        chrome.i18n.getMessage('muteAllInProfile', [label]),
        chrome.i18n.getMessage('unmuteAllInProfile', [label])
      )
    );
    list.appendChild(makeTabList(p.tabs, false, p.profile_uuid));
  });
}

function renderEmptyState(profiles) {
  document.getElementById('empty-state').classList.toggle('hidden', hasAnyTabs(profiles));
}

function createTabElement(tab, isOwnProfile, ownerProfileUuid) {
  const entry = document.createElement('div');
  entry.className = 'tab-entry';
  entry.setAttribute('role', 'listitem');

  const item = document.createElement('div');
  item.className = 'tab-item' + (isOwnProfile ? '' : ' tab-item--cross');
  item.tabIndex = 0;
  item.setAttribute('data-tab-id', tab.tab_id);
  if (!isOwnProfile && ownerProfileUuid) {
    item.setAttribute('data-owner-profile', ownerProfileUuid);
  }

  const favicon = document.createElement('img');
  favicon.className = 'tab-favicon';
  favicon.src = tab.favicon_url || 'icons/icon16.png';
  favicon.alt = '';
  favicon.setAttribute('aria-hidden', 'true');
  favicon.onerror = () => { favicon.src = 'icons/icon16.png'; };

  const audioIndicator = document.createElement('div');
  audioIndicator.className = 'audio-indicator' + (tab.muted ? ' muted' : '');
  audioIndicator.setAttribute('aria-hidden', 'true');
  audioIndicator.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
    </svg>
  `;

  const info = document.createElement('div');
  info.className = 'tab-info';
  const title = document.createElement('div');
  title.className = 'tab-title';
  title.textContent = tab.title || chrome.i18n.getMessage('untitled');
  title.title = tab.title || '';
  const url = document.createElement('div');
  url.className = 'tab-url';
  url.textContent = formatUrl(tab.url);
  url.title = tab.url || '';
  info.appendChild(title);
  info.appendChild(url);

  item.appendChild(favicon);
  item.appendChild(audioIndicator);
  item.appendChild(info);
  // Volume reaches into the page, which only works for tabs this Chrome profile
  // owns — another profile would need its own grant of the optional permission.
  if (isOwnProfile) {
    item.appendChild(createVolumeButton(tab, entry));
  }
  item.appendChild(createSoloButton(tab, isOwnProfile, ownerProfileUuid));
  item.appendChild(createMuteButton(tab, isOwnProfile, ownerProfileUuid, audioIndicator));
  item.appendChild(createCloseButton(tab, isOwnProfile, ownerProfileUuid, entry));

  item.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    activateTab(tab, isOwnProfile, ownerProfileUuid);
  });

  entry.appendChild(item);
  return entry;
}

function createMuteButton(tab, isOwnProfile, ownerProfileUuid, audioIndicator) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mute-btn';
  applyMuteButtonState(btn, tab.muted);

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const newMuted = !tab.muted;
    applyMuteButtonState(btn, newMuted);
    audioIndicator.classList.toggle('muted', newMuted);
    tab.muted = newMuted;

    try {
      await setTabMuted(tab, isOwnProfile, ownerProfileUuid, newMuted);
    } catch (err) {
      tab.muted = !newMuted;
      applyMuteButtonState(btn, tab.muted);
      audioIndicator.classList.toggle('muted', tab.muted);
      showToast(chrome.i18n.getMessage('actionFailedToast'));
    }
  });
  return btn;
}

function applyMuteButtonState(btn, isMuted) {
  const label = chrome.i18n.getMessage(isMuted ? 'unmuteTab' : 'muteTab');
  btn.setAttribute('aria-label', label);
  btn.title = label;
  btn.innerHTML = isMuted ? ICON_SPEAKER_MUTED : ICON_SPEAKER;
}

function createSoloButton(tab, isOwnProfile, ownerProfileUuid) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'solo-btn';
  btn.setAttribute('aria-label', chrome.i18n.getMessage('muteOthers'));
  btn.title = chrome.i18n.getMessage('muteOthers');
  btn.innerHTML = ICON_HEADPHONES;
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    let result;
    try {
      result = await applySolo(tab, isOwnProfile, ownerProfileUuid, _profiles);
    } catch (err) {
      showToast(chrome.i18n.getMessage('actionFailedToast'));
      return;
    }
    await refreshAfter(result.remoteSent > 0 || !isOwnProfile);
  });
  return btn;
}

function createCloseButton(tab, isOwnProfile, ownerProfileUuid, entryEl) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'close-btn';
  btn.setAttribute('aria-label', chrome.i18n.getMessage('closeTab'));
  btn.title = chrome.i18n.getMessage('closeTab');
  btn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"></line>
      <line x1="6" y1="6" x2="18" y2="18"></line>
    </svg>
  `;
  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const neighbour = entryEl.nextElementSibling || entryEl.previousElementSibling;
    entryEl.remove();
    const nextItem = neighbour && neighbour.querySelector ? neighbour.querySelector('.tab-item') : null;
    if (nextItem) nextItem.focus();
    try {
      await removeTab(tab, isOwnProfile, ownerProfileUuid);
    } catch (err) {
      showToast(chrome.i18n.getMessage('actionFailedToast'));
    }
  });
  return btn;
}

async function activateTab(tab, isOwnProfile, ownerProfileUuid) {
  try {
    await focusTab(tab, isOwnProfile, ownerProfileUuid);
    window.close();
  } catch (e) {
    showToast(chrome.i18n.getMessage('actionFailedToast'));
  }
}

// -------------------------------------------------------------- volume panel

function createVolumeButton(tab, entryEl) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'volume-btn';
  btn.setAttribute('aria-label', chrome.i18n.getMessage('volumeAria'));
  btn.title = chrome.i18n.getMessage('volumeLabel');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = ICON_TUNE;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleVolumePanel(tab, entryEl, btn);
  });
  return btn;
}

async function toggleVolumePanel(tab, entryEl, btn) {
  const existing = entryEl.querySelector('.volume-panel');
  if (existing) {
    existing.remove();
    btn.setAttribute('aria-expanded', 'false');
    btn.classList.remove('volume-btn--active');
    return;
  }
  const panel = document.createElement('div');
  panel.className = 'volume-panel';
  entryEl.appendChild(panel);
  btn.setAttribute('aria-expanded', 'true');
  btn.classList.add('volume-btn--active');
  await populateVolumePanel(tab, panel);
}

async function populateVolumePanel(tab, panel) {
  panel.innerHTML = '';
  panel.removeAttribute('title');

  if (!(await hasVolumePermission())) {
    panel.appendChild(buildVolumePermissionNotice(tab, panel));
    return;
  }

  let level = null;
  let scriptable = true;
  try {
    level = await readTabVolume(tab.tab_id);
  } catch (e) {
    scriptable = false;
  }
  const available = scriptable && level !== null;

  const icon = document.createElement('span');
  icon.className = 'volume-panel__icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = ICON_SPEAKER;

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'volume-panel__slider';
  slider.min = '0';
  slider.max = '100';
  slider.step = '1';
  slider.value = String(Math.round((level === null ? 1 : level) * 100));
  slider.setAttribute('aria-label', chrome.i18n.getMessage('volumeAria'));

  const value = document.createElement('span');
  value.className = 'volume-panel__value';

  if (!available) {
    slider.disabled = true;
    value.textContent = '—';
    panel.title = chrome.i18n.getMessage('volumeUnavailable');
  } else {
    value.textContent = slider.value + '%';
    let pending = null;
    slider.addEventListener('input', () => {
      value.textContent = slider.value + '%';
      if (pending) clearTimeout(pending);
      pending = setTimeout(async () => {
        try {
          await writeTabVolume(tab.tab_id, Number(slider.value) / 100);
        } catch (e) {
          showToast(chrome.i18n.getMessage('volumeUnavailable'));
        }
      }, VOLUME_DEBOUNCE_MS);
    });
  }

  panel.appendChild(icon);
  panel.appendChild(slider);
  panel.appendChild(value);
}

function buildVolumePermissionNotice(tab, panel) {
  const wrap = document.createElement('div');
  wrap.className = 'volume-panel__notice';

  const note = document.createElement('p');
  note.textContent = chrome.i18n.getMessage('volumePermissionBody');

  const grant = document.createElement('button');
  grant.type = 'button';
  grant.className = 'volume-panel__grant';
  grant.textContent = chrome.i18n.getMessage('volumePermissionButton');
  grant.addEventListener('click', () => {
    // chrome.permissions.request must run inside the user gesture, so nothing
    // may be awaited before it. Chrome usually closes the popup to show the
    // prompt, so leave a note (fire-and-forget) that lands the next open back
    // on this row.
    rememberOpenVolumePanel(tab.tab_id);
    requestVolumePermission().then(async (granted) => {
      await forgetOpenVolumePanel();
      if (granted) await populateVolumePanel(tab, panel);
    });
  });

  wrap.appendChild(note);
  wrap.appendChild(grant);
  return wrap;
}

async function restorePendingVolumePanel() {
  const tabId = await takeOpenVolumePanel();
  if (tabId === null) return;
  const item = document.querySelector(`.tab-item[data-tab-id="${CSS.escape(String(tabId))}"]`);
  const btn = item && item.querySelector('.volume-btn');
  if (btn) {
    btn.click();
    item.focus();
  }
}

// -------------------------------------------------------------------- shared

function formatUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return url || '';
  }
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.remove('hidden');
  setTimeout(() => toast.classList.add('hidden'), 3000);
}

function setupKeyboardNavigation() {
  document.addEventListener('keydown', (e) => {
    if (e.target.matches('input, textarea')) return;

    const items = Array.from(document.querySelectorAll('.tab-item'));
    const focused = items.findIndex(
      (el) => el.contains(document.activeElement) || el === document.activeElement
    );

    switch (e.key) {
      case 'M':
      case 'm':
        if (e.shiftKey) {
          e.preventDefault();
          runBulkMute({ kind: 'global' }, true);
        } else {
          clickInRow(items, focused, '.mute-btn');
        }
        return;
      case 'U':
      case 'u':
        if (e.shiftKey) {
          e.preventDefault();
          runBulkMute({ kind: 'global' }, false);
        }
        return;
    }

    if (items.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (focused === -1) items[0].focus();
        else if (focused < items.length - 1) items[focused + 1].focus();
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (focused > 0) items[focused - 1].focus();
        break;
      case 'Home':
        e.preventDefault();
        items[0].focus();
        break;
      case 'End':
        e.preventDefault();
        items[items.length - 1].focus();
        break;
      case 'Enter':
      case ' ':
        if (focused !== -1 && document.activeElement === items[focused]) {
          e.preventDefault();
          items[focused].click();
        }
        break;
      case 's':
      case 'S':
        if (clickInRow(items, focused, '.solo-btn')) e.preventDefault();
        break;
      case 'v':
      case 'V':
        if (clickInRow(items, focused, '.volume-btn')) e.preventDefault();
        break;
      case 'Delete':
      case 'Backspace':
        if (focused !== -1) {
          e.preventDefault();
          clickInRow(items, focused, '.close-btn');
        }
        break;
    }
  });
}

function clickInRow(items, focused, selector) {
  if (focused === -1) return false;
  const btn = items[focused].querySelector(selector);
  if (!btn) return false;
  btn.click();
  return true;
}
