import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';

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

// Emulator ports, matching firebase.westayfit.emulators.json.
const EMULATOR_HOST = '127.0.0.1';
const AUTH_EMULATOR_PORT = 9099;
const FIRESTORE_EMULATOR_PORT = 8080;
const FUNCTIONS_EMULATOR_PORT = 5001;

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

// Whether this build should talk to the local emulator suite instead of the
// real project.
//
// Guarded TWICE on purpose. The build-time flag alone is not enough to make
// this safe to carry in a deploy candidate: an env var can leak into a hosted
// build by accident, and a production bundle that silently pointed real
// members at a nonexistent emulator would fail every auth call with a network
// error and look like an outage. The second guard is structural — the page
// must actually be served from a loopback host — so a hosted build cannot
// connect to an emulator even if the flag is set.
//
// This exists so the M-U2 signup → verify → profile-setup → start-community
// flow can be driven end to end locally. Without it that flow is only
// assertable in pieces, and the ID-token-refresh fix in verify-email.tsx (the
// one that decides whether a new member dead-ends) cannot be proven at all.
function shouldUseEmulators(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  const flagged = raw === '1' || raw?.trim().toLowerCase() === 'true';
  if (!flagged) return false;
  if (typeof window === 'undefined') return true;
  return LOOPBACK_HOSTNAMES.has(window.location.hostname);
}

const emulated = shouldUseEmulators();

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
    if (emulated) {
      // disableWarnings keeps the emulator's red banner out of screenshots in
      // the Playwright run; it does not weaken any check.
      connectAuthEmulator(authInstance, `http://${EMULATOR_HOST}:${AUTH_EMULATOR_PORT}`, {
        disableWarnings: true,
      });
    }
  }
  return authInstance;
}

export function getFirebaseFirestore(): Firestore {
  if (!firestoreInstance) {
    firestoreInstance = getFirestore(getFirebaseApp());
    if (emulated) {
      connectFirestoreEmulator(firestoreInstance, EMULATOR_HOST, FIRESTORE_EMULATOR_PORT);
    }
  }
  return firestoreInstance;
}

export function getFirebaseFunctions(): Functions {
  if (!functionsInstance) {
    functionsInstance = getFunctions(getFirebaseApp(), 'us-central1');
    if (emulated) {
      connectFunctionsEmulator(functionsInstance, EMULATOR_HOST, FUNCTIONS_EMULATOR_PORT);
    }
  }
  return functionsInstance;
}

export const wsfFirebaseProjectId = firebaseConfig.projectId;

// Exported for the smoke test: a production build must never be emulated.
export const wsfUsingEmulators = emulated;
