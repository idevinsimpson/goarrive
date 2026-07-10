/**
 * coachComms.ts — Coach communication loop (Phase 1)
 *
 * 1. sendWeeklyDigest — Mondays 9:00 AM ET: bundles queued platform_releases
 *    into one branded "What's New in GoArrive" email to all active coaches.
 * 2. onCoachFeedbackCreated — instant branded acknowledgment email when a
 *    coach submits feedback via the in-app form.
 */

import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { sendNotification, resetNotificationProviders } from './notifications';
import { whatsNewDigestEmail, feedbackAckEmail, DigestRelease } from './templates';

const emailApiKey = defineSecret('EMAIL_API_KEY');

// Lazy: index.ts calls admin.initializeApp() after some module imports,
// so grabbing Firestore at module scope can race initialization.
function getDb() {
  return admin.firestore();
}

const DIGEST_FROM = 'GoArrive <updates@goarrive.fit>';
const DIGEST_REPLY_TO = 'devin.simpson@goa.fit';

// ─── Weekly What's New digest ────────────────────────────────────────────────

export const sendWeeklyDigest = onSchedule(
  {
    schedule: 'every monday 09:00',
    timeZone: 'America/New_York',
    region: 'us-central1',
    secrets: [emailApiKey],
  },
  async () => {
    const TAG = '[sendWeeklyDigest]';
    resetNotificationProviders();

    const queuedSnap = await getDb()
      .collection('platform_releases')
      .where('status', '==', 'queued')
      .get();

    if (queuedSnap.empty) {
      console.log(TAG, 'No queued releases — skipping digest');
      return;
    }

    const releases: DigestRelease[] = queuedSnap.docs.map((d) => {
      const data = d.data();
      return {
        title: data.title || 'Platform update',
        bodyMarkdown: data.bodyMarkdown || '',
        features: Array.isArray(data.features) ? data.features : [],
      };
    });
    console.log(TAG, `Sending digest with ${releases.length} release(s)`);

    const coachesSnap = await getDb().collection('coaches').get();
    const appUrl = process.env.APP_BASE_URL || 'https://goarrive.fit';

    let sent = 0;
    let skipped = 0;
    for (const coachDoc of coachesSnap.docs) {
      const coach = coachDoc.data();
      const isActive = !!coach.email && coach.disabled !== true && coach.status !== 'inactive';
      if (!isActive) {
        skipped++;
        continue;
      }

      const rendered = whatsNewDigestEmail(coach.name || '', releases, appUrl);
      await sendNotification({
        messageType: 'platform_digest',
        channel: 'email',
        recipient: {
          uid: coachDoc.id,
          email: coach.email,
          displayName: coach.name,
          role: 'coach',
        },
        subject: rendered.subject,
        body: rendered.body,
        htmlBody: rendered.htmlBody,
        fromAddress: DIGEST_FROM,
        replyTo: DIGEST_REPLY_TO,
        coachId: coachDoc.id,
        metadata: { releaseIds: queuedSnap.docs.map((d) => d.id).join(',') },
      });
      sent++;
    }

    const now = admin.firestore.Timestamp.now();
    const batch = getDb().batch();
    queuedSnap.docs.forEach((d) => {
      batch.update(d.ref, { status: 'sent', sentAt: now });
    });
    await batch.commit();

    console.log(TAG, `Done: ${sent} sent, ${skipped} skipped, ${queuedSnap.size} release(s) marked sent`);
  }
);

// ─── Feedback acknowledgment ─────────────────────────────────────────────────

export const onCoachFeedbackCreated = onDocumentCreated(
  { document: 'coach_feedback/{feedbackId}', region: 'us-central1', secrets: [emailApiKey] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const TAG = '[onCoachFeedbackCreated]';
    resetNotificationProviders();

    const data = snap.data() as {
      coachId?: string;
      coachName?: string;
      coachEmail?: string;
      message?: string;
      category?: string;
    };

    let email = data.coachEmail;
    let name = data.coachName;
    if ((!email || !name) && data.coachId) {
      const coachSnap = await getDb().collection('coaches').doc(data.coachId).get();
      email = email || coachSnap.data()?.email;
      name = name || coachSnap.data()?.name;
    }
    if (!email) {
      console.log(TAG, 'No coach email resolvable — skipping ack', event.params.feedbackId);
      return;
    }

    const rendered = feedbackAckEmail(name || '', data.message || '', data.category || 'idea');
    await sendNotification({
      messageType: 'feedback_ack',
      channel: 'email',
      recipient: {
        uid: data.coachId || event.params.feedbackId,
        email,
        displayName: name,
        role: 'coach',
      },
      subject: rendered.subject,
      body: rendered.body,
      htmlBody: rendered.htmlBody,
      fromAddress: DIGEST_FROM,
      replyTo: DIGEST_REPLY_TO,
      coachId: data.coachId,
      metadata: { feedbackId: event.params.feedbackId },
    });

    await snap.ref.update({ acknowledgedAt: admin.firestore.Timestamp.now() });
    console.log(TAG, 'Ack email sent to', email, 'for feedback', event.params.feedbackId);
  }
);
