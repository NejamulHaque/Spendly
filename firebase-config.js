// ============================================================
//  SPENDLY — firebase-config.js
//  ⚠️  PASTE YOUR FIREBASE CREDENTIALS BELOW — only edit this file
//  All other files import from here automatically.
//  See SETUP-GUIDE.md for step-by-step instructions.
// ============================================================

import { initializeApp }               from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { getFirestore }                from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

// ── STEP 1: Replace every value below with your own ──────────
// Get it: Firebase Console → Project Settings → Your Apps → SDK setup → Config
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyBzB1OjG3qBd1J4Jv7-fBpqYFsAc4gVNTc",
  authDomain: "expence-tracker-3e97b.firebaseapp.com",
  projectId: "expence-tracker-3e97b",
  storageBucket: "expence-tracker-3e97b.firebasestorage.app",
  messagingSenderId: "566389036358",
  appId: "1:566389036358:web:0e5b3c52fc7c0054308147",
  // measurementId: "G-LGC8Y1PRTQ"
};

// ── DO NOT EDIT BELOW ─────────────────────────────────────────
const app      = initializeApp(firebaseConfig);
const auth     = getAuth(app);
const db       = getFirestore(app);
const provider = new GoogleAuthProvider();

export { auth, db, provider, firebaseConfig };