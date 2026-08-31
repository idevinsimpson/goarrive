import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getFunctions, type Functions } from 'firebase/functions';

// Real registration for the "We Stay Fit" Web App in the shared `goarrive`
// Firebase project (console receipt posted to #dev-westayfit on 2026-08-26).
// These are publishable client identifiers, not secrets — Firebase web config
// is public by design and every access decision is made by Firestore Rules.
// apiKey and messagingSenderId are per-PROJECT, so they necessarily match
// GoArrive's; only appId is per-APP, and that is what makes this a distinct
// registration. Analytics (measurementId) is deliberately omitted — WSF ships
// no Analytics.
const firebaseConfig = {
  apiKey: 'AIzaSyBgLIP0uvGJ98fde3aZthZjILTg6unkkX0',
  authDomain: 'goarrive.firebaseapp.com',
  projectId: 'goarrive',
  storageBucket: 'goarrive.firebasestorage.app',
  messagingSenderId: '413741232388',
  appId: '1:413741232388:web:30f3490b0a3b220dd42051',
};

let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let firestoreInstance: Firestore | null = null;
let functionsInstance: Functions | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!app) {
    app = initializeApp(firebaseConfig, 'westayfit');
  }
  return app;
}

export function getFirebaseAuth(): Auth {
  if (!authInstance) {
    authInstance = getAuth(getFirebaseApp());
  }
  return authInstance;
}

export function getFirebaseFirestore(): Firestore {
  if (!firestoreInstance) {
    firestoreInstance = getFirestore(getFirebaseApp());
  }
  return firestoreInstance;
}

export function getFirebaseFunctions(): Functions {
  if (!functionsInstance) {
    functionsInstance = getFunctions(getFirebaseApp(), 'us-central1');
  }
  return functionsInstance;
}

export const wsfFirebaseProjectId = firebaseConfig.projectId;
