#!/usr/bin/env bash
set -euo pipefail

# Builds promo/demo.mp4 — the short video for the YouTube link on the Chrome
# Web Store listing.
#
# Usage:
#   ./scripts/build-promo-video.sh
#
# Requires headless Chrome, node, ffmpeg and puppeteer-core. puppeteer-core is
# installed into a temp dir on demand and drives the Chrome already on the
# machine, so nothing is added to this repo and no second browser is downloaded.
#
# The video is captured frame by frame from a page that renders the project's
# real popup.css: render(t) computes a whole frame from t alone, so the capture
# loop can ask for any instant and get the same pixels every time. Recording a
# live animation instead would make the result depend on when each screenshot
# happened to land.
#
# Output: promo/demo.mp4 — 1920x1080, 30fps, H.264, silent.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/promo"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
FPS="${FPS:-30}"

export PROMO_WORK="$(mktemp -d)"
trap 'rm -rf "${PROMO_WORK}"' EXIT

[ -x "${CHROME}" ] || { echo "ERROR: Google Chrome not found at ${CHROME}" >&2; exit 1; }
command -v node   >/dev/null || { echo "ERROR: node not found" >&2; exit 1; }
command -v ffmpeg >/dev/null || { echo "ERROR: ffmpeg not found. brew install ffmpeg" >&2; exit 1; }

mkdir -p "${OUT}" "${PROMO_WORK}/fav"

echo "Fetching favicons…"
for host in youtube.com open.spotify.com netflix.com twitch.tv soundcloud.com; do
  curl -fsSL --max-time 15 \
    "https://www.google.com/s2/favicons?domain=${host}&sz=64" \
    -o "${PROMO_WORK}/fav/${host}.png" \
    || { echo "ERROR: could not fetch favicon for ${host}" >&2; exit 1; }
done

echo "Installing puppeteer-core (temp)…"
npm install --silent --no-audit --no-fund --prefix "${PROMO_WORK}/tools" puppeteer-core >/dev/null 2>&1 \
  || { echo "ERROR: npm install puppeteer-core failed" >&2; exit 1; }
export PUPPETEER_PATH="${PROMO_WORK}/tools/node_modules/puppeteer-core"

echo "Building the video page…"
node "${ROOT}/scripts/promo/gen-video.js"

echo "Capturing frames…"
FPS="${FPS}" node "${ROOT}/scripts/promo/capture.js"

echo "Synthesising the backing track…"
# Generated from oscillators rather than downloaded, so there is no licence to
# honour and nothing that can be claimed against the video later.
python3 "${ROOT}/scripts/promo/gen-music.py" "${PROMO_WORK}/music.wav" 27.0

echo "Encoding…"
# yuv420p and the even-dimension filter keep it playable everywhere; faststart
# puts the index up front so it streams rather than waiting for a full download.
ffmpeg -y -loglevel error \
  -framerate "${FPS}" -i "${PROMO_WORK}/video-frames/%05d.png" \
  -i "${PROMO_WORK}/music.wav" \
  -c:v libx264 -preset slow -crf 18 \
  -c:a aac -b:a 192k -ac 2 \
  -pix_fmt yuv420p -movflags +faststart -shortest \
  -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" \
  "${OUT}/demo.mp4"

echo ""
echo "Built ${OUT}/demo.mp4"
ffprobe -v error -show_entries format=duration,size -show_entries stream=width,height,r_frame_rate \
  -of default=noprint_wrappers=1 "${OUT}/demo.mp4"
echo ""
echo "Next: upload to YouTube (unlisted is fine), then paste the URL at"
echo "      https://chrome.google.com/webstore/devconsole"
echo "      → Audio Tab Finder → Store listing → Video"
