/*
 * Emits the popup frames for the Chrome Web Store screenshots.
 *
 * These are not mockups: every frame links the project's real popup.css and
 * the markup comes from popup-dom.js, which mirrors what popup.js builds. Only
 * the tab data is staged.
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
  const buf = fs.readFileSync(path.join(FAV, `${host}.png`));
  const mime = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
};

const D = require('./popup-dom')(favDataUri);
const { T, t } = D;

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
  /* Headless Chrome paints the native range track; pin the fill so the slider
     reads at a glance the way it does in the live popup. */
  .volume-panel__slider {
    background: linear-gradient(to right, #4ade80 0 70%, #1f4068 70% 100%);
  }
</style>
</head><body>${body}</body></html>`;

const frames = {
  // 1 — the core promise
  list: D.container(
    D.titleRow(false) +
    D.profileHeader('Work') +
    `<div id="own-tabs-section" class="tabs-section"><div id="own-groups">${D.tabList([
      t(T.yt), t(T.spotify), t(T.twitch, { muted: true }),
    ])}</div></div>`
  ),

  // 2 — cross-profile
  profiles: D.container(
    D.titleRow(true) +
    D.profileHeader('Work') +
    `<div id="own-tabs-section" class="tabs-section"><div id="own-groups">${D.tabList([
      t(T.yt), t(T.spotify),
    ])}</div></div>` +
    D.otherProfiles('Personal', [t(T.netflix, { cross: true }), t(T.twitch, { cross: true, muted: true })])
  ),

  // 3 — scoped bulk controls
  bulk: D.container(
    D.titleRow(true) +
    D.profileHeader('Work') +
    `<div id="own-tabs-section" class="tabs-section"><div id="own-groups">
       ${D.groupHeader('window', 'This window', '')}
       ${D.tabList([t(T.yt), t(T.spotify)])}
       ${D.groupHeader('window', 'Other windows', '')}
       ${D.tabList([t(T.twitch)])}
     </div></div>` +
    D.otherProfiles('Personal', [t(T.netflix, { cross: true })])
  ),

  // 4 — volume
  volume: D.container(
    D.titleRow(false) +
    D.profileHeader('Work') +
    `<div id="own-tabs-section" class="tabs-section"><div id="own-groups">${D.tabList([
      t(T.ytDoc, { panel: 70 }), t(T.spotify), t(T.sc, { muted: true }),
    ])}</div></div>`
  ),

  // 5 — pause
  pause: D.container(
    D.titleRow(false) +
    D.profileHeader('Work') +
    `<div id="own-tabs-section" class="tabs-section"><div id="own-groups">${D.tabList([
      t(T.yt), t(T.netflix, { paused: true }), t(T.sc),
    ])}</div></div>`
  ),
};

for (const [name, body] of Object.entries(frames)) {
  fs.writeFileSync(path.join(OUT, `${name}.html`), shell(body));
}
console.log('frames:', Object.keys(frames).join(', '));
