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

// Fail loudly if the React Native build of Auth was not resolved: falling back
// to in-memory persistence would sign every member out on each restart with no
// error anywhere.
if (typeof getReactNativePersistence !== 'function') {
  throw new Error(
    'WSF native Auth: getReactNativePersistence is unavailable — Firebase Auth did not resolve to its React Native build.'
  );
}

export function createWsfAuth(app: FirebaseApp): Auth {
  try {
    return initializeAuth(app, { persistence: getReactNativePersistence(AsyncStorage) });
  } catch (e) {
    // Only "already initialized" (fast refresh in development) is expected;
    // that existing instance already carries its persistence. Anything else
    // is a real failure and must not degrade silently to memory persistence.
    if ((e as { code?: unknown } | null)?.code === 'auth/already-initialized') return getAuth(app);
    throw e;
  }
}
