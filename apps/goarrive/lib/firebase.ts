/**
 * firebase.ts — Firebase initialization for GoArrive
 *
 * Initializes Firebase App, Auth, and Firestore.
 * Config values sourced from Firebase Console → Project Settings → Web App.
 */
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  getFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from 'firebase/firestore';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

const useLocalEmulators = typeof __DEV__ !== 'undefined' && __DEV__ && process.env.EXPO_PUBLIC_USE_FIREBASE_EMULATORS === 'true';
if (useLocalEmulators && typeof window !== 'undefined' && !['localhost', '127.0.0.1'].includes(window.location.hostname)) {
  throw new Error('Firebase emulators are restricted to localhost development');
}

const firebaseConfig = {
  apiKey: 'AIzaSyBgLIP0uvGJ98fde3aZthZjILTg6unkkX0',
  authDomain: 'goarrive.firebaseapp.com',
  projectId: 'goarrive',
  storageBucket: 'goarrive.firebasestorage.app',
  messagingSenderId: '413741232388',
  appId: '1:413741232388:web:ecb3d8dfea6859d6d42051',
  measurementId: 'G-B415XH5710',
};

// Initialize Firebase (prevent duplicate initialization)
const app = getApps().length === 0 ? initializeApp(useLocalEmulators ? { ...firebaseConfig, projectId: 'demo-playbook-repair', apiKey: 'demo-key', authDomain: 'localhost', storageBucket: 'demo-playbook-repair.appspot.com' } : firebaseConfig) : getApp();

export const auth = getAuth(app);
// Persistent local cache (IndexedDB, web only): after a reload or PWA resume,
// listeners render instantly from disk while the server refresh streams in.
// Without it every cold load races the network and small collections (e.g.
// build_folders) can paint seconds after the rest of the grid.
let firestoreDb: ReturnType<typeof getFirestore>;
if (typeof window !== 'undefined' && typeof indexedDB !== 'undefined') {
  try {
    firestoreDb = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  } catch {
    firestoreDb = getFirestore(app);
  }
} else {
  firestoreDb = getFirestore(app);
}
export const db = firestoreDb;
export const functions = getFunctions(app);
export const functionsHttpOrigin = useLocalEmulators
  ? 'http://127.0.0.1:5001/demo-playbook-repair/us-central1'
  : 'https://us-central1-goarrive.cloudfunctions.net';
export const storage = getStorage(app);

// Explicit local development only; never redirects deployed builds.
if (useLocalEmulators) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

export default app;
