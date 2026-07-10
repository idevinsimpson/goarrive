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
import { onDocumentCreated, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { sendNotification, resetNotificationProviders } from './notifications';
import {
  whatsNewDigestEmail,
  feedbackAckEmail,
  feedbackShippedEmail,
  feedbackPlannedEmail,
  adminFeedbackAlertEmail,
  DigestRelease,
} from './templates';

const emailApiKey = defineSecret('EMAIL_API_KEY');
const slackBotToken = defineSecret('SLACK_BOT_TOKEN');

// Lazy: index.ts calls admin.initializeApp() after some module imports,
// so grabbing Firestore at module scope can race initialization.
function getDb() {
  return admin.firestore();
}

const DIGEST_FROM = 'GoArrive <updates@goarrive.fit>';
const DIGEST_REPLY_TO = 'devin.simpson@goa.fit';
const ADMIN_EMAIL = 'devin.simpson@goa.fit';
const FEEDBACK_SLACK_CHANNEL = 'C0AQQ3K48CE'; // #dev-goarrive

// Posts a new-feedback alert to Slack with a link button into the admin Comms
// tab. Buttons are link-only: no block_actions interactivity handler exists in
// this codebase, so status changes stay in the admin UI.
async function postFeedbackToSlack(
  token: string,
  coachName: string,
  coachEmail: string,
  category: string,
  message: string
): Promise<void> {
  const header = `New coach feedback from ${coachName || 'Unknown coach'}`;
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel: FEEDBACK_SLACK_CHANNEL,
      text: `${header} (${category}): ${message}`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${header}*\n*Coach:* ${coachName || 'Unknown'}${coachEmail ? ` (${coachEmail})` : ''}\n*Category:* ${category}`,
          },
        },
        {
          type: 'section',
          text: { type: 'mrkdwn', text: `>${(message || '(no message)').replace(/\n/g, '\n>')}` },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Open Admin Comms', emoji: false },
              url: 'https://goarrive.fit/admin',
              style: 'primary',
            },
          ],
        },
      ],
    }),
  });
  const json = (await res.json()) as { ok: boolean; error?: string };
  if (!json.ok) throw new Error(`chat.postMessage failed: ${json.error}`);
}

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
        requestedByCoaches: data.requestedByCoaches === true,
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
  { document: 'coach_feedback/{feedbackId}', region: 'us-central1', secrets: [emailApiKey, slackBotToken] },
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

    if (email) {
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
    } else {
      console.log(TAG, 'No coach email resolvable — skipping ack', event.params.feedbackId);
    }

    // Admin alert email — independent of the coach ack.
    try {
      const adminRendered = adminFeedbackAlertEmail(
        name || '',
        email || '',
        data.category || 'idea',
        data.message || ''
      );
      await sendNotification({
        messageType: 'feedback_admin_alert',
        channel: 'email',
        recipient: {
          uid: 'platform-admin',
          email: ADMIN_EMAIL,
          displayName: 'Devin Simpson',
          role: 'admin',
        },
        subject: adminRendered.subject,
        body: adminRendered.body,
        htmlBody: adminRendered.htmlBody,
        fromAddress: DIGEST_FROM,
        replyTo: email || DIGEST_REPLY_TO,
        coachId: data.coachId,
        metadata: { feedbackId: event.params.feedbackId },
      });
      console.log(TAG, 'Admin alert email sent for feedback', event.params.feedbackId);
    } catch (err) {
      console.error(TAG, 'Admin alert email failed (non-fatal):', err);
    }

    // Slack push — non-fatal.
    try {
      await postFeedbackToSlack(
        slackBotToken.value(),
        name || '',
        email || '',
        data.category || 'idea',
        data.message || ''
      );
      console.log(TAG, 'Slack alert posted for feedback', event.params.feedbackId);
    } catch (err) {
      console.error(TAG, 'Slack alert failed (non-fatal):', err);
    }
  }
);

// ─── Close the loop: shipped / planned status emails (Phase 3) ───────────────

export const onCoachFeedbackStatusChanged = onDocumentUpdated(
  { document: 'coach_feedback/{feedbackId}', region: 'us-central1', secrets: [emailApiKey] },
  async (event) => {
    const TAG = '[onCoachFeedbackStatusChanged]';
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    const beforeStatus = before.status as string | undefined;
    const afterStatus = after.status as string | undefined;
    // Only fire on a transition INTO shipped/planned — never on unrelated edits.
    if (beforeStatus === afterStatus) return;
    if (afterStatus !== 'shipped' && afterStatus !== 'planned') return;

    const notifiedField = afterStatus === 'shipped' ? 'shippedNotifiedAt' : 'plannedNotifiedAt';
    if (after[notifiedField]) {
      console.log(TAG, `Already notified (${notifiedField}) — skipping`, event.params.feedbackId);
      return;
    }

    resetNotificationProviders();

    let email = after.coachEmail as string | undefined;
    let name = after.coachName as string | undefined;
    if ((!email || !name) && after.coachId) {
      const coachSnap = await getDb().collection('coaches').doc(after.coachId).get();
      email = email || coachSnap.data()?.email;
      name = name || coachSnap.data()?.name;
    }
    if (!email) {
      console.log(TAG, 'No coach email resolvable — skipping', event.params.feedbackId);
      return;
    }

    const appUrl = process.env.APP_BASE_URL || 'https://goarrive.fit';
    const originalMessage = (after.message as string) || '';

    let rendered;
    if (afterStatus === 'shipped') {
      let releaseTitle: string | undefined;
      if (after.relatedReleaseId) {
        try {
          const releaseSnap = await getDb()
            .collection('platform_releases')
            .doc(after.relatedReleaseId)
            .get();
          releaseTitle = releaseSnap.data()?.title;
        } catch (err) {
          console.warn(TAG, 'Failed to resolve relatedReleaseId', after.relatedReleaseId, err);
        }
      }
      rendered = feedbackShippedEmail(
        name || '',
        originalMessage,
        (after.shippedNote as string) || undefined,
        releaseTitle,
        appUrl
      );
    } else {
      rendered = feedbackPlannedEmail(name || '', originalMessage);
    }

    await sendNotification({
      messageType: afterStatus === 'shipped' ? 'feedback_shipped' : 'feedback_planned',
      channel: 'email',
      recipient: {
        uid: after.coachId || event.params.feedbackId,
        email,
        displayName: name,
        role: 'coach',
      },
      subject: rendered.subject,
      body: rendered.body,
      htmlBody: rendered.htmlBody,
      fromAddress: DIGEST_FROM,
      replyTo: DIGEST_REPLY_TO,
      coachId: after.coachId,
      metadata: { feedbackId: event.params.feedbackId, transition: `${beforeStatus}->${afterStatus}` },
    });

    await event.data!.after.ref.update({ [notifiedField]: admin.firestore.Timestamp.now() });
    console.log(TAG, `${afterStatus} email sent to`, email, 'for feedback', event.params.feedbackId);
  }
);
