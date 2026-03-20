# Spendly — Install on All Platforms

## What's Been Added
- `manifest.json` — App identity, icons, colors, shortcuts
- `sw.js` — Service worker for offline support & caching
- `generate-icons.js` — Generates all icon sizes automatically
- Updated `index.html` — PWA meta tags + install banner
- Updated `firebase.json` — Proper hosting headers

---

## STEP 1 — Generate App Icons

```bash
npm install sharp
node generate-icons.js
```

This creates an `icons/` folder with all required sizes.

**OR** skip this and use the free online tool:
1. Go to https://maskable.app/editor
2. Design your icon
3. Export all sizes into an `icons/` folder

---

## STEP 2 — Deploy to Firebase Hosting (Required for PWA)

PWA requires HTTPS — Firebase Hosting gives you a free `*.firebaseapp.com` domain.

```bash
# Install Firebase CLI (once)
npm install -g firebase-tools

# Login
firebase login

# Deploy
firebase deploy --only hosting
```

Your app will be live at:
```
https://expence-tracker-3e97b.web.app
```

---

## PLATFORM: Android (Install from Browser)

1. Open Chrome on Android
2. Go to your Firebase Hosting URL
3. Chrome shows **"Add Spendly to Home screen"** banner automatically
4. Tap **Install** → app appears on home screen like a native app

✅ Works on Chrome, Edge, Samsung Browser
✅ Fullscreen, no browser UI
✅ Works offline

---

## PLATFORM: iPhone / iOS

1. Open **Safari** on iPhone (must be Safari, not Chrome)
2. Go to your Firebase Hosting URL
3. Tap the **Share button** (box with arrow)
4. Tap **"Add to Home Screen"**
5. Tap **Add**

✅ App icon appears on home screen
✅ Fullscreen mode
⚠️ iOS PWA has some limitations (no push notifications)

---

## PLATFORM: Windows / Mac / Linux (Desktop)

**Chrome / Edge:**
1. Go to your Firebase Hosting URL in Chrome or Edge
2. Look for the **install icon** in the address bar (⊕ or computer icon)
3. Click it → click **Install**
4. App opens in its own window like a native app

**OR via Edge:**
1. Click `...` menu → Apps → Install this site as an app

✅ Appears in Start Menu / Applications
✅ Own window, no browser UI
✅ Works offline

---

## PLATFORM: Android APK (Play Store)

To publish on Play Store, use **TWA (Trusted Web Activity)**:

```bash
# Install Bubblewrap (Google's official TWA tool)
npm install -g @bubblewrap/cli

# Initialize TWA project
bubblewrap init --manifest https://expence-tracker-3e97b.web.app/manifest.json

# Build APK
bubblewrap build
```

This generates a signed APK you can upload to Google Play Store.

**Requirements:**
- Firebase Hosting must be live with HTTPS
- Need a Google Play Developer account ($25 one-time fee)
- Add your domain to `assetlinks.json` (Bubblewrap does this automatically)

---

## PLATFORM: Desktop App (Electron)

```bash
# Create electron wrapper
mkdir spendly-desktop && cd spendly-desktop
npm init -y
npm install electron

# Create main.js
cat > main.js << 'EOF'
const { app, BrowserWindow } = require('electron');

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    icon: '../icons/icon-512.png',
    webPreferences: { nodeIntegration: false }
  });
  win.loadURL('https://expence-tracker-3e97b.web.app');
  win.setTitle('Spendly');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
EOF

# Run
npx electron main.js

# Package as installer
npm install -g electron-builder
electron-builder --win    # Windows .exe
electron-builder --mac    # Mac .dmg
electron-builder --linux  # Linux .AppImage
```

---

## PWA Checklist

Before deploying, verify:
- [ ] `icons/` folder exists with all sizes (72 to 512)
- [ ] `manifest.json` is in root folder
- [ ] `sw.js` is in root folder
- [ ] Site is served over HTTPS (Firebase Hosting)
- [ ] Chrome DevTools → Application → Manifest shows no errors
- [ ] Chrome DevTools → Application → Service Workers shows "Activated"

---

## Test PWA Score

After deploying, run Lighthouse:
1. Open Chrome DevTools → Lighthouse tab
2. Select "Progressive Web App"
3. Click "Analyze page load"

Target score: **90+**