#!/usr/bin/env bash
set -euo pipefail

# Regenerates every Chrome Web Store asset in promo/.
#
# Usage:
#   ./scripts/build-promo-assets.sh
#
# Requires headless Chrome, node and ImageMagick.
#
# These are not mockups. scripts/promo/gen-frames.js links the project's real
# popup.css and reproduces the exact DOM popup.js builds, so the interface in
# the store listing is the interface that ships. Only the tab data is staged —
# rerun this after any change to the popup's markup or styles and the listing
# stays truthful for free.
#
# Output (sizes taken from the CWS upload form):
#   promo/1-find.png … 5-pause.png   1280x800  screenshots
#   promo/tile-small.png              440x280  small promo tile
#   promo/tile-marquee.png           1400x560  marquee promo tile
#
# All flattened to 24-bit PNG: the store rejects alpha.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${ROOT}/promo"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

export PROMO_WORK="$(mktemp -d)"
trap 'rm -rf "${PROMO_WORK}"' EXIT

[ -x "${CHROME}" ] || { echo "ERROR: Google Chrome not found at ${CHROME}" >&2; exit 1; }
command -v node    >/dev/null || { echo "ERROR: node not found" >&2; exit 1; }
command -v magick  >/dev/null || { echo "ERROR: ImageMagick not found. brew install imagemagick" >&2; exit 1; }

mkdir -p "${OUT}" "${PROMO_WORK}/fav" "${PROMO_WORK}/shots"

# Real favicons, so the rows look like what a user actually sees. Nominative
# use of the sites' marks in a screenshot of a tab manager.
echo "Fetching favicons…"
for host in youtube.com open.spotify.com netflix.com twitch.tv soundcloud.com; do
  curl -fsSL --max-time 15 \
    "https://www.google.com/s2/favicons?domain=${host}&sz=64" \
    -o "${PROMO_WORK}/fav/${host}.png" \
    || { echo "ERROR: could not fetch favicon for ${host}" >&2; exit 1; }
done

# Render the popup itself at 3x on a magenta page, then trim that magenta away.
# The sentinel colour matters: trimming against transparency made ImageMagick
# take its reference from the container's own corner pixel and strip the
# container's padding too, so raising .container's padding changed nothing in
# the output. Magenta appears nowhere in the popup, so the trim can only remove
# page background.
echo "Rendering popup frames…"
node "${ROOT}/scripts/promo/gen-frames.js"
for frame in list profiles bulk volume pause; do
  "${CHROME}" --headless --disable-gpu --hide-scrollbars --no-sandbox \
    --force-device-scale-factor=3 --window-size=380,900 \
    --default-background-color=ffff00ff \
    --screenshot="${PROMO_WORK}/shots/raw-${frame}.png" \
    "file://${PROMO_WORK}/frames/${frame}.html" >/dev/null 2>&1
  magick "${PROMO_WORK}/shots/raw-${frame}.png" \
    -bordercolor '#ff00ff' -border 1 -trim +repage -alpha off \
    "${PROMO_WORK}/shots/${frame}.png"
done

# Compose the store assets around those renders, at 2x for crisp type.
echo "Composing store assets…"
node "${ROOT}/scripts/promo/gen-promo.js"

shoot() {
  local name="$1" w="$2" h="$3"
  "${CHROME}" --headless --disable-gpu --hide-scrollbars --no-sandbox \
    --force-device-scale-factor=2 --window-size="${w},${h}" \
    --screenshot="${PROMO_WORK}/promo/raw-${name}.png" \
    "file://${PROMO_WORK}/promo/${name}.html" >/dev/null 2>&1
  magick "${PROMO_WORK}/promo/raw-${name}.png" \
    -resize "${w}x${h}!" -background '#0d0f1a' -alpha remove -alpha off \
    -strip "PNG24:${OUT}/${name}.png"
}

for name in 1-find 2-profiles 3-bulk 4-volume 5-pause; do shoot "${name}" 1280 800; done
shoot tile-small   440 280
shoot tile-marquee 1400 560

echo ""
echo "Built ${OUT}:"
for f in "${OUT}"/*.png; do
  printf '  %-22s %s\n' "$(basename "$f")" "$(magick identify -format '%wx%h  %[bit-depth]-bit' "$f")"
done
echo ""
echo "Next: upload at https://chrome.google.com/webstore/devconsole"
echo "      → Audio Tab Finder → Store listing → Graphic assets"
