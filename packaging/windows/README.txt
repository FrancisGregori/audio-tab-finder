Audio Tab Finder Native Helper — Windows install

This ZIP contains:
  - audio-tab-finder-host.exe   (the native helper binary)
  - install.ps1                 (PowerShell installer script)
  - uninstall.ps1               (PowerShell uninstaller script)

To install:
  1. Right-click install.ps1 and select "Run with PowerShell".
  2. If PowerShell prompts about untrusted scripts, type Y and press Enter.
  3. Wait for "Done" message.
  4. Reload the Audio Tab Finder extension in Chrome.

The installer:
  - Copies the binary to %LOCALAPPDATA%\AudioTabFinder\
  - Writes a native messaging manifest there
  - Registers the manifest in HKCU\Software\Google\Chrome\NativeMessagingHosts
  - Requires no admin privileges (per-user install)
  - Makes no network connections

To uninstall:
  Right-click uninstall.ps1 and select "Run with PowerShell".

NOTE: This installer is not signed with a Windows Authenticode certificate
(those are expensive for a free open-source project). The PowerShell script
is plain text — you can read it before running.

Source code: https://github.com/FrancisGregori/audio-tab-finder
