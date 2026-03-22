/**
 * GoArrive Cloud Functions
 *
 * Functions:
 *  1. sendPlanSharedNotification — Firestore onCreate trigger on /notifications/{notifId}.
 *     Reads the member's FCM token from /users/{recipientId} and sends a push notification
 *     via Firebase Cloud Messaging. Gracefully skips if no token is stored.
 *
 *  2. cleanupReadNotifications — Scheduled function (runs daily at 03:00 UTC).
 *     Deletes notifications that are either:
 *       (a) marked read=true, OR
 *       (b) older than 30 days (regardless of read status)
 *     This prevents unbounded growth of the notifications collection.
 */

import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { Timestamp } from 'firebase-admin/firestore';

admin.initializeApp();

const db = admin.firestore();
const messaging = admin.messaging();

// ─── 1. FCM Push Notification on plan_shared ─────────────────────────────────

export const sendPlanSharedNotification = onDocumentCreated(
  'notifications/{notifId}',
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const data = snap.data() as {
      recipientId?: string;
      type?: string;
      title?: string;
      body?: string;
    };

    // Only process plan_shared notifications
    if (data.type !== 'plan_shared') return;

    const recipientId = data.recipientId;
    if (!recipientId) {
      console.warn('[sendPlanSharedNotification] No recipientId on notification', snap.id);
      return;
    }

    // Look up the member's FCM token
    let fcmToken: string | undefined;
    try {
      const userDoc = await db.collection('users').doc(recipientId).get();
      if (userDoc.exists) {
        fcmToken = userDoc.data()?.fcmToken as string | undefined;
      }
    } catch (err) {
      console.warn('[sendPlanSharedNotification] Could not fetch user doc:', err);
    }

    if (!fcmToken) {
      // Member has not granted push permission or has not visited the app yet.
      // This is expected — the in-app notification already exists in Firestore.
      console.log('[sendPlanSharedNotification] No FCM token for recipient', recipientId, '— skipping push');
      return;
    }

    const title = data.title || 'Your plan has been updated';
    const body = data.body || 'Your coach has shared your fitness plan with you.';

    try {
      await messaging.send({
        token: fcmToken,
        notification: { title, body },
        webpush: {
          notification: {
            title,
            body,
            icon: '/icons/icon-192.png',
            badge: '/icons/icon-192.png',
            requireInteraction: false,
          },
          fcmOptions: {
            link: '/my-plan',
          },
        },
        apns: {
          payload: {
            aps: {
              alert: { title, body },
              sound: 'default',
              badge: 1,
            },
          },
        },
      });
      console.log('[sendPlanSharedNotification] Push sent to', recipientId);
    } catch (err: unknown) {
      // If the token is invalid/expired, remove it from the user document to avoid
      // repeated failed sends. Firebase Messaging error codes for invalid tokens:
      // messaging/registration-token-not-registered, messaging/invalid-registration-token
      const code = (err as { code?: string })?.code || '';
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        console.warn('[sendPlanSharedNotification] Stale FCM token for', recipientId, '— removing');
        try {
          await db.collection('users').doc(recipientId).update({ fcmToken: admin.firestore.FieldValue.delete() });
        } catch {
          // Best-effort cleanup; ignore secondary errors
        }
      } else {
        console.error('[sendPlanSharedNotification] FCM send error:', err);
      }
    }
  }
);

// ─── 2. Notification TTL Cleanup (daily at 03:00 UTC) ────────────────────────

export const cleanupReadNotifications = onSchedule(
  { schedule: '0 3 * * *', timeZone: 'UTC' },
  async () => {
    const now = Timestamp.now();
    // 30 days ago in seconds
    const thirtyDaysAgo = Timestamp.fromMillis(now.toMillis() - 30 * 24 * 60 * 60 * 1000);

    let deletedCount = 0;
    const batchSize = 400; // Firestore batch limit is 500; stay well under it

    // Delete read notifications
    const readQuery = db.collection('notifications')
      .where('read', '==', true)
      .limit(batchSize);

    let readSnap = await readQuery.get();
    while (!readSnap.empty) {
      const batch = db.batch();
      readSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deletedCount += readSnap.size;
      readSnap = await readQuery.get();
    }

    // Delete notifications older than 30 days (regardless of read status)
    const staleQuery = db.collection('notifications')
      .where('createdAt', '<', thirtyDaysAgo)
      .limit(batchSize);

    let staleSnap = await staleQuery.get();
    while (!staleSnap.empty) {
      const batch = db.batch();
      staleSnap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deletedCount += staleSnap.size;
      staleSnap = await staleQuery.get();
    }

    console.log(`[cleanupReadNotifications] Deleted ${deletedCount} notification(s)`);
  }
);
