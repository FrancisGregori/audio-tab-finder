/*
 * Emits the demo video page: the real popup, driven through a scripted
 * interaction by a synthetic cursor.
 *
 * Time is a parameter, not a wall clock. render(t) computes the whole frame
 * from t alone, so the capture loop can ask for any instant in any order and
 * the output is identical every run — CSS animations and requestAnimationFrame
 * would both make the render depend on when the screenshot happened to land.
 *
 * The popup states are pre-rendered here from popup-dom.js and swapped in; the
 * continuous parts (cursor, captions, slider position, entrance) are computed
 * per frame on top.
 */
const fs = require('fs');
const path = require('path');

const WORK = process.env.PROMO_WORK;
if (!WORK) throw new Error('PROMO_WORK not set — run scripts/build-promo-video.sh');

const ROOT = path.join(__dirname, '..', '..');
const FAV = path.join(WORK, 'fav');
fs.mkdirSync(WORK, { recursive: true });

const favDataUri = (host) => {
  const buf = fs.readFileSync(path.join(FAV, `${host}.png`));
  const mime = buf[0] === 0xff && buf[1] === 0xd8 ? 'image/jpeg' : 'image/png';
  return `data:${mime};base64,${buf.toString('base64')}`;
};
const pngDataUri = (p) => `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;

const D = require('./popup-dom')(favDataUri);
const { T, t } = D;
const ICON = pngDataUri(path.join(ROOT, 'icons/icon128.png'));
const GLYPH = pngDataUri(path.join(ROOT, 'icons/toolbar/icon48.png'));

const rows = (list) => `<div id="own-tabs-section" class="tabs-section"><div id="own-groups">${D.tabList(list)}</div></div>`;

const yt = (extra) => t(T.yt, Object.assign({ id: 'yt' }, extra));
const sp = (extra) => t(T.spotify, Object.assign({ id: 'sp' }, extra));
const tw = (extra) => t(T.twitch, Object.assign({ id: 'tw' }, extra));

// Discrete states the demo steps through. Each is the popup as popup.js would
// have built it at that moment.
const STATES = {
  a: D.container(D.titleRow(false) + D.profileHeader('Work') + rows([yt(), sp(), tw()])),
  b: D.container(D.titleRow(false) + D.profileHeader('Work') + rows([yt(), sp(), tw({ muted: true })])),
  c: D.container(D.titleRow(false) + D.profileHeader('Work') + rows([yt({ panel: 100 }), sp(), tw({ muted: true })])),
  d: D.container(D.titleRow(false) + D.profileHeader('Work') + rows([yt({ paused: true }), sp(), tw({ muted: true })])),
  e: D.container(D.titleRow(false) + D.profileHeader('Work') + rows([yt({ paused: true }), sp({ muted: true }), tw({ muted: true })])),
  f: D.container(
    D.titleRow(true) + D.profileHeader('Work') + rows([yt({ paused: true }), sp({ muted: true }), tw({ muted: true })]) +
    D.otherProfiles('Personal', [t(T.netflix, { cross: true }), t(T.sc, { cross: true })])
  ),
};

// The script. `at` is seconds; a beat may change state, move the cursor to an
// element, fire a click, or swap the caption.
const BEATS = [
  { at: 0.0,  state: 'a', caption: null },
  { at: 3.4,  caption: 'Every tab playing sound, in one list' },
  { at: 5.2,  cursor: '[data-row="tw"] .mute-btn' },
  { at: 6.3,  click: true, state: 'b', caption: 'Mute one without leaving the tab you are on' },
  { at: 8.4,  cursor: '[data-row="yt"] .volume-btn' },
  { at: 9.4,  click: true, state: 'c', caption: 'Or just turn it down' },
  { at: 10.2, cursor: '[data-row="yt"] .volume-panel__slider', drag: [100, 40] },
  { at: 13.4, cursor: '[data-row="yt"] .volume-panel__action' },
  { at: 14.4, click: true, state: 'd', caption: 'Pause it — muting leaves the video running' },
  { at: 17.2, cursor: '#profile-header .bulk-btn--mute' },
  { at: 18.2, click: true, state: 'e', caption: 'Or silence the whole profile at once' },
  { at: 20.6, state: 'f', caption: 'Even the tabs in your other Chrome profiles' },
  { at: 24.0, caption: null },
];

const DURATION = 27.0;

const page = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="file://${ROOT}/popup.css">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1920px; height: 1080px; overflow: hidden; }
  body {
    background: #0d0f1a;
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
    color: #eef0f6;
    -webkit-font-smoothing: antialiased;
  }
  #stage {
    position: absolute; inset: 0;
    background:
      radial-gradient(1200px 820px at 84% 20%, rgba(74,222,128,0.15), transparent 62%),
      radial-gradient(1000px 760px at 8% 88%, rgba(59,130,246,0.15), transparent 60%),
      linear-gradient(158deg, #12162a 0%, #0d0f1a 52%, #101a2e 100%);
  }
  #stage::after {
    content: ""; position: absolute; inset: 0;
    background-image: repeating-linear-gradient(to bottom, rgba(255,255,255,0.025) 0 1px, transparent 1px 62px);
  }

  /* The popup at 2.2x. Scaling the real element keeps the real CSS in charge;
     re-authoring it at video size would be a different interface. */
  #popup-wrap {
    position: absolute; left: 1130px; top: 50%;
    transform-origin: center center;
    width: 380px;
  }
  #popup-wrap .container { border-radius: 14px; }
  #popup-shadow { filter: drop-shadow(0 40px 90px rgba(0,0,0,0.66)); }

  #caption {
    position: absolute; left: 150px; top: 50%; transform: translateY(-50%);
    width: 640px;
  }
  #caption h2 {
    font-size: 60px; line-height: 1.06; letter-spacing: -0.033em;
    font-weight: 700; text-wrap: balance;
  }

  #cursor { position: absolute; width: 30px; height: 30px; pointer-events: none; z-index: 40; }
  #cursor svg { width: 100%; height: 100%; display: block;
    filter: drop-shadow(0 3px 7px rgba(0,0,0,0.65)); }
  #ring {
    position: absolute; width: 74px; height: 74px; margin: -37px 0 0 -37px;
    border: 3px solid #4ade80; border-radius: 50%; pointer-events: none; z-index: 39;
  }

  /* full-bleed cards */
  .card {
    position: absolute; inset: 0; z-index: 60;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 30px; background: #0d0f1a;
  }
  .card img { width: 150px; height: 150px; filter: drop-shadow(0 16px 40px rgba(74,222,128,0.3)); }
  .card h1 { font-size: 74px; letter-spacing: -0.035em; font-weight: 700; text-align: center;
    text-wrap: balance; max-width: 1200px; line-height: 1.05; }
  .card p { font-size: 30px; color: #a7aec4; }
  .card .brand { font-size: 56px; font-weight: 700; letter-spacing: -0.03em; }
  .card .chip {
    font-size: 22px; letter-spacing: 0.13em; text-transform: uppercase;
    color: #4ade80; font-weight: 700;
  }
</style>
</head>
<body>
  <div id="stage"></div>
  <div id="caption"><h2></h2></div>
  <div id="popup-wrap"><div id="popup-shadow"></div></div>
  <div id="ring"></div>
  <div id="cursor">
    <svg viewBox="0 0 24 24"><path d="M5.5 2.2 19.4 12l-6.2.6-3.3 5.6z" fill="#fff" stroke="#0d0f1a" stroke-width="1.4" stroke-linejoin="round"/></svg>
  </div>

  <div class="card" id="card-open">
    <img src="${ICON}" alt="">
    <h1>Which tab is making that noise?</h1>
  </div>
  <div class="card" id="card-end">
    <img src="${ICON}" alt="">
    <div class="brand">Audio Tab Finder</div>
    <p>Find it, mute it, pause it, turn it down.</p>
    <div class="chip">Free · Open source · Chrome Web Store</div>
  </div>

<script>
const STATES = ${JSON.stringify(STATES)};
const BEATS = ${JSON.stringify(BEATS)};
const DURATION = ${DURATION};

const wrap = document.getElementById('popup-wrap');
const shadow = document.getElementById('popup-shadow');
const capBox = document.getElementById('caption');
const capText = capBox.querySelector('h2');
const cursor = document.getElementById('cursor');
const ring = document.getElementById('ring');
const cardOpen = document.getElementById('card-open');
const cardEnd = document.getElementById('card-end');

const clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
const easeInOut = (x) => x < 0.5 ? 4*x*x*x : 1 - Math.pow(-2*x + 2, 3) / 2;
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
const lerp = (a, b, x) => a + (b - a) * x;

const POPUP_SCALE = 2.2;
const OPEN_END = 3.0;      // title card holds, then dissolves
const POPUP_IN = 3.0;      // popup enters
const END_START = 24.4;

let currentState = null;
function setState(key) {
  if (key === currentState) return;
  currentState = key;
  shadow.innerHTML = STATES[key];
}

// Cursor keyframes resolve to element centres, so the pointer lands on the
// control wherever layout puts it rather than on a hardcoded coordinate.
function centreOf(sel) {
  const el = shadow.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

function beatsUpTo(t) {
  return BEATS.filter((b) => b.at <= t);
}

function render(t) {
  // ---- state
  const past = beatsUpTo(t);
  const stateBeat = [...past].reverse().find((b) => b.state);
  setState(stateBeat ? stateBeat.state : 'a');

  // ---- popup entrance
  const inP = easeOut(clamp01((t - POPUP_IN) / 1.1));
  wrap.style.transform =
    'translateY(-50%) scale(' + (POPUP_SCALE * lerp(0.94, 1, inP)) + ')';
  wrap.style.opacity = String(inP);

  // ---- slider drag
  const dragBeat = [...past].reverse().find((b) => b.drag);
  if (dragBeat) {
    const slider = shadow.querySelector('.volume-panel__slider');
    const value = shadow.querySelector('.volume-panel__value');
    if (slider && value) {
      const p = easeInOut(clamp01((t - dragBeat.at) / 2.4));
      const v = Math.round(lerp(dragBeat.drag[0], dragBeat.drag[1], p));
      slider.value = String(v);
      value.textContent = v + '%';
      slider.style.background =
        'linear-gradient(to right, #4ade80 0 ' + v + '%, #1f4068 ' + v + '% 100%)';
    }
  }

  // ---- cursor path
  const cursorBeats = BEATS.filter((b) => b.cursor);
  let pos = null;
  const prior = cursorBeats.filter((b) => b.at <= t);
  if (prior.length) {
    const from = prior.length > 1 ? centreOf(prior[prior.length - 2].cursor) : { x: 1680, y: 940 };
    const to = centreOf(prior[prior.length - 1].cursor);
    const b = prior[prior.length - 1];
    const p = easeInOut(clamp01((t - b.at) / 0.85));
    pos = to && from ? { x: lerp(from.x, to.x, p), y: lerp(from.y, to.y, p) } : to;
  }
  const cursorVisible = pos && t >= POPUP_IN + 0.6 && t < END_START - 0.4;
  cursor.style.opacity = cursorVisible ? '1' : '0';
  if (pos) {
    cursor.style.left = (pos.x - 4) + 'px';
    cursor.style.top = (pos.y - 3) + 'px';
  }

  // ---- click pulse
  const clickBeat = [...past].reverse().find((b) => b.click);
  let ringOn = 0;
  if (clickBeat) {
    const age = t - clickBeat.at;
    if (age >= 0 && age < 0.5) {
      const p = age / 0.5;
      ringOn = 1 - p;
      ring.style.transform = 'scale(' + lerp(0.25, 1, easeOut(p)) + ')';
      const c = centreOf(clickBeat.cursor || (prior.length ? prior[prior.length - 1].cursor : ''));
      const at = c || pos;
      if (at) { ring.style.left = at.x + 'px'; ring.style.top = at.y + 'px'; }
    }
  }
  ring.style.opacity = String(cursorVisible ? ringOn : 0);

  // ---- caption
  const capBeat = [...past].reverse().find((b) => 'caption' in b);
  const text = capBeat ? capBeat.caption : null;
  capText.textContent = text || '';
  let capOpacity = 0;
  if (text) {
    const age = t - capBeat.at;
    capOpacity = easeOut(clamp01(age / 0.5));
    const nextCap = BEATS.find((b) => 'caption' in b && b.at > capBeat.at);
    if (nextCap) capOpacity *= 1 - easeOut(clamp01((t - (nextCap.at - 0.4)) / 0.4));
  }
  capBox.style.opacity = String(capOpacity);
  capBox.style.transform = 'translateY(calc(-50% + ' + lerp(14, 0, capOpacity) + 'px))';

  // ---- cards
  cardOpen.style.opacity = String(1 - easeInOut(clamp01((t - OPEN_END) / 0.7)));
  cardEnd.style.opacity = String(easeInOut(clamp01((t - END_START) / 0.7)));
}

window.render = render;
window.DURATION = DURATION;
render(0);
</script>
</body></html>`;

fs.writeFileSync(path.join(WORK, 'video.html'), page);
console.log('video page written, duration', DURATION, 's');
