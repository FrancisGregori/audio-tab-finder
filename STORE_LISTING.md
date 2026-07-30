# Chrome Web Store Listing

## Extension Name
Audio Tab Finder – Find & Close Tabs Playing Sound

## Short Description (132 characters max)
Instantly find which tab is playing that mystery sound. Stop the noise, switch tabs, or close them with one click!

## Detailed Description

**"WHERE IS THAT SOUND COMING FROM?!"**

We've all been there. You're deep in focus mode, conquering your to-do list like a productivity ninja, when suddenly... *music starts playing*. Or worse, an ad. From somewhere. One of your 47 open tabs has betrayed you.

You start the ancient ritual: clicking through tabs one by one, desperately hunting for the audio culprit. By the time you find it, you've lost your train of thought, your coffee is cold, and your zen is completely destroyed.

**Not anymore.**

Audio Tab Finder is your new best friend. One click shows you EXACTLY which tabs are making noise. No more tab-hunting. No more frustration. Just sweet, sweet silence (or music, if that's what you wanted).

### What can you do with it?

- **See all audio tabs at a glance** - A clean list showing every tab currently playing sound
- **Jump to any tab instantly** - Click on a tab to switch to it immediately
- **Mute or unmute anything** - One tab, one window, every other window, one profile, or absolutely everything
- **Mute all but this one** - The "solo" button silences the rest so you hear only what you want
- **Set the volume per tab** - A real 0-100% slider for each tab, not just mute
- **Close noisy tabs directly** - Hit the X button without even visiting the tab
- **Badge counter** - See how many tabs are playing audio right on the extension icon
- **Works everywhere** - YouTube, Spotify, random websites with autoplay videos... we catch them all

### Why Audio Tab Finder?

- **Lightweight** - No bloat, no tracking, no nonsense
- **Privacy-first** - We only check if tabs have audio. That's it. No data collection, ever.
- **Beautiful dark UI** - Easy on the eyes, especially during those late-night browsing sessions
- **Open source** - Trust, but verify. Check our code anytime.

### Perfect for:

- People with "just a few" tabs open (we don't judge your 100+ tabs)
- Remote workers in video calls ("Sorry, that wasn't me, let me find it...")
- Music lovers who forgot which Spotify tab is playing
- Anyone who's ever rage-clicked through tabs looking for an autoplay ad

**Stop the hunt. Find the sound. Reclaim your peace.**

---

*Made with frustration and determination by someone who had way too many tabs open.*

## NEW in v2.1: Bulk mute controls and per-tab volume

You asked, we built it. The popup now does a lot more than list tabs:

- Mute all / unmute all, with the scope you actually mean: this window,
  every other window, one specific Chrome profile, or everything at once.
- "Mute all others" on any tab - one click to hear only that one.
- A volume slider for each tab, 0 to 100%, independent of mute.

Keyboard: m mutes the selected tab, s solos it, v opens its volume,
Shift+M and Shift+U mute and unmute everything.

Volume control is the only feature that needs extra access, so it is
optional: nothing is requested at install time, and the extension only
asks the first time you press "Enable volume control". If you never touch
the slider, it never asks.

## NEW in v2.0: Cross-profile audio detection

Have multiple Chrome profiles open? With the optional native helper,
Audio Tab Finder shows audio tabs across ALL your Chrome profiles in one
popup. Mute, close, or jump to a tab in any profile — all from a single
view.

The extension still works fine without the helper (single-profile mode,
same as v1.x), but the cross-profile feature requires it because Chrome
isolates profiles for security.

Install instructions and source code:
https://github.com/FrancisGregori/audio-tab-finder

The native helper is open source, distributed via GitHub Releases, and
makes no network connections. The macOS installer is signed and notarized
by Apple. Linux and Windows builds are reproducible from public source via
GitHub Actions.

☕ Enjoying Audio Tab Finder? Support the project:
https://buymeacoffee.com/francisgregori

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
- noise
- productivity
- audio control
- tab finder
- playing audio
- browser tabs

## Additional Information

### Privacy Policy (Simple)
Audio Tab Finder does not collect, store, or transmit any user data. The extension only accesses tab information to identify which tabs are playing audio. No browsing history, no personal information, no analytics. Your tabs are your business.

### Support
For issues or feature requests, please visit our GitHub repository.
If you'd like to support development: https://buymeacoffee.com/francisgregori

---

## Screenshots Needed (for Chrome Web Store)

1. **Main popup** - Show the extension with 2-3 tabs playing audio
2. **Badge counter** - Show the extension icon with the badge number
3. **Empty state** - Show the "No tabs playing audio" message
4. **Close action** - Hover over close button to show the red highlight

### Recommended Screenshot Sizes
- Store listing: 1280x800 or 640x400
- Small promo tile: 440x280
- Large promo tile: 920x680
- Marquee promo tile: 1400x560

## Permissions Justification

If asked to justify permissions during the Chrome Web Store review:

- **`tabs`**: To detect which tabs are playing audio (required for the core feature) and to display tab titles, URLs, and favicons in the popup.
- **`storage`**: To persist a per-profile UUID and a user-defined profile label across browser restarts. No personal data is stored.
- **`nativeMessaging`**: To communicate with an optional native helper that detects audio playback across the user's Chrome profiles. The native helper is open source, distributed via GitHub, and only runs locally — no network communication. Source: https://github.com/FrancisGregori/audio-tab-finder

Optional permissions (declared as `optional_permissions` / `optional_host_permissions`, never requested at install time):

- **`scripting`** (optional): Used only for the per-tab volume feature. When the user moves a tab's volume slider, the extension injects a short function that sets the `volume` property on that page's `<audio>` and `<video>` elements. Chrome provides no API for tab volume, only mute, so this is the only way to offer the feature. Nothing is read from the page and nothing is transmitted.
- **`<all_urls>`** (optional host permission): Required by `scripting` above, and requested only the first time the user presses "Enable volume control" in the popup. It applies to all sites because the media element is frequently inside a cross-origin iframe (for example an embedded YouTube player on a blog), and each frame needs its own permission. The extension never reads page content, never injects on page load, and never contacts a server. Users who do not use the volume slider are never prompted.
