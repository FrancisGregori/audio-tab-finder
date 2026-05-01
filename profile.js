async function getOrCreateProfileUuid() {
  const stored = await chrome.storage.local.get('profileUuid');
  if (typeof stored.profileUuid === 'string' && stored.profileUuid.length > 0) {
    return stored.profileUuid;
  }
  const newUuid = crypto.randomUUID();
  await chrome.storage.local.set({ profileUuid: newUuid });
  return newUuid;
}

async function getProfileLabel() {
  const stored = await chrome.storage.local.get('profileLabel');
  if (typeof stored.profileLabel !== 'string') return '';
  return stored.profileLabel.trim();
}

async function setProfileLabel(label) {
  const trimmed = (label ?? '').trim().slice(0, 30);
  if (trimmed.length === 0) {
    await chrome.storage.local.remove('profileLabel');
    return '';
  }
  await chrome.storage.local.set({ profileLabel: trimmed });
  return trimmed;
}
