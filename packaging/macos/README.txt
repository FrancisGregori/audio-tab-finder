Audio Tab Finder Native Helper

This installer registers a small command-line tool that allows the
Audio Tab Finder Chrome extension to detect audio playback across
your Chrome profiles.

The helper:
  - Is signed and notarized by Apple
  - Communicates only with the Audio Tab Finder Chrome extension
  - Reads and writes only files under
    ~/Library/Application Support/AudioTabFinder/
  - Makes no network connections

After installation, reload the Audio Tab Finder extension in Chrome
to enable cross-profile detection.

To uninstall:
  sudo rm "/Library/Application Support/AudioTabFinder/audio-tab-finder-host"
  sudo rm "/Library/Google/Chrome/NativeMessagingHosts/com.fgregori.audio_tab_finder.json"

Source code: https://github.com/FrancisGregori/audio-tab-finder
