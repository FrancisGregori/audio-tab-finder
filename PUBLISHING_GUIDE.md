# Publishing Guide - Chrome Web Store

## Prerequisites

1. **Google Developer Account**
   - Go to [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole)
   - Pay the one-time $5 registration fee
   - Verify your email

2. **Prepare Your Assets**
   - Extension ZIP file
   - Screenshots (at least 1, up to 5)
   - Promotional images (optional but recommended)
   - Privacy policy URL (required)

---

## Step 1: Create Extension ZIP

Run this command in the extension directory:

```bash
zip -r audio-tab-finder.zip manifest.json popup.html popup.css popup.js background.js icons/
```

**Important:** Don't include these files in the ZIP:
- `promo.html`
- `privacy.html`
- `STORE_LISTING.md`
- `PUBLISHING_GUIDE.md`
- Any `.git` folders
- Any development files

---

## Step 2: Take Screenshots

### Required Screenshots (1280x800 or 640x400)

1. **Main popup with audio tabs**
   - Open YouTube, Spotify, or any audio-playing site
   - Click the extension icon
   - Take a screenshot of the popup

2. **Badge counter**
   - Show the toolbar with the extension icon displaying the badge number

3. **Empty state**
   - Close all audio tabs
   - Show the "No tabs playing audio" message

### Tips for Great Screenshots
- Use a clean browser window (no personal bookmarks visible)
- Use example sites like YouTube, Spotify, SoundCloud
- Consider using a screenshot tool that captures at exact dimensions

---

## Step 3: Host Privacy Policy

You need a public URL for your privacy policy. Options:

1. **GitHub Pages** (free)
   - Push `privacy.html` to a GitHub repo
   - Enable GitHub Pages in repo settings
   - URL: `https://yourusername.github.io/audio-tab-finder/privacy.html`

2. **Any web hosting**
   - Upload `privacy.html` to your server

---

## Step 4: Upload to Chrome Web Store

1. Go to [Developer Dashboard](https://chrome.google.com/webstore/devconsole)
2. Click **"New Item"**
3. Upload your ZIP file
4. Fill in the store listing:

### Store Listing Fields

| Field | Value |
|-------|-------|
| **Language** | English |
| **Extension name** | Audio Tab Finder – Find & Close Tabs Playing Sound |
| **Summary** | (copy from STORE_LISTING.md - 132 chars max) |
| **Description** | (copy from STORE_LISTING.md) |
| **Category** | Productivity |
| **Language** | English (United States) |

### Upload Screenshots
- Upload 1-5 screenshots (1280x800 recommended)

### Privacy Tab
- **Single purpose description**: "Find and manage browser tabs that are currently playing audio"
- **Permission justification for "tabs"**: "Required to detect which tabs are playing audio and to switch/close tabs"
- **Privacy policy URL**: Your hosted privacy.html URL

---

## Step 5: Submit for Review

1. Review all information
2. Click **"Submit for Review"**
3. Wait 1-3 business days for review

### Common Rejection Reasons
- Missing or invalid privacy policy
- Screenshots showing personal information
- Description doesn't match functionality
- Missing permission justifications

---

## Step 6: After Approval

Once approved, your extension will be live! You can:

1. Share the Chrome Web Store URL
2. Update `promo.html` with the actual store link
3. Track installs in the Developer Dashboard

---

## Updating the Extension

1. Increment version in `manifest.json` (e.g., "1.0.0" → "1.0.1")
2. Create new ZIP
3. Go to Developer Dashboard
4. Click on your extension
5. Upload new ZIP in "Package" tab
6. Submit for review

---

## Quick Commands

```bash
# Create production ZIP
cd /Users/fgregori/Projects/personal/audio-tab-finder
zip -r audio-tab-finder-v1.0.0.zip manifest.json popup.html popup.css popup.js background.js icons/

# Check ZIP contents
unzip -l audio-tab-finder-v1.0.0.zip
```

---

## Checklist Before Publishing

- [ ] Tested extension works correctly
- [ ] All icons display properly (16, 48, 128)
- [ ] Badge counter works
- [ ] Popup opens and lists audio tabs
- [ ] Close button works
- [ ] Tab switching works
- [ ] Privacy policy hosted and accessible
- [ ] Screenshots taken
- [ ] Description proofread
- [ ] Version number is correct

---

Good luck with your launch!

---

## Releasing v2.x

### One-time setup

- Apple Developer Program enrolled
- Certificates installed in your local Mac's login keychain (Developer ID
  Application + Developer ID Installer) — used for `release-macos.sh`
- App-Specific Password generated at https://appleid.apple.com
- The 5 Apple env vars exported in your shell rc (see BUILDING.md)
- The `gh` CLI authenticated (`gh auth status`)

### Per-release steps

1. **Bump versions in code:**
   - `manifest.json`: update `"version"` field
   - `host-connection.js`: update `EXPECTED_HOST_VERSION` constant to match

2. **Commit and push:**
   ```bash
   git add manifest.json host-connection.js
   git commit -m "chore: bump version to X.Y.Z"
   git push
   ```

3. **Tag and push the tag:**
   ```bash
   git tag vX.Y.Z
   git push --tags
   ```

4. **Wait for CI (~3 minutes).**
   The GitHub Actions release workflow will:
   - Build `.deb`, `.rpm`, `.tar.gz` for Linux (amd64 + arm64)
   - Build `.zip` for Windows
   - Generate `SHA256SUMS.txt`
   - Create a GitHub Release with the Linux + Windows artifacts

   The release page initially shows a note that the macOS `.pkg` will be
   uploaded shortly.

5. **Build, notarize and upload the macOS `.pkg` from your Mac:**
   ```bash
   ./scripts/release-macos.sh X.Y.Z
   ```
   This signs, notarizes (typically 1-3 min wait on Apple), staples, and
   uploads the `.pkg` to the existing release page via `gh release upload`.

6. **Verify the release:**
   - Open https://github.com/FrancisGregori/audio-tab-finder/releases/tag/vX.Y.Z
   - Confirm all 8 artifacts are listed (1 .pkg, 2 .deb, 2 .rpm, 1 .tar.gz, 1 .zip, SHA256SUMS.txt)
   - Re-download the `.pkg` and verify with `spctl --assess --type install`

7. **Build the extension archive for Chrome Web Store:**
   ```bash
   zip -r Archive.zip . \
     -x 'native-host/*' \
     -x 'scripts/*' \
     -x 'packaging/*' \
     -x 'docs/*' \
     -x '.github/*' \
     -x '.git/*' \
     -x 'dist/*' \
     -x '*.zip' \
     -x 'BUILDING.md' \
     -x 'STORE_LISTING.md' \
     -x 'PUBLISHING_GUIDE.md'
   ```

8. **Upload to Chrome Web Store Developer Dashboard:**
   - Open https://chrome.google.com/webstore/devconsole
   - Select the Audio Tab Finder extension
   - Click "Package" → "Upload new package"
   - Select `Archive.zip`
   - Update the listing's description if needed (see `STORE_LISTING.md`)
   - Submit for review

9. **Wait for review** (typically 1-3 days, sometimes longer if `nativeMessaging` triggers manual review).

### Rollback

If a critical issue is found after release:

- **In the GitHub Release:** click "Delete this release" on the GitHub Releases UI. The tag remains; you can re-release after fixing by tagging vX.Y.Z+1.
- **In the Chrome Web Store:** if the new version was approved and published, submit a hotfix vX.Y.Z+1 ASAP. Users on the bad version will auto-update within ~24 hours of the new approval.

### Test releases

To test the CI pipeline without affecting public users, push a pre-release tag:

```bash
git tag v0.0.1-test
git push --tags
```

The workflow has `prerelease: ${{ contains(github.ref, '-') }}` so any tag containing a `-` is marked as pre-release on GitHub. After validating, delete the test release and tag:

```bash
gh release delete v0.0.1-test --yes
git tag -d v0.0.1-test
git push origin :refs/tags/v0.0.1-test
```
