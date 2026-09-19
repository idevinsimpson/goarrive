import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getFunctions, type Functions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: 'AIzaSyCX16RcaVvNjMTOR6XdEV_hd_Msuz6Ep0Y',
  authDomain: 'goarrive.firebaseapp.com',
  projectId: 'goarrive',
  storageBucket: 'goarrive.firebasestorage.app',
  messagingSenderId: '1088464557005',
  appId: '1:1088464557005:web:westayfit-app',
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
