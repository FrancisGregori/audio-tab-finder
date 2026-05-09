#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  cat <<EOF >&2
Usage: $0 <DeveloperIDApplication.p12> <DeveloperIDInstaller.p12>

Writes base64-encoded contents of each .p12 file to two separate files,
ready to upload to GitHub Secrets via 'gh secret set --body-file'.
EOF
  exit 1
fi

APP_P12="$1"
INSTALLER_P12="$2"

if [ ! -f "$APP_P12" ]; then
  echo "Error: $APP_P12 not found" >&2
  exit 1
fi

if [ ! -f "$INSTALLER_P12" ]; then
  echo "Error: $INSTALLER_P12 not found" >&2
  exit 1
fi

APP_OUT="/tmp/apple_cert_application.b64"
INSTALLER_OUT="/tmp/apple_cert_installer.b64"

base64 -i "$APP_P12" > "$APP_OUT"
base64 -i "$INSTALLER_P12" > "$INSTALLER_OUT"

cat <<EOF
Wrote:
  $APP_OUT       ($(wc -c < "$APP_OUT") bytes)
  $INSTALLER_OUT ($(wc -c < "$INSTALLER_OUT") bytes)

Set the GitHub Secrets via gh CLI:
  gh secret set APPLE_CERT_APPLICATION_P12_BASE64 --repo FrancisGregori/audio-tab-finder < "$APP_OUT"
  gh secret set APPLE_CERT_INSTALLER_P12_BASE64   --repo FrancisGregori/audio-tab-finder < "$INSTALLER_OUT"

Then also configure the other 5 secrets manually if not done yet:
  APPLE_CERT_PASSWORD          = the password you set when exporting the .p12 files
  APPLE_ID                     = your Apple Developer account email
  APPLE_TEAM_ID                = your 10-char Team ID
  APPLE_APP_SPECIFIC_PASSWORD  = the 19-char password from appleid.apple.com
  KEYCHAIN_PASSWORD            = any random string (used for the temporary CI keychain)

After uploading, securely delete the temp files:
  rm -f "$APP_OUT" "$INSTALLER_OUT"
EOF
