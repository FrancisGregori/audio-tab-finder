/*
 * Captures the demo video frame by frame.
 *
 * Drives the Chrome already installed via puppeteer-core — no second browser
 * download — and asks the page for one deterministic instant at a time rather
 * than recording a clock, so the output is identical on every run.
 */
const path = require('path');
const fs = require('fs');

const WORK = process.env.PROMO_WORK;
const PUPPETEER = process.env.PUPPETEER_PATH;
if (!WORK || !PUPPETEER) throw new Error('run via scripts/build-promo-video.sh');

const puppeteer = require(PUPPETEER);

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FPS = Number(process.env.FPS || 30);
const OUT = path.join(WORK, 'video-frames');

(async () => {
  fs.mkdirSync(OUT, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: 'shell',
    args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--force-color-profile=srgb'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
  await page.goto('file://' + path.join(WORK, 'video.html'), { waitUntil: 'networkidle0' });

  const duration = await page.evaluate(() => window.DURATION);
  const total = Math.round(duration * FPS);
  process.stdout.write(`capturing ${total} frames at ${FPS}fps…\n`);

  for (let i = 0; i < total; i++) {
    const t = i / FPS;
    await page.evaluate((time) => window.render(time), t);
    await page.screenshot({
      path: path.join(OUT, String(i).padStart(5, '0') + '.png'),
      optimizeForSpeed: true,
    });
    if (i % 60 === 0) process.stdout.write(`  ${i}/${total}\n`);
  }

  await browser.close();
  process.stdout.write(`done: ${total} frames\n`);
})();
