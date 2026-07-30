/*
 * Builds the Chrome Web Store assets around the real popup renders.
 *
 * Sizes come from the CWS upload form: screenshots 1280x800, small promo tile
 * 440x280, marquee 1400x560. Everything is rendered at 2x and downscaled, and
 * flattened to 24-bit PNG afterwards because the store rejects alpha.
 */
const fs = require('fs');
const path = require('path');

const WORK = process.env.PROMO_WORK;
if (!WORK) throw new Error('PROMO_WORK not set — run scripts/build-promo-assets.sh');

const ROOT = path.join(__dirname, '..', '..');
const SHOTS = path.join(WORK, 'shots');
const OUT = path.join(WORK, 'promo');
fs.mkdirSync(OUT, { recursive: true });

const dataUri = (file) => `data:image/png;base64,${fs.readFileSync(file).toString('base64')}`;
const popup = (name) => dataUri(path.join(SHOTS, `${name}.png`));
const ICON = dataUri(path.join(ROOT, 'icons/icon128.png'));
const GLYPH = dataUri(path.join(ROOT, 'icons/toolbar/icon48.png'));

const BASE_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif;
    background: #0d0f1a;
    color: #eef0f6;
    overflow: hidden;
    -webkit-font-smoothing: antialiased;
  }
  .stage {
    width: 100%; height: 100%;
    position: relative;
    background:
      radial-gradient(900px 620px at 88% 18%, rgba(74,222,128,0.16), transparent 62%),
      radial-gradient(760px 560px at 6% 92%, rgba(59,130,246,0.16), transparent 60%),
      linear-gradient(158deg, #12162a 0%, #0d0f1a 52%, #101a2e 100%);
    overflow: hidden;
  }
  /* faint horizontal rules, echoing the popup's own row rhythm */
  .stage::after {
    content: "";
    position: absolute; inset: 0;
    background-image: repeating-linear-gradient(
      to bottom, rgba(255,255,255,0.028) 0 1px, transparent 1px 46px);
    pointer-events: none;
  }
  .eyebrow {
    font-size: 15px; font-weight: 700; letter-spacing: 0.16em;
    text-transform: uppercase; color: #4ade80;
  }
  h2 {
    font-size: 50px; line-height: 1.06; letter-spacing: -0.032em;
    font-weight: 700; text-wrap: balance;
  }
  .sub { font-size: 21px; line-height: 1.5; color: #a7aec4; max-width: 22ch; }

  /* the popup shown the way it actually appears: hanging off the toolbar */
  .browser { width: var(--w); filter: drop-shadow(0 34px 70px rgba(0,0,0,0.62)); }
  .toolbar {
    height: 46px;
    background: #23262f;
    border-radius: 12px 12px 0 0;
    display: flex; align-items: center; justify-content: flex-end;
    padding: 0 16px; gap: 12px;
  }
  .toolbar__dots { display: flex; gap: 7px; margin-right: auto; }
  .toolbar__dots i { width: 11px; height: 11px; border-radius: 50%; background: #4a4e59; display: block; }
  .toolbar__action { position: relative; width: 30px; height: 30px;
    display: flex; align-items: center; justify-content: center; }
  .toolbar__action img { width: 20px; height: 20px; }
  .toolbar__badge {
    position: absolute; right: -2px; bottom: 0;
    background: #4ade80; color: #10221a;
    font-size: 10px; font-weight: 800; line-height: 13px;
    min-width: 15px; height: 13px; border-radius: 3px; text-align: center;
    padding: 0 2px; letter-spacing: -0.02em;
  }
  .browser img.shot { display: block; width: 100%; border-radius: 0 0 12px 12px; }
`;

const browser = (name, width, badge) => `
  <div class="browser" style="--w:${width}px">
    <div class="toolbar">
      <div class="toolbar__dots"><i></i><i></i><i></i></div>
      <div class="toolbar__action">
        <img src="${GLYPH}" alt="">
        <span class="toolbar__badge">${badge}</span>
      </div>
    </div>
    <img class="shot" src="${popup(name)}" alt="">
  </div>`;

const page = (w, h, css, body) => `<!doctype html>
<html><head><meta charset="utf-8"><style>${BASE_CSS}
  body { width: ${w}px; height: ${h}px; }
  ${css}
</style></head><body><div class="stage">${body}</div></body></html>`;

// ---------------------------------------------------------------- screenshots

const SHOT_CSS = `
  .stage { display: grid; grid-template-columns: 1fr auto; align-items: center;
           gap: 64px; padding: 0 86px; }
  .copy { display: flex; flex-direction: column; gap: 20px; max-width: 540px; }
  .art { display: flex; align-items: center; justify-content: center; }
`;

const screenshots = [
  {
    file: '1-find',
    frame: 'list', width: 430, badge: '3',
    eyebrow: 'Find it',
    title: 'Which tab is making that noise?',
    sub: 'One click lists every tab playing sound. Jump to it, mute it, or close it without hunting.',
  },
  {
    file: '2-profiles',
    frame: 'profiles', width: 405, badge: '2/4',
    eyebrow: 'Across profiles',
    title: 'Even the tabs in your other Chrome profile.',
    sub: 'Work, Personal, anything else you keep open — all of it in one list, all of it controllable.',
  },
  {
    file: '3-bulk',
    frame: 'bulk', width: 375, badge: '4',
    eyebrow: 'Silence it',
    title: 'Mute all.<br>Or everything but one.',
    sub: 'This window, the other windows, one profile, or the whole browser. Each scope has its own switch.',
  },
  {
    file: '4-volume',
    frame: 'volume', width: 420, badge: '3',
    eyebrow: 'Turn it down',
    title: 'A real volume slider for every tab.',
    sub: 'Not just mute — set any tab from 0 to 100% and leave the rest alone.',
  },
  {
    file: '5-pause',
    frame: 'pause', width: 430, badge: '2',
    eyebrow: 'Stop it',
    title: 'Pause it. Not just mute it.',
    sub: 'Muting leaves the video running. Pausing stops it, and the tab stays in the list so you can pick it back up.',
  },
];

for (const s of screenshots) {
  fs.writeFileSync(
    path.join(OUT, `${s.file}.html`),
    page(1280, 800, SHOT_CSS, `
      <div class="copy">
        <span class="eyebrow">${s.eyebrow}</span>
        <h2>${s.title}</h2>
        <p class="sub">${s.sub}</p>
      </div>
      <div class="art">${browser(s.frame, s.width, s.badge)}</div>
    `)
  );
}

// ----------------------------------------------------------------- promo tiles

fs.writeFileSync(path.join(OUT, 'tile-small.html'), page(440, 280, `
  .stage { display: flex; flex-direction: column; align-items: center;
           justify-content: center; gap: 16px; padding: 0 34px; text-align: center; }
  .mark { width: 78px; height: 78px; filter: drop-shadow(0 10px 26px rgba(74,222,128,0.28)); }
  .name { font-size: 27px; font-weight: 700; letter-spacing: -0.028em; }
  .tag { font-size: 14px; line-height: 1.45; color: #a7aec4; }
  .stage::after { background-image: repeating-linear-gradient(
      to bottom, rgba(255,255,255,0.028) 0 1px, transparent 1px 30px); }
`, `
  <img class="mark" src="${ICON}" alt="">
  <div class="name">Audio Tab Finder</div>
  <p class="tag">Find, mute, pause and set the volume of every tab making noise</p>
`));

fs.writeFileSync(path.join(OUT, 'tile-marquee.html'), page(1400, 560, `
  .stage { display: grid; grid-template-columns: 1fr auto; align-items: center;
           gap: 60px; padding: 0 92px; }
  .copy { display: flex; flex-direction: column; gap: 22px; max-width: 640px; }
  .lockup { display: flex; align-items: center; gap: 20px; }
  .lockup img { width: 76px; height: 76px; filter: drop-shadow(0 10px 26px rgba(74,222,128,0.28)); }
  .lockup .name { font-size: 40px; font-weight: 700; letter-spacing: -0.03em; }
  h2 { font-size: 44px; }
  .sub { font-size: 20px; max-width: 30ch; }
  .art { display: flex; align-items: center; }
`, `
  <div class="copy">
    <div class="lockup"><img src="${ICON}" alt=""><span class="name">Audio Tab Finder</span></div>
    <h2>Stop hunting for the tab that's making noise.</h2>
    <p class="sub">Every audio tab in every Chrome profile — muted, paused, or turned down, in one click.</p>
  </div>
  <div class="art">${browser('profiles', 372, '2/4')}</div>
`));

console.log('promo pages:', fs.readdirSync(OUT).filter((f) => f.endsWith('.html')).join(', '));
