"use strict";
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
exports.adminAssignLeadToCoach = exports.onIntakeSubmissionCreated = void 0;
const admin = __importStar(require("firebase-admin"));
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-functions/v2/firestore");
const params_1 = require("firebase-functions/params");
const notifications_1 = require("./notifications");
const templates_1 = require("./templates");
const emailApiKey = (0, params_1.defineSecret)('EMAIL_API_KEY');
const slackBotToken = (0, params_1.defineSecret)('SLACK_BOT_TOKEN');
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
async function postLeadToSlack(token, leadName, leadEmail, leadPhone, goals) {
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
    const json = (await res.json());
    if (!json.ok)
        throw new Error(`chat.postMessage failed: ${json.error}`);
}
// ─── Unassigned lead alert ───────────────────────────────────────────────────
exports.onIntakeSubmissionCreated = (0, firestore_1.onDocumentCreated)({ document: 'intakeSubmissions/{submissionId}', region: 'us-central1', secrets: [emailApiKey, slackBotToken] }, async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const TAG = '[onIntakeSubmissionCreated]';
    const data = snap.data();
    if (data.coachId && data.coachId !== 'unassigned') {
        // Coach-assigned intake — the coach hears about it via onMemberCreated.
        return;
    }
    (0, notifications_1.resetNotificationProviders)();
    const leadName = [data.firstName, data.lastName].filter(Boolean).join(' ') || 'Unknown lead';
    const goalsList = Array.isArray(data.primaryGoals)
        ? data.primaryGoals.filter((g) => typeof g === 'string')
        : [];
    const goals = [goalsList.join(', '), data.specificGoals].filter(Boolean).join(' — ');
    // Admin alert email — non-fatal.
    try {
        const rendered = (0, templates_1.adminLeadAlertEmail)(leadName, data.email || '', data.phone || '', goals);
        await (0, notifications_1.sendNotification)({
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
    }
    catch (err) {
        console.error(TAG, 'Admin lead alert email failed (non-fatal):', err);
    }
    // Slack push — non-fatal.
    try {
        await postLeadToSlack(slackBotToken.value(), leadName, data.email || '', data.phone || '', goals);
        console.log(TAG, 'Slack lead alert posted for', event.params.submissionId);
    }
    catch (err) {
        console.error(TAG, 'Slack lead alert failed (non-fatal):', err);
    }
});
// ─── Assign lead to coach ────────────────────────────────────────────────────
exports.adminAssignLeadToCoach = (0, https_1.onCall)({ invoker: 'public' }, async (request) => {
    var _a, _b;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be logged in');
    const token = (_b = request.auth) === null || _b === void 0 ? void 0 : _b.token;
    let isAdmin = (token === null || token === void 0 ? void 0 : token.role) === 'platformAdmin' || (token === null || token === void 0 ? void 0 : token.admin) === true;
    if (!isAdmin) {
        const callerSnap = await getDb().collection('coaches').doc(callerUid).get();
        const callerData = callerSnap.data();
        isAdmin = (callerData === null || callerData === void 0 ? void 0 : callerData.role) === 'platformAdmin' || (callerData === null || callerData === void 0 ? void 0 : callerData.admin) === true;
    }
    if (!isAdmin)
        throw new https_1.HttpsError('permission-denied', 'Admin only');
    const { memberId, coachId } = request.data;
    if (!memberId || !coachId) {
        throw new https_1.HttpsError('invalid-argument', 'memberId and coachId are required');
    }
    if (coachId === 'unassigned') {
        throw new https_1.HttpsError('invalid-argument', 'Pick a coach to assign this lead to');
    }
    const db = getDb();
    const memberRef = db.collection('members').doc(memberId);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists)
        throw new https_1.HttpsError('not-found', 'Member not found');
    const member = memberSnap.data();
    if (member.coachId && member.coachId !== 'unassigned') {
        throw new https_1.HttpsError('failed-precondition', 'This member is already assigned to a coach.');
    }
    const coachSnap = await db.collection('coaches').doc(coachId).get();
    if (!coachSnap.exists)
        throw new https_1.HttpsError('not-found', 'Coach not found');
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
    }
    catch (err) {
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
        }
        catch (err) {
            console.error('[adminAssignLeadToCoach] Claims update failed (non-fatal):', err);
        }
    }
    // FCM push to the coach — onMemberCreated only fires on create, not this update.
    try {
        const memberName = member.displayName || member.name || member.email || 'A new member';
        await (0, notifications_1.notifyCoachOfNewMember)(coachId, memberName);
    }
    catch (err) {
        console.warn('[adminAssignLeadToCoach] Coach notification failed (non-fatal):', err);
    }
    console.log('[adminAssignLeadToCoach] Lead', memberId, 'assigned to coach', coachId, 'by', callerUid);
    return { success: true, memberId, coachId };
});
//# sourceMappingURL=leads.js.map