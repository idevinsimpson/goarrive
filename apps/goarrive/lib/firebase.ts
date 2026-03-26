/**
 * firebase.ts — Firebase initialization for GoArrive
 *
 * Initializes Firebase App, Auth, and Firestore.
 * Config values sourced from Firebase Console → Project Settings → Web App.
 */
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';
import { getStorage } from 'firebase/storage';

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
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app);
export const storage = getStorage(app);

// Connect to emulators in development
if (typeof window !== 'undefined') {
  try {
    const isDev = typeof __DEV__ !== 'undefined' && __DEV__;
    const useEmulator = false; // Set to true when running local emulators
    if (isDev && useEmulator) {
      connectAuthEmulator(auth, 'http://localhost:9099');
      connectFirestoreEmulator(db, 'localhost', 8080);
    }
  } catch (err) {
    console.warn('[Firebase] Emulator connection failed:', err);
  }
}

export default app;
