"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupReadNotifications = exports.sendPlanSharedNotification = void 0;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const firestore_2 = require("firebase-admin/firestore");
admin.initializeApp();
const db = admin.firestore();
const messaging = admin.messaging();
// ─── 1. FCM Push Notification on plan_shared ─────────────────────────────────
exports.sendPlanSharedNotification = (0, firestore_1.onDocumentCreated)('notifications/{notifId}', async (event) => {
    var _a;
    const snap = event.data;
    if (!snap)
        return;
    const data = snap.data();
    // Only process plan_shared notifications
    if (data.type !== 'plan_shared')
        return;
    const recipientId = data.recipientId;
    if (!recipientId) {
        console.warn('[sendPlanSharedNotification] No recipientId on notification', snap.id);
        return;
    }
    // Look up the member's FCM token
    let fcmToken;
    try {
        const userDoc = await db.collection('users').doc(recipientId).get();
        if (userDoc.exists) {
            fcmToken = (_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.fcmToken;
        }
    }
    catch (err) {
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
    }
    catch (err) {
        // If the token is invalid/expired, remove it from the user document to avoid
        // repeated failed sends. Firebase Messaging error codes for invalid tokens:
        // messaging/registration-token-not-registered, messaging/invalid-registration-token
        const code = (err === null || err === void 0 ? void 0 : err.code) || '';
        if (code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token') {
            console.warn('[sendPlanSharedNotification] Stale FCM token for', recipientId, '— removing');
            try {
                await db.collection('users').doc(recipientId).update({ fcmToken: admin.firestore.FieldValue.delete() });
            }
            catch (_b) {
                // Best-effort cleanup; ignore secondary errors
            }
        }
        else {
            console.error('[sendPlanSharedNotification] FCM send error:', err);
        }
    }
});
// ─── 2. Notification TTL Cleanup (daily at 03:00 UTC) ────────────────────────
exports.cleanupReadNotifications = (0, scheduler_1.onSchedule)({ schedule: '0 3 * * *', timeZone: 'UTC' }, async () => {
    const now = firestore_2.Timestamp.now();
    // 30 days ago in seconds
    const thirtyDaysAgo = firestore_2.Timestamp.fromMillis(now.toMillis() - 30 * 24 * 60 * 60 * 1000);
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
});
//# sourceMappingURL=index.js.map