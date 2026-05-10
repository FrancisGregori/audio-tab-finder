# install.ps1 — installs audio-tab-finder-host on Windows.
#
# Usage:
#   Right-click → "Run with PowerShell"
#
# OR, if "Run with PowerShell" doesn't work (Mark of the Web / execution policy):
#   PowerShell -ExecutionPolicy Bypass -File .\install.ps1
#
# OR to use a specific extension ID (e.g. for a "Load unpacked" dev build):
#   PowerShell -ExecutionPolicy Bypass -File .\install.ps1 -ExtensionId abcdef...
#
# By default, this script will:
#   1. Always allow the published Chrome Web Store ID
#   2. Scan your local Chrome profiles for any "Audio Tab Finder" extensions
#      (e.g. dev-mode unpacked builds) and add their IDs as well
# So both CWS and Load-unpacked installs work without any manual editing.

param(
    [string]$ExtensionId = $null
)

$ErrorActionPreference = "Stop"

$CwsExtensionId = "ecnkofmcbijompohhddkaaekdaenhmhh"
$InstallDir    = Join-Path $env:LOCALAPPDATA "AudioTabFinder"
$BinaryName    = "audio-tab-finder-host.exe"
$ManifestName  = "com.fgregori.audio_tab_finder.json"
$RegistryKey   = "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.fgregori.audio_tab_finder"

$ScriptDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$SourceBinary = Join-Path $ScriptDir $BinaryName

if (-not (Test-Path $SourceBinary)) {
    Write-Error "Could not find $BinaryName next to install.ps1"
    exit 1
}

# ----------------------------------------------------------------
# Build the list of allowed extension IDs
# ----------------------------------------------------------------

function Find-AudioTabFinderExtensionIds {
    $found = New-Object System.Collections.Generic.HashSet[string]
    $userData = Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"
    if (-not (Test-Path $userData)) { return @() }

    Get-ChildItem -Path $userData -Directory -ErrorAction SilentlyContinue | ForEach-Object {
        $extensionsDir = Join-Path $_.FullName "Extensions"
        if (-not (Test-Path $extensionsDir)) { return }

        Get-ChildItem -Path $extensionsDir -Directory -ErrorAction SilentlyContinue | ForEach-Object {
            $extId = $_.Name
            # An extension folder contains version subfolders. Use the latest.
            $versionDir = Get-ChildItem -Path $_.FullName -Directory -ErrorAction SilentlyContinue |
                Sort-Object Name -Descending | Select-Object -First 1
            if (-not $versionDir) { return }

            $manifestPath = Join-Path $versionDir.FullName "manifest.json"
            if (-not (Test-Path $manifestPath)) { return }

            try {
                $manifest = Get-Content -Raw $manifestPath | ConvertFrom-Json

                # Must request nativeMessaging — narrows it down a lot.
                $hasNm = $false
                if ($manifest.permissions) {
                    $hasNm = ($manifest.permissions -contains "nativeMessaging")
                }
                if (-not $hasNm) { return }

                # Resolve display name (i18n-aware).
                $displayName = $null
                if ($manifest.name -and $manifest.name -notlike "__MSG_*__") {
                    $displayName = $manifest.name
                } else {
                    $localesEn = Join-Path $versionDir.FullName "_locales\en\messages.json"
                    if (Test-Path $localesEn) {
                        $messages = Get-Content -Raw $localesEn | ConvertFrom-Json
                        if ($messages.extensionName -and $messages.extensionName.message) {
                            $displayName = $messages.extensionName.message
                        }
                    }
                }

                if ($displayName -and ($displayName -like "*Audio Tab Finder*")) {
                    [void]$found.Add($extId)
                }
            } catch {
                # ignore extensions with unparseable manifests
            }
        }
    }
    return @($found)
}

$allowedIds = New-Object System.Collections.Generic.HashSet[string]

if ($ExtensionId) {
    [void]$allowedIds.Add($ExtensionId)
    Write-Host ">>> Using explicit extension ID: $ExtensionId"
} else {
    [void]$allowedIds.Add($CwsExtensionId)
    Write-Host ">>> Including Chrome Web Store ID: $CwsExtensionId"

    $detected = Find-AudioTabFinderExtensionIds
    if ($detected.Count -gt 0) {
        Write-Host ">>> Detected local Audio Tab Finder extension IDs:"
        foreach ($id in $detected) {
            if ($id -ne $CwsExtensionId) {
                Write-Host "    - $id"
            }
            [void]$allowedIds.Add($id)
        }
    } else {
        Write-Host ">>> No local Audio Tab Finder installs found (CWS-only mode)"
    }
}

# ----------------------------------------------------------------
# Install
# ----------------------------------------------------------------

Write-Host ">>> Creating install directory at $InstallDir"
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

Write-Host ">>> Copying binary"
Copy-Item -Path $SourceBinary -Destination (Join-Path $InstallDir $BinaryName) -Force

Write-Host ">>> Writing native messaging manifest"
$ManifestPath = Join-Path $InstallDir $ManifestName
$BinaryPath   = (Join-Path $InstallDir $BinaryName) -replace '\\', '\\\\'

# Build the allowed_origins JSON array.
$originsList = @()
foreach ($id in $allowedIds) {
    $originsList += "    `"chrome-extension://$id/`""
}
$originsJson = $originsList -join ",`r`n"

$Manifest = @"
{
  "name": "com.fgregori.audio_tab_finder",
  "description": "Audio Tab Finder native helper",
  "path": "$BinaryPath",
  "type": "stdio",
  "allowed_origins": [
$originsJson
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
Write-Host "If it still doesn't connect, your extension ID may not be in the list."
Write-Host "Open chrome://extensions, copy the ID under 'Audio Tab Finder', and re-run:"
Write-Host "  PowerShell -ExecutionPolicy Bypass -File .\install.ps1 -ExtensionId <your-id>"
Write-Host ""
Write-Host "Press any key to exit..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
