// =================================================================
// EZ Pilot — Firebase Client SDK (ez-pilot.com)
// Load this in the HTML as <script type="module" src="/firebase-client.js">
//
// Fill in firebaseConfig from Firebase Console → Project Settings
// =================================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  signInWithPopup, GoogleAuthProvider, FacebookAuthProvider, OAuthProvider,
  signOut, onAuthStateChanged
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, doc, setDoc, getDoc, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

// ---- REPLACE with your Firebase project config ----
const firebaseConfig = {
  apiKey:            "YOUR_WEB_API_KEY",
  authDomain:        "ez-pilot.firebaseapp.com",
  projectId:         "ez-pilot",
  storageBucket:     "ez-pilot.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
export const storage = getStorage(app);

// ---- Sign-in methods ----
export async function signInEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}
export async function signUpEmail(email, password, acceptedTerms) {
  const cred = await createUserWithEmailAndPassword(auth, email, password);
  await setDoc(doc(db, 'users', cred.user.uid), {
    email,
    plan: 'pro',
    trialStartedAt: serverTimestamp(),
    termsAcceptedAt: acceptedTerms ? serverTimestamp() : null,
    createdAt: serverTimestamp(),
  }, { merge: true });
  return cred;
}
export async function signInGoogle() {
  const provider = new GoogleAuthProvider();
  // Add scopes for unified Google OAuth (Gmail, Docs, Calendar, Drive, Ads...)
  provider.addScope('https://www.googleapis.com/auth/gmail.modify');
  provider.addScope('https://www.googleapis.com/auth/documents');
  provider.addScope('https://www.googleapis.com/auth/calendar');
  provider.addScope('https://www.googleapis.com/auth/drive');
  provider.addScope('https://www.googleapis.com/auth/adwords');
  return signInWithPopup(auth, provider);
}
export async function signInFacebook() {
  const provider = new FacebookAuthProvider();
  provider.addScope('email');
  provider.addScope('public_profile');
  return signInWithPopup(auth, provider);
}
export async function signInMicrosoft() {
  const provider = new OAuthProvider('microsoft.com');
  provider.addScope('mail.read');
  provider.addScope('calendars.read');
  provider.addScope('user.read');
  return signInWithPopup(auth, provider);
}
export async function logout() {
  return signOut(auth);
}

// ---- Authed fetch wrapper ----
export async function apiFetch(path, options = {}) {
  const token = await auth.currentUser?.getIdToken();
  return fetch(path, {
    ...options,
    headers: {
      ...(options.headers || {}),
      'Authorization': `Bearer ${token}`,
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    },
  });
}

export { onAuthStateChanged };
