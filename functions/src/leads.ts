/**
 * leads.ts — Unassigned intake lead notifications + admin assignment
 *
 * 1. onIntakeSubmissionCreated — alerts the platform admin (email + Slack)
 *    when an intake form is submitted without a coach (coachId 'unassigned').
 *    Coach-assigned intakes return early: the coach already gets an FCM push
 *    via onMemberCreated, and QuickAddMember submissions always carry a real
 *    coachId.
 * 2. adminAssignLeadToCoach — admin-only callable that assigns an unassigned
 *    lead (members doc + intake submission) to a coach, refreshes the
 *    member's custom claims when they have an auth account, and notifies the
 *    coach.
 */

import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { sendNotification, resetNotificationProviders, notifyCoachOfNewMember } from './notifications';
import { adminLeadAlertEmail } from './templates';

const emailApiKey = defineSecret('EMAIL_API_KEY');
const slackBotToken = defineSecret('SLACK_BOT_TOKEN');

// Lazy: index.ts calls admin.initializeApp() after some module imports,
// so grabbing Firestore at module scope can race initialization.
function getDb() {
  return admin.firestore();
}

const LEADS_FROM = 'GoArrive <updates@goarrive.fit>';
const LEADS_REPLY_TO = 'devin.simpson@goa.fit';
const ADMIN_EMAIL = 'devin.simpson@goa.fit';
const LEADS_SLACK_CHANNEL = 'C0AQQ3K48CE'; // #dev-goarrive

// Posts a new-lead alert to Slack with a link button into the admin Leads
// tab. Buttons are link-only: no block_actions interactivity handler exists
// in this codebase, so assignment happens in the admin UI.
async function postLeadToSlack(
  token: string,
  leadName: string,
  leadEmail: string,
  leadPhone: string,
  goals: string
): Promise<void> {
  const header = `New lead needs a coach: ${leadName || 'Unknown lead'}`;
  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      channel: LEADS_SLACK_CHANNEL,
      text: `${header} (${leadEmail || 'no email'})`,
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*${header}*\nThey completed the intake form without choosing a coach.\n*Email:* ${leadEmail || '—'}\n*Phone:* ${leadPhone || '—'}\n*Goals:* ${goals || '—'}`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: { type: 'plain_text', text: 'Open Leads tab', emoji: false },
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

// ─── Unassigned lead alert ───────────────────────────────────────────────────

export const onIntakeSubmissionCreated = onDocumentCreated(
  { document: 'intakeSubmissions/{submissionId}', region: 'us-central1', secrets: [emailApiKey, slackBotToken] },
  async (event) => {
    const snap = event.data;
    if (!snap) return;
    const TAG = '[onIntakeSubmissionCreated]';

    const data = snap.data() as {
      coachId?: string;
      firstName?: string;
      lastName?: string;
      email?: string;
      phone?: string;
      primaryGoals?: unknown;
      specificGoals?: string;
    };

    if (data.coachId && data.coachId !== 'unassigned') {
      // Coach-assigned intake — the coach hears about it via onMemberCreated.
      return;
    }

    resetNotificationProviders();

    const leadName = [data.firstName, data.lastName].filter(Boolean).join(' ') || 'Unknown lead';
    const goalsList = Array.isArray(data.primaryGoals)
      ? data.primaryGoals.filter((g): g is string => typeof g === 'string')
      : [];
    const goals = [goalsList.join(', '), data.specificGoals].filter(Boolean).join(' — ');

    // Admin alert email — non-fatal.
    try {
      const rendered = adminLeadAlertEmail(leadName, data.email || '', data.phone || '', goals);
      await sendNotification({
        messageType: 'lead_admin_alert',
        channel: 'email',
        recipient: {
          uid: 'platform-admin',
          email: ADMIN_EMAIL,
          displayName: 'Devin Simpson',
          role: 'admin',
        },
        subject: rendered.subject,
        body: rendered.body,
        htmlBody: rendered.htmlBody,
        fromAddress: LEADS_FROM,
        replyTo: data.email || LEADS_REPLY_TO,
        metadata: { submissionId: event.params.submissionId },
      });
      console.log(TAG, 'Admin lead alert email sent for', event.params.submissionId);
    } catch (err) {
      console.error(TAG, 'Admin lead alert email failed (non-fatal):', err);
    }

    // Slack push — non-fatal.
    try {
      await postLeadToSlack(
        slackBotToken.value(),
        leadName,
        data.email || '',
        data.phone || '',
        goals
      );
      console.log(TAG, 'Slack lead alert posted for', event.params.submissionId);
    } catch (err) {
      console.error(TAG, 'Slack lead alert failed (non-fatal):', err);
    }
  }
);

// ─── Assign lead to coach ────────────────────────────────────────────────────

export const adminAssignLeadToCoach = onCall(
  { invoker: 'public' },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Must be logged in');

    const token = request.auth?.token as Record<string, any> | undefined;
    let isAdmin = token?.role === 'platformAdmin' || token?.admin === true;
    if (!isAdmin) {
      const callerSnap = await getDb().collection('coaches').doc(callerUid).get();
      const callerData = callerSnap.data();
      isAdmin = callerData?.role === 'platformAdmin' || callerData?.admin === true;
    }
    if (!isAdmin) throw new HttpsError('permission-denied', 'Admin only');

    const { memberId, coachId } = request.data as { memberId?: string; coachId?: string };
    if (!memberId || !coachId) {
      throw new HttpsError('invalid-argument', 'memberId and coachId are required');
    }
    if (coachId === 'unassigned') {
      throw new HttpsError('invalid-argument', 'Pick a coach to assign this lead to');
    }

    const db = getDb();
    const memberRef = db.collection('members').doc(memberId);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) throw new HttpsError('not-found', 'Member not found');
    const member = memberSnap.data()!;

    if (member.coachId && member.coachId !== 'unassigned') {
      throw new HttpsError('failed-precondition', 'This member is already assigned to a coach.');
    }

    const coachSnap = await db.collection('coaches').doc(coachId).get();
    if (!coachSnap.exists) throw new HttpsError('not-found', 'Coach not found');

    await memberRef.update({
      coachId,
      tenantId: coachId,
      assignedByAdminAt: admin.firestore.Timestamp.now(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Keep the intake submission readable by the new coach — rules scope
    // get/list on intakeSubmissions by coachId. (Same doc ID as the member.)
    try {
      const intakeRef = db.collection('intakeSubmissions').doc(memberId);
      const intakeSnap = await intakeRef.get();
      if (intakeSnap.exists) {
        await intakeRef.update({ coachId });
      }
    } catch (err) {
      console.warn('[adminAssignLeadToCoach] Intake submission update failed (non-fatal):', err);
    }

    // Refresh custom claims so the member's app resolves the new coach.
    if (member.uid && member.hasAccount === true) {
      try {
        await admin.auth().setCustomUserClaims(member.uid, {
          role: 'member',
          coachId,
          tenantId: coachId,
          memberId,
        });
      } catch (err) {
        console.error('[adminAssignLeadToCoach] Claims update failed (non-fatal):', err);
      }
    }

    // FCM push to the coach — onMemberCreated only fires on create, not this update.
    try {
      const memberName = member.displayName || member.name || member.email || 'A new member';
      await notifyCoachOfNewMember(coachId, memberName);
    } catch (err) {
      console.warn('[adminAssignLeadToCoach] Coach notification failed (non-fatal):', err);
    }

    console.log('[adminAssignLeadToCoach] Lead', memberId, 'assigned to coach', coachId, 'by', callerUid);
    return { success: true, memberId, coachId };
  }
);
