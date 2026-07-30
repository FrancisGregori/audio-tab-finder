/*
 * Emits the popup frames for the Chrome Web Store assets.
 *
 * These are not mockups: every frame links the project's real popup.css and
 * reproduces the exact DOM that popup.js builds, so what ships to the store is
 * the actual interface. Only the tab data is staged.
 */
const fs = require('fs');
const path = require('path');

const WORK = process.env.PROMO_WORK;
if (!WORK) throw new Error('PROMO_WORK not set — run scripts/build-promo-assets.sh');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(WORK, 'frames');
const FAV = path.join(WORK, 'fav');
fs.mkdirSync(OUT, { recursive: true });

const favDataUri = (host) => {
  const file = path.join(FAV, `${host}.png`);
  const buf = fs.readFileSync(file);
  const mime = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
};

// Icons lifted verbatim from popup.js
const SPEAKER = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>`;
const SPEAKER_MUTED = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>`;
const TUNE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17v2h6v-2H3zM3 5v2h10V5H3zm10 16v-2h8v-2h-8v-2h-2v6h2zM7 9v2H3v2h4v2h2V9H7zm14 4v-2H11v2h10zm-6-4h2V7h4V5h-4V3h-2v6z"/></svg>`;
const PAUSE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>`;
const PLAY = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>`;
const PERSON = `<svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>`;
const PENCIL = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a.996.996 0 0 0 0-1.41l-2.34-2.34a.996.996 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`;
const CLOSE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
const INDICATOR = `<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/></svg>`;

const bulk = (label) => `
  <span class="bulk-controls">
    ${label ? `<span class="bulk-controls__label">${label}</span>` : ''}
    <button type="button" class="bulk-btn bulk-btn--mute">${SPEAKER_MUTED}</button>
    <button type="button" class="bulk-btn bulk-btn--unmute">${SPEAKER}</button>
  </span>`;

const groupHeader = (variant, label, bulkLabel) => `
  <div class="group-header group-header--${variant}">
    <span class="group-header__label">${label}</span>
    ${bulk(bulkLabel)}
  </div>`;

// tab: { host, title, url, muted, cross, paused, panel }
const tabRow = (tab) => {
  const paused = !!tab.paused;
  const buttons = paused
    ? `<button type="button" class="resume-btn">${PLAY}</button>
       <button type="button" class="close-btn">${CLOSE}</button>`
    : `<button type="button" class="volume-btn${tab.panel ? ' volume-btn--active' : ''}">${TUNE}</button>
       <button type="button" class="mute-btn">${tab.muted ? SPEAKER_MUTED : SPEAKER}</button>
       <button type="button" class="close-btn">${CLOSE}</button>`;

  const panel = tab.panel
    ? `<div class="volume-panel">
         <div class="volume-panel__row">
           <span class="volume-panel__icon">${SPEAKER}</span>
           <input type="range" class="volume-panel__slider" min="0" max="100" value="${tab.panel}">
           <span class="volume-panel__value">${tab.panel}%</span>
         </div>
         <button type="button" class="volume-panel__action">
           <span class="volume-panel__action-icon">${PAUSE}</span><span>Pause playback</span>
         </button>
         <button type="button" class="volume-panel__action">
           <span class="volume-panel__action-icon">${SPEAKER_MUTED}</span><span>Mute all other tabs</span>
         </button>
       </div>`
    : '';

  return `
  <div class="tab-entry" role="listitem">
    <div class="tab-item${tab.cross ? ' tab-item--cross' : ''}${paused ? ' tab-item--paused' : ''}">
      <img class="tab-favicon" src="${favDataUri(tab.host)}" alt="">
      <div class="audio-indicator${tab.muted || paused ? ' muted' : ''}">${paused ? PAUSE : INDICATOR}</div>
      <div class="tab-info">
        <div class="tab-title">${tab.title}</div>
        <div class="tab-url">${paused ? 'Paused &middot; ' : ''}${tab.url}</div>
      </div>
      ${buttons}
    </div>
    ${panel}
  </div>`;
};

const tabList = (tabs) => `<div class="tab-list" role="list">${tabs.map(tabRow).join('')}</div>`;

const shell = (body) => `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${ROOT}/popup.css">
<style>
  /* A colour the popup never uses, so the trim step has an unambiguous
     reference. Trimming against transparency took the corner pixel from the
     container itself and stripped its padding along with the empty area,
     which silently cancelled out any change to .container's padding. */
  html, body { background: #ff00ff; }
  body { width: 380px; }
  /* Chrome renders a native range track headlessly; pin the fill so the
     slider reads at a glance the way it does in the live popup. */
  .volume-panel__slider {
    background: linear-gradient(to right, #4ade80 0 70%, #1f4068 70% 100%);
  }
</style>
</head><body>${body}</body></html>`;

const container = (inner) => `<div class="container" role="main">${inner}</div>`;

const titleRow = (withGlobal) => `
  <div class="title-row">
    <h1 id="popup-title">Audio Tabs</h1>
    ${withGlobal ? `<div id="global-bulk" class="bulk-controls">${bulk('All').replace(/^\s*<span class="bulk-controls">|<\/span>\s*$/g, '')}</div>` : ''}
  </div>`;

const profileHeader = (name) => `
  <div id="profile-header" class="profile-header">
    <div class="profile-header__name">
      <span class="profile-header__icon">${PERSON}</span>
      <span class="profile-header__text">${name}</span>
      <button type="button" class="profile-header__edit-btn">${PENCIL}</button>
    </div>
    ${bulk('')}
  </div>`;

const otherProfiles = (label, tabs) => `
  <div id="other-profiles-section" class="other-section">
    <div class="section-divider">Other profiles</div>
    <div id="other-profiles-list">
      ${groupHeader('profile', label, '')}
      ${tabList(tabs)}
    </div>
  </div>`;

const T = {
  yt:      { host: 'youtube.com',       title: 'lofi hip hop radio - beats to relax', url: 'youtube.com' },
  ytDoc:   { host: 'youtube.com',       title: 'How to Play Padel: Rules Explained',  url: 'youtube.com' },
  spotify: { host: 'open.spotify.com',  title: 'Daily Mix 3 - Spotify',               url: 'open.spotify.com' },
  netflix: { host: 'netflix.com',       title: 'The Diplomat - S02E04',               url: 'netflix.com' },
  twitch:  { host: 'twitch.tv',         title: 'gaules - CS2 Major Watch Party',      url: 'twitch.tv' },
  sc:      { host: 'soundcloud.com',    title: 'Bonobo - Fragments (Full Album)',     url: 'soundcloud.com' },
};
const t = (base, extra) => Object.assign({}, base, extra);

const frames = {
  // 1 — the core promise
  list: container(
    titleRow(false) +
    profileHeader('Work') +
    `<div id="own-tabs-section" class="tabs-section"><div id="own-groups">${tabList([
      t(T.yt), t(T.spotify), t(T.twitch, { muted: true }),
    ])}</div></div>`
  ),

  // 2 — cross-profile
  profiles: container(
    titleRow(true) +
    profileHeader('Work') +
    `<div id="own-tabs-section" class="tabs-section"><div id="own-groups">${tabList([
      t(T.yt), t(T.spotify),
    ])}</div></div>` +
    otherProfiles('Personal', [t(T.netflix, { cross: true }), t(T.twitch, { cross: true, muted: true })])
  ),

  // 3 — scoped bulk controls
  bulk: container(
    titleRow(true) +
    profileHeader('Work') +
    `<div id="own-tabs-section" class="tabs-section"><div id="own-groups">
       ${groupHeader('window', 'This window', '')}
       ${tabList([t(T.yt), t(T.spotify)])}
       ${groupHeader('window', 'Other windows', '')}
       ${tabList([t(T.twitch)])}
     </div></div>` +
    otherProfiles('Personal', [t(T.netflix, { cross: true })])
  ),

  // 4 — volume
  volume: container(
    titleRow(false) +
    profileHeader('Work') +
    `<div id="own-tabs-section" class="tabs-section"><div id="own-groups">${tabList([
      t(T.ytDoc, { panel: 70 }), t(T.spotify), t(T.sc, { muted: true }),
    ])}</div></div>`
  ),

  // 5 — pause
  pause: container(
    titleRow(false) +
    profileHeader('Work') +
    `<div id="own-tabs-section" class="tabs-section"><div id="own-groups">${tabList([
      t(T.yt), t(T.netflix, { paused: true }), t(T.sc),
    ])}</div></div>`
  ),
};

for (const [name, body] of Object.entries(frames)) {
  fs.writeFileSync(path.join(OUT, `${name}.html`), shell(body));
}
console.log('frames:', Object.keys(frames).join(', '));
