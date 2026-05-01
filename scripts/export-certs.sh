#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
  cat <<EOF >&2
Usage: $0 <DeveloperIDApplication.p12> <DeveloperIDInstaller.p12>

Outputs base64-encoded contents of each .p12 file, ready to paste
into GitHub Secrets as APPLE_CERT_APPLICATION_P12_BASE64 and
APPLE_CERT_INSTALLER_P12_BASE64.

The password used to export the .p12 files goes into a separate
secret APPLE_CERT_PASSWORD.
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

cat <<EOF

=== APPLE_CERT_APPLICATION_P12_BASE64 ===
Paste the lines below as the value of GitHub Secret APPLE_CERT_APPLICATION_P12_BASE64:

$(base64 -i "$APP_P12")

=== APPLE_CERT_INSTALLER_P12_BASE64 ===
Paste the lines below as the value of GitHub Secret APPLE_CERT_INSTALLER_P12_BASE64:

$(base64 -i "$INSTALLER_P12")

=== Done ===
Don't forget to also configure the other 5 secrets:
  APPLE_CERT_PASSWORD          = the password you set when exporting the .p12 files
  APPLE_ID                     = your Apple Developer account email
  APPLE_TEAM_ID                = your 10-char Team ID
  APPLE_APP_SPECIFIC_PASSWORD  = the 19-char password from appleid.apple.com
  KEYCHAIN_PASSWORD            = any random string (used for the temporary CI keychain)
EOF
