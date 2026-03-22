/**
 * useFcmToken.ts
 *
 * React hook that:
 *  1. Requests browser push-notification permission (once per session).
 *  2. Retrieves the FCM registration token using the Firebase Web SDK.
 *  3. Persists the token to /users/{uid}.fcmToken in Firestore so the
 *     sendPlanSharedNotification Cloud Function can look it up.
 *
 * Usage: call this hook inside a component that is only rendered when the
 * user is authenticated (e.g. the root app layout).
 *
 * The hook is a no-op on non-web platforms and when the browser does not
 * support the Notifications API (e.g. Safari < 16, Firefox private mode).
 *
 * VAPID key: obtain from Firebase Console → Project Settings → Cloud Messaging
 * → Web Push certificates → Key pair. Replace the placeholder below once the
 * key has been generated.
 */

import { useEffect } from 'react';
import { Platform } from 'react-native';
import { getMessaging, getToken } from 'firebase/messaging';
import { doc, setDoc } from 'firebase/firestore';
import app from './firebase';
import { db } from './firebase';

// ─── VAPID public key ─────────────────────────────────────────────────────────
// Replace this placeholder with the actual VAPID key from:
// Firebase Console → Project Settings → Cloud Messaging → Web Push certificates
const VAPID_KEY = 'REPLACE_WITH_VAPID_KEY_FROM_FIREBASE_CONSOLE';

export function useFcmToken(uid: string | null | undefined) {
  useEffect(() => {
    // Only run on web and when a user is authenticated
    if (Platform.OS !== 'web' || !uid) return;
    // Service workers and the Notifications API are required
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    if (!('Notification' in window)) return;
    // Don't request permission if already denied — avoid repeated prompts
    if (Notification.permission === 'denied') return;
    // Skip if VAPID key has not been configured yet
    if (VAPID_KEY === 'REPLACE_WITH_VAPID_KEY_FROM_FIREBASE_CONSOLE') {
      console.warn('[useFcmToken] VAPID key not configured — push notifications disabled');
      return;
    }

    let cancelled = false;

    async function registerToken() {
      try {
        // Request permission (shows browser prompt if not yet granted)
        const permission = await Notification.requestPermission();
        if (permission !== 'granted' || cancelled) return;

        const messaging = getMessaging(app);
        const token = await getToken(messaging, {
          vapidKey: VAPID_KEY,
          serviceWorkerRegistration: await navigator.serviceWorker.ready,
        });

        if (!token || cancelled) return;

        // Persist token to Firestore (merge so we don't overwrite other fields)
        await setDoc(
          doc(db, 'users', uid as string),
          { fcmToken: token },
          { merge: true }
        );
        console.log('[useFcmToken] FCM token registered for', uid);
      } catch (err) {
        // Non-fatal — in-app notifications still work without push
        console.warn('[useFcmToken] Could not register FCM token:', err);
      }
    }

    registerToken();
    return () => { cancelled = true; };
  }, [uid]);
}
