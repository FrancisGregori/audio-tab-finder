#!/usr/bin/env bash
set -euo pipefail

# Regenerates every PNG under icons/ from the SVG masters kept in this file.
#
# Usage:
#   ./scripts/build-icons.sh
#
# Requires rsvg-convert (brew install librsvg).
#
#
# Why the geometry lives on a 16-unit grid
# ----------------------------------------
# The toolbar renders this at 16px, and that is the size that decides whether
# the icon reads at all. Authoring at 24 units and downscaling puts every edge
# on a fractional pixel and the result blurs. So the master is drawn on a
# 16x16 grid with integer coordinates only — 4 bars, 2 wide, 2 apart — which
# then scales exactly to 32 (2x), 48 (3x) and 128 (8x).
#
# Why the bars are vertically centred
# -----------------------------------
# Chrome draws the badge over the bottom-right of the icon, and this extension
# shows a badge whenever anything is playing — which is most of the time. Bars
# anchored to a baseline would lose their staggered tops, the only thing that
# identifies the mark. Centred, the top half survives the badge intact.
#
# Why the toolbar glyph is blue rather than theme-aware
# ----------------------------------------------------
# `theme_icons` is a Firefox manifest key; Chrome has no documented support for
# it, which is why the light/ and dark/ folders sat here as identical copies
# doing nothing. The toolbar glyph therefore has to work unaided on both a
# light (#f1f3f4) and a dark (#292a2d) toolbar. #3b82f6 clears 3:1 against both
# (3.30 and 3.91), and stays distinct from the green badge sitting on top of it.
# light/ and dark/ are still generated, correctly this time, for Firefox and for
# any Chrome build that does honour the key.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ICONS="${ROOT}/icons"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

command -v rsvg-convert >/dev/null || {
  echo "ERROR: rsvg-convert not found. brew install librsvg" >&2
  exit 1
}

TOOLBAR_BLUE="#3b82f6"   # reads on both light and dark toolbars
INK_LIGHT="#e8eaed"      # light-coloured glyph, for dark themes
INK_DARK="#1f2330"       # dark-coloured glyph, for light themes
TILE_NAVY="#16213e"      # matches the popup surface
TILE_GREEN="#4ade80"     # matches the badge and the popup accent

# The mark itself. Bars at x = 1, 5, 9, 13; heights 6, 12, 8, 4; every bar
# centred on y = 8 so the silhouette reads from the top half alone.
write_glyph_svg() {
  local color="$1" out="$2"
  cat > "${out}" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">
  <g fill="${color}">
    <rect x="1"  y="5" width="2" height="6"  rx="1"/>
    <rect x="5"  y="2" width="2" height="12" rx="1"/>
    <rect x="9"  y="4" width="2" height="8"  rx="1"/>
    <rect x="13" y="6" width="2" height="4"  rx="1"/>
  </g>
</svg>
SVG
}

# Store and extensions-page icon: the same mark at 4x on the popup's navy,
# inset 16px per side as the Chrome Web Store asks for.
write_tile_svg() {
  local out="$1"
  cat > "${out}" <<SVG
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <rect x="16" y="16" width="96" height="96" rx="21" fill="${TILE_NAVY}"/>
  <g fill="${TILE_GREEN}">
    <rect x="36" y="52" width="8" height="24" rx="4"/>
    <rect x="52" y="40" width="8" height="48" rx="4"/>
    <rect x="68" y="48" width="8" height="32" rx="4"/>
    <rect x="84" y="56" width="8" height="16" rx="4"/>
  </g>
</svg>
SVG
}

render() {
  local svg="$1" size="$2" out="$3"
  mkdir -p "$(dirname "${out}")"
  rsvg-convert -w "${size}" -h "${size}" "${svg}" -o "${out}"
}

write_glyph_svg "${TOOLBAR_BLUE}" "${TMP}/glyph-blue.svg"
write_glyph_svg "${INK_LIGHT}"    "${TMP}/glyph-light.svg"
write_glyph_svg "${INK_DARK}"     "${TMP}/glyph-dark.svg"
write_tile_svg                    "${TMP}/tile.svg"

# action.default_icon — what actually sits in the toolbar
for size in 16 32 48; do
  render "${TMP}/glyph-blue.svg" "${size}" "${ICONS}/toolbar/icon${size}.png"
done

# action.theme_icons — the icon's own colour names the file
for size in 16 32 48; do
  render "${TMP}/glyph-light.svg" "${size}" "${ICONS}/light/icon${size}.png"
  render "${TMP}/glyph-dark.svg"  "${size}" "${ICONS}/dark/icon${size}.png"
done

# manifest.icons — Chrome Web Store listing and chrome://extensions
render "${TMP}/tile.svg" 128 "${ICONS}/icon128.png"
render "${TMP}/tile.svg" 48  "${ICONS}/icon48.png"
# At 16 the tile collapses into a navy square with 1px marks in it, so the
# small size drops the tile and shows the mark plainly.
render "${TMP}/glyph-blue.svg" 16 "${ICONS}/icon16.png"

# Old 128s in light/ and dark/ were copies of the previous icon and are not
# referenced by the manifest at any size.
rm -f "${ICONS}/light/icon128.png" "${ICONS}/dark/icon128.png"

echo "Rebuilt icons:"
find "${ICONS}" -name '*.png' | sort | while read -r f; do
  printf '  %-34s %s\n' "${f#${ROOT}/}" "$(rsvg-convert --version >/dev/null; sips -g pixelWidth "$f" | tail -1 | tr -d ' ')"
done
