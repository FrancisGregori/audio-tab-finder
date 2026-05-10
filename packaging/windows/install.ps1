# install.ps1 — installs audio-tab-finder-host on Windows
# Right-click this file and select "Run with PowerShell".

$ErrorActionPreference = "Stop"

$ExtensionId = "ecnkofmcbijompohhddkaaekdaenhmhh"
$InstallDir = Join-Path $env:LOCALAPPDATA "AudioTabFinder"
$BinaryName = "audio-tab-finder-host.exe"
$ManifestName = "com.fgregori.audio_tab_finder.json"
$RegistryKey = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.fgregori.audio_tab_finder"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceBinary = Join-Path $ScriptDir $BinaryName

if (-not (Test-Path $SourceBinary)) {
    Write-Error "Could not find $BinaryName next to install.ps1"
    exit 1
}

Write-Host ">>> Creating install directory at $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

Write-Host ">>> Copying binary"
Copy-Item -Path $SourceBinary -Destination (Join-Path $InstallDir $BinaryName) -Force

Write-Host ">>> Writing native messaging manifest"
$ManifestPath = Join-Path $InstallDir $ManifestName
$BinaryPath = (Join-Path $InstallDir $BinaryName) -replace '\\', '\\\\'
$Manifest = @"
{
  "name": "com.fgregori.audio_tab_finder",
  "description": "Audio Tab Finder native helper",
  "path": "$BinaryPath",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://$ExtensionId/"
  ]
}
"@
Set-Content -Path $ManifestPath -Value $Manifest -Encoding UTF8

Write-Host ">>> Registering native messaging host in registry"
New-Item -Path $RegistryKey -Force | Out-Null
Set-ItemProperty -Path $RegistryKey -Name "(Default)" -Value $ManifestPath

Write-Host ""
Write-Host "Done. Reload the Audio Tab Finder extension in Chrome."
Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
