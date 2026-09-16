import { initializeApp, type FirebaseApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, type Auth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore, type Firestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions, type Functions } from 'firebase/functions';

import { readStagingEnv, resolveStagingConfig, type WsfFirebaseConfig } from './stagingEnv';

// Real registration for the "We Stay Fit" Web App in the shared `goarrive`
// Firebase project (console receipt posted to #dev-westayfit on 2026-08-26).
// These are publishable client identifiers, not secrets — Firebase web config
// is public by design and every access decision is made by Firestore Rules.
// apiKey and messagingSenderId are per-PROJECT, so they necessarily match
// GoArrive's; only appId is per-APP, and that is what makes this a distinct
// registration. Analytics (measurementId) is deliberately omitted — WSF ships
// no Analytics.

// Project ids. Production is always the shared `goarrive` project. The
// emulator id is selected ONLY when the build flag is on AND the page is
// actually served from a loopback host, so a local browser run is namespaced
// away from the real project's identifiers (E4-A1-R4).
const PROD_PROJECT_ID = 'goarrive' as const;
const EMULATOR_PROJECT_ID = 'demo-wsf-local' as const;

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

function isEmulatorFlagOn(raw: string | undefined): boolean {
  return raw === '1' || raw?.trim().toLowerCase() === 'true';
}

// Pure selector for the projectId baked into firebaseConfig. Explicit inputs
// and no globals, so every branch is unit-testable — including the SSR case
// (hasWindow=false), which must NEVER select the emulator id: a static export
// prerenders without a window and its HTML must carry the production id.
export function selectProjectId(opts: {
  flagRaw: string | undefined;
  hasWindow: boolean;
  hostname: string | undefined;
}): typeof PROD_PROJECT_ID | typeof EMULATOR_PROJECT_ID {
  if (!isEmulatorFlagOn(opts.flagRaw)) return PROD_PROJECT_ID;
  if (!opts.hasWindow) return PROD_PROJECT_ID;
  if (opts.hostname !== undefined && LOOPBACK_HOSTNAMES.has(opts.hostname)) {
    return EMULATOR_PROJECT_ID;
  }
  return PROD_PROJECT_ID;
}

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
//
// Returns true under SSR (no window) because the connect*Emulator calls are
// no-ops there; project selection above is deliberately stricter.
function shouldUseEmulators(): boolean {
  const raw = process.env.EXPO_PUBLIC_WSF_USE_EMULATORS;
  if (!isEmulatorFlagOn(raw)) return false;
  if (typeof window === 'undefined') return true;
  return LOOPBACK_HOSTNAMES.has(window.location.hostname);
}

const emulated = shouldUseEmulators();
const projectId = selectProjectId({
  flagRaw: process.env.EXPO_PUBLIC_WSF_USE_EMULATORS,
  hasWindow: typeof window !== 'undefined',
  hostname: typeof window !== 'undefined' ? window.location.hostname : undefined,
});

const productionConfig: WsfFirebaseConfig = {
  apiKey: 'AIzaSyBgLIP0uvGJ98fde3aZthZjILTg6unkkX0',
  authDomain: 'goarrive.firebaseapp.com',
  projectId,
  storageBucket: 'goarrive.firebasestorage.app',
  messagingSenderId: '413741232388',
  appId: '1:413741232388:web:30f3490b0a3b220dd42051',
};

// Staging, when and only when this build declares it AND supplies a complete,
// internally coherent config for a project that is not production.
//
// resolveStagingConfig returns null ONLY for an unambiguous production build —
// no selector and no staging values. Every ambiguous shape throws: a
// misspelled selector, staging values with the selector missing, a partial
// config, production's own identifiers, or staging together with the emulator
// flag. The emulator/staging conflict is checked inside the resolver rather
// than here, so it is covered by the resolver's own tests.
//
// The emulator path above is untouched and still wins for a loopback run.
// Staging is a third destination, not a loosening of that gate.
const stagingConfig = resolveStagingConfig(readStagingEnv());

const firebaseConfig: WsfFirebaseConfig = stagingConfig ?? productionConfig;

/** True only in a build pointed at a verified separate staging backend. */
export const wsfIsStaging = stagingConfig !== null;

// Emulator ports, matching firebase.westayfit.emulators.json.
const EMULATOR_HOST = '127.0.0.1';
const AUTH_EMULATOR_PORT = 9099;
const FIRESTORE_EMULATOR_PORT = 8080;
const FUNCTIONS_EMULATOR_PORT = 5001;

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

// ── WSF-only test-isolation surface (Execution Addendum 1 §2) ────────────────
//
// Exported so the local test path can assert, before it does anything, that
// it is pointed at the emulator suite and not at live services. Production
// behaviour is unchanged: nothing here runs in a deployed build, and the
// values are the same ones the functions above already use.
//
// KNOWN GAP, reported rather than papered over: the emulator project id is
// `demo-wsf-local`, not a `demo-` prefixed id. Firebase only guarantees that a
// `demo-`prefixed project never reaches a real backend. Changing it here alone
// would break the run — `scripts/westayfit/gate1.sh` and the jest emulator
// configs pin `demo-wsf-local`, and both are outside Package C's allowed file
// scope. The bootstrap below therefore verifies the emulator wiring explicitly
// instead of relying on the id, and the gap stays on the record.
export const wsfEmulatorTargets = {
  projectId: firebaseConfig.projectId,
  emulatorProjectId: EMULATOR_PROJECT_ID,
  productionProjectId: PROD_PROJECT_ID,
  host: EMULATOR_HOST,
  authPort: AUTH_EMULATOR_PORT,
  firestorePort: FIRESTORE_EMULATOR_PORT,
  functionsPort: FUNCTIONS_EMULATOR_PORT,
  emulated,
} as const;
