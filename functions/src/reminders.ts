/**
 * reminders.ts — GoArrive Reminder Job Engine
 *
 * Manages reminder_jobs collection: scheduling, processing, and state tracking.
 * Reminders are driven by session-instance truth, not disconnected scheduling guesses.
 */

import * as admin from 'firebase-admin';
import { sendNotification, NotificationRecipient } from './notifications';
import { renderTemplate, TemplateData } from './templates';

const db = admin.firestore();

// ─── Types ───────────────────────────────────────────────────────────────────

export type ReminderType =
  | 'member_24h'
  | 'member_1h'
  | 'coach_24h'
  | 'coach_1h'
  | 'missed_session_followup'
  | 'recording_ready';

export type ReminderStatus =
  | 'scheduled'
  | 'processing'
  | 'sent'
  | 'failed'
  | 'canceled'
  | 'skipped';

export interface ReminderJob {
  id?: string;
  reminderType: ReminderType;
  sessionInstanceId: string;
  recipientUid: string;
  recipientRole: 'member' | 'coach';
  coachId: string;
  memberId: string;
  scheduledFor: admin.firestore.Timestamp;
  status: ReminderStatus;
  channels: ('email' | 'sms' | 'push')[];
  notificationIds: string[];
  createdAt: admin.firestore.Timestamp;
  processedAt?: admin.firestore.Timestamp;
  error?: string;
  sessionDate?: string;
  sessionTime?: string;
  sessionType?: string;
  memberName?: string;
  coachName?: string;
  guidancePhase?: string;
  joinUrl?: string;
}

// ─── Reminder Job Creation ───────────────────────────────────────────────────

/**
 * Create reminder jobs for a session instance.
 * Called after a session instance is allocated (has a valid meeting).
 */
export async function createRemindersForInstance(instance: {
  id: string;
  date: string;
  startTime: string;
  sessionType: string;
  memberId: string;
  coachId: string;
  memberName?: string;
  coachName?: string;
  guidancePhase?: string;
  joinUrl?: string;
  hostingMode?: string;
  coachExpectedLive?: boolean;
}): Promise<string[]> {
  const jobIds: string[] = [];

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
    channels: ['email'] as ('email' | 'sms' | 'push')[],
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
    const ref = await db.collection('reminder_jobs').add({
      ...baseFields,
      reminderType: 'member_24h',
      recipientUid: instance.memberId,
      recipientRole: 'member',
      scheduledFor: admin.firestore.Timestamp.fromDate(t24h),
      status: 'scheduled',
    });
    jobIds.push(ref.id);
  }

  // Member 1h reminder (only if session is >1h away)
  if (t1h > now) {
    const ref = await db.collection('reminder_jobs').add({
      ...baseFields,
      reminderType: 'member_1h',
      recipientUid: instance.memberId,
      recipientRole: 'member',
      scheduledFor: admin.firestore.Timestamp.fromDate(t1h),
      status: 'scheduled',
    });
    jobIds.push(ref.id);
  }

  // Coach reminders (only if coach is expected live)
  const coachLive = instance.coachExpectedLive !== false &&
    (instance.hostingMode === 'coach_personal' || instance.guidancePhase === 'coach_guided');

  if (coachLive) {
    if (t24h > now) {
      const ref = await db.collection('reminder_jobs').add({
        ...baseFields,
        reminderType: 'coach_24h',
        recipientUid: instance.coachId,
        recipientRole: 'coach',
        scheduledFor: admin.firestore.Timestamp.fromDate(t24h),
        status: 'scheduled',
      });
      jobIds.push(ref.id);
    }
    if (t1h > now) {
      const ref = await db.collection('reminder_jobs').add({
        ...baseFields,
        reminderType: 'coach_1h',
        recipientUid: instance.coachId,
        recipientRole: 'coach',
        scheduledFor: admin.firestore.Timestamp.fromDate(t1h),
        status: 'scheduled',
      });
      jobIds.push(ref.id);
    }
  }

  // Missed session follow-up check (always created, processed later)
  if (tMissed > now) {
    const ref = await db.collection('reminder_jobs').add({
      ...baseFields,
      reminderType: 'missed_session_followup',
      recipientUid: instance.memberId,
      recipientRole: 'member',
      scheduledFor: admin.firestore.Timestamp.fromDate(tMissed),
      status: 'scheduled',
    });
    jobIds.push(ref.id);
  }

  return jobIds;
}

// ─── Reminder Processing ─────────────────────────────────────────────────────

/**
 * Process all due reminder jobs.
 * Called by the scheduled Cloud Function (every 5 minutes).
 */
export async function processDueReminders(): Promise<{
  processed: number;
  sent: number;
  failed: number;
  skipped: number;
}> {
  const now = admin.firestore.Timestamp.now();
  const stats = { processed: 0, sent: 0, failed: 0, skipped: 0 };

  // Query for due reminders
  const snap = await db.collection('reminder_jobs')
    .where('status', '==', 'scheduled')
    .where('scheduledFor', '<=', now)
    .limit(100) // Process in batches
    .get();

  for (const doc of snap.docs) {
    const job = doc.data() as ReminderJob;
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

      const instance = instanceSnap.data()!;

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
      const recipientData = recipientDoc.exists ? recipientDoc.data()! : {};

      const recipient: NotificationRecipient = {
        uid: job.recipientUid,
        email: recipientData.email || '',
        phone: recipientData.phone || '',
        displayName: recipientData.displayName || job.memberName || '',
        role: job.recipientRole,
      };

      // Build template data
      const templateData: TemplateData = {
        memberName: job.memberName || recipientData.displayName || 'there',
        coachName: job.coachName || '',
        sessionType: job.sessionType || '',
        sessionDate: job.sessionDate || '',
        sessionTime: job.sessionTime || '',
        guidancePhase: job.guidancePhase || '',
        joinUrl: job.joinUrl || instance.joinUrl || '',
      };

      // Render template
      const rendered = renderTemplate(job.reminderType, templateData);

      // Send through each channel
      const notificationIds: string[] = [];
      for (const channel of job.channels) {
        if (channel === 'email' && !recipient.email) continue;
        if (channel === 'sms' && !recipient.phone) continue;

        const notifId = await sendNotification({
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
    } catch (err: any) {
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
export async function cancelRemindersForInstance(sessionInstanceId: string): Promise<number> {
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

function reminderTypeToMessageType(rt: ReminderType): 'session_reminder' | 'session_starting_soon' | 'missed_session_followup' | 'recording_ready' | 'coach_session_reminder' {
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
