import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FirebaseApp } from 'firebase/app';
import { getAuth, initializeAuth, type Auth, type Persistence } from 'firebase/auth';

/**
 * iOS/Android: persist the signed-in session across app restarts.
 *
 * On React Native, `getAuth()` without `initializeAuth` falls back to
 * in-memory persistence, so a member would be signed out every time the
 * process is killed. `getReactNativePersistence` exists only in Firebase's
 * React Native build (which Metro resolves through the `react-native`
 * export condition); the web type declarations do not list it, hence the
 * typed require.
 */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getReactNativePersistence } = require('firebase/auth') as {
  getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
};

export function createWsfAuth(app: FirebaseApp): Auth {
  try {
    return initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch {
    // initializeAuth throws if Auth already exists for this app (fast refresh
    // in development). The existing instance already carries its persistence.
    return getAuth(app);
  }
}
