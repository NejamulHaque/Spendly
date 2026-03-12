// ============================================================
//  SPENDLY — auth.js
//  Firebase Authentication — Email/Password + Google + Reset
//  All exports match exactly what script.js calls.
// ============================================================

import { auth, provider } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendPasswordResetEmail,
  sendEmailVerification,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ── Default: keep user signed in across browser restarts ─────
await setPersistence(auth, browserLocalPersistence);

// ── Watch auth state ──────────────────────────────────────────
// Called by script.js as: watchAuthState(onLogin, onLogout)
export function watchAuthState(onLogin, onLogout) {
  onAuthStateChanged(auth, user => (user ? onLogin(user) : onLogout()));
}

// ── Sign up with email + password ─────────────────────────────
export async function signUpEmail(name, email, password) {
  if (!name.trim())        throw new Error("Please enter your full name.");
  if (!email.trim())       throw new Error("Please enter your email.");
  if (password.length < 6) throw new Error("Password must be at least 6 characters.");

  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(cred.user, { displayName: name.trim() });

  // Send verification email (non-blocking)
  try { await sendEmailVerification(cred.user); } catch (_) {}

  return cred.user;
}

// ── Sign in with email + password ─────────────────────────────
export async function signInEmail(email, password) {
  if (!email.trim()) throw new Error("Please enter your email.");
  if (!password)     throw new Error("Please enter your password.");
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}

// ── Sign in with Google popup ─────────────────────────────────
export async function signInGoogle() {
  const cred = await signInWithPopup(auth, provider);
  return cred.user;
}

// ── Sign out ──────────────────────────────────────────────────
export async function logOut() {
  await signOut(auth);
}

// ── Send password reset email ─────────────────────────────────
export async function resetPassword(email) {
  if (!email.trim()) throw new Error("Please enter your email address.");
  await sendPasswordResetEmail(auth, email);
}

// ── Toggle remember-me persistence ───────────────────────────
export async function setRememberMe(remember) {
  await setPersistence(
    auth,
    remember ? browserLocalPersistence : browserSessionPersistence
  );
}

// ── Firebase error codes → human-readable messages ───────────
// Called by script.js as: friendlyError(e.code)
export function friendlyError(code) {
  const map = {
    "auth/email-already-in-use":    "This email is already registered. Try signing in.",
    "auth/invalid-email":           "Please enter a valid email address.",
    "auth/user-not-found":          "No account found with this email.",
    "auth/wrong-password":          "Incorrect password. Please try again.",
    "auth/invalid-credential":      "Invalid email or password.",
    "auth/too-many-requests":       "Too many attempts. Please wait a few minutes.",
    "auth/network-request-failed":  "Network error. Check your connection.",
    "auth/popup-closed-by-user":    "Google sign-in was cancelled.",
    "auth/popup-blocked":           "Pop-ups are blocked. Please allow pop-ups for this site.",
    "auth/weak-password":           "Password is too weak. Use at least 6 characters.",
    "auth/user-disabled":           "This account has been disabled. Please contact support.",
    "auth/account-exists-with-different-credential":
                                    "An account already exists with this email via a different sign-in method.",
    "auth/requires-recent-login":   "Please sign out and sign back in to continue.",
    "auth/configuration-not-found": "Firebase not configured. Paste credentials in firebase-config.js.",
    "auth/operation-not-allowed":   "This sign-in method is disabled. Check Firebase Console → Authentication.",
  };
  return map[code] || "Something went wrong. Please try again.";
}