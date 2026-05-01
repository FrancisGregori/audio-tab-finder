# uninstall.ps1 — removes audio-tab-finder-host from Windows
# Right-click this file and select "Run with PowerShell".

$ErrorActionPreference = "Continue"

$InstallDir = Join-Path $env:LOCALAPPDATA "AudioTabFinder"
$RegistryKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.fgregori.audio_tab_finder"

Write-Host ">>> Removing registry key"
if (Test-Path $RegistryKey) {
    Remove-Item -Path $RegistryKey -Recurse -Force
}

Write-Host ">>> Removing install directory"
if (Test-Path $InstallDir) {
    Remove-Item -Path $InstallDir -Recurse -Force
}

Write-Host ""
Write-Host "Done. The native helper has been removed."
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
