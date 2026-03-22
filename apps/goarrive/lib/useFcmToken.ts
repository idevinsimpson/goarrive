/**
 * useFcmToken.ts
 *
 * React hook that:
 *  1. Requests browser push-notification permission (once per session).
 *  2. Retrieves the FCM registration token using the Firebase Web SDK.
 *  3. Compares the new token against the value stored in Firestore and
 *     updates it only when it has changed (handles token rotation after
 *     the user clears app data or the token is otherwise invalidated).
 *
 * Usage: call this hook inside a component that is only rendered when the
 * user is authenticated (e.g. the root app layout).
 *
 * The hook is a no-op on non-web platforms and when the browser does not
 * support the Notifications API (e.g. Safari < 16, Firefox private mode).
 *
 * VAPID key: BLjaLma-KbDtZtFp9WIACGyoPTDYsCkkyk_VeSVthPp5daFjqHEc70ZdMBdqCDIAuN8RtGeYLTSg_o5p_iyHrzU
 * Source: Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
 * Generated: Mar 14, 2026. Rotate via Firebase Console if ever compromised.
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';
import { getMessaging, getToken } from 'firebase/messaging';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import app from './firebase';
import { db } from './firebase';

// ─── VAPID public key ─────────────────────────────────────────────────────────
// From Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
const VAPID_KEY =
  'BLjaLma-KbDtZtFp9WIACGyoPTDYsCkkyk_VeSVthPp5daFjqHEc70ZdMBdqCDIAuN8RtGeYLTSg_o5p_iyHrzU';

export function useFcmToken(uid: string | null | undefined) {
  useEffect(() => {
    // Only run on web and when a user is authenticated
    if (Platform.OS !== 'web' || !uid) return;
    // Service workers and the Notifications API are required
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (!('Notification' in window)) return;
    // Don't request permission if already denied — avoid repeated prompts
    if (Notification.permission === 'denied') return;

    let cancelled = false;

    async function registerOrRefreshToken() {
      try {
        // Request permission (shows browser prompt if not yet granted)
        const permission = await Notification.requestPermission();
        if (permission !== 'granted' || cancelled) return;

        const messaging = getMessaging(app);
        const currentToken = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: await navigator.serviceWorker.ready,
        });

        if (!currentToken || cancelled) return;

        // Read the token currently stored in Firestore to detect rotation.
        // Only write when the token has changed — avoids unnecessary writes
        // on every app launch when the token is still valid.
        const userRef = doc(db, 'users', uid as string);
        const userSnap = await getDoc(userRef);
        const storedToken: string | undefined = userSnap.exists()
          ? userSnap.data()?.fcmToken
          : undefined;

        if (currentToken !== storedToken) {
          await setDoc(userRef, { fcmToken: currentToken }, { merge: true });
          console.log(
            '[useFcmToken] FCM token',
            storedToken ? 'refreshed' : 'registered',
            'for',
            uid
          );
        } else {
          console.log('[useFcmToken] FCM token unchanged for', uid);
        }
      } catch (err) {
        // Non-fatal — in-app notifications still work without push
        console.warn('[useFcmToken] Could not register/refresh FCM token:', err);
      }
    }

    registerOrRefreshToken();
    return () => { cancelled = true; };
  }, [uid]);
}
