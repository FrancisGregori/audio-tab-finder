# Chrome Web Store Listing

Everything below is the text to paste into the Chrome Web Store dashboard.
Plain text only — the store does not render Markdown or HTML.

Last updated for **v2.1.0** (bulk mute controls, per-tab volume, pause).

## Extension Name

Audio Tab Finder – Find, Mute & Control Noisy Tabs

## Short Description (132 characters max)

Find the tab that's making noise. Mute it, pause it, or set its volume — in any Chrome profile, in one click.

## Detailed Description

WHERE IS THAT SOUND COMING FROM?!

You're working, browsing, or in a meeting, and suddenly… sound starts playing. A video. Music. An ad. Somewhere. One of your many open tabs is making noise — and you have no idea which one.

You start clicking tab by tab trying to find it. Your focus is gone.

Audio Tab Finder fixes this in one click.

Open the popup and every tab playing sound is right there. Jump to it, mute it, turn it down, pause it, or close it — without hunting for it first.

No more guessing. No more tab hunting. Full control over sound in your browser.

🔊 FIND IT

  • See all audio tabs at a glance — A clean list of every tab currently playing sound
  • Jump to any tab instantly — Go straight to the source
  • Badge counter — See how many tabs are playing audio right on the extension icon
  • Works on any site — YouTube, Spotify, Netflix, Twitch, news sites, autoplay ads, and more

🔇 SILENCE IT

  • Mute or unmute any tab — Without leaving the tab you're on
  • Mute all, unmute all — With the scope you actually mean: this window, your other windows, one Chrome profile, or everything at once. Each scope has its own switch, right where it belongs.
  • Mute all other tabs — One click to hear only the tab you care about, and it unmutes that one for you
  • Close it — Kill the noise completely

🎚️ TURN IT DOWN — OR STOP IT

  • Volume per tab — A real 0 to 100% slider for every tab, independent of mute. Turn a loud tab down instead of silencing it.
  • Pause playback — Muting leaves the video running. Pausing actually stops it. Paused tabs stay in your list with a play button, so you can pick them back up whenever you want.

About the permission these two need: nothing extra is requested when you install. The first time you open a volume slider, the extension asks — and that access does exactly one thing: set the volume on, or pause, the audio and video elements of the page you chose. No page content is ever read. Nothing ever leaves your computer. If you never use volume or pause, you are never asked.

⌨️ KEYBOARD

Everything works from the keyboard, inside the popup:

  • Arrow keys, Home, End — move between tabs
  • Enter — switch to the selected tab
  • M — mute or unmute it
  • S — mute every other tab
  • P — pause or resume it
  • V — open its volume slider
  • Delete — close it
  • Shift+M / Shift+U — mute or unmute everything, everywhere

🌐 USE MULTIPLE CHROME PROFILES? (OPTIONAL HELPER)

If you keep more than one Chrome profile open at the same time — work, personal, school, dev — Audio Tab Finder can detect and control audio across ALL of them, not just the profile you're currently in.

To enable cross-profile detection, install our free open-source companion: the Audio Tab Finder native helper. It's a tiny local program that lets the extension see what's happening in your other Chrome profiles.

How to install:

  1. Open the Audio Tab Finder popup
  2. Click the "Detect audio across profiles?" banner at the bottom
  3. Follow the link to GitHub Releases and download the installer for your OS:
  – macOS: signed and notarized .pkg (no Gatekeeper warning, just double-click)
  – Linux: .deb / .rpm / .tar.gz for Debian, Ubuntu, Fedora, openSUSE, etc.
  – Windows: .zip with a PowerShell installer (no admin rights needed)
  4. Reload the extension at chrome://extensions

Once installed, the popup automatically shows:

  • Which Chrome profile is making each sound
  • A combined badge counter for ALL profiles ("3" instead of just "1")
  • An "Other profiles" section listing audio tabs from other profiles
  • Mute, unmute, solo, close or jump to audio tabs in any profile — without switching profiles first
  • Mute all or unmute all in a specific profile, from a switch next to its name

Two honest notes on what crosses profiles and what doesn't. The volume slider works on another profile's tabs, but it can't read that tab's current level back, so it opens where you last left it — and that profile needs to have enabled volume control itself. Pause and resume work in your current profile only.

The helper runs entirely on your machine. It makes ZERO network connections. It just opens a tiny local channel between Chrome profiles on the same computer. The full source code is on GitHub — you can read every line before installing.

If you only use one Chrome profile, you can ignore all of this — the extension already works perfectly for you out of the box.

💡 WHY AUDIO TAB FINDER?

  • Lightweight — No bloat, no ads, no tracking
  • Privacy-first — We only detect which tabs are playing audio. No data collection. Ever.
  • Clean dark UI — Easy on the eyes, even during long sessions
  • Open source — Inspect the code on GitHub anytime

👌 PERFECT FOR

  • People who always have too many tabs open
  • Remote workers in meetings
  • Anyone tired of autoplay videos and random sounds
  • Anyone who wants one tab quieter, not silent
  • Multi-profile users who want to know which Chrome profile is making noise

  Stop the hunt. Control the sound. Stay focused.

☕ Enjoying Audio Tab Finder? Support the project: https://buymeacoffee.com/francisgregori

## Category

Productivity

## Keywords/Tags

- audio
- tabs
- sound
- music
- find tabs
- tab manager
- mute
- mute all tabs
- tab volume
- volume control
- pause video
- noise
- productivity
- audio control
- tab finder
- playing audio
- browser tabs

## Additional Information

### Privacy Policy (Simple)

Audio Tab Finder does not collect, store, or transmit any user data. The extension only accesses tab information to identify which tabs are playing audio. The optional volume and pause features set the volume on, or pause, media elements in a page you explicitly choose — they never read page content. No browsing history, no personal information, no analytics. Your tabs are your business.

### Support

For issues or feature requests, please visit our GitHub repository.
If you'd like to support development: https://buymeacoffee.com/francisgregori

## Graphic Assets

All generated by `./scripts/build-promo-assets.sh` into `promo/`. They render
the real `popup.css`, so rerun the script after any popup change and the
listing stays accurate.

| Slot | File | Size |
|---|---|---|
| Global screenshots | `promo/1-find.png` | 1280x800 |
| | `promo/2-profiles.png` | 1280x800 |
| | `promo/3-bulk.png` | 1280x800 |
| | `promo/4-volume.png` | 1280x800 |
| | `promo/5-pause.png` | 1280x800 |
| Small promo tile | `promo/tile-small.png` | 440x280 |
| Marquee promo tile | `promo/tile-marquee.png` | 1400x560 |

The store icon comes from `manifest.icons` (128px), so uploading the package
updates it — there is no separate icon upload.

## Permissions Justification

If asked to justify permissions during the Chrome Web Store review:

- **`tabs`**: To detect which tabs are playing audio (required for the core feature) and to display tab titles, URLs, and favicons in the popup.
- **`storage`**: To persist a per-profile UUID and a user-defined profile label across browser restarts. No personal data is stored.
- **`nativeMessaging`**: To communicate with an optional native helper that detects audio playback across the user's Chrome profiles. The native helper is open source, distributed via GitHub, and only runs locally — no network communication. Source: https://github.com/FrancisGregori/audio-tab-finder

Optional permissions (declared as `optional_permissions` / `optional_host_permissions`, never requested at install time):

- **`scripting`** (optional): Used only for the per-tab volume and pause features. When the user moves a tab's volume slider or presses pause, the extension injects a short function that sets the `volume` property on, or calls `pause()`/`play()` on, that page's `<audio>` and `<video>` elements. Chrome provides no API for tab volume or playback, only mute, so this is the only way to offer these features. Nothing is read from the page and nothing is transmitted.
- **`<all_urls>`** (optional host permission): Required by `scripting` above, and requested only the first time the user presses "Enable volume control" in the popup. It applies to all sites because the media element is frequently inside a cross-origin iframe (for example an embedded YouTube player on a blog), and each frame needs its own permission. The extension never reads page content, never injects on page load, and never contacts a server. Users who do not use volume or pause are never prompted.
