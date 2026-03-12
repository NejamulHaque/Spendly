# Spendly Firebase Setup Guide

Follow these steps to get login working in ~10 minutes.

---

## Step 1 — Create a Firebase Project

1. Go to https://console.firebase.google.com
2. Click **"Add project"**
3. Name it `spendly` (or anything you like)
4. Disable Google Analytics if you want (optional)
5. Click **Create project**

---

## Step 2 — Enable Authentication

1. In the Firebase Console sidebar click **Authentication**
2. Click **"Get started"**
3. Under **Sign-in method** tab, enable:
   - **Email/Password** → toggle ON → Save
   - **Google** → toggle ON → enter your support email → Save

---

## Step 3 — Create Firestore Database

1. In the sidebar click **Firestore Database**
2. Click **"Create database"**
3. Choose **"Start in test mode"** (you can add security rules later)
4. Select your nearest region → Click **Done**

---

## Step 4 — Get Your Config Keys

1. Click the **gear icon ⚙️** next to "Project Overview" → **Project settings**
2. Scroll to **"Your apps"** section
3. Click the **`</>`** (Web) icon to register a web app
4. Give it a nickname like `spendly-web`
5. Click **Register app**
6. You'll see a config block like this:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "spendly-xxx.firebaseapp.com",
  projectId: "spendly-xxx",
  storageBucket: "spendly-xxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123...:web:abc..."
};
```

---

## Step 5 — Paste Config into Spendly

Open **`firebase-config.js`** and replace every `PASTE_YOUR_..._HERE` value:

```js
const firebaseConfig = {
  apiKey:            "AIzaSy...",        // ← paste yours
  authDomain:        "spendly-xxx...",   // ← paste yours
  projectId:         "spendly-xxx",      // ← paste yours
  storageBucket:     "spendly-xxx...",   // ← paste yours
  messagingSenderId: "123456789",        // ← paste yours
  appId:             "1:123...",         // ← paste yours
};
```

Save the file.

---

## Step 6 — Enable Google Sign-In (Authorized Domain)

If you open the app from a local file (`file://`), Google Sign-In
popup may be blocked. To fix this:

**Option A — Use a local server (recommended)**

Install Node.js, then in the project folder run:
```bash
npx serve .
```
Then open http://localhost:3000

**Option B — Use VS Code Live Server**

Install the "Live Server" extension → Right-click `index.html` → Open with Live Server

**Option C — Deploy to Firebase Hosting (free)**

```bash
npm install -g firebase-tools
firebase login
firebase init hosting
firebase deploy
```

---

## Step 7 — Add Firestore Security Rules (Production)

Once you're ready to go live, replace **test mode** rules with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

This ensures each user can only access their own data.

---

## File Structure

```
spendly/
├── index.html          ← Main app HTML + auth screen
├── style.css           ← App styles
├── auth.css            ← Login screen styles
├── firebase-config.js  ← ⚠️ Your Firebase credentials go here
├── auth.js             ← Login / signup / Google / logout logic
├── db.js               ← All Firestore read/write operations
└── app.js              ← Full app logic (wired to Firebase)
```

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Firebase: Error (auth/configuration-not-found)" | You haven't pasted your config yet |
| Google popup closes immediately | Open via localhost, not file:// |
| "Missing or insufficient permissions" | Check Firestore is in test mode |
| Data not saving | Check browser console for errors |
