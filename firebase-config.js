// Import Firebase
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";

import { 
  getAuth, 
  GoogleAuthProvider 
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  getFirestore,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBzB1OjG3qBd1J4Jv7-fBpqYFsAc4gVNTc",
  authDomain: "expence-tracker-3e97b.firebaseapp.com",
  projectId: "expence-tracker-3e97b",
  storageBucket: "expence-tracker-3e97b.firebasestorage.app",
  messagingSenderId: "566389036358",
  appId: "1:566389036358:web:0e5b3c52fc7c0054308147",
  measurementId: "G-LGC8Y1PRTQ"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Auth
const auth = getAuth(app);

// Google provider
const provider = new GoogleAuthProvider();

// Initialize Firestore
const db = getFirestore(app);

// Enable offline persistence
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code == 'failed-precondition') {
    console.warn('Multiple tabs open, persistence can only be enabled in one tab at a time.');
  } else if (err.code == 'unimplemented') {
    console.warn('The current browser does not support all of the features required to enable persistence.');
  }
});

// Export so other files can use them
export { auth, provider, db };