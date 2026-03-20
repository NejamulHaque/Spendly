# Spendly — Bug Fixes Applied

## What Was Broken & What Was Fixed

---

### Bug 1 — `firebase-config.js` was missing Firestore (`db` export)

**Problem:** `db.js` imports `db` from `firebase-config.js`, but the original
`firebase-config.js` only initialized Auth — it never called `getFirestore()` and
never exported `db`. This caused a silent crash on every Firestore read/write.

**Fix:** Added `getFirestore(app)` and `export { ..., db }` to `firebase-config.js`.

---

### Bug 2 — Firebase SDK version mismatch

**Problem:** `firebase-config.js` imported from version `10.12.2`, but `auth.js`
and `db.js` imported from version `10.12.0`. Mixing versions of Firebase ES modules
causes hard-to-debug runtime errors and can break Auth state sharing between modules.

**Fix:** All three files now consistently import from `10.12.2`.

---

### Bug 3 — Google Sign-In popup blocked when opened from `file://`

**Problem:** Firebase's `signInWithPopup` requires the page to be served over
HTTP/HTTPS. Opening `index.html` directly from your file system (`file://`) causes
the Google popup to fail silently or throw `auth/popup-blocked`.

**Fix (you must do this):** Serve the project from a local server. Options:

**Option A — Quickest (Node.js required):**
```bash
cd /path/to/spendly
npx serve .
```
Then open: http://localhost:3000

**Option B — VS Code:**
Install "Live Server" extension → right-click `index.html` → Open with Live Server

**Option C — Python (already installed on most systems):**
```bash
cd /path/to/spendly
python3 -m http.server 3000
```
Then open: http://localhost:3000

---

## Files Changed

| File | Change |
|---|---|
| `firebase-config.js` | Added `getFirestore`, exported `db` |
| `auth.js` | Changed SDK version `10.12.0` → `10.12.2` |
| `db.js` | Changed SDK version `10.12.0` → `10.12.2` |
| `index.html`, `script.js`, `style.css`, `auth.css` | Unchanged |

---

## Final Checklist

- [ ] Replace all files in your project folder with these fixed versions
- [ ] Serve from localhost (not `file://`) — see Bug 3 above
- [ ] In Firebase Console → Authentication → Sign-in method: enable **Email/Password** AND **Google**
- [ ] In Firebase Console → Firestore Database: create database in **test mode**
- [ ] Open http://localhost:3000 and try signing in