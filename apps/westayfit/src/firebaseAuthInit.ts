import { getAuth, type Auth } from 'firebase/auth';
import type { FirebaseApp } from 'firebase/app';

/**
 * Web: the default Auth instance uses the browser's persistence (IndexedDB,
 * then localStorage). Metro picks `firebaseAuthInit.native.ts` on iOS/Android.
 */
export function createWsfAuth(app: FirebaseApp): Auth {
  return getAuth(app);
}
