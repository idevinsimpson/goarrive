"use strict";
/**
 * reminders.ts — GoArrive Reminder Job Engine
 *
 * Manages reminder_jobs collection: scheduling, processing, and state tracking.
 * Reminders are driven by session-instance truth, not disconnected scheduling guesses.
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
exports.createRemindersForInstance = createRemindersForInstance;
exports.processDueReminders = processDueReminders;
exports.cancelRemindersForInstance = cancelRemindersForInstance;
const admin = __importStar(require("firebase-admin"));
const notifications_1 = require("./notifications");
const templates_1 = require("./templates");
const db = admin.firestore();
// ─── Reminder Job Creation ───────────────────────────────────────────────────
/**
 * Create reminder jobs for a session instance.
 * Called after a session instance is allocated (has a valid meeting).
 */
async function createRemindersForInstance(instance) {
    const jobIds = [];
    // Parse session datetime
    const [year, month, day] = instance.date.split('-').map(Number);
    const [hours, minutes] = instance.startTime.split(':').map(Number);
    const sessionTime = new Date(year, month - 1, day, hours, minutes);
    // 24h before
    const t24h = new Date(sessionTime.getTime() - 24 * 60 * 60 * 1000);
    // 1h before
    const t1h = new Date(sessionTime.getTime() - 60 * 60 * 1000);
    // 30min after session end (for missed follow-up check)
    const tMissed = new Date(sessionTime.getTime() + 90 * 60 * 1000);
    const now = new Date();
    const baseFields = {
        sessionInstanceId: instance.id,
        coachId: instance.coachId,
        memberId: instance.memberId,
        channels: ['email'],
        notificationIds: [],
        createdAt: admin.firestore.Timestamp.now(),
        sessionDate: instance.date,
        sessionTime: instance.startTime,
        sessionType: instance.sessionType,
        memberName: instance.memberName || '',
        coachName: instance.coachName || '',
        guidancePhase: instance.guidancePhase || '',
        joinUrl: instance.joinUrl || '',
    };
    // Member 24h reminder (only if session is >24h away)
    if (t24h > now) {
        const ref = await db.collection('reminder_jobs').add(Object.assign(Object.assign({}, baseFields), { reminderType: 'member_24h', recipientUid: instance.memberId, recipientRole: 'member', scheduledFor: admin.firestore.Timestamp.fromDate(t24h), status: 'scheduled' }));
        jobIds.push(ref.id);
    }
    // Member 1h reminder (only if session is >1h away)
    if (t1h > now) {
        const ref = await db.collection('reminder_jobs').add(Object.assign(Object.assign({}, baseFields), { reminderType: 'member_1h', recipientUid: instance.memberId, recipientRole: 'member', scheduledFor: admin.firestore.Timestamp.fromDate(t1h), status: 'scheduled' }));
        jobIds.push(ref.id);
    }
    // Coach reminders (only if coach is expected live)
    const coachLive = instance.coachExpectedLive !== false &&
        (instance.hostingMode === 'coach_personal' || instance.guidancePhase === 'coach_guided');
    if (coachLive) {
        if (t24h > now) {
            const ref = await db.collection('reminder_jobs').add(Object.assign(Object.assign({}, baseFields), { reminderType: 'coach_24h', recipientUid: instance.coachId, recipientRole: 'coach', scheduledFor: admin.firestore.Timestamp.fromDate(t24h), status: 'scheduled' }));
            jobIds.push(ref.id);
        }
        if (t1h > now) {
            const ref = await db.collection('reminder_jobs').add(Object.assign(Object.assign({}, baseFields), { reminderType: 'coach_1h', recipientUid: instance.coachId, recipientRole: 'coach', scheduledFor: admin.firestore.Timestamp.fromDate(t1h), status: 'scheduled' }));
            jobIds.push(ref.id);
        }
    }
    // Missed session follow-up check (always created, processed later)
    if (tMissed > now) {
        const ref = await db.collection('reminder_jobs').add(Object.assign(Object.assign({}, baseFields), { reminderType: 'missed_session_followup', recipientUid: instance.memberId, recipientRole: 'member', scheduledFor: admin.firestore.Timestamp.fromDate(tMissed), status: 'scheduled' }));
        jobIds.push(ref.id);
    }
    return jobIds;
}
// ─── Reminder Processing ─────────────────────────────────────────────────────
/**
 * Process all due reminder jobs.
 * Called by the scheduled Cloud Function (every 5 minutes).
 */
async function processDueReminders() {
    const now = admin.firestore.Timestamp.now();
    const stats = { processed: 0, sent: 0, failed: 0, skipped: 0 };
    // Query for due reminders
    const snap = await db.collection('reminder_jobs')
        .where('status', '==', 'scheduled')
        .where('scheduledFor', '<=', now)
        .limit(100) // Process in batches
        .get();
    for (const doc of snap.docs) {
        const job = doc.data();
        stats.processed++;
        try {
            // Check if the session instance is still valid
            const instanceSnap = await db.collection('session_instances')
                .doc(job.sessionInstanceId).get();
            if (!instanceSnap.exists) {
                await doc.ref.update({ status: 'skipped', processedAt: now, error: 'Instance deleted' });
                stats.skipped++;
                continue;
            }
            const instance = instanceSnap.data();
            // Skip if session was canceled
            if (instance.status === 'canceled') {
                await doc.ref.update({ status: 'skipped', processedAt: now, error: 'Session canceled' });
                stats.skipped++;
                continue;
            }
            // For missed_session_followup, check if member actually attended
            if (job.reminderType === 'missed_session_followup') {
                const attended = instance.attendance === 'completed' ||
                    instance.attendance === 'joined' ||
                    instance.actualStartTime;
                if (attended) {
                    await doc.ref.update({ status: 'skipped', processedAt: now, error: 'Member attended' });
                    stats.skipped++;
                    continue;
                }
            }
            // Resolve recipient info
            const recipientDoc = await db.collection('users').doc(job.recipientUid).get();
            const recipientData = recipientDoc.exists ? recipientDoc.data() : {};
            const recipient = {
                uid: job.recipientUid,
                email: recipientData.email || '',
                phone: recipientData.phone || '',
                displayName: recipientData.displayName || job.memberName || '',
                role: job.recipientRole,
            };
            // Build template data
            const templateData = {
                memberName: job.memberName || recipientData.displayName || 'there',
                coachName: job.coachName || '',
                sessionType: job.sessionType || '',
                sessionDate: job.sessionDate || '',
                sessionTime: job.sessionTime || '',
                guidancePhase: job.guidancePhase || '',
                joinUrl: job.joinUrl || instance.joinUrl || '',
            };
            // Render template
            const rendered = (0, templates_1.renderTemplate)(job.reminderType, templateData);
            // Send through each channel
            const notificationIds = [];
            for (const channel of job.channels) {
                if (channel === 'email' && !recipient.email)
                    continue;
                if (channel === 'sms' && !recipient.phone)
                    continue;
                const notifId = await (0, notifications_1.sendNotification)({
                    messageType: reminderTypeToMessageType(job.reminderType),
                    channel,
                    recipient,
                    subject: rendered.subject,
                    body: rendered.body,
                    htmlBody: rendered.htmlBody,
                    sessionInstanceId: job.sessionInstanceId,
                    coachId: job.coachId,
                    memberId: job.memberId,
                });
                notificationIds.push(notifId);
            }
            await doc.ref.update({
                status: 'sent',
                processedAt: now,
                notificationIds,
            });
            stats.sent++;
        }
        catch (err) {
            await doc.ref.update({
                status: 'failed',
                processedAt: now,
                error: err.message || String(err),
            });
            stats.failed++;
            // Write to dead_letter
            await db.collection('dead_letter').add({
                type: 'reminder_processing_failed',
                sourceCollection: 'reminder_jobs',
                sourceId: doc.id,
                error: err.message || String(err),
                payload: { reminderType: job.reminderType, sessionInstanceId: job.sessionInstanceId },
                createdAt: admin.firestore.Timestamp.now(),
                resolved: false,
            });
        }
    }
    return stats;
}
// ─── Cancel Reminders ────────────────────────────────────────────────────────
/**
 * Cancel all pending reminders for a session instance.
 * Called when a session is canceled or rescheduled.
 */
async function cancelRemindersForInstance(sessionInstanceId) {
    const snap = await db.collection('reminder_jobs')
        .where('sessionInstanceId', '==', sessionInstanceId)
        .where('status', '==', 'scheduled')
        .get();
    const batch = db.batch();
    snap.docs.forEach(doc => {
        batch.update(doc.ref, {
            status: 'canceled',
            processedAt: admin.firestore.Timestamp.now(),
        });
    });
    await batch.commit();
    return snap.size;
}
// ─── Helpers ─────────────────────────────────────────────────────────────────
function reminderTypeToMessageType(rt) {
    switch (rt) {
        case 'member_24h': return 'session_reminder';
        case 'member_1h': return 'session_starting_soon';
        case 'coach_24h': return 'coach_session_reminder';
        case 'coach_1h': return 'coach_session_reminder';
        case 'missed_session_followup': return 'missed_session_followup';
        case 'recording_ready': return 'recording_ready';
        default: return 'session_reminder';
    }
}
//# sourceMappingURL=reminders.js.map