document.addEventListener('DOMContentLoaded', async () => {
  initializeI18n();
  await loadAndRender();
  setupKeyboardNavigation();
});

function initializeI18n() {
  document.getElementById('popup-title').textContent = chrome.i18n.getMessage('popupTitle');
  document.getElementById('empty-message').textContent = chrome.i18n.getMessage('noAudioAnywhere');
  document.getElementById('other-profiles-header').textContent = chrome.i18n.getMessage('otherProfilesHeader');
  document.getElementById('own-empty').textContent = chrome.i18n.getMessage('thisProfileSilent');
}

async function loadAndRender() {
  const resp = await chrome.runtime.sendMessage({ type: 'get_aggregate' });
  if (!resp || !resp.ok) {
    showToast((resp && resp.error) || 'failed to load');
    return;
  }
  renderHostBanner(resp.hostInstalled);
  renderProfileHeader(resp.profiles);
  renderOwnProfileTabs(resp.profiles);
  renderOtherProfiles(resp.profiles);
  renderEmptyState(resp.profiles);
}

function renderHostBanner(hostInstalled) {
  const banner = document.getElementById('host-banner');
  if (hostInstalled) {
    banner.classList.add('hidden');
    return;
  }
  banner.innerHTML = '';
  const text = document.createElement('span');
  text.textContent = chrome.i18n.getMessage('nativeHostMissing');
  banner.appendChild(text);
  banner.classList.remove('hidden');
}

function getOwnProfile(profiles) {
  return profiles.find((p) => p.is_self) || null;
}

function getOtherProfiles(profiles) {
  return profiles.filter((p) => !p.is_self);
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

function renderOwnProfileTabs(profiles) {
  const list = document.getElementById('own-tabs-list');
  const empty = document.getElementById('own-empty');
  list.innerHTML = '';
  const own = getOwnProfile(profiles);
  const tabs = (own && own.tabs) || [];

  if (tabs.length === 0) {
    list.classList.add('hidden');
    const others = getOtherProfiles(profiles);
    const anyOtherHasTabs = others.some((p) => p.tabs && p.tabs.length > 0);
    if (anyOtherHasTabs) empty.classList.remove('hidden');
    else empty.classList.add('hidden');
    return;
  }

  empty.classList.add('hidden');
  list.classList.remove('hidden');
  tabs.forEach((tab) => {
    list.appendChild(createTabElement(tab, /*isOwnProfile*/ true, /*ownerProfileUuid*/ null));
  });
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
    const heading = document.createElement('div');
    heading.className = 'other-profile-heading';
    heading.textContent = p.label || chrome.i18n.getMessage('profileLabelEmpty');
    list.appendChild(heading);
    p.tabs.forEach((tab) => {
      list.appendChild(createTabElement(tab, /*isOwnProfile*/ false, /*ownerProfileUuid*/ p.profile_uuid));
    });
  });
}

function renderEmptyState(profiles) {
  const empty = document.getElementById('empty-state');
  const own = getOwnProfile(profiles);
  const others = getOtherProfiles(profiles);
  const ownHasTabs = own && own.tabs && own.tabs.length > 0;
  const othersHaveTabs = others.some((p) => p.tabs && p.tabs.length > 0);
  if (!ownHasTabs && !othersHaveTabs) {
    empty.classList.remove('hidden');
  } else {
    empty.classList.add('hidden');
  }
}

function createTabElement(tab, isOwnProfile, ownerProfileUuid) {
  const item = document.createElement('div');
  item.className = 'tab-item' + (isOwnProfile ? '' : ' tab-item--cross');
  item.setAttribute('role', 'listitem');
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

  const muteBtn = createMuteButton(tab, isOwnProfile, ownerProfileUuid, item, audioIndicator);
  const closeBtn = createCloseButton(tab, isOwnProfile, ownerProfileUuid, item);

  item.appendChild(favicon);
  item.appendChild(audioIndicator);
  item.appendChild(info);
  item.appendChild(muteBtn);
  item.appendChild(closeBtn);

  item.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    activateTab(tab, isOwnProfile, ownerProfileUuid);
  });

  return item;
}

function createMuteButton(tab, isOwnProfile, ownerProfileUuid, itemEl, audioIndicator) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mute-btn';
  btn.setAttribute('aria-label', tab.muted ? chrome.i18n.getMessage('unmuteTab') : chrome.i18n.getMessage('muteTab'));
  btn.title = btn.getAttribute('aria-label');
  setMuteIcon(btn, tab.muted);

  btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const newMuted = !tab.muted;
    setMuteIcon(btn, newMuted);
    if (newMuted) audioIndicator.classList.add('muted');
    else audioIndicator.classList.remove('muted');
    btn.setAttribute('aria-label', newMuted ? chrome.i18n.getMessage('unmuteTab') : chrome.i18n.getMessage('muteTab'));
    btn.title = btn.getAttribute('aria-label');
    tab.muted = newMuted;

    try {
      if (isOwnProfile) {
        await chrome.tabs.update(tab.tab_id, { muted: newMuted });
      } else {
        const resp = await chrome.runtime.sendMessage({
          type: 'send_action',
          target_profile_uuid: ownerProfileUuid,
          action: newMuted ? 'mute' : 'unmute',
          target_tab_id: tab.tab_id,
          target_window_id: tab.window_id,
        });
        if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'send_action failed');
      }
    } catch (err) {
      tab.muted = !newMuted;
      setMuteIcon(btn, tab.muted);
      if (tab.muted) audioIndicator.classList.add('muted');
      else audioIndicator.classList.remove('muted');
      btn.setAttribute('aria-label', tab.muted ? chrome.i18n.getMessage('unmuteTab') : chrome.i18n.getMessage('muteTab'));
      showToast(chrome.i18n.getMessage('actionFailedToast'));
    }
  });
  return btn;
}

function createCloseButton(tab, isOwnProfile, ownerProfileUuid, itemEl) {
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
    const next = itemEl.nextElementSibling || itemEl.previousElementSibling;
    itemEl.remove();
    if (next && next.classList.contains('tab-item')) next.focus();
    try {
      if (isOwnProfile) {
        await chrome.tabs.remove(tab.tab_id);
      } else {
        const resp = await chrome.runtime.sendMessage({
          type: 'send_action',
          target_profile_uuid: ownerProfileUuid,
          action: 'close',
          target_tab_id: tab.tab_id,
          target_window_id: tab.window_id,
        });
        if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'send_action failed');
      }
    } catch (err) {
      showToast(chrome.i18n.getMessage('actionFailedToast'));
    }
  });
  return btn;
}

function setMuteIcon(btn, isMuted) {
  if (isMuted) {
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
      </svg>
    `;
  } else {
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>
      </svg>
    `;
  }
}

async function activateTab(tab, isOwnProfile, ownerProfileUuid) {
  try {
    if (isOwnProfile) {
      await chrome.tabs.update(tab.tab_id, { active: true });
      await chrome.windows.update(tab.window_id, { focused: true });
    } else {
      const resp = await chrome.runtime.sendMessage({
        type: 'send_action',
        target_profile_uuid: ownerProfileUuid,
        action: 'activate',
        target_tab_id: tab.tab_id,
        target_window_id: tab.window_id,
      });
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || 'send_action failed');
    }
    window.close();
  } catch (e) {
    showToast(chrome.i18n.getMessage('actionFailedToast'));
  }
}

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
    if (items.length === 0) return;

    const focused = items.findIndex((el) => el.contains(document.activeElement) || el === document.activeElement);

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
      case 'm':
      case 'M':
        if (focused !== -1) {
          const muteBtn = items[focused].querySelector('.mute-btn');
          if (muteBtn) muteBtn.click();
        }
        break;
      case 'Delete':
      case 'Backspace':
        if (focused !== -1) {
          e.preventDefault();
          const closeBtn = items[focused].querySelector('.close-btn');
          if (closeBtn) closeBtn.click();
        }
        break;
    }
  });
}
