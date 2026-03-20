// ============================================================
//  NESTFY — db.js
//  Firestore Database Layer — all data scoped to /users/{uid}/
// ============================================================

import { db } from "./firebase-config.js";
import {
  collection, doc,
  addDoc, setDoc, updateDoc, deleteDoc,
  getDocs, getDoc, onSnapshot,
  query, orderBy,
  serverTimestamp, writeBatch,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Path helpers ─────────────────────────────────────────────
const txCol     = uid       => collection(db, "users", uid, "transactions");
const txDoc     = (uid, id) => doc(db, "users", uid, "transactions", id);
const budgetDoc = uid       => doc(db, "users", uid, "settings", "budgets");
const goalCol   = uid       => collection(db, "users", uid, "goals");
const goalDoc   = (uid, id) => doc(db, "users", uid, "goals", id);
const recCol    = uid       => collection(db, "users", uid, "recurring");
const recDoc    = (uid, id) => doc(db, "users", uid, "recurring", id);
const prefsDoc  = uid       => doc(db, "users", uid, "settings", "prefs");

// ── Transactions ─────────────────────────────────────────────
export async function addTransaction(uid, tx) {
  const ref = await addDoc(txCol(uid), { ...tx, createdAt: serverTimestamp() });
  return ref.id;
}

export async function updateTransaction(uid, id, tx) {
  await updateDoc(txDoc(uid, id), { ...tx, updatedAt: serverTimestamp() });
}

export async function deleteTransaction(uid, id) {
  await deleteDoc(txDoc(uid, id));
}

// Real-time listener — fires onChange([...txs]) on every Firestore change
export function listenTransactions(uid, onChange) {
  const q = query(txCol(uid), orderBy("date", "desc"));
  return onSnapshot(q, snap => {
    onChange(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export async function getAllTransactions(uid) {
  try {
    const snap = await getDocs(query(txCol(uid), orderBy("date", "desc")));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) { 
    console.warn("Load transactions warning:", e); 
    return []; 
  }
}

// ── Budgets ───────────────────────────────────────────────────
export async function saveBudgets(uid, budgets) {
  await setDoc(budgetDoc(uid), { data: budgets, updatedAt: serverTimestamp() });
}

export async function getBudgets(uid) {
  try {
    const snap = await getDoc(budgetDoc(uid));
    return snap.exists() ? (snap.data().data || {}) : {};
  } catch { return {}; }
}

// ── Goals ─────────────────────────────────────────────────────
export async function addGoal(uid, goal) {
  const ref = await addDoc(goalCol(uid), { ...goal, createdAt: serverTimestamp() });
  return ref.id;
}

export async function updateGoal(uid, id, data) {
  await updateDoc(goalDoc(uid, id), { ...data, updatedAt: serverTimestamp() });
}

export async function deleteGoal(uid, id) {
  await deleteDoc(goalDoc(uid, id));
}

export async function getAllGoals(uid) {
  try {
    const snap = await getDocs(goalCol(uid));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) { 
    console.warn("Load goals warning:", e); 
    return []; 
  }
}

// ── Recurring ─────────────────────────────────────────────────
export async function addRecurring(uid, item) {
  const ref = await addDoc(recCol(uid), { ...item, createdAt: serverTimestamp() });
  return ref.id;
}

export async function deleteRecurring(uid, id) {
  await deleteDoc(recDoc(uid, id));
}

export async function getAllRecurring(uid) {
  try {
    const snap = await getDocs(recCol(uid));
    return snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch(e) { 
    console.warn("Load recurring warning:", e); 
    return []; 
  }
}

// ── Preferences ───────────────────────────────────────────────
export async function savePrefs(uid, prefs) {
  await setDoc(prefsDoc(uid), { ...prefs, updatedAt: serverTimestamp() }, { merge: true });
}

export async function getPrefs(uid) {
  try {
    const snap = await getDoc(prefsDoc(uid));
    return snap.exists() ? snap.data() : {};
  } catch { return {}; }
}

// ── Wipe all user data ────────────────────────────────────────
export async function wipeAllUserData(uid) {
  const batch = writeBatch(db);
  const [txSnap, gSnap, rSnap] = await Promise.all([
    getDocs(txCol(uid)), getDocs(goalCol(uid)), getDocs(recCol(uid))
  ]);
  txSnap.docs.forEach(d => batch.delete(d.ref));
  gSnap.docs.forEach(d  => batch.delete(d.ref));
  rSnap.docs.forEach(d  => batch.delete(d.ref));
  batch.delete(budgetDoc(uid));
  batch.delete(prefsDoc(uid));
  await batch.commit();
}