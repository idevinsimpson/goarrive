import { initializeApp, type FirebaseApp } from 'firebase/app';

const firebaseConfig = {
  apiKey: 'AIzaSyCX16RcaVvNjMTOR6XdEV_hd_Msuz6Ep0Y',
  authDomain: 'goarrive.firebaseapp.com',
  projectId: 'goarrive',
  storageBucket: 'goarrive.firebasestorage.app',
  messagingSenderId: '1088464557005',
  appId: '1:1088464557005:web:westayfit-app',
};

let app: FirebaseApp | null = null;

export function getFirebaseApp(): FirebaseApp {
  if (!app) {
    app = initializeApp(firebaseConfig, 'westayfit');
  }
  return app;
}

export const wsfFirebaseProjectId = firebaseConfig.projectId;
