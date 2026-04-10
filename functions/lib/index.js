"use strict";
/**
 * GoArrive Cloud Functions
 *
 * Functions:
 *  1. sendPlanSharedNotification  — FCM push on plan_shared notification
 *  2. cleanupReadNotifications    — Daily TTL cleanup of read/stale notifications
 *  3. createStripeConnectLink     — HTTPS callable: create/resume Stripe Connect onboarding link
 *  4. refreshStripeAccountStatus  — HTTPS callable: sync Stripe account status to Firestore
 *  5. createCheckoutSession       — HTTPS callable: create Stripe Checkout session (monthly or pay-in-full)
 *  6. stripeWebhook               — HTTPS trigger: handle Stripe webhook events
 *  7. activateCtsOptIn             — HTTPS callable: activate Commit-to-Save subscription item
 *  8. addCoach                     — HTTPS callable: admin-only coach account creation
 * 26. enforceCtsAccountability     — Scheduled (hourly): auto-charge CTS missed session fees after 48h
 *
 * ME-001: STRIPE_SECRET_KEY must be set as a Firebase secret before functions 3–6 operate.
 *         firebase functions:secrets:set STRIPE_SECRET_KEY
 * ME-002: STRIPE_WEBHOOK_SECRET must be set for webhook signature verification.
 *         firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
 * ME-003: APP_BASE_URL must be set to the deployed app URL for checkout redirects.
 *         firebase functions:config:set app.base_url="https://goarrive.fit"
 * ME-004: ZOOM_ACCOUNT_ID must be set for live Zoom integration.
 *         firebase functions:secrets:set ZOOM_ACCOUNT_ID
 * ME-005: ZOOM_CLIENT_ID must be set for live Zoom integration.
 *         firebase functions:secrets:set ZOOM_CLIENT_ID
 * ME-006: ZOOM_CLIENT_SECRET must be set for live Zoom integration.
 *         firebase functions:secrets:set ZOOM_CLIENT_SECRET
 * ME-007: ZOOM_WEBHOOK_SECRET must be set for Zoom webhook signature verification.
 *         firebase functions:secrets:set ZOOM_WEBHOOK_SECRET
 *
 * RISK-001: CTS + pay-in-full discount stacking order is unresolved.
 *           Do not hardcode stacking. Both amounts are stored in the snapshot;
 *           compute at checkout time using the rule snapshot.
 *
 * BP-001: Always create checkout from acceptedPlanSnapshot, never from live plan doc.
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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateGcalConflictCalendars = exports.listGcalConflictCalendars = exports.gcalConflictCallback = exports.initGcalConflictAuth = exports.disconnectGoogleCalendar = exports.syncToGoogleCalendar = exports.googleCalendarCallback = exports.initGoogleCalendarAuth = exports.migrateIcalTokens = exports.regenerateIcalToken = exports.refreshRecordingUrl = exports.checkSlotConflicts = exports.requestSkipInstance = exports.detectNoShows = exports.syncSlotDuration = exports.batchPhaseTransition = exports.waiveCtsFee = exports.enforceCtsAccountability = exports.adminGetCoachData = exports.setAdminRole = exports.seedMissingCoachDocs = exports.getSharedPlan = exports.updateMemberGuidancePhase = exports.coachIcalFeed = exports.getSessionEventLog = exports.getDeadLetterItems = exports.retryDeadLetter = exports.processReminders = exports.getSystemHealth = exports.zoomWebhook = exports.cancelInstance = exports.rescheduleInstance = exports.allocateAllPendingInstances = exports.allocateSessionInstance = exports.generateUpcomingInstances = exports.updateRecurringSlot = exports.createRecurringSlot = exports.manageZoomRoom = exports.claimMemberAccount = exports.activateCoachInvite = exports.inviteCoach = exports.addCoach = exports.activateCtsOptIn = exports.stripeWebhook = exports.createCheckoutSession = exports.disconnectStripeAccount = exports.refreshStripeAccountStatus = exports.createStripeConnectLink = exports.cleanupReadNotifications = exports.sendPlanSharedNotification = void 0;
exports.generateVoice = exports.createMissingLedgerEntry = exports.getConnectedAccountData = exports.setYearlyEarningsCap = exports.setProfitShareStartDate = exports.reconcileConnectedAccountPayments = exports.analyzeMovement = exports.retryFailedGifGeneration = exports.cleanupOldMovementThumbnails = exports.generateMovementGif = exports.cleanupNotificationCooldowns = exports.continueRecurringAssignments = exports.onWorkoutCompleted = exports.onMovementMediaUploaded = exports.onWorkoutLogReviewed = exports.onWorkoutAssigned = exports.checkGcalConflicts = exports.removeGcalConflictAccount = void 0;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const firestore_2 = require("firebase-admin/firestore");
const stripe_1 = __importDefault(require("stripe"));
const googleapis_1 = require("googleapis");
const zoom_1 = require("./zoom");
admin.initializeApp();
const db = admin.firestore(); // IAM: datastore.user granted 2026-03-22
const messaging = admin.messaging();
// ── Secrets (live mode: STRIPE_SECRET_KEY v8, STRIPE_WEBHOOK_SECRET v4) ─────────
const stripeSecretKey = (0, params_1.defineSecret)('STRIPE_SECRET_KEY');
const stripeWebhookSecret = (0, params_1.defineSecret)('STRIPE_WEBHOOK_SECRET');
const stripeWebhookSecretConnect = (0, params_1.defineSecret)('STRIPE_WEBHOOK_SECRET_CONNECT');
// ── Zoom Secrets ─────────────────────────────────────────────────────────────
const zoomAccountId = (0, params_1.defineSecret)('ZOOM_ACCOUNT_ID');
const zoomClientId = (0, params_1.defineSecret)('ZOOM_CLIENT_ID');
const zoomClientSecret = (0, params_1.defineSecret)('ZOOM_CLIENT_SECRET');
// ZOOM_WEBHOOK_SECRET is defined near zoomWebhook CF (line ~2858)
// ── Notification Secrets ─────────────────────────────────────────────────────
const emailApiKey = (0, params_1.defineSecret)('EMAIL_API_KEY');
const twilioAccountSid = (0, params_1.defineSecret)('TWILIO_ACCOUNT_SID');
const twilioAuthToken = (0, params_1.defineSecret)('TWILIO_AUTH_TOKEN');
const twilioFromNumber = (0, params_1.defineSecret)('TWILIO_FROM_NUMBER');
// ── Google Calendar Secrets ──────────────────────────────────────────────────
const googleClientId = (0, params_1.defineSecret)('GOOGLE_CLIENT_ID');
const googleClientSecret = (0, params_1.defineSecret)('GOOGLE_CLIENT_SECRET');
// ── Tier split config (GoArrive share percent) ────────────────────────────────
// 40% for coaches with < 5 active paying members
// 35% for coaches with 5–9 active paying members
// 30% for coaches with 10+ active paying members
function getTierSplit(activePayingMembers) {
    if (activePayingMembers >= 10)
        return 30;
    if (activePayingMembers >= 5)
        return 35;
    return 40;
}
// ── Helper: get Stripe instance ───────────────────────────────────────────────
function getStripe(secretKey) {
    // Trim whitespace/newlines that Secret Manager may append to the key value
    return new stripe_1.default(secretKey.trim(), { apiVersion: '2026-02-25.clover' });
}
// ─── 1. FCM Push Notification on plan_shared ─────────────────────────────────
exports.sendPlanSharedNotification = (0, firestore_1.onDocumentCreated)('notifications/{notifId}', async (event) => {
    var _a;
    const snap = event.data;
    if (!snap)
        return;
    const data = snap.data();
    if (data.type !== 'plan_shared')
        return;
    const recipientId = data.recipientId;
    if (!recipientId) {
        console.warn('[sendPlanSharedNotification] No recipientId on notification', snap.id);
        return;
    }
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
                fcmOptions: { link: '/my-plan' },
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
        const code = (err === null || err === void 0 ? void 0 : err.code) || '';
        if (code === 'messaging/registration-token-not-registered' ||
            code === 'messaging/invalid-registration-token') {
            console.warn('[sendPlanSharedNotification] Stale FCM token for', recipientId, '— removing');
            try {
                await db.collection('users').doc(recipientId).update({ fcmToken: firestore_2.FieldValue.delete() });
            }
            catch (_b) {
                // Best-effort cleanup
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
    const thirtyDaysAgo = firestore_2.Timestamp.fromMillis(now.toMillis() - 30 * 24 * 60 * 60 * 1000);
    let deletedCount = 0;
    const batchSize = 400;
    const readQuery = db.collection('notifications').where('read', '==', true).limit(batchSize);
    let readSnap = await readQuery.get();
    while (!readSnap.empty) {
        const batch = db.batch();
        readSnap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        deletedCount += readSnap.size;
        readSnap = await readQuery.get();
    }
    const staleQuery = db.collection('notifications').where('createdAt', '<', thirtyDaysAgo).limit(batchSize);
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
// ─── 3. createStripeConnectLink ───────────────────────────────────────────────
/**
 * Creates or resumes a Stripe Connect Express account onboarding link for a coach.
 * Stores the account in coachStripeAccounts/{coachId}.
 *
 * ME-001: Requires STRIPE_SECRET_KEY secret.
 */
exports.createStripeConnectLink = (0, https_1.onCall)({ secrets: [stripeSecretKey] }, async (request) => {
    var _a, _b, _c;
    const coachId = (_a = request.data) === null || _a === void 0 ? void 0 : _a.coachId;
    if (!coachId)
        throw new https_1.HttpsError('invalid-argument', 'coachId is required');
    // Verify caller is the coach or an admin
    const callerUid = (_b = request.auth) === null || _b === void 0 ? void 0 : _b.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const stripe = getStripe(stripeSecretKey.value());
    // Check if account already exists
    const accountRef = db.collection('coachStripeAccounts').doc(coachId);
    const accountSnap = await accountRef.get();
    let stripeAccountId;
    if (accountSnap.exists && ((_c = accountSnap.data()) === null || _c === void 0 ? void 0 : _c.stripeAccountId)) {
        stripeAccountId = accountSnap.data().stripeAccountId;
    }
    else {
        // Create new Express account
        const account = await stripe.accounts.create({
            type: 'express',
            metadata: { coachId },
        });
        stripeAccountId = account.id;
        await accountRef.set({
            coachId,
            stripeAccountId,
            accountType: 'express',
            onboardingStatus: 'pending',
            chargesEnabled: false,
            payoutsEnabled: false,
            requirementsDue: [],
            createdAt: firestore_2.FieldValue.serverTimestamp(),
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
            lastStatusSyncAt: firestore_2.FieldValue.serverTimestamp(),
        });
    }
    // Generate onboarding link
    const appBaseUrl = process.env.APP_BASE_URL || 'https://goarrive.fit';
    const accountLink = await stripe.accountLinks.create({
        account: stripeAccountId,
        refresh_url: `${appBaseUrl}/account?stripe_refresh=1`,
        return_url: `${appBaseUrl}/account?stripe_return=1`,
        type: 'account_onboarding',
    });
    // Update status to in_progress
    await accountRef.update({
        onboardingStatus: 'in_progress',
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
    });
    return { url: accountLink.url };
});
// ─── 4. refreshStripeAccountStatus ───────────────────────────────────────────
/**
 * Fetches the latest Stripe account status and syncs it to Firestore.
 * ME-001: Requires STRIPE_SECRET_KEY secret.
 */
exports.refreshStripeAccountStatus = (0, https_1.onCall)({ secrets: [stripeSecretKey] }, async (request) => {
    var _a, _b, _c, _d;
    const coachId = (_a = request.data) === null || _a === void 0 ? void 0 : _a.coachId;
    if (!coachId)
        throw new https_1.HttpsError('invalid-argument', 'coachId is required');
    const callerUid = (_b = request.auth) === null || _b === void 0 ? void 0 : _b.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const accountRef = db.collection('coachStripeAccounts').doc(coachId);
    const accountSnap = await accountRef.get();
    if (!accountSnap.exists)
        throw new https_1.HttpsError('not-found', 'No Stripe account found for this coach');
    const stripeAccountId = accountSnap.data().stripeAccountId;
    const stripe = getStripe(stripeSecretKey.value());
    const account = await stripe.accounts.retrieve(stripeAccountId);
    const onboardingStatus = account.details_submitted
        ? account.charges_enabled && account.payouts_enabled
            ? 'complete'
            : 'restricted'
        : 'in_progress';
    await accountRef.update({
        onboardingStatus,
        chargesEnabled: account.charges_enabled,
        payoutsEnabled: account.payouts_enabled,
        requirementsDue: (_d = (_c = account.requirements) === null || _c === void 0 ? void 0 : _c.currently_due) !== null && _d !== void 0 ? _d : [],
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
        lastStatusSyncAt: firestore_2.FieldValue.serverTimestamp(),
    });
    return { success: true, onboardingStatus };
});
// ─── 4b. disconnectStripeAccount ────────────────────────────────────────────
/**
 * Disconnects (deletes) a coach's Stripe Express account and clears the
 * coachStripeAccounts/{coachId} Firestore document so they can reconnect fresh.
 *
 * Flow:
 *   1. Verify caller is the coach (or admin).
 *   2. Retrieve the stripeAccountId from Firestore.
 *   3. Call stripe.accounts.del(stripeAccountId) to permanently delete the
 *      Express account on Stripe's side.  Stripe requires the account to have
 *      a zero balance; if it doesn't, we return a safe error without touching
 *      Firestore so the coach can resolve the balance first.
 *   4. Delete the coachStripeAccounts/{coachId} document so the UI resets to
 *      "Not connected" and the coach can start fresh with Connect Stripe.
 *
 * NOTE: stripe.accounts.del() only works on Express/Custom accounts where the
 * platform is the controller.  It permanently removes the account and all its
 * data from Stripe — this is intentional for a full reset.
 *
 * ME-001: Requires STRIPE_SECRET_KEY secret.
 */
exports.disconnectStripeAccount = (0, https_1.onCall)({ secrets: [stripeSecretKey] }, async (request) => {
    var _a, _b, _c, _d, _e;
    const coachId = (_a = request.data) === null || _a === void 0 ? void 0 : _a.coachId;
    if (!coachId)
        throw new https_1.HttpsError('invalid-argument', 'coachId is required');
    const callerUid = (_b = request.auth) === null || _b === void 0 ? void 0 : _b.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    // Only the coach themselves (or an admin) may disconnect
    const callerDoc = await db.collection('users').doc(callerUid).get();
    const isAdmin = callerDoc.exists && ((_c = callerDoc.data()) === null || _c === void 0 ? void 0 : _c.role) === 'admin';
    if (callerUid !== coachId && !isAdmin) {
        throw new https_1.HttpsError('permission-denied', 'You can only disconnect your own Stripe account');
    }
    const accountRef = db.collection('coachStripeAccounts').doc(coachId);
    const accountSnap = await accountRef.get();
    if (!accountSnap.exists) {
        // Already disconnected — idempotent success
        return { success: true, message: 'No Stripe account was connected.' };
    }
    const stripeAccountId = accountSnap.data().stripeAccountId;
    const stripe = getStripe(stripeSecretKey.value());
    try {
        // Attempt to delete the Express account on Stripe
        await stripe.accounts.del(stripeAccountId);
    }
    catch (err) {
        const stripeCode = ((_d = err === null || err === void 0 ? void 0 : err.raw) === null || _d === void 0 ? void 0 : _d.code) || (err === null || err === void 0 ? void 0 : err.code) || '';
        const stripeMsg = ((_e = err === null || err === void 0 ? void 0 : err.raw) === null || _e === void 0 ? void 0 : _e.message) || (err === null || err === void 0 ? void 0 : err.message) || String(err);
        if (stripeCode === 'account_invalid' ||
            stripeMsg.includes('No such account') ||
            stripeMsg.includes('does not exist')) {
            // Account already deleted on Stripe side — safe to clean up Firestore
            console.warn('[disconnectStripeAccount] Account not found on Stripe, cleaning Firestore only:', stripeAccountId);
        }
        else if (stripeCode === 'balance_insufficient' ||
            stripeMsg.toLowerCase().includes('balance') ||
            stripeMsg.toLowerCase().includes('outstanding')) {
            // Account has a non-zero balance — cannot delete yet
            throw new https_1.HttpsError('failed-precondition', 'This Stripe account has an outstanding balance and cannot be deleted yet. ' +
                'Please wait for all pending payouts to complete, then try again.');
        }
        else {
            // Unknown Stripe error — surface it
            throw new https_1.HttpsError('internal', `Stripe error: ${stripeMsg}`);
        }
    }
    // Clear the Firestore record so the UI resets to "Not connected"
    await accountRef.delete();
    console.log(`[disconnectStripeAccount] Coach ${coachId} disconnected Stripe account ${stripeAccountId}`);
    return { success: true, message: 'Stripe account disconnected. You can now connect a new account.' };
});
// ─── 5. createCheckoutSession ─────────────────────────────────────────────────
/**
 * Creates a Stripe Checkout session for a member accepting a plan.
 *
 * For monthly:
 *   - Creates a subscription schedule with two phases:
 *     Phase 1: initial monthly price for contractLengthMonths
 *     Phase 2: continuation monthly price, indefinite
 *   - application_fee_percent = tierSplit (40/35/30)
 *
 * For pay_in_full:
 *   - Charges the full term total up front (10% discount applied)
 *   - Creates a continuation monthly subscription starting at contractEndAt
 *
 * BP-001: Creates acceptedPlanSnapshot before creating checkout session.
 * ME-001: Requires STRIPE_SECRET_KEY secret.
 * RISK-001: CTS + pay-in-full stacking order is unresolved; both amounts stored in snapshot.
 */
exports.createCheckoutSession = (0, https_1.onCall)({ secrets: [stripeSecretKey] }, async (request) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w;
    const { planId, memberId, paymentOption, commitToSave, nutritionAddOn, displayedMonthlyPrice: clientMonthly, displayedPayInFullTotal: clientPayInFull, billingInterval: clientBillingInterval } = request.data;
    // Weekly billing: only applies to 'monthly' (recurring) payment option
    const billingInterval = (paymentOption === 'monthly' && clientBillingInterval === 'week') ? 'week' : 'month';
    const isWeekly = billingInterval === 'week';
    if (!planId || !memberId || !paymentOption) {
        throw new https_1.HttpsError('invalid-argument', 'planId, memberId, and paymentOption are required');
    }
    try { // Global try-catch for error visibility in logs
        // Auth is optional — shared-plan members are not signed in.
        // When signed in, we verify the caller is the member or coach.
        const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
        // ── Load plan ──
        const planRef = db.collection('member_plans').doc(planId);
        const planSnap = await planRef.get();
        if (!planSnap.exists)
            throw new https_1.HttpsError('not-found', 'Plan not found');
        const plan = planSnap.data();
        const coachId = plan.coachId;
        if (!coachId)
            throw new https_1.HttpsError('failed-precondition', 'Plan has no coachId');
        // If signed in, verify the caller is the member, the plan's coach, or a platform admin
        const callerToken = (_b = request.auth) === null || _b === void 0 ? void 0 : _b.token;
        const callerIsAdmin = (callerToken === null || callerToken === void 0 ? void 0 : callerToken.role) === 'platformAdmin' || (callerToken === null || callerToken === void 0 ? void 0 : callerToken.admin) === true;
        if (callerUid && callerUid !== memberId && callerUid !== coachId && !callerIsAdmin) {
            throw new https_1.HttpsError('permission-denied', 'Not authorized for this plan');
        }
        // Verify the memberId matches the plan (prevents guessing planIds)
        // Allow platform admins to bypass this check for testing purposes
        if (!callerIsAdmin && plan.memberId !== memberId) {
            throw new https_1.HttpsError('permission-denied', 'Member ID does not match this plan');
        }
        // ── (1) Plan status check — block checkout if already paid or cancelled ──
        const planStatus = plan.checkoutStatus;
        if (planStatus === 'paid') {
            throw new https_1.HttpsError('failed-precondition', 'This plan has already been paid.');
        }
        if (planStatus === 'cancelled') {
            throw new https_1.HttpsError('failed-precondition', 'This plan has been cancelled.');
        }
        // ── (2) Rate limiting — max 5 pending checkout intents per plan per hour ──
        try {
            const oneHourAgo = firestore_2.Timestamp.fromMillis(Date.now() - 60 * 60 * 1000);
            const recentIntentsSnap = await db.collection('checkoutIntents')
                .where('planId', '==', planId)
                .where('status', '==', 'pending')
                .get();
            const recentCount = recentIntentsSnap.docs.filter((d) => d.data().createdAt && d.data().createdAt.toMillis() >= oneHourAgo.toMillis()).length;
            if (recentCount >= 5) {
                throw new https_1.HttpsError('resource-exhausted', 'Too many checkout attempts. Please wait a few minutes and try again.');
            }
        }
        catch (e) {
            // If it's our own rate-limit error, re-throw; otherwise log and continue
            if ((e === null || e === void 0 ? void 0 : e.code) === 'resource-exhausted')
                throw e;
            console.warn('[createCheckoutSession] Rate limit check failed, proceeding:', e === null || e === void 0 ? void 0 : e.message);
        }
        // ── Load coach Stripe account ──
        const coachAccountSnap = await db.collection('coachStripeAccounts').doc(coachId).get();
        if (!coachAccountSnap.exists) {
            throw new https_1.HttpsError('failed-precondition', 'Coach has not connected Stripe. ME-001: Coach must complete Stripe onboarding first.');
        }
        const coachAccount = coachAccountSnap.data();
        // (5) Stripe connected account guard — block if charges not enabled
        if (!coachAccount.chargesEnabled) {
            throw new https_1.HttpsError('failed-precondition', 'Your coach is still setting up payments. Please contact them directly.');
        }
        const stripeAccountId = coachAccount.stripeAccountId;
        if (!stripeAccountId) {
            throw new https_1.HttpsError('failed-precondition', 'Your coach is still setting up payments. Please contact them directly.');
        }
        // ── Compute pricing ──
        const sessionsPerWeek = plan.sessionsPerWeek || 3;
        const sessionsPerMonth = Math.round(sessionsPerWeek * (52 / 12));
        const contractMonths = plan.contractMonths || 12;
        // Initial monthly
        const hourlyRate = plan.hourlyRate || 100;
        const sessionLengthMinutes = plan.sessionLengthMinutes || 60;
        const checkInCallMinutes = plan.checkInCallMinutes || 30;
        const programBuildTimeHours = plan.programBuildTimeHours || 5;
        // ── Pricing: use client-sent displayed prices to avoid rounding mismatches ──
        // The frontend's calculatePricing() already applies CTS, nutrition, manual
        // overrides, and pay-in-full discount using the exact same formula the member
        // sees. We trust those values but validate they are within a sane range of
        // the server-side estimate.
        const ctsActive = commitToSave === true;
        const nutActive = nutritionAddOn === true;
        // Server-side fallback calculation (used for validation & snapshot)
        const serverBaseMonthly = Math.round((_g = (_e = (_d = (_c = plan.pricingResult) === null || _c === void 0 ? void 0 : _c.displayMonthlyPrice) !== null && _d !== void 0 ? _d : plan.monthlyPriceOverride) !== null && _e !== void 0 ? _e : (_f = plan.pricingResult) === null || _f === void 0 ? void 0 : _f.calculatedMonthlyPrice) !== null && _g !== void 0 ? _g : (hourlyRate * (sessionLengthMinutes / 60) * sessionsPerMonth));
        const ctsMonthlySavings = ctsActive
            ? ((_k = (_j = (_h = plan.commitToSave) === null || _h === void 0 ? void 0 : _h.monthlySavings) !== null && _j !== void 0 ? _j : plan.commitToSaveMonthlySavings) !== null && _k !== void 0 ? _k : 100)
            : 0;
        const nutritionMonthlyCost = nutActive
            ? ((_o = (_m = (_l = plan.nutrition) === null || _l === void 0 ? void 0 : _l.monthlyCost) !== null && _m !== void 0 ? _m : plan.nutritionMonthlyCost) !== null && _o !== void 0 ? _o : 100)
            : 0;
        const serverMonthly = serverBaseMonthly - ctsMonthlySavings + nutritionMonthlyCost;
        const payInFullDiscountPct = plan.payInFullDiscountPercent || 10;
        const serverPayInFull = Math.round(serverMonthly * contractMonths * (1 - payInFullDiscountPct / 100));
        // Use client-sent prices when available; fall back to server calculation
        const displayMonthlyPrice = (typeof clientMonthly === 'number' && clientMonthly > 0)
            ? Math.round(clientMonthly)
            : Math.round(serverMonthly);
        const payInFullTotal = (typeof clientPayInFull === 'number' && clientPayInFull > 0)
            ? Math.round(clientPayInFull)
            : serverPayInFull;
        // Sanity check: client price must be within $10 of server estimate
        if (Math.abs(displayMonthlyPrice - Math.round(serverMonthly)) > 10) {
            console.error(`[createCheckoutSession] Monthly price mismatch: client=${displayMonthlyPrice}, server=${Math.round(serverMonthly)}`);
            throw new https_1.HttpsError('invalid-argument', 'Price mismatch — please refresh and try again.');
        }
        if (paymentOption === 'pay_in_full' && Math.abs(payInFullTotal - serverPayInFull) > 50) {
            console.error(`[createCheckoutSession] Pay-in-full price mismatch: client=${payInFullTotal}, server=${serverPayInFull}`);
            throw new https_1.HttpsError('invalid-argument', 'Price mismatch — please refresh and try again.');
        }
        const payInFullMonthlyEquivalent = Math.round(payInFullTotal / contractMonths);
        // Continuation monthly
        const cp = plan.continuationPricing;
        const contHr = (_p = cp === null || cp === void 0 ? void 0 : cp.continuationHourlyRate) !== null && _p !== void 0 ? _p : hourlyRate;
        const contMin = (_q = cp === null || cp === void 0 ? void 0 : cp.continuationMinutesPerSession) !== null && _q !== void 0 ? _q : 3.5;
        const contCheckIn = (_r = cp === null || cp === void 0 ? void 0 : cp.continuationCheckInMinutesPerMonth) !== null && _r !== void 0 ? _r : 30;
        const continuationMonthlyPrice = Math.round(contHr * (contMin / 60) * sessionsPerMonth);
        const continuationPayInFullTotal = Math.round(continuationMonthlyPrice * 12 * 0.9);
        const continuationPayInFullMonthlyEquivalent = Math.round(continuationPayInFullTotal / 12);
        // Tier split (count active paying members for this coach)
        const activePayingSnap = await db.collection('member_plans')
            .where('coachId', '==', coachId)
            .where('checkoutStatus', '==', 'paid')
            .get();
        const activePayingCount = activePayingSnap.size;
        const tierSplit = getTierSplit(activePayingCount);
        const applicationFeePercent = tierSplit;
        // ── Create acceptedPlanSnapshot ──
        const snapshotRef = db.collection('acceptedPlanSnapshots').doc();
        const snapshotId = snapshotRef.id;
        const now = firestore_2.Timestamp.now();
        const contractStartAt = now;
        const contractEndAtMs = now.toMillis() + contractMonths * 30.44 * 24 * 60 * 60 * 1000;
        const contractEndAt = firestore_2.Timestamp.fromMillis(contractEndAtMs);
        const snapshot = {
            snapshotId,
            planId,
            memberId,
            coachId,
            snapshotAt: now,
            contractLengthMonths: contractMonths,
            hourlyRate,
            sessionLengthMinutes,
            checkInCallMinutes,
            programBuildTimeHours,
            sessionsPerWeek,
            calculatedMonthlyPrice: displayMonthlyPrice,
            displayMonthlyPrice,
            payInFullTotal,
            payInFullMonthlyEquivalent,
            continuationHourlyRate: contHr,
            continuationMinutesPerSession: contMin,
            continuationCheckInMinutesPerMonth: contCheckIn,
            continuationMonthlyPrice,
            continuationPayInFullTotal,
            continuationPayInFullMonthlyEquivalent,
            baseMonthlyPrice: serverBaseMonthly,
            billingInterval,
            ctsActive,
            ctsMonthlySavings: ctsActive ? ctsMonthlySavings : ((_t = (_s = plan.postContract) === null || _s === void 0 ? void 0 : _s.ctsMonthlySavings) !== null && _t !== void 0 ? _t : null),
            nutActive,
            nutritionMonthlyCost: nutActive ? nutritionMonthlyCost : 0,
            tierSplit,
            applicationFeePercent,
            contractStartAt,
            contractEndAt,
        };
        await snapshotRef.set(snapshot);
        // ── Create checkoutIntent ──
        const intentRef = db.collection('checkoutIntents').doc();
        const intentId = intentRef.id;
        await intentRef.set({
            intentId,
            memberId,
            coachId,
            planId,
            snapshotId,
            paymentOption,
            billingInterval,
            status: 'pending',
            createdAt: firestore_2.FieldValue.serverTimestamp(),
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        });
        const stripe = getStripe(stripeSecretKey.value());
        const appBaseUrl = process.env.APP_BASE_URL || 'https://goarrive.fit';
        // ── (3) Get or create Stripe customer — email fallback for unauthenticated members ──
        let stripeCustomerId = plan.stripeCustomerId;
        if (!stripeCustomerId) {
            // Try user account first, then fall back to email stored on the plan
            const memberSnap = await db.collection('users').doc(memberId).get();
            const memberEmail = ((_u = memberSnap.data()) === null || _u === void 0 ? void 0 : _u.email)
                || plan.memberEmail
                || plan.email;
            const customer = await stripe.customers.create({ email: memberEmail, metadata: { memberId, coachId, planId } }, { stripeAccount: stripeAccountId });
            stripeCustomerId = customer.id;
            await planRef.update({ stripeCustomerId });
        }
        let sessionUrl;
        let stripeSessionId;
        if (paymentOption === 'monthly') {
            // ── Recurring subscription: weekly or monthly ──
            // Phase 1: contract period at displayMonthlyPrice (or weekly equivalent)
            // Phase 2: indefinite at continuationMonthlyPrice (monthly)
            const recurringAmount = isWeekly
                ? Math.round(displayMonthlyPrice * 100 / (52 / 12)) // weekly in cents
                : displayMonthlyPrice * 100; // monthly in cents
            const intervalLabel = isWeekly ? 'Weekly' : 'Monthly';
            const session = await stripe.checkout.sessions.create({
                customer: stripeCustomerId,
                payment_method_types: ['card'],
                mode: 'subscription',
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            product_data: {
                                name: `GoArrive Coaching — ${contractMonths}-Month Contract (${intervalLabel})${ctsActive ? ' (Commit to Save)' : ''}${nutActive ? ' + Nutrition' : ''}`,
                                metadata: { planId, snapshotId },
                            },
                            unit_amount: recurringAmount,
                            recurring: { interval: billingInterval },
                        },
                        quantity: 1,
                    },
                ],
                subscription_data: {
                    application_fee_percent: applicationFeePercent,
                    metadata: {
                        planId,
                        snapshotId,
                        intentId,
                        memberId,
                        coachId,
                        paymentOption: 'monthly',
                        billingInterval,
                        contractMonths: String(contractMonths),
                        continuationMonthlyPriceCents: String(continuationMonthlyPrice * 100),
                        tierSplit: String(tierSplit),
                    },
                },
                // (4) Include planId in success URL so checkout-success page can link the account
                success_url: `${appBaseUrl}/checkout-success?intent=${intentId}&memberId=${memberId}&planId=${planId}`,
                cancel_url: `${appBaseUrl}/shared-plan/${memberId}?checkout_cancelled=1`,
                metadata: { intentId, planId, snapshotId, memberId, coachId },
            }, { stripeAccount: stripeAccountId });
            sessionUrl = session.url;
            stripeSessionId = session.id;
        }
        else {
            // ── Pay in full: one-time payment + deferred continuation subscription ──
            const session = await stripe.checkout.sessions.create({
                customer: stripeCustomerId,
                payment_method_types: ['card'],
                mode: 'payment',
                line_items: [
                    {
                        price_data: {
                            currency: 'usd',
                            product_data: {
                                name: `GoArrive Coaching — ${contractMonths}-Month Pay in Full (10% off)${ctsActive ? ' + Commit to Save' : ''}${nutActive ? ' + Nutrition' : ''}`,
                                metadata: { planId, snapshotId },
                            },
                            unit_amount: payInFullTotal * 100, // cents
                        },
                        quantity: 1,
                    },
                ],
                payment_intent_data: {
                    application_fee_amount: Math.round(payInFullTotal * 100 * applicationFeePercent / 100),
                    metadata: {
                        planId,
                        snapshotId,
                        intentId,
                        memberId,
                        coachId,
                        paymentOption: 'pay_in_full',
                        contractMonths: String(contractMonths),
                        contractEndAtMs: String(contractEndAtMs),
                        continuationMonthlyPriceCents: String(continuationMonthlyPrice * 100),
                        tierSplit: String(tierSplit),
                        // Store for future renewed pay-in-full option (BP-002)
                        continuationPayInFullTotal: String(continuationPayInFullTotal),
                    },
                },
                // (4) Include planId in success URL so checkout-success page can link the account
                success_url: `${appBaseUrl}/checkout-success?intent=${intentId}&memberId=${memberId}&planId=${planId}`,
                cancel_url: `${appBaseUrl}/shared-plan/${memberId}?checkout_cancelled=1`,
                metadata: { intentId, planId, snapshotId, memberId, coachId },
            }, { stripeAccount: stripeAccountId });
            sessionUrl = session.url;
            stripeSessionId = session.id;
        }
        // Update intent with Stripe session ID
        await intentRef.update({
            stripeSessionId,
            stripeSessionUrl: sessionUrl,
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        });
        return { sessionUrl, intentId, snapshotId };
    }
    catch (err) {
        // Re-throw HttpsError as-is; wrap unexpected errors with logging
        if ((err === null || err === void 0 ? void 0 : err.code) && (err === null || err === void 0 ? void 0 : err.httpErrorCode))
            throw err; // Already an HttpsError
        console.error('[createCheckoutSession] Unhandled error:', (_v = err === null || err === void 0 ? void 0 : err.message) !== null && _v !== void 0 ? _v : err, (_w = err === null || err === void 0 ? void 0 : err.stack) !== null && _w !== void 0 ? _w : '');
        throw new https_1.HttpsError('internal', 'Something went wrong creating checkout. Please try again.');
    }
});
// ─── 6. stripeWebhook ─────────────────────────────────────────────────────────
/**
 * Handles Stripe webhook events. Idempotent: uses stripeEventId as Firestore doc ID.
 *
 * Handled events:
 *   - checkout.session.completed
 *   - invoice.paid
 *   - invoice.payment_failed
 *   - customer.subscription.created
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 *   - charge.refunded
 *
 * ME-002: Requires STRIPE_WEBHOOK_SECRET secret.
 *
 * Refund policy (documented):
 *   When a charge is refunded, the application fee is also refunded proportionally
 *   by Stripe automatically for direct charges. This is the correct behavior —
 *   coaches are not harmed by refunds on the platform fee portion.
 *   The ledger entry records the refund amount and marks the entry as refunded.
 */
exports.stripeWebhook = (0, https_1.onRequest)({ secrets: [stripeSecretKey, stripeWebhookSecret, stripeWebhookSecretConnect] }, async (req, res) => {
    const sig = req.headers['stripe-signature'];
    if (!sig) {
        res.status(400).send('Missing stripe-signature header');
        return;
    }
    const stripe = getStripe(stripeSecretKey.value());
    let event;
    // Try platform webhook secret first, then connected account secret
    const secrets = [
        stripeWebhookSecret.value(),
        stripeWebhookSecretConnect.value(),
    ].filter(Boolean);
    let verified = false;
    for (const secret of secrets) {
        try {
            event = stripe.webhooks.constructEvent(req.rawBody, sig, secret);
            verified = true;
            break;
        }
        catch (_err) {
            // Try next secret
        }
    }
    if (!verified) {
        console.error('[stripeWebhook] Signature verification failed with all secrets');
        res.status(400).send('Webhook signature error: verification failed');
        return;
    }
    // Log connected account info if present
    const connectedAccountId = event.account;
    if (connectedAccountId) {
        console.log(`[stripeWebhook] Connected account event from: ${connectedAccountId}`);
    }
    // ── Idempotency: check if already processed ──
    const eventRef = db.collection('billingEvents').doc(event.id);
    const existing = await eventRef.get();
    if (existing.exists) {
        console.log('[stripeWebhook] Already processed event', event.id, '— skipping');
        res.status(200).send('Already processed');
        return;
    }
    // ── Store raw event (append-only) ──
    const billingEvent = {
        eventId: event.id,
        stripeEventId: event.id,
        stripeEventType: event.type,
        rawPayload: event,
        processedAt: firestore_2.FieldValue.serverTimestamp(),
    };
    try {
        await eventRef.set(billingEvent);
    }
    catch (err) {
        console.error('[stripeWebhook] Failed to store billing event:', err);
        res.status(500).send('Failed to store event');
        return;
    }
    // ── Process event ──
    try {
        switch (event.type) {
            case 'checkout.session.completed':
                await handleCheckoutSessionCompleted(event.data.object, event.id);
                break;
            case 'invoice.paid':
                await handleInvoicePaid(event.data.object, event.id);
                break;
            case 'invoice.payment_failed':
                await handleInvoicePaymentFailed(event.data.object, event.id);
                break;
            case 'customer.subscription.created':
            case 'customer.subscription.updated':
                await handleSubscriptionUpsert(event.data.object, event.id);
                break;
            case 'customer.subscription.deleted':
                await handleSubscriptionDeleted(event.data.object, event.id);
                break;
            case 'charge.refunded':
                await handleChargeRefunded(event.data.object, event.id);
                break;
            default:
                console.log('[stripeWebhook] Unhandled event type:', event.type);
        }
    }
    catch (err) {
        console.error('[stripeWebhook] Error processing event', event.id, ':', err);
        // Don't return 500 — Stripe will retry. Log and return 200 to avoid retry loops
        // for non-transient errors. For transient errors, throw to trigger retry.
    }
    res.status(200).send('OK');
});
// ── Webhook handlers ──────────────────────────────────────────────────────────
async function handleCheckoutSessionCompleted(session, eventId) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k;
    const { intentId, planId, snapshotId, memberId, coachId: _coachId } = (_a = session.metadata) !== null && _a !== void 0 ? _a : {};
    void _coachId; // coachId is stored in snapshot; not needed here directly
    if (!intentId || !planId || !memberId) {
        console.warn('[handleCheckoutSessionCompleted] Missing metadata on session', session.id);
        return;
    }
    const paymentOption = (_c = (_b = session.metadata) === null || _b === void 0 ? void 0 : _b.paymentOption) !== null && _c !== void 0 ? _c : 'monthly';
    // Update checkoutIntent
    await db.collection('checkoutIntents').doc(intentId).update({
        status: 'completed',
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
    });
    // Load snapshot for contract dates
    const snapshotSnap = snapshotId
        ? await db.collection('acceptedPlanSnapshots').doc(snapshotId).get()
        : null;
    const snapshot = snapshotSnap === null || snapshotSnap === void 0 ? void 0 : snapshotSnap.data();
    const contractMonths = (_d = snapshot === null || snapshot === void 0 ? void 0 : snapshot.contractLengthMonths) !== null && _d !== void 0 ? _d : 12;
    const now = firestore_2.Timestamp.now();
    const contractStartAt = now;
    const contractEndAt = firestore_2.Timestamp.fromMillis(now.toMillis() + contractMonths * 30.44 * 24 * 60 * 60 * 1000);
    // Update plan status
    await db.collection('member_plans').doc(planId).update({
        status: 'active',
        checkoutStatus: paymentOption === 'pay_in_full' ? 'pay_in_full_paid' : 'paid',
        acceptedAt: now,
        contractStartAt,
        contractEndAt,
        acceptedSnapshotId: snapshotId !== null && snapshotId !== void 0 ? snapshotId : null,
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
    });
    // Update snapshot with billing event reference
    if (snapshotId) {
        await db.collection('acceptedPlanSnapshots').doc(snapshotId).update({
            checkoutSessionId: session.id,
            checkoutCompletedAt: now,
        });
    }
    // ── Pay-in-full: create deferred continuation subscription ──
    // The contract period is paid upfront. We create a Stripe subscription
    // with trial_end = contractEndAt so billing begins automatically when
    // the contract ends, without any further action from the member.
    //
    // RISK-001: CTS discount is NOT applied here. The continuation subscription
    // starts at the full continuationMonthlyPrice. CTS opt-in (a separate flow)
    // will update the subscription price if the member later commits.
    if (paymentOption === 'pay_in_full' && snapshot) {
        const continuationMonthlyPrice = snapshot.continuationMonthlyPrice;
        const coachId = snapshot.coachId;
        const tierSplit = ((_e = snapshot.tierSplit) !== null && _e !== void 0 ? _e : 40);
        if (continuationMonthlyPrice && coachId) {
            try {
                // Look up the coach's connected Stripe account
                const coachAccountSnap = await db.collection('coachStripeAccounts').doc(coachId).get();
                const stripeAccountId = (_f = coachAccountSnap.data()) === null || _f === void 0 ? void 0 : _f.stripeAccountId;
                if (stripeAccountId) {
                    const stripe = getStripe(stripeSecretKey.value());
                    // Get the member's Stripe customer ID from the plan doc
                    const planSnap = await db.collection('member_plans').doc(planId).get();
                    const stripeCustomerId = (_g = planSnap.data()) === null || _g === void 0 ? void 0 : _g.stripeCustomerId;
                    if (stripeCustomerId) {
                        // Create a price object for the continuation monthly amount
                        const continuationPrice = await stripe.prices.create({
                            currency: 'usd',
                            unit_amount: Math.round(continuationMonthlyPrice * 100),
                            recurring: { interval: 'month' },
                            product_data: {
                                name: `GoArrive Coaching — Ongoing Support`,
                                metadata: { planId, snapshotId: snapshotId !== null && snapshotId !== void 0 ? snapshotId : '', type: 'continuation' },
                            },
                        }, { stripeAccount: stripeAccountId });
                        // Create subscription with trial_end = contractEndAt
                        // The subscription will not charge until trial ends.
                        const continuationSub = await stripe.subscriptions.create({
                            customer: stripeCustomerId,
                            items: [{ price: continuationPrice.id }],
                            trial_end: contractEndAt.seconds,
                            application_fee_percent: tierSplit,
                            metadata: {
                                planId,
                                snapshotId: snapshotId !== null && snapshotId !== void 0 ? snapshotId : '',
                                memberId: memberId !== null && memberId !== void 0 ? memberId : '',
                                coachId,
                                type: 'continuation',
                                contractEndAtMs: String(contractEndAt.toMillis()),
                            },
                        }, { stripeAccount: stripeAccountId });
                        // Record the deferred subscription in memberSubscriptions
                        await db.collection('memberSubscriptions').doc(continuationSub.id).set({
                            subscriptionId: continuationSub.id,
                            planId,
                            snapshotId: snapshotId !== null && snapshotId !== void 0 ? snapshotId : '',
                            memberId: memberId !== null && memberId !== void 0 ? memberId : '',
                            coachId,
                            stripeAccountId,
                            stripeCustomerId,
                            paymentOption: 'pay_in_full_continuation',
                            phase: 'continuation',
                            contractStartAt,
                            contractEndAt,
                            status: continuationSub.status,
                            currentPeriodEnd: firestore_2.Timestamp.fromMillis(continuationSub.current_period_end * 1000),
                            tierSnapshot: tierSplit,
                            createdAt: firestore_2.FieldValue.serverTimestamp(),
                            updatedAt: firestore_2.FieldValue.serverTimestamp(),
                        }, { merge: true });
                        console.log('[handleCheckoutSessionCompleted] Deferred continuation subscription', continuationSub.id, 'created for pay-in-full plan', planId, '— billing starts at', contractEndAt.toDate().toISOString());
                    }
                    else {
                        console.warn('[handleCheckoutSessionCompleted] No stripeCustomerId on plan', planId, '— skipping deferred sub');
                    }
                }
                else {
                    console.warn('[handleCheckoutSessionCompleted] No stripeAccountId for coach', coachId, '— skipping deferred sub');
                }
            }
            catch (err) {
                // Log but do not rethrow — the plan is already activated.
                // A failed deferred sub creation should not roll back plan activation.
                // The billing dashboard Tasks section will surface this as a missing subscription.
                console.error('[handleCheckoutSessionCompleted] Failed to create deferred continuation subscription:', err);
            }
        }
    }
    // ── Monthly: convert subscription to subscription schedule with two phases ──
    // Stripe Checkout creates a regular subscription. We convert it to a
    // subscription schedule with Phase 1 (contract rate) and Phase 2 (continuation rate).
    // This ensures the price automatically transitions at contractEndAt.
    if (paymentOption === 'monthly' && session.subscription && snapshot) {
        const subscriptionId = typeof session.subscription === 'string'
            ? session.subscription
            : session.subscription.id;
        const continuationMonthlyPrice = snapshot.continuationMonthlyPrice;
        const coachId = snapshot.coachId;
        const tierSplit = ((_h = snapshot.tierSplit) !== null && _h !== void 0 ? _h : 40);
        // Calculate Phase 1 end date from the snapshot's contractEndAt
        const contractEndAtSnap = snapshot.contractEndAt;
        const contractEndMs = (contractEndAtSnap === null || contractEndAtSnap === void 0 ? void 0 : contractEndAtSnap._seconds)
            ? contractEndAtSnap._seconds * 1000
            : ((contractEndAtSnap === null || contractEndAtSnap === void 0 ? void 0 : contractEndAtSnap.seconds) ? contractEndAtSnap.seconds * 1000 : Number((_j = snapshot.contractEndAtMs) !== null && _j !== void 0 ? _j : 0));
        const phase1EndUnix = Math.floor(contractEndMs / 1000);
        if (continuationMonthlyPrice && coachId) {
            try {
                const coachAccountSnap = await db.collection('coachStripeAccounts').doc(coachId).get();
                const stripeAccountId = (_k = coachAccountSnap.data()) === null || _k === void 0 ? void 0 : _k.stripeAccountId;
                if (stripeAccountId) {
                    const stripe = getStripe(stripeSecretKey.value());
                    // Create a continuation price on the coach's connected account
                    const continuationPrice = await stripe.prices.create({
                        currency: 'usd',
                        unit_amount: Math.round(continuationMonthlyPrice * 100),
                        recurring: { interval: 'month' },
                        product_data: {
                            name: `GoArrive Coaching — Ongoing Support`,
                            metadata: { planId, snapshotId: snapshotId !== null && snapshotId !== void 0 ? snapshotId : '', type: 'continuation' },
                        },
                    }, { stripeAccount: stripeAccountId });
                    // Convert the subscription to a subscription schedule with two phases:
                    // Phase 1: current price for contractMonths iterations
                    // Phase 2: continuation price indefinitely
                    const schedule = await stripe.subscriptionSchedules.create({
                        from_subscription: subscriptionId,
                    }, { stripeAccount: stripeAccountId });
                    // Get the current phase's items to preserve the existing price
                    const currentPhase = schedule.phases[0];
                    const currentItems = currentPhase.items;
                    // Update the schedule with two explicit phases
                    await stripe.subscriptionSchedules.update(schedule.id, {
                        end_behavior: 'release', // After Phase 2, subscription continues as normal
                        phases: [
                            {
                                // Phase 1: contract period at initial rate
                                items: currentItems.map(item => {
                                    var _a;
                                    return ({
                                        price: typeof item.price === 'string' ? item.price : item.price.id,
                                        quantity: (_a = item.quantity) !== null && _a !== void 0 ? _a : 1,
                                    });
                                }),
                                end_date: phase1EndUnix,
                                application_fee_percent: tierSplit,
                                metadata: {
                                    phase: 'contract',
                                    planId,
                                    snapshotId: snapshotId !== null && snapshotId !== void 0 ? snapshotId : '',
                                },
                            },
                            {
                                // Phase 2: continuation at new rate, indefinite
                                items: [{ price: continuationPrice.id, quantity: 1 }],
                                application_fee_percent: tierSplit,
                                metadata: {
                                    phase: 'continuation',
                                    planId,
                                    snapshotId: snapshotId !== null && snapshotId !== void 0 ? snapshotId : '',
                                },
                            },
                        ],
                    }, { stripeAccount: stripeAccountId });
                    console.log('[handleCheckoutSessionCompleted] Subscription schedule', schedule.id, 'created for monthly plan', planId, '— Phase 1:', contractMonths, 'months at', snapshot.displayMonthlyPrice, '— Phase 2: continuation at', continuationMonthlyPrice);
                }
            }
            catch (err) {
                // Log but do not rethrow — the plan is already activated.
                // A failed schedule conversion means the subscription stays at the initial rate.
                // The billing dashboard Tasks section will surface this.
                console.error('[handleCheckoutSessionCompleted] Failed to create subscription schedule:', err);
            }
        }
    }
    console.log('[handleCheckoutSessionCompleted] Plan', planId, 'activated for member', memberId);
}
async function handleInvoicePaid(invoice, eventId) {
    var _a, _b, _c, _d;
    const sub = invoice.subscription;
    if (!sub)
        return;
    // Find memberSubscription by subscriptionId
    const subSnap = await db.collection('memberSubscriptions')
        .where('subscriptionId', '==', sub)
        .limit(1)
        .get();
    if (subSnap.empty) {
        console.log('[handleInvoicePaid] No memberSubscription found for', sub, '— may be first invoice before subscription.created fires');
        return;
    }
    const subDoc = subSnap.docs[0];
    const subData = subDoc.data();
    // Determine phase: contract or continuation
    const contractEndAt = subData.contractEndAt;
    const now = firestore_2.Timestamp.now();
    const phase = contractEndAt && now.toMillis() > contractEndAt.toMillis() ? 'continuation' : 'contract';
    const grossAmountCents = invoice.amount_paid;
    const tierSnapshot = ((_a = subData.tierSnapshot) !== null && _a !== void 0 ? _a : 40);
    const applicationFeePercent = tierSnapshot;
    const goArriveShareCents = Math.round(grossAmountCents * applicationFeePercent / 100);
    const coachShareCents = grossAmountCents - goArriveShareCents;
    // Append ledger entry
    const ledgerRef = db.collection('ledgerEntries').doc();
    await ledgerRef.set({
        entryId: ledgerRef.id,
        billingEventId: eventId,
        memberId: subData.memberId,
        coachId: subData.coachId,
        planId: subData.planId,
        snapshotId: subData.snapshotId,
        phase,
        grossAmountCents,
        coachShareCents,
        goArriveShareCents,
        tierSnapshot,
        applicationFeePercent,
        stripeInvoiceId: invoice.id,
        stripeChargeId: invoice.charge,
        contractStartAt: (_b = subData.contractStartAt) !== null && _b !== void 0 ? _b : null,
        contractEndAt: (_c = subData.contractEndAt) !== null && _c !== void 0 ? _c : null,
        pricingSnapshotId: (_d = subData.snapshotId) !== null && _d !== void 0 ? _d : '',
        ruleSnapshot: {
            tierSplit: tierSnapshot,
            applicationFeePercent,
            resolvedAt: now.toDate().toISOString(),
        },
        createdAt: firestore_2.FieldValue.serverTimestamp(),
    });
    console.log('[handleInvoicePaid] Ledger entry created for invoice', invoice.id, 'phase:', phase);
}
async function handleInvoicePaymentFailed(invoice, eventId) {
    const sub = invoice.subscription;
    if (!sub)
        return;
    const subSnap = await db.collection('memberSubscriptions')
        .where('subscriptionId', '==', sub)
        .limit(1)
        .get();
    if (!subSnap.empty) {
        const planId = subSnap.docs[0].data().planId;
        await db.collection('member_plans').doc(planId).update({
            checkoutStatus: 'failed',
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        });
        console.log('[handleInvoicePaymentFailed] Plan', planId, 'marked payment_failed');
    }
}
async function handleSubscriptionUpsert(sub, eventId) {
    var _a, _b, _c;
    const metadata = (_a = sub.metadata) !== null && _a !== void 0 ? _a : {};
    const { planId, snapshotId, memberId, coachId, contractMonths, tierSplit } = metadata;
    if (!planId || !memberId) {
        console.log('[handleSubscriptionUpsert] Missing metadata on subscription', sub.id);
        return;
    }
    const contractMonthsNum = parseInt(contractMonths !== null && contractMonths !== void 0 ? contractMonths : '12', 10);
    const tierSplitNum = parseInt(tierSplit !== null && tierSplit !== void 0 ? tierSplit : '40', 10);
    // Determine contractStartAt and contractEndAt from subscription
    const contractStartAt = firestore_2.Timestamp.fromMillis(((_b = sub.start_date) !== null && _b !== void 0 ? _b : Date.now() / 1000) * 1000);
    const contractEndAt = firestore_2.Timestamp.fromMillis(contractStartAt.toMillis() + contractMonthsNum * 30.44 * 24 * 60 * 60 * 1000);
    const subRef = db.collection('memberSubscriptions').doc(sub.id);
    await subRef.set({
        subscriptionId: sub.id,
        memberId,
        coachId: coachId !== null && coachId !== void 0 ? coachId : '',
        planId,
        snapshotId: snapshotId !== null && snapshotId !== void 0 ? snapshotId : '',
        stripeAccountId: (_c = sub.account) !== null && _c !== void 0 ? _c : '',
        stripeCustomerId: sub.customer,
        paymentOption: 'monthly',
        phase: 'contract',
        contractStartAt,
        contractEndAt,
        status: sub.status,
        currentPeriodEnd: firestore_2.Timestamp.fromMillis(sub.current_period_end * 1000),
        tierSnapshot: tierSplitNum,
        createdAt: firestore_2.FieldValue.serverTimestamp(),
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
    }, { merge: true });
    console.log('[handleSubscriptionUpsert] memberSubscription upserted for', sub.id);
}
async function handleSubscriptionDeleted(sub, eventId) {
    var _a;
    const subRef = db.collection('memberSubscriptions').doc(sub.id);
    const subSnap = await subRef.get();
    if (!subSnap.exists)
        return;
    await subRef.update({
        status: 'canceled',
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
    });
    const planId = (_a = subSnap.data()) === null || _a === void 0 ? void 0 : _a.planId;
    if (planId) {
        await db.collection('member_plans').doc(planId).update({
            checkoutStatus: 'failed',
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        });
    }
    console.log('[handleSubscriptionDeleted] Subscription', sub.id, 'canceled');
}
async function handleChargeRefunded(charge, eventId) {
    // Refund policy (documented):
    // For direct charges, Stripe automatically refunds the application fee proportionally.
    // Coaches are not harmed — the platform fee portion is returned to the platform,
    // and the coach's share is returned to the member from the coach's connected account.
    // We record the refund in the ledger as a negative entry.
    var _a, _b, _c;
    const invoiceId = charge.invoice;
    if (!invoiceId) {
        console.log('[handleChargeRefunded] Charge', charge.id, 'has no invoice — skipping ledger entry');
        return;
    }
    // Find original ledger entry for this charge
    const originalEntrySnap = await db.collection('ledgerEntries')
        .where('stripeChargeId', '==', charge.id)
        .limit(1)
        .get();
    if (originalEntrySnap.empty) {
        console.log('[handleChargeRefunded] No ledger entry found for charge', charge.id);
        return;
    }
    const original = originalEntrySnap.docs[0].data();
    const refundedAmountCents = charge.amount_refunded;
    const tierSnapshot = original.tierSnapshot;
    const applicationFeePercent = tierSnapshot;
    const goArriveShareCents = -Math.round(refundedAmountCents * applicationFeePercent / 100);
    const coachShareCents = -(refundedAmountCents + goArriveShareCents); // negative
    const ledgerRef = db.collection('ledgerEntries').doc();
    await ledgerRef.set({
        entryId: ledgerRef.id,
        billingEventId: eventId,
        memberId: original.memberId,
        coachId: original.coachId,
        planId: original.planId,
        snapshotId: original.snapshotId,
        phase: original.phase,
        grossAmountCents: -refundedAmountCents,
        coachShareCents,
        goArriveShareCents,
        tierSnapshot,
        applicationFeePercent,
        stripeInvoiceId: invoiceId,
        stripeChargeId: charge.id,
        refundOf: originalEntrySnap.docs[0].id,
        contractStartAt: (_a = original.contractStartAt) !== null && _a !== void 0 ? _a : null,
        contractEndAt: (_b = original.contractEndAt) !== null && _b !== void 0 ? _b : null,
        pricingSnapshotId: (_c = original.pricingSnapshotId) !== null && _c !== void 0 ? _c : '',
        ruleSnapshot: Object.assign(Object.assign({}, original.ruleSnapshot), { refundPolicy: 'Stripe auto-refunds application fee proportionally on direct charge refunds. Coach share returned from connected account.' }),
        createdAt: firestore_2.FieldValue.serverTimestamp(),
    });
    console.log('[handleChargeRefunded] Refund ledger entry created for charge', charge.id);
}
// ─── 7. activateCtsOptIn ──────────────────────────────────────────────────────
/**
 * Activates a Commit to Save opt-in for a member in the continuation phase.
 *
 * Steps:
 *   1. Validates the commitToSaveConsent document.
 *   2. Finds the member's active continuation subscription in memberSubscriptions.
 *   3. Creates a new Stripe Price at the CTS rate on the coach's connected account.
 *   4. Updates the Stripe subscription item to the new price.
 *   5. Marks the consent document status as 'active'.
 *   6. Updates memberSubscriptions with the new CTS price ID.
 *
 * RISK-001: CTS applies only to the continuation phase. It does NOT stack with
 * the 10% pay-in-full discount (which applies only to the contract period).
 *
 * ME-005: This function requires STRIPE_SECRET_KEY secret (same as createCheckoutSession).
 */
exports.activateCtsOptIn = (0, https_1.onCall)({ secrets: [stripeSecretKey] }, async (request) => {
    var _a, _b, _c;
    const { consentId, planId, memberId } = request.data;
    if (!consentId || !planId || !memberId) {
        throw new Error('Missing required parameters: consentId, planId, memberId');
    }
    // 1. Load and validate consent document
    const consentRef = db.collection('commitToSaveConsents').doc(consentId);
    const consentSnap = await consentRef.get();
    if (!consentSnap.exists) {
        throw new Error('Consent document not found');
    }
    const consent = consentSnap.data();
    if (consent.memberId !== memberId || consent.planId !== planId) {
        throw new Error('Consent document does not match memberId/planId');
    }
    if (consent.status === 'active') {
        // Already activated — idempotent success
        return { success: true, message: 'CTS already active' };
    }
    const ctsMonthlyRate = consent.ctsMonthlyRate;
    // 1b. Time-period guard — CTS only allowed after contract ends (RISK-001)
    const planSnap = await db.collection('member_plans').doc(planId).get();
    const planData = planSnap.data();
    if (planData === null || planData === void 0 ? void 0 : planData.contractEndAt) {
        const contractEndMs = planData.contractEndAt.toMillis();
        const nowMs = firestore_2.Timestamp.now().toMillis();
        if (nowMs < contractEndMs) {
            throw new Error('CTS cannot be activated during the contract period. ' +
                'Contract ends ' + new Date(contractEndMs).toISOString());
        }
    }
    // 2. Find the member's active continuation subscription
    const subSnap = await db.collection('memberSubscriptions')
        .where('planId', '==', planId)
        .where('memberId', '==', memberId)
        .limit(5)
        .get();
    let stripeAccountId;
    let stripeSubscriptionId;
    let coachId;
    let subDocRef;
    if (!subSnap.empty) {
        // Prefer continuation phase subscription; fall back to any active sub
        const subDoc = (_a = subSnap.docs.find(d => d.data().phase === 'continuation' || d.data().paymentOption === 'pay_in_full_continuation')) !== null && _a !== void 0 ? _a : subSnap.docs[0];
        const subData = subDoc.data();
        stripeAccountId = subData.stripeAccountId;
        stripeSubscriptionId = subData.subscriptionId;
        coachId = subData.coachId;
        subDocRef = subDoc.ref;
    }
    // Fallback: query Stripe directly if no memberSubscription doc found
    if (!stripeAccountId || !stripeSubscriptionId) {
        // Load coach info from plan
        coachId = coachId !== null && coachId !== void 0 ? coachId : planData === null || planData === void 0 ? void 0 : planData.coachId;
        if (!coachId)
            throw new Error('Cannot determine coachId for this plan');
        const coachAccountSnap = await db.collection('coachStripeAccounts').doc(coachId).get();
        stripeAccountId = (_b = coachAccountSnap.data()) === null || _b === void 0 ? void 0 : _b.stripeAccountId;
        if (!stripeAccountId)
            throw new Error('Coach has no connected Stripe account');
        const stripeCustomerId = planData === null || planData === void 0 ? void 0 : planData.stripeCustomerId;
        if (!stripeCustomerId)
            throw new Error('Plan has no stripeCustomerId');
        const stripeForLookup = getStripe(stripeSecretKey.value());
        const subs = await stripeForLookup.subscriptions.list({
            customer: stripeCustomerId,
            status: 'active',
            limit: 10,
        }, { stripeAccount: stripeAccountId });
        // Find a continuation subscription by metadata
        const contSub = (_c = subs.data.find(s => { var _a, _b; return ((_a = s.metadata) === null || _a === void 0 ? void 0 : _a.type) === 'continuation' || ((_b = s.metadata) === null || _b === void 0 ? void 0 : _b.phase) === 'continuation'; })) !== null && _c !== void 0 ? _c : subs.data[0];
        if (!contSub)
            throw new Error('No active Stripe subscription found for this member');
        stripeSubscriptionId = contSub.id;
    }
    const stripe = getStripe(stripeSecretKey.value());
    // 3. Retrieve the subscription to get the current item ID
    const stripeSub = await stripe.subscriptions.retrieve(stripeSubscriptionId, { stripeAccount: stripeAccountId });
    const currentItem = stripeSub.items.data[0];
    if (!currentItem) {
        throw new Error('Subscription has no items');
    }
    // 4. Create a new CTS price on the coach's connected account
    const ctsPrice = await stripe.prices.create({
        currency: 'usd',
        unit_amount: Math.round(ctsMonthlyRate * 100),
        recurring: { interval: 'month' },
        product_data: {
            name: 'GoArrive Coaching — Commit to Save Rate',
            metadata: { planId, memberId, coachId: coachId !== null && coachId !== void 0 ? coachId : '', type: 'cts' },
        },
    }, { stripeAccount: stripeAccountId });
    // 5. Update the subscription item to the CTS price
    await stripe.subscriptions.update(stripeSubscriptionId, {
        items: [
            {
                id: currentItem.id,
                price: ctsPrice.id,
            },
        ],
        proration_behavior: 'none', // No proration — CTS takes effect next billing cycle
        metadata: {
            ctsActivatedAt: new Date().toISOString(),
            consentId,
            ctsMonthlyRate: String(ctsMonthlyRate),
        },
    }, { stripeAccount: stripeAccountId });
    // 6. Mark consent as active
    await consentRef.update({
        status: 'active',
        activatedAt: firestore_2.FieldValue.serverTimestamp(),
        stripePriceId: ctsPrice.id,
        stripeSubscriptionId,
    });
    // 7. Update memberSubscription record (if we have a Firestore doc reference)
    if (subDocRef) {
        await subDocRef.update({
            ctsPriceId: ctsPrice.id,
            ctsActivatedAt: firestore_2.FieldValue.serverTimestamp(),
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        });
    }
    console.log('[activateCtsOptIn] CTS activated for member', memberId, 'plan', planId, 'subscription', stripeSubscriptionId, 'rate', ctsMonthlyRate);
    return { success: true };
});
// ── 8. addCoach — Admin-only: create a new coach account ─────────────────────
// Creates a Firebase Auth user, sets custom claims, and writes a coaches doc.
// Only callers with admin: true in their custom claims may invoke this.
exports.addCoach = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a, _b, _c, _d;
    // 1. Auth guard: caller must be signed in with admin claim
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const callerAdmin = ((_c = (_b = request.auth) === null || _b === void 0 ? void 0 : _b.token) === null || _c === void 0 ? void 0 : _c.admin) === true;
    if (!callerAdmin)
        throw new https_1.HttpsError('permission-denied', 'Admin access required');
    // 1b. Rate limit: max 10 coaches per hour per admin
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentCoaches = await db.collection('coaches')
        .where('createdBy', '==', callerUid)
        .where('createdAt', '>', oneHourAgo)
        .count().get();
    if (recentCoaches.data().count >= 10) {
        throw new https_1.HttpsError('resource-exhausted', 'Rate limit: max 10 coaches per hour');
    }
    // 2. Validate input
    const { email, displayName } = request.data;
    if (!email || !displayName) {
        throw new https_1.HttpsError('invalid-argument', 'email and displayName are required');
    }
    // 3. Create Firebase Auth user with a temporary password
    const tempPassword = `GA-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    let userRecord;
    try {
        userRecord = await admin.auth().createUser({
            email,
            displayName,
            password: tempPassword,
        });
    }
    catch (err) {
        if (err.code === 'auth/email-already-exists') {
            throw new https_1.HttpsError('already-exists', 'A user with this email already exists');
        }
        throw new https_1.HttpsError('internal', (_d = err.message) !== null && _d !== void 0 ? _d : 'Failed to create user');
    }
    const newCoachId = userRecord.uid;
    // 4. Set custom claims
    await admin.auth().setCustomUserClaims(newCoachId, {
        role: 'coach',
        coachId: newCoachId,
        tenantId: newCoachId,
    });
    // 5. Write coaches doc
    await db.collection('coaches').doc(newCoachId).set({
        uid: newCoachId,
        email,
        name: displayName,
        role: 'coach',
        createdAt: Date.now(),
        createdBy: callerUid,
    });
    // 6. Generate password reset link and send via Firebase's built-in email
    const appUrl = process.env.APP_BASE_URL || 'https://goarrive.fit';
    const actionCodeSettings = {
        url: appUrl,
        handleCodeInApp: false,
    };
    const resetLink = await admin.auth().generatePasswordResetLink(email, actionCodeSettings);
    console.log('[addCoach] Created coach', newCoachId, email, 'by', callerUid);
    return {
        success: true,
        coachId: newCoachId,
        email,
        displayName,
        resetLink,
    };
});
// ── 9. inviteCoach — Admin-only: generate a coach invite link ─────────────────
/**
 * Creates a coachInvites/{token} document and returns a shareable signup URL.
 * The invite is valid for 7 days and can only be used once.
 *
 * Input:  { email: string, displayName: string }
 * Output: { inviteUrl: string, token: string, expiresAt: number }
 */
exports.inviteCoach = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a, _b, _c;
    // Auth guard: caller must be signed in with admin claim
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const token = (_b = request.auth) === null || _b === void 0 ? void 0 : _b.token;
    const isAdmin = (token === null || token === void 0 ? void 0 : token.admin) === true || (token === null || token === void 0 ? void 0 : token.role) === 'platformAdmin';
    if (!isAdmin)
        throw new https_1.HttpsError('permission-denied', 'Admin access required');
    const { email, displayName } = request.data;
    if (!email || !displayName) {
        throw new https_1.HttpsError('invalid-argument', 'email and displayName are required');
    }
    // Check if email is already a registered user
    try {
        await admin.auth().getUserByEmail(email.trim().toLowerCase());
        throw new https_1.HttpsError('already-exists', 'A user with this email already exists.');
    }
    catch (err) {
        if (err.code === 'functions/already-exists')
            throw err;
        if (err.code !== 'auth/user-not-found') {
            throw new https_1.HttpsError('internal', (_c = err.message) !== null && _c !== void 0 ? _c : 'Failed to check email');
        }
    }
    // Expire any existing pending invites for this email
    const existingSnap = await db.collection('coachInvites')
        .where('email', '==', email.trim().toLowerCase())
        .where('status', '==', 'pending')
        .limit(10)
        .get();
    const batch = db.batch();
    existingSnap.forEach(doc => batch.update(doc.ref, { status: 'superseded' }));
    await batch.commit();
    // Generate a secure random token
    const crypto = require('crypto');
    const inviteToken = crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    await db.collection('coachInvites').doc(inviteToken).set({
        token: inviteToken,
        email: email.trim().toLowerCase(),
        displayName: displayName.trim(),
        status: 'pending',
        createdBy: callerUid,
        createdAt: firestore_2.FieldValue.serverTimestamp(),
        expiresAt,
    });
    const appUrl = process.env.APP_BASE_URL || 'https://goarrive.fit';
    const inviteUrl = `${appUrl}/coach-signup?token=${inviteToken}`;
    console.log('[inviteCoach] Invite created for', email, 'by', callerUid);
    return { inviteUrl, token: inviteToken, expiresAt };
});
// ── 10. activateCoachInvite — Called after signup to apply coach role ──────────
/**
 * Validates an invite token and sets coach custom claims on the newly-created user.
 * Called from the /coach-signup page after Firebase Auth account creation.
 *
 * Input:  { token: string }
 * Output: { success: boolean, coachId: string }
 */
exports.activateCoachInvite = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a, _b, _c;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { token } = request.data;
    if (!token)
        throw new https_1.HttpsError('invalid-argument', 'token is required');
    const inviteRef = db.collection('coachInvites').doc(token);
    const inviteSnap = await inviteRef.get();
    if (!inviteSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Invite not found. Please request a new invite link.');
    }
    const invite = inviteSnap.data();
    if (invite.status !== 'pending') {
        throw new https_1.HttpsError('failed-precondition', 'This invite link has already been used or expired.');
    }
    if (invite.expiresAt < Date.now()) {
        await inviteRef.update({ status: 'expired' });
        throw new https_1.HttpsError('deadline-exceeded', 'This invite link has expired. Please request a new one.');
    }
    // Verify the signed-in user's email matches the invite
    const userRecord = await admin.auth().getUser(callerUid);
    const userEmail = (_c = (_b = userRecord.email) === null || _b === void 0 ? void 0 : _b.toLowerCase()) !== null && _c !== void 0 ? _c : '';
    if (userEmail !== invite.email.toLowerCase()) {
        throw new https_1.HttpsError('permission-denied', `This invite is for ${invite.email}. Please sign in with that email address.`);
    }
    // Set custom claims: role = coach
    await admin.auth().setCustomUserClaims(callerUid, {
        role: 'coach',
        admin: false,
        coachId: callerUid,
        tenantId: callerUid,
    });
    // Write coaches doc
    await db.collection('coaches').doc(callerUid).set({
        uid: callerUid,
        email: userEmail,
        name: invite.displayName,
        role: 'coach',
        createdAt: Date.now(),
        invitedBy: invite.createdBy,
    });
    // Mark invite as used
    await inviteRef.update({
        status: 'used',
        usedAt: firestore_2.FieldValue.serverTimestamp(),
        usedBy: callerUid,
    });
    console.log('[activateCoachInvite] Coach activated:', callerUid, userEmail);
    return { success: true, coachId: callerUid };
});
/**
 * claimMemberAccount – Links a newly created Firebase Auth account to an
 * existing member doc (created by a coach via quick-add).
 *
 * Called by the shared-plan claim gate after the user creates their account.
 *
 * Input: { memberId: string }
 * Output: { success: boolean }
 */
exports.claimMemberAccount = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a, _b, _c;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { memberId } = request.data;
    if (!memberId)
        throw new https_1.HttpsError('invalid-argument', 'memberId is required');
    // Fetch the member doc
    const memberRef = db.collection('members').doc(memberId);
    const memberSnap = await memberRef.get();
    if (!memberSnap.exists) {
        throw new https_1.HttpsError('not-found', 'Member record not found.');
    }
    const member = memberSnap.data();
    // If the member already has an account, reject
    if (member.hasAccount === true && member.uid) {
        throw new https_1.HttpsError('already-exists', 'This member already has an account.');
    }
    // If the member has an email on file, verify it matches the caller's email
    const userRecord = await admin.auth().getUser(callerUid);
    const userEmail = (_c = (_b = userRecord.email) === null || _b === void 0 ? void 0 : _b.toLowerCase()) !== null && _c !== void 0 ? _c : '';
    if (member.email && member.email.toLowerCase() !== userEmail) {
        throw new https_1.HttpsError('permission-denied', `This plan belongs to ${member.email}. Please sign up with that email address.`);
    }
    // Set custom claims: role = member
    await admin.auth().setCustomUserClaims(callerUid, {
        role: 'member',
        coachId: member.coachId,
        tenantId: member.tenantId,
        memberId: memberId,
    });
    // Update the member doc to link the auth account
    await memberRef.update({
        uid: callerUid,
        hasAccount: true,
        email: userEmail || member.email || '',
        displayName: userRecord.displayName || member.name || '',
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
    });
    console.log('[claimMemberAccount] Member claimed:', callerUid, memberId);
    return { success: true };
});
// ═══════════════════════════════════════════════════════════════════════════════
// SCHEDULING BACKBONE — Recurring Slots, Session Instances, Zoom Allocation
// ═══════════════════════════════════════════════════════════════════════════════
//
// Architecture:
//   1. Coaches create recurring_slots for members (owned time rhythms)
//   2. generateUpcomingInstances runs on schedule to create session_instances
//   3. allocateSessionInstance assigns a Zoom room to each instance
//   4. Mock provider generates realistic-looking Zoom meeting data
//   5. Real Zoom provider is scaffolded for future OAuth activation
//
// Collections:
//   - zoom_rooms: Zoom host account resources
//   - recurring_slots: Member-owned recurring time slots
//   - session_instances: Concrete generated occurrences
//   - scheduling_audit_log: Audit trail for all scheduling decisions
// ═══════════════════════════════════════════════════════════════════════════════
// ─── Helper: Write session event to durable ledger ──────────────────────────
async function writeSessionEvent(event) {
    // Idempotency: if idempotencyKey is provided, check for duplicates
    if (event.idempotencyKey) {
        const existing = await db.collection('session_events')
            .where('idempotencyKey', '==', event.idempotencyKey)
            .limit(1)
            .get();
        if (!existing.empty) {
            console.log(`[SessionEvent] Duplicate skipped: ${event.idempotencyKey}`);
            return existing.docs[0].id;
        }
    }
    const ref = await db.collection('session_events').add(event);
    return ref.id;
}
// ─── Helper: Write audit log entry ───────────────────────────────────────────
async function writeAuditLog(entry) {
    await db.collection('scheduling_audit_log').add(Object.assign(Object.assign({}, entry), { createdAt: firestore_2.FieldValue.serverTimestamp() }));
}
// ─── 13. manageZoomRoom — Add/update/deactivate Zoom room resources ─────────
exports.manageZoomRoom = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const data = request.data;
    const action = data.action;
    const roomId = data.roomId;
    // Support both nested roomData and flat params (from AccountPanel)
    const roomData = data.roomData || {
        label: data.label,
        zoomAccountEmail: data.zoomAccountEmail,
        zoomUserId: data.zoomUserId,
        maxConcurrentMeetings: data.maxConcurrentMeetings,
        notes: data.notes,
        isPersonal: data.isPersonal,
    };
    if (!action)
        throw new https_1.HttpsError('invalid-argument', 'action is required');
    // Verify caller is a coach (by checking coaches collection or UID match)
    const coachId = callerUid;
    if (action === 'add') {
        if (!(roomData === null || roomData === void 0 ? void 0 : roomData.label) || !(roomData === null || roomData === void 0 ? void 0 : roomData.zoomAccountEmail)) {
            throw new https_1.HttpsError('invalid-argument', 'label and zoomAccountEmail are required');
        }
        const roomRef = db.collection('zoom_rooms').doc();
        // Check if a personal room already exists for this coach (avoid duplicates)
        if (roomData.isPersonal) {
            const existingPersonal = await db.collection('zoom_rooms')
                .where('coachId', '==', coachId)
                .where('isPersonal', '==', true)
                .get();
            if (!existingPersonal.empty) {
                // Update existing personal room instead of creating a new one
                const existingRef = existingPersonal.docs[0].ref;
                await existingRef.update({
                    label: roomData.label,
                    zoomAccountEmail: roomData.zoomAccountEmail,
                    status: 'active',
                    updatedAt: firestore_2.FieldValue.serverTimestamp(),
                });
                return { success: true, roomId: existingPersonal.docs[0].id, updated: true };
            }
        }
        const room = {
            coachId,
            label: roomData.label,
            zoomAccountEmail: roomData.zoomAccountEmail,
            zoomUserId: roomData.zoomUserId || '',
            status: 'active',
            maxConcurrentMeetings: roomData.maxConcurrentMeetings || 1,
            notes: roomData.notes || '',
            createdAt: firestore_2.FieldValue.serverTimestamp(),
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        };
        // Tag as personal room if specified
        if (roomData.isPersonal)
            room.isPersonal = true;
        await roomRef.set(room);
        await writeAuditLog({
            coachId,
            action: 'room_added',
            zoomRoomId: roomRef.id,
            details: `Added Zoom room "${roomData.label}" (${roomData.zoomAccountEmail})`,
        });
        console.log(`[manageZoomRoom] Added room ${roomRef.id} for coach ${coachId}`);
        return { success: true, roomId: roomRef.id };
    }
    if (!roomId)
        throw new https_1.HttpsError('invalid-argument', 'roomId is required for update/deactivate/activate');
    const roomRef = db.collection('zoom_rooms').doc(roomId);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists)
        throw new https_1.HttpsError('not-found', 'Zoom room not found');
    const existingRoom = roomSnap.data();
    if (existingRoom.coachId !== coachId) {
        throw new https_1.HttpsError('permission-denied', 'You can only manage your own Zoom rooms');
    }
    if (action === 'update') {
        const updates = { updatedAt: firestore_2.FieldValue.serverTimestamp() };
        if (roomData === null || roomData === void 0 ? void 0 : roomData.label)
            updates.label = roomData.label;
        if (roomData === null || roomData === void 0 ? void 0 : roomData.zoomAccountEmail)
            updates.zoomAccountEmail = roomData.zoomAccountEmail;
        if ((roomData === null || roomData === void 0 ? void 0 : roomData.zoomUserId) !== undefined)
            updates.zoomUserId = roomData.zoomUserId;
        if (roomData === null || roomData === void 0 ? void 0 : roomData.maxConcurrentMeetings)
            updates.maxConcurrentMeetings = roomData.maxConcurrentMeetings;
        if ((roomData === null || roomData === void 0 ? void 0 : roomData.notes) !== undefined)
            updates.notes = roomData.notes;
        await roomRef.update(updates);
        await writeAuditLog({
            coachId,
            action: 'room_updated',
            zoomRoomId: roomId,
            details: `Updated Zoom room "${existingRoom.label}"`,
            metadata: updates,
        });
        return { success: true };
    }
    if (action === 'deactivate') {
        await roomRef.update({ status: 'inactive', updatedAt: firestore_2.FieldValue.serverTimestamp() });
        await writeAuditLog({
            coachId,
            action: 'room_deactivated',
            zoomRoomId: roomId,
            details: `Deactivated Zoom room "${existingRoom.label}"`,
        });
        return { success: true };
    }
    if (action === 'activate') {
        await roomRef.update({ status: 'active', updatedAt: firestore_2.FieldValue.serverTimestamp() });
        await writeAuditLog({
            coachId,
            action: 'room_added',
            zoomRoomId: roomId,
            details: `Reactivated Zoom room "${existingRoom.label}"`,
        });
        return { success: true };
    }
    throw new https_1.HttpsError('invalid-argument', `Unknown action: ${action}`);
});
// ─── 14. createRecurringSlot — Coach assigns a recurring time slot to a member ──
exports.createRecurringSlot = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a, _b;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { memberId, memberName, dayOfWeek, startTime, durationMinutes, timezone, recurrencePattern, weekOfMonth, effectiveFrom, sessionType, guidancePhase, roomSource, coachJoining, liveCoachingStartMin, liveCoachingEndMin, liveCoachingDuration, hostingMode, coachExpectedLive, personalZoomRequired, transitionDate, transitionToPhase, commitToSaveEnabled } = request.data;
    if (!memberId || dayOfWeek === undefined || !startTime || !durationMinutes || !timezone) {
        throw new https_1.HttpsError('invalid-argument', 'memberId, dayOfWeek, startTime, durationMinutes, and timezone are required');
    }
    if (dayOfWeek < 0 || dayOfWeek > 6) {
        throw new https_1.HttpsError('invalid-argument', 'dayOfWeek must be 0-6 (Sunday-Saturday)');
    }
    const coachId = callerUid;
    // Verify the member belongs to this coach
    const memberSnap = await db.collection('members').doc(memberId).get();
    if (!memberSnap.exists)
        throw new https_1.HttpsError('not-found', 'Member not found');
    if (memberSnap.data().coachId !== coachId) {
        throw new https_1.HttpsError('permission-denied', 'This member does not belong to you');
    }
    // Server-side conflict detection: catch race conditions during slot creation
    if (guidancePhase !== 'self_guided') {
        const [ph, pm] = startTime.split(':').map(Number);
        const proposedStart = ph * 60 + pm;
        const proposedEnd = proposedStart + durationMinutes;
        const existingSlotsSnap = await db.collection('recurring_slots')
            .where('coachId', '==', coachId)
            .where('dayOfWeek', '==', dayOfWeek)
            .where('status', '==', 'active')
            .get();
        const serverConflicts = [];
        for (const sd of existingSlotsSnap.docs) {
            const s = sd.data();
            if (s.guidancePhase === 'self_guided')
                continue;
            const [sh, sm] = s.startTime.split(':').map(Number);
            const sStart = sh * 60 + sm;
            const sEnd = sStart + (s.durationMinutes || 30);
            if (proposedStart < sEnd && proposedEnd > sStart) {
                serverConflicts.push(`${s.memberName || 'another member'} at ${s.startTime}`);
            }
        }
        if (serverConflicts.length > 0) {
            console.warn(`[createRecurringSlot] Server-side conflict detected: ${serverConflicts.join(', ')}`);
            // Log the conflict but allow creation (coach was already warned client-side)
        }
        // ── Google Calendar conflict check ──────────────────────────────────────
        // Compute the next occurrence of dayOfWeek+startTime to use as the freebusy window
        try {
            const coachDocForGcal = await db.collection('coaches').doc(coachId).get();
            const coachDataForGcal = coachDocForGcal.data();
            const gcalAccounts = (coachDataForGcal === null || coachDataForGcal === void 0 ? void 0 : coachDataForGcal.gcalConflictAccounts) || [];
            const accountsWithCalendars = gcalAccounts.filter((a) => (a.selectedCalendarIds || []).length > 0 && !a.tokenExpired);
            if (accountsWithCalendars.length > 0) {
                // Find next occurrence of the target day of week
                const now = new Date();
                const daysUntil = ((dayOfWeek - now.getUTCDay()) + 7) % 7 || 7;
                const nextOccurrence = new Date(now);
                nextOccurrence.setUTCDate(now.getUTCDate() + daysUntil);
                const [ph2, pm2] = startTime.split(':').map(Number);
                nextOccurrence.setUTCHours(ph2, pm2, 0, 0);
                const slotEndTime = new Date(nextOccurrence.getTime() + durationMinutes * 60 * 1000);
                const startISO = nextOccurrence.toISOString();
                const endISO = slotEndTime.toISOString();
                const gcalConflicts = [];
                for (const account of accountsWithCalendars) {
                    try {
                        const oauth2ClientForCheck = getGoogleOAuth2Client();
                        oauth2ClientForCheck.setCredentials({ refresh_token: account.refreshToken });
                        const calendarApi = googleapis_1.google.calendar({ version: 'v3', auth: oauth2ClientForCheck });
                        const freebusyRes = await calendarApi.freebusy.query({
                            requestBody: {
                                timeMin: startISO,
                                timeMax: endISO,
                                timeZone: timezone || 'UTC',
                                items: account.selectedCalendarIds.map((id) => ({ id })),
                            },
                        });
                        const calendarsData = freebusyRes.data.calendars || {};
                        for (const calId of account.selectedCalendarIds) {
                            const busy = ((_b = calendarsData[calId]) === null || _b === void 0 ? void 0 : _b.busy) || [];
                            if (busy.length > 0) {
                                gcalConflicts.push(`${account.email} (${busy.length} event${busy.length > 1 ? 's' : ''})`);
                            }
                        }
                    }
                    catch (gcalErr) {
                        console.warn(`[createRecurringSlot] GCal conflict check failed for ${account.email}:`, gcalErr.message);
                    }
                }
                if (gcalConflicts.length > 0) {
                    console.warn(`[createRecurringSlot] Google Calendar conflicts detected: ${gcalConflicts.join(', ')}`);
                    // Log but allow creation — coach was warned client-side via checkGcalConflicts
                }
            }
        }
        catch (gcalCheckErr) {
            console.warn('[createRecurringSlot] GCal conflict check error (non-blocking):', gcalCheckErr.message);
        }
    }
    const slotRef = db.collection('recurring_slots').doc();
    const effectiveDate = effectiveFrom ? firestore_2.Timestamp.fromDate(new Date(effectiveFrom)) : firestore_2.Timestamp.now();
    // Determine room source from guidance phase if not explicitly provided
    // Shared Guidance and Self Guided always use shared pool (round-robin)
    const resolvedRoomSource = roomSource || (guidancePhase === 'coach_guided' ? 'coach_personal' : 'shared_pool');
    const slot = Object.assign(Object.assign({ coachId,
        memberId, memberName: memberName || memberSnap.data().name || 'Unknown', dayOfWeek,
        startTime,
        durationMinutes,
        timezone, recurrencePattern: recurrencePattern || 'weekly' }, (recurrencePattern === 'monthly' && weekOfMonth ? { weekOfMonth } : {})), { status: 'active', effectiveFrom: effectiveDate, createdAt: firestore_2.FieldValue.serverTimestamp(), updatedAt: firestore_2.FieldValue.serverTimestamp() });
    // Add phase-aware fields if provided
    if (sessionType)
        slot.sessionType = sessionType;
    if (guidancePhase)
        slot.guidancePhase = guidancePhase;
    slot.roomSource = resolvedRoomSource;
    if (coachJoining !== undefined)
        slot.coachJoining = coachJoining;
    // Live coaching window for shared_guidance phase
    if (liveCoachingStartMin !== undefined)
        slot.liveCoachingStartMin = liveCoachingStartMin;
    if (liveCoachingEndMin !== undefined)
        slot.liveCoachingEndMin = liveCoachingEndMin;
    if (liveCoachingDuration !== undefined)
        slot.liveCoachingDuration = liveCoachingDuration;
    // Prompt 2: Guidance-aware hosting fields
    // Derive hostingMode from guidancePhase if not explicitly provided
    const resolvedHostingMode = hostingMode || (guidancePhase === 'coach_guided' ? 'coach_led' : 'hosted');
    slot.hostingMode = resolvedHostingMode;
    // Coach is expected live for coach_guided (always) and shared_guidance (has live window)
    const resolvedCoachExpectedLive = coachExpectedLive !== undefined ? coachExpectedLive :
        (guidancePhase === 'coach_guided' ? true : guidancePhase === 'shared_guidance' ? true : false);
    slot.coachExpectedLive = resolvedCoachExpectedLive;
    slot.personalZoomRequired = personalZoomRequired !== undefined ? personalZoomRequired :
        (resolvedRoomSource === 'coach_personal');
    if (transitionDate)
        slot.transitionDate = transitionDate;
    if (transitionToPhase)
        slot.transitionToPhase = transitionToPhase;
    if (commitToSaveEnabled !== undefined)
        slot.commitToSaveEnabled = commitToSaveEnabled;
    await slotRef.set(slot);
    await writeAuditLog({
        coachId,
        action: 'slot_created',
        recurringSlotId: slotRef.id,
        memberId,
        details: `Created recurring slot for ${memberName || 'member'}: day ${dayOfWeek}, ${startTime}, ${durationMinutes}min, ${recurrencePattern || 'weekly'}${recurrencePattern === 'monthly' && weekOfMonth ? ` (${weekOfMonth}${weekOfMonth === 1 ? 'st' : weekOfMonth === 2 ? 'nd' : weekOfMonth === 3 ? 'rd' : 'th'})` : ''}`,
    });
    // Immediately generate instances for the next 4 weeks for this slot
    const instances = generateInstancesForSlot(slot, slotRef.id, 28);
    for (const inst of instances) {
        const instRef = db.collection('session_instances').doc();
        await instRef.set(Object.assign(Object.assign({}, inst), { id: instRef.id }));
    }
    console.log(`[createRecurringSlot] Created slot ${slotRef.id} with ${instances.length} instances for coach ${coachId}`);
    return { success: true, slotId: slotRef.id, instancesGenerated: instances.length };
});
// ─── 15. updateRecurringSlot — Pause/cancel/modify a recurring slot ──────────
exports.updateRecurringSlot = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { slotId, action: slotAction } = request.data;
    if (!slotId || !slotAction)
        throw new https_1.HttpsError('invalid-argument', 'slotId and action are required');
    const slotRef = db.collection('recurring_slots').doc(slotId);
    const slotSnap = await slotRef.get();
    if (!slotSnap.exists)
        throw new https_1.HttpsError('not-found', 'Recurring slot not found');
    const slot = slotSnap.data();
    if (slot.coachId !== callerUid) {
        throw new https_1.HttpsError('permission-denied', 'You can only manage your own slots');
    }
    if (slotAction === 'pause') {
        await slotRef.update({ status: 'paused', updatedAt: firestore_2.FieldValue.serverTimestamp() });
        await writeAuditLog({
            coachId: callerUid,
            action: 'slot_paused',
            recurringSlotId: slotId,
            memberId: slot.memberId,
            details: `Paused recurring slot for ${slot.memberName}`,
        });
        return { success: true };
    }
    if (slotAction === 'resume') {
        await slotRef.update({ status: 'active', updatedAt: firestore_2.FieldValue.serverTimestamp() });
        return { success: true };
    }
    if (slotAction === 'cancel') {
        await slotRef.update({ status: 'cancelled', updatedAt: firestore_2.FieldValue.serverTimestamp() });
        // Cancel all future scheduled/allocated instances
        const futureInstances = await db.collection('session_instances')
            .where('recurringSlotId', '==', slotId)
            .where('status', 'in', ['scheduled', 'allocated'])
            .get();
        const batch = db.batch();
        futureInstances.docs.forEach(d => {
            batch.update(d.ref, { status: 'cancelled', updatedAt: firestore_2.FieldValue.serverTimestamp() });
        });
        await batch.commit();
        await writeAuditLog({
            coachId: callerUid,
            action: 'slot_cancelled',
            recurringSlotId: slotId,
            memberId: slot.memberId,
            details: `Cancelled recurring slot for ${slot.memberName}. ${futureInstances.size} future instances cancelled.`,
        });
        return { success: true, instancesCancelled: futureInstances.size };
    }
    if (slotAction === 'update') {
        // Accept all scheduling fields directly on request.data
        const d = request.data;
        const slotUpdates = { updatedAt: firestore_2.FieldValue.serverTimestamp() };
        if (d.dayOfWeek !== undefined)
            slotUpdates.dayOfWeek = d.dayOfWeek;
        if (d.startTime)
            slotUpdates.startTime = d.startTime;
        if (d.durationMinutes)
            slotUpdates.durationMinutes = d.durationMinutes;
        if (d.timezone)
            slotUpdates.timezone = d.timezone;
        if (d.recurrencePattern)
            slotUpdates.recurrencePattern = d.recurrencePattern;
        if (d.weekOfMonth !== undefined)
            slotUpdates.weekOfMonth = d.weekOfMonth;
        if (d.sessionType)
            slotUpdates.sessionType = d.sessionType;
        if (d.guidancePhase)
            slotUpdates.guidancePhase = d.guidancePhase;
        if (d.roomSource)
            slotUpdates.roomSource = d.roomSource;
        if (d.coachJoining !== undefined)
            slotUpdates.coachJoining = d.coachJoining;
        if (d.hostingMode)
            slotUpdates.hostingMode = d.hostingMode;
        if (d.coachExpectedLive !== undefined)
            slotUpdates.coachExpectedLive = d.coachExpectedLive;
        if (d.personalZoomRequired !== undefined)
            slotUpdates.personalZoomRequired = d.personalZoomRequired;
        if (d.liveCoachingStartMin !== undefined)
            slotUpdates.liveCoachingStartMin = d.liveCoachingStartMin;
        if (d.liveCoachingEndMin !== undefined)
            slotUpdates.liveCoachingEndMin = d.liveCoachingEndMin;
        if (d.liveCoachingDuration !== undefined)
            slotUpdates.liveCoachingDuration = d.liveCoachingDuration;
        if (d.commitToSaveEnabled !== undefined)
            slotUpdates.commitToSaveEnabled = d.commitToSaveEnabled;
        await slotRef.update(slotUpdates);
        // Cancel future scheduled/allocated instances and regenerate
        const futureInstances = await db.collection('session_instances')
            .where('recurringSlotId', '==', slotId)
            .where('status', 'in', ['scheduled', 'allocated'])
            .get();
        const batch = db.batch();
        futureInstances.docs.forEach(doc => {
            batch.update(doc.ref, { status: 'cancelled', updatedAt: firestore_2.FieldValue.serverTimestamp() });
        });
        await batch.commit();
        // Regenerate instances with updated slot data
        const updatedSlotSnap = await slotRef.get();
        const updatedSlot = updatedSlotSnap.data();
        const newInstances = generateInstancesForSlot(updatedSlot, slotId, 28);
        for (const inst of newInstances) {
            const instRef = db.collection('session_instances').doc();
            await instRef.set(Object.assign(Object.assign({}, inst), { id: instRef.id }));
        }
        await writeAuditLog({
            coachId: callerUid,
            action: 'slot_updated',
            recurringSlotId: slotId,
            memberId: slot.memberId,
            details: `Updated recurring slot for ${slot.memberName}. ${futureInstances.size} old instances cancelled, ${newInstances.length} new instances generated.`,
        });
        return { success: true, updatedInstances: newInstances.length };
    }
    // Item 2: Skip instance (recurring exception dates)
    if (slotAction === 'skip_instance') {
        const { instanceId, reason, skipCategory } = request.data;
        if (!instanceId)
            throw new https_1.HttpsError('invalid-argument', 'instanceId is required for skip');
        const instRef = db.collection('session_instances').doc(instanceId);
        const instSnap = await instRef.get();
        if (!instSnap.exists)
            throw new https_1.HttpsError('not-found', 'Instance not found');
        const inst = instSnap.data();
        if (inst.recurringSlotId !== slotId && inst.slotId !== slotId) {
            throw new https_1.HttpsError('permission-denied', 'Instance does not belong to this slot');
        }
        if (!['scheduled', 'allocated', 'allocation_failed'].includes(inst.status)) {
            throw new https_1.HttpsError('failed-precondition', 'Can only skip future scheduled instances');
        }
        const VALID_SKIP_CATEGORIES = ['Holiday', 'Vacation', 'Illness', 'Coach Unavailable', 'Other'];
        const resolvedCategory = skipCategory && VALID_SKIP_CATEGORIES.includes(skipCategory) ? skipCategory : 'Other';
        await instRef.update({
            status: 'skipped',
            skipCategory: resolvedCategory,
            skipReason: reason || (resolvedCategory !== 'Other' ? resolvedCategory : 'Coach skipped'),
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        });
        await writeAuditLog({
            coachId: callerUid,
            action: 'instance_skipped',
            recurringSlotId: slotId,
            memberId: slot.memberId,
            details: `Skipped instance on ${inst.scheduledDate} [${resolvedCategory}]${reason ? ': ' + reason : ''}`,
        });
        return { success: true };
    }
    // Item 7: Update instance notes
    if (slotAction === 'update_instance_notes') {
        const { instanceId, notes: instanceNotes } = request.data;
        if (!instanceId)
            throw new https_1.HttpsError('invalid-argument', 'instanceId is required');
        const instRef = db.collection('session_instances').doc(instanceId);
        const instSnap = await instRef.get();
        if (!instSnap.exists)
            throw new https_1.HttpsError('not-found', 'Instance not found');
        const inst = instSnap.data();
        if (inst.recurringSlotId !== slotId && inst.slotId !== slotId) {
            throw new https_1.HttpsError('permission-denied', 'Instance does not belong to this slot');
        }
        await instRef.update({
            coachNotes: instanceNotes || '',
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        });
        return { success: true };
    }
    if (slotAction === 'reschedule_instance') {
        const { instanceId, newDate, newTime } = request.data;
        if (!instanceId || !newDate) {
            throw new https_1.HttpsError('invalid-argument', 'instanceId and newDate are required for reschedule');
        }
        const instRef = db.collection('session_instances').doc(instanceId);
        const instSnap = await instRef.get();
        if (!instSnap.exists)
            throw new https_1.HttpsError('not-found', 'Instance not found');
        const inst = instSnap.data();
        if (inst.recurringSlotId !== slotId && inst.slotId !== slotId) {
            throw new https_1.HttpsError('permission-denied', 'Instance does not belong to this slot');
        }
        // Conflict detection for rescheduled instances
        const rescheduleTime = newTime || inst.scheduledStartTime || inst.startTime || '00:00';
        const [rh, rm] = rescheduleTime.split(':').map(Number);
        const rStart = rh * 60 + rm;
        const rEnd = rStart + (inst.durationMinutes || 30);
        const guidancePhase = inst.guidancePhase || slot.guidancePhase;
        if (guidancePhase !== 'self_guided') {
            const conflictSnap = await db.collection('session_instances')
                .where('coachId', '==', callerUid)
                .where('scheduledDate', '==', newDate)
                .where('status', 'in', ['scheduled', 'allocated'])
                .get();
            for (const cDoc of conflictSnap.docs) {
                if (cDoc.id === instanceId)
                    continue;
                const c = cDoc.data();
                const cPhase = c.guidancePhase;
                if (cPhase === 'self_guided')
                    continue;
                const [ch, cm] = (c.scheduledStartTime || c.startTime || '00:00').split(':').map(Number);
                const cStart = ch * 60 + cm;
                const cEnd = cStart + (c.durationMinutes || 30);
                if (rStart < cEnd && rEnd > cStart) {
                    throw new https_1.HttpsError('already-exists', `Conflict: ${c.memberName || 'another member'} has a session at ${c.scheduledStartTime || c.startTime} on ${newDate}. Choose a different time.`);
                }
            }
        }
        const updateData = {
            scheduledDate: newDate,
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
            rescheduled: true,
            originalDate: inst.scheduledDate,
        };
        if (newTime)
            updateData.startTime = newTime;
        await instRef.update(updateData);
        await writeAuditLog({
            coachId: callerUid,
            action: 'instance_rescheduled',
            recurringSlotId: slotId,
            memberId: slot.memberId,
            details: `Rescheduled instance from ${inst.scheduledDate} to ${newDate}`,
        });
        return { success: true };
    }
    // Member self-skip: coach approves or denies a pending skip request
    if (slotAction === 'approve_skip_request') {
        const { instanceId } = request.data;
        if (!instanceId)
            throw new https_1.HttpsError('invalid-argument', 'instanceId is required');
        const instRef = db.collection('session_instances').doc(instanceId);
        const instSnap = await instRef.get();
        if (!instSnap.exists)
            throw new https_1.HttpsError('not-found', 'Instance not found');
        const inst = instSnap.data();
        if (inst.recurringSlotId !== slotId && inst.slotId !== slotId) {
            throw new https_1.HttpsError('permission-denied', 'Instance does not belong to this slot');
        }
        if (inst.status !== 'skip_requested') {
            throw new https_1.HttpsError('failed-precondition', 'Instance is not in skip_requested status');
        }
        await instRef.update({
            status: 'skipped',
            skipCategory: inst.skipCategory || 'Other',
            skipReason: inst.skipReason || 'Member requested skip (approved)',
            skipApprovedBy: callerUid,
            skipApprovedAt: firestore_2.FieldValue.serverTimestamp(),
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        });
        await writeAuditLog({
            coachId: callerUid,
            action: 'skip_request_approved',
            recurringSlotId: slotId,
            memberId: slot.memberId,
            details: `Approved member skip request for ${inst.scheduledDate} [${inst.skipCategory || 'Other'}]`,
        });
        // Push notification to member
        try {
            const { sendNotification } = await Promise.resolve().then(() => __importStar(require('./notifications')));
            const memberSnap = await db.collection('members').doc(slot.memberId).get();
            const memberData = memberSnap.exists ? memberSnap.data() : {};
            await sendNotification({
                messageType: 'skip_request_resolved',
                channel: 'push',
                recipient: {
                    uid: slot.memberId,
                    email: memberData.email,
                    displayName: memberData.displayName || 'Member',
                    role: 'member',
                },
                subject: 'Skip Request Approved',
                body: `Your skip request for ${inst.scheduledDate} has been approved by your coach.`,
                sessionInstanceId: instanceId,
                coachId: callerUid,
                memberId: slot.memberId,
            });
        }
        catch (err) {
            console.warn(`[approve_skip_request] Failed to send notification: ${err.message}`);
        }
        return { success: true };
    }
    if (slotAction === 'deny_skip_request') {
        const { instanceId } = request.data;
        if (!instanceId)
            throw new https_1.HttpsError('invalid-argument', 'instanceId is required');
        const instRef = db.collection('session_instances').doc(instanceId);
        const instSnap = await instRef.get();
        if (!instSnap.exists)
            throw new https_1.HttpsError('not-found', 'Instance not found');
        const inst = instSnap.data();
        if (inst.recurringSlotId !== slotId && inst.slotId !== slotId) {
            throw new https_1.HttpsError('permission-denied', 'Instance does not belong to this slot');
        }
        if (inst.status !== 'skip_requested') {
            throw new https_1.HttpsError('failed-precondition', 'Instance is not in skip_requested status');
        }
        // Restore to previous status (allocated or scheduled)
        const restoreStatus = inst.previousStatus || 'scheduled';
        await instRef.update({
            status: restoreStatus,
            skipCategory: firestore_2.FieldValue.delete(),
            skipReason: firestore_2.FieldValue.delete(),
            skipRequestedAt: firestore_2.FieldValue.delete(),
            skipRequestedBy: firestore_2.FieldValue.delete(),
            previousStatus: firestore_2.FieldValue.delete(),
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        });
        await writeAuditLog({
            coachId: callerUid,
            action: 'skip_request_denied',
            recurringSlotId: slotId,
            memberId: slot.memberId,
            details: `Denied member skip request for ${inst.scheduledDate}`,
        });
        // Push notification to member
        try {
            const { sendNotification } = await Promise.resolve().then(() => __importStar(require('./notifications')));
            const memberSnap = await db.collection('members').doc(slot.memberId).get();
            const memberData = memberSnap.exists ? memberSnap.data() : {};
            await sendNotification({
                messageType: 'skip_request_resolved',
                channel: 'push',
                recipient: {
                    uid: slot.memberId,
                    email: memberData.email,
                    displayName: memberData.displayName || 'Member',
                    role: 'member',
                },
                subject: 'Skip Request Denied',
                body: `Your skip request for ${inst.scheduledDate} has been denied. The session remains on your schedule.`,
                sessionInstanceId: instanceId,
                coachId: callerUid,
                memberId: slot.memberId,
            });
        }
        catch (err) {
            console.warn(`[deny_skip_request] Failed to send notification: ${err.message}`);
        }
        return { success: true };
    }
    throw new https_1.HttpsError('invalid-argument', `Unknown action: ${slotAction}`);
});
// ─── Helper: Generate concrete instances from a recurring slot ───────────────
function generateInstancesForSlot(slot, slotId, daysAhead) {
    const instances = [];
    const now = new Date();
    const endDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    // ── Monthly recurrence: find Nth occurrence of dayOfWeek in each month ──
    if (slot.recurrencePattern === 'monthly' && slot.weekOfMonth) {
        const weekNum = slot.weekOfMonth; // 1-4
        // Start from current month
        let month = now.getMonth();
        let year = now.getFullYear();
        // Check up to 4 months ahead to cover daysAhead window
        for (let i = 0; i < 4; i++) {
            // Find the Nth occurrence of dayOfWeek in this month
            const firstOfMonth = new Date(year, month, 1);
            let dayOffset = (slot.dayOfWeek - firstOfMonth.getDay() + 7) % 7;
            const nthDate = new Date(year, month, 1 + dayOffset + (weekNum - 1) * 7);
            // Verify it's still in the same month
            if (nthDate.getMonth() === month && nthDate >= now && nthDate <= endDate) {
                const dateStr = nthDate.toISOString().split('T')[0];
                const [h, m] = slot.startTime.split(':').map(Number);
                const endMinutes = h * 60 + m + slot.durationMinutes;
                const endH = Math.floor(endMinutes / 60) % 24;
                const endM = endMinutes % 60;
                const endTime = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
                const inst = {
                    coachId: slot.coachId, memberId: slot.memberId, memberName: slot.memberName || 'Unknown',
                    recurringSlotId: slotId, scheduledDate: dateStr, scheduledStartTime: slot.startTime,
                    scheduledEndTime: endTime, durationMinutes: slot.durationMinutes, timezone: slot.timezone,
                    status: 'scheduled', allocationAttempts: 0,
                    createdAt: firestore_2.FieldValue.serverTimestamp(), updatedAt: firestore_2.FieldValue.serverTimestamp(),
                };
                if (slot.sessionType)
                    inst.sessionType = slot.sessionType;
                if (slot.guidancePhase)
                    inst.guidancePhase = slot.guidancePhase;
                if (slot.roomSource)
                    inst.roomSource = slot.roomSource;
                if (slot.coachJoining !== undefined)
                    inst.coachJoining = slot.coachJoining;
                if (slot.liveCoachingStartMin !== undefined)
                    inst.liveCoachingStartMin = slot.liveCoachingStartMin;
                if (slot.liveCoachingEndMin !== undefined)
                    inst.liveCoachingEndMin = slot.liveCoachingEndMin;
                if (slot.liveCoachingDuration !== undefined)
                    inst.liveCoachingDuration = slot.liveCoachingDuration;
                // Prompt 2: Propagate guidance-aware hosting fields
                if (slot.hostingMode)
                    inst.hostingMode = slot.hostingMode;
                if (slot.coachExpectedLive !== undefined)
                    inst.coachExpectedLive = slot.coachExpectedLive;
                if (slot.personalZoomRequired !== undefined)
                    inst.personalZoomRequired = slot.personalZoomRequired;
                if (slot.commitToSaveEnabled !== undefined)
                    inst.commitToSaveEnabled = slot.commitToSaveEnabled;
                instances.push(inst);
            }
            month++;
            if (month > 11) {
                month = 0;
                year++;
            }
        }
        return instances;
    }
    // ── Weekly / Biweekly recurrence ──
    // Find the next occurrence of the target day of week
    let current = new Date(now);
    current.setHours(0, 0, 0, 0);
    // Advance to the next target day
    while (current.getDay() !== slot.dayOfWeek) {
        current.setDate(current.getDate() + 1);
    }
    // If today is the target day but the time has passed, skip to next week
    if (current.getTime() === new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
        const [h, m] = slot.startTime.split(':').map(Number);
        const slotTimeToday = new Date(now);
        slotTimeToday.setHours(h, m, 0, 0);
        if (now > slotTimeToday) {
            current.setDate(current.getDate() + (slot.recurrencePattern === 'biweekly' ? 14 : 7));
        }
    }
    const step = slot.recurrencePattern === 'biweekly' ? 14 : 7;
    while (current <= endDate) {
        const dateStr = current.toISOString().split('T')[0]; // YYYY-MM-DD
        const [h, m] = slot.startTime.split(':').map(Number);
        const endMinutes = h * 60 + m + slot.durationMinutes;
        const endH = Math.floor(endMinutes / 60) % 24;
        const endM = endMinutes % 60;
        const endTime = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
        const inst = {
            coachId: slot.coachId,
            memberId: slot.memberId,
            memberName: slot.memberName || 'Unknown',
            recurringSlotId: slotId,
            scheduledDate: dateStr,
            scheduledStartTime: slot.startTime,
            scheduledEndTime: endTime,
            durationMinutes: slot.durationMinutes,
            timezone: slot.timezone,
            status: 'scheduled',
            allocationAttempts: 0,
            createdAt: firestore_2.FieldValue.serverTimestamp(),
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        };
        // Propagate phase-aware fields from slot to instance
        if (slot.sessionType)
            inst.sessionType = slot.sessionType;
        if (slot.guidancePhase)
            inst.guidancePhase = slot.guidancePhase;
        if (slot.roomSource)
            inst.roomSource = slot.roomSource;
        if (slot.coachJoining !== undefined)
            inst.coachJoining = slot.coachJoining;
        if (slot.liveCoachingStartMin !== undefined)
            inst.liveCoachingStartMin = slot.liveCoachingStartMin;
        if (slot.liveCoachingEndMin !== undefined)
            inst.liveCoachingEndMin = slot.liveCoachingEndMin;
        if (slot.liveCoachingDuration !== undefined)
            inst.liveCoachingDuration = slot.liveCoachingDuration;
        // Prompt 2: Propagate guidance-aware hosting fields
        if (slot.hostingMode)
            inst.hostingMode = slot.hostingMode;
        if (slot.coachExpectedLive !== undefined)
            inst.coachExpectedLive = slot.coachExpectedLive;
        if (slot.personalZoomRequired !== undefined)
            inst.personalZoomRequired = slot.personalZoomRequired;
        if (slot.commitToSaveEnabled !== undefined)
            inst.commitToSaveEnabled = slot.commitToSaveEnabled;
        instances.push(inst);
        current.setDate(current.getDate() + step);
    }
    return instances;
}
// ─── 16. generateUpcomingInstances — Scheduled: generate instances for all active slots ──
exports.generateUpcomingInstances = (0, scheduler_1.onSchedule)({ schedule: '0 2 * * *', timeZone: 'UTC', region: 'us-central1' }, async () => {
    console.log('[generateUpcomingInstances] Starting daily instance generation...');
    // Get all active recurring slots
    const slotsSnap = await db.collection('recurring_slots')
        .where('status', '==', 'active')
        .get();
    let totalGenerated = 0;
    for (const slotDoc of slotsSnap.docs) {
        const slot = slotDoc.data();
        // Check what instances already exist for this slot in the next 28 days
        const now = new Date();
        const futureDate = new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000);
        const futureDateStr = futureDate.toISOString().split('T')[0];
        const existingSnap = await db.collection('session_instances')
            .where('recurringSlotId', '==', slotDoc.id)
            .where('scheduledDate', '>=', now.toISOString().split('T')[0])
            .where('scheduledDate', '<=', futureDateStr)
            .get();
        const existingDates = new Set(existingSnap.docs.map(d => d.data().scheduledDate));
        // Generate instances for missing dates
        const allInstances = generateInstancesForSlot(slot, slotDoc.id, 28);
        const newInstances = allInstances.filter(inst => !existingDates.has(inst.scheduledDate));
        for (const inst of newInstances) {
            const instRef = db.collection('session_instances').doc();
            await instRef.set(Object.assign(Object.assign({}, inst), { id: instRef.id }));
            totalGenerated++;
        }
    }
    console.log(`[generateUpcomingInstances] Generated ${totalGenerated} new instances for ${slotsSnap.size} active slots`);
});
// ─── 17. allocateSessionInstance — Assign a Zoom room to a session instance ──
exports.allocateSessionInstance = (0, https_1.onCall)({ region: 'us-central1', secrets: [zoomAccountId, zoomClientId, zoomClientSecret, emailApiKey, twilioAccountSid, twilioAuthToken, twilioFromNumber] }, async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { instanceId } = request.data;
    if (!instanceId)
        throw new https_1.HttpsError('invalid-argument', 'instanceId is required');
    const instanceRef = db.collection('session_instances').doc(instanceId);
    const instanceSnap = await instanceRef.get();
    if (!instanceSnap.exists)
        throw new https_1.HttpsError('not-found', 'Session instance not found');
    const instance = instanceSnap.data();
    if (instance.coachId !== callerUid) {
        throw new https_1.HttpsError('permission-denied', 'You can only allocate your own sessions');
    }
    if (instance.status !== 'scheduled' && instance.status !== 'allocation_failed') {
        throw new https_1.HttpsError('failed-precondition', `Instance is in status "${instance.status}", cannot allocate`);
    }
    // Phase-aware room routing:
    //   coach_personal → use coach's personal Zoom room (tagged isPersonal: true)
    //   shared_pool    → round-robin from shared pool rooms (isPersonal !== true)
    //   (no roomSource) → legacy behavior: try all active rooms
    const roomSource = instance.roomSource || '';
    let roomQuery = db.collection('zoom_rooms')
        .where('coachId', '==', callerUid)
        .where('status', '==', 'active');
    const roomsSnap = await roomQuery.get();
    // Filter rooms based on roomSource
    let candidateRooms = roomsSnap.docs;
    if (roomSource === 'coach_personal') {
        // Prefer rooms tagged as personal; fall back to all if none tagged
        const personalRooms = candidateRooms.filter(d => d.data().isPersonal === true);
        if (personalRooms.length > 0)
            candidateRooms = personalRooms;
    }
    else if (roomSource === 'shared_pool') {
        // Prefer rooms NOT tagged as personal; fall back to all if none
        const poolRooms = candidateRooms.filter(d => d.data().isPersonal !== true);
        if (poolRooms.length > 0)
            candidateRooms = poolRooms;
    }
    if (candidateRooms.length === 0) {
        const reason = roomSource === 'coach_personal'
            ? 'No personal Zoom room configured. Add your Zoom in Settings.'
            : roomSource === 'shared_pool'
                ? 'No shared pool rooms available.'
                : 'No active Zoom rooms available.';
        await instanceRef.update({
            status: 'allocation_failed',
            allocationFailReason: reason,
            allocationAttempts: (instance.allocationAttempts || 0) + 1,
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        });
        await writeAuditLog({
            coachId: callerUid,
            action: 'allocation_failed',
            sessionInstanceId: instanceId,
            details: reason,
        });
        return { success: false, reason };
    }
    // Check each candidate room for conflicts at the same date/time
    const scheduledDate = instance.scheduledDate;
    const scheduledStartTime = instance.scheduledStartTime;
    const scheduledEndTime = instance.scheduledEndTime;
    let allocatedRoom = null;
    for (const roomDoc of candidateRooms) {
        const room = roomDoc.data();
        // Check for overlapping instances already allocated to this room
        const conflictsSnap = await db.collection('session_instances')
            .where('zoomRoomId', '==', roomDoc.id)
            .where('scheduledDate', '==', scheduledDate)
            .where('status', 'in', ['allocated', 'in_progress'])
            .get();
        let hasConflict = false;
        for (const conflictDoc of conflictsSnap.docs) {
            const conflict = conflictDoc.data();
            if (scheduledStartTime < conflict.scheduledEndTime && scheduledEndTime > conflict.scheduledStartTime) {
                hasConflict = true;
                await writeAuditLog({
                    coachId: callerUid,
                    action: 'room_conflict',
                    sessionInstanceId: instanceId,
                    zoomRoomId: roomDoc.id,
                    details: `Room "${room.label}" has conflict at ${scheduledDate} ${scheduledStartTime}-${scheduledEndTime} (existing: ${conflict.scheduledStartTime}-${conflict.scheduledEndTime})`,
                });
                break;
            }
        }
        if (!hasConflict) {
            allocatedRoom = Object.assign({ id: roomDoc.id }, room);
            break;
        }
    }
    if (!allocatedRoom) {
        await instanceRef.update({
            status: 'allocation_failed',
            allocationFailReason: 'All candidate Zoom rooms have conflicts at this time',
            allocationAttempts: (instance.allocationAttempts || 0) + 1,
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        });
        await writeAuditLog({
            coachId: callerUid,
            action: 'allocation_failed',
            sessionInstanceId: instanceId,
            details: `All ${candidateRooms.length} candidate rooms (source: ${roomSource || 'any'}) have conflicts at ${scheduledDate} ${scheduledStartTime}`,
        });
        return { success: false, reason: 'All candidate Zoom rooms have conflicts at this time' };
    }
    // Create Zoom meeting via provider (real or mock based on config)
    const memberName = instance.memberName || 'Member';
    const zoomProvider = (0, zoom_1.getZoomProvider)({ accountId: zoomAccountId.value(), clientId: zoomClientId.value(), clientSecret: zoomClientSecret.value() });
    let meeting;
    try {
        meeting = await zoomProvider.createMeeting({
            topic: `GoArrive Session: ${memberName}`,
            startTime: `${scheduledDate}T${scheduledStartTime}:00`,
            duration: instance.durationMinutes,
            timezone: 'America/New_York',
            hostEmail: allocatedRoom.zoomAccountEmail,
        });
    }
    catch (err) {
        // Meeting creation failed — log event and mark allocation failed
        await writeSessionEvent({
            occurrenceId: instanceId,
            eventType: 'meeting_creation_failed',
            source: 'system',
            providerMode: zoomProvider.mode,
            timestamp: firestore_2.FieldValue.serverTimestamp(),
            payload: { error: err.message, roomId: allocatedRoom.id },
        });
        await instanceRef.update({
            status: 'allocation_failed',
            allocationFailReason: `Zoom meeting creation failed: ${err.message}`,
            allocationAttempts: (instance.allocationAttempts || 0) + 1,
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        });
        return { success: false, reason: `Zoom meeting creation failed: ${err.message}` };
    }
    // Update the instance with allocation data
    await instanceRef.update({
        status: 'allocated',
        zoomRoomId: allocatedRoom.id,
        zoomRoomLabel: allocatedRoom.label,
        zoomMeetingId: meeting.meetingId,
        zoomMeetingUuid: meeting.uuid || null,
        zoomJoinUrl: meeting.joinUrl,
        zoomStartUrl: meeting.startUrl,
        zoomMeetingPassword: meeting.password,
        zoomProviderMode: zoomProvider.mode,
        allocatedAt: firestore_2.FieldValue.serverTimestamp(),
        allocationAttempts: (instance.allocationAttempts || 0) + 1,
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
    });
    // Write session event for traceability
    await writeSessionEvent({
        occurrenceId: instanceId,
        eventType: 'meeting_created',
        source: 'system',
        providerMode: zoomProvider.mode,
        zoomMeetingId: meeting.meetingId,
        zoomMeetingUuid: meeting.uuid,
        timestamp: firestore_2.FieldValue.serverTimestamp(),
        payload: { roomId: allocatedRoom.id, roomLabel: allocatedRoom.label, joinUrl: meeting.joinUrl },
    });
    await writeAuditLog({
        coachId: callerUid,
        action: 'allocation_success',
        sessionInstanceId: instanceId,
        zoomRoomId: allocatedRoom.id,
        memberId: instance.memberId,
        details: `Allocated room "${allocatedRoom.label}" for ${memberName} at ${scheduledDate} ${scheduledStartTime} [${zoomProvider.mode}]`,
        metadata: { meetingId: meeting.meetingId, providerMode: zoomProvider.mode },
    });
    // Prompt 4: Create reminder jobs after successful allocation
    try {
        await (0, reminders_1.createRemindersForInstance)({
            id: instanceId,
            date: scheduledDate,
            startTime: scheduledStartTime,
            sessionType: instance.sessionType || '',
            memberId: instance.memberId,
            coachId: instance.coachId,
            memberName: memberName,
            coachName: instance.coachName || '',
            guidancePhase: instance.guidancePhase || '',
            joinUrl: meeting.joinUrl,
            hostingMode: instance.hostingMode || '',
            coachExpectedLive: instance.coachExpectedLive,
        });
    }
    catch (err) {
        console.warn(`[allocateSessionInstance] Reminder creation failed for ${instanceId}: ${err.message}`);
    }
    console.log(`[allocateSessionInstance] Allocated room ${allocatedRoom.id} to instance ${instanceId} [${zoomProvider.mode}]`);
    return { success: true, roomLabel: allocatedRoom.label, meetingId: meeting.meetingId, providerMode: zoomProvider.mode };
});
// ─── 18. allocateAllPendingInstances — Batch allocate all unallocated instances ──
exports.allocateAllPendingInstances = (0, https_1.onCall)({ region: 'us-central1', secrets: [zoomAccountId, zoomClientId, zoomClientSecret, emailApiKey, twilioAccountSid, twilioAuthToken, twilioFromNumber] }, async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    // Get all scheduled (unallocated) instances for this coach
    const pendingSnap = await db.collection('session_instances')
        .where('coachId', '==', callerUid)
        .where('status', '==', 'scheduled')
        .get();
    if (pendingSnap.empty) {
        return { success: true, allocated: 0, failed: 0, message: 'No pending instances to allocate' };
    }
    // Get all active Zoom rooms for this coach
    const roomsSnap = await db.collection('zoom_rooms')
        .where('coachId', '==', callerUid)
        .where('status', '==', 'active')
        .get();
    if (roomsSnap.empty) {
        return { success: false, allocated: 0, failed: pendingSnap.size, message: 'No active Zoom rooms available' };
    }
    let allocated = 0;
    let failed = 0;
    // Sort instances by date/time for orderly allocation
    const instances = pendingSnap.docs
        .map(d => (Object.assign({ id: d.id }, d.data())))
        .sort((a, b) => {
        const dateCompare = a.scheduledDate.localeCompare(b.scheduledDate);
        if (dateCompare !== 0)
            return dateCompare;
        return a.scheduledStartTime.localeCompare(b.scheduledStartTime);
    });
    for (const inst of instances) {
        const instance = inst;
        let roomFound = false;
        for (const roomDoc of roomsSnap.docs) {
            const room = roomDoc.data();
            // Check for conflicts
            const conflictsSnap = await db.collection('session_instances')
                .where('zoomRoomId', '==', roomDoc.id)
                .where('scheduledDate', '==', instance.scheduledDate)
                .where('status', 'in', ['allocated', 'in_progress'])
                .get();
            let hasConflict = false;
            for (const conflictDoc of conflictsSnap.docs) {
                const conflict = conflictDoc.data();
                if (instance.scheduledStartTime < conflict.scheduledEndTime && instance.scheduledEndTime > conflict.scheduledStartTime) {
                    hasConflict = true;
                    break;
                }
            }
            if (!hasConflict) {
                const batchProvider = (0, zoom_1.getZoomProvider)({ accountId: zoomAccountId.value(), clientId: zoomClientId.value(), clientSecret: zoomClientSecret.value() });
                try {
                    const meeting = await batchProvider.createMeeting({
                        topic: `GoArrive Session: ${instance.memberName || 'Member'}`,
                        startTime: `${instance.scheduledDate}T${instance.scheduledStartTime}:00`,
                        duration: instance.durationMinutes,
                        timezone: 'America/New_York',
                        hostEmail: room.zoomAccountEmail,
                    });
                    await db.collection('session_instances').doc(instance.id).update({
                        status: 'allocated',
                        zoomRoomId: roomDoc.id,
                        zoomRoomLabel: room.label,
                        zoomMeetingId: meeting.meetingId,
                        zoomMeetingUuid: meeting.uuid || null,
                        zoomJoinUrl: meeting.joinUrl,
                        zoomStartUrl: meeting.startUrl,
                        zoomMeetingPassword: meeting.password,
                        zoomProviderMode: batchProvider.mode,
                        allocatedAt: firestore_2.FieldValue.serverTimestamp(),
                        allocationAttempts: (instance.allocationAttempts || 0) + 1,
                        updatedAt: firestore_2.FieldValue.serverTimestamp(),
                    });
                    await writeSessionEvent({
                        occurrenceId: instance.id,
                        eventType: 'meeting_created',
                        source: 'system',
                        providerMode: batchProvider.mode,
                        zoomMeetingId: meeting.meetingId,
                        zoomMeetingUuid: meeting.uuid,
                        timestamp: firestore_2.FieldValue.serverTimestamp(),
                        payload: { roomId: roomDoc.id, batch: true },
                    });
                    allocated++;
                    roomFound = true;
                }
                catch (err) {
                    await writeSessionEvent({
                        occurrenceId: instance.id,
                        eventType: 'meeting_creation_failed',
                        source: 'system',
                        providerMode: batchProvider.mode,
                        timestamp: firestore_2.FieldValue.serverTimestamp(),
                        payload: { error: err.message, roomId: roomDoc.id, batch: true },
                    });
                    // Continue trying other rooms
                }
                if (roomFound)
                    break;
            }
        }
        if (!roomFound) {
            await db.collection('session_instances').doc(instance.id).update({
                status: 'allocation_failed',
                allocationFailReason: 'All rooms have conflicts',
                allocationAttempts: (instance.allocationAttempts || 0) + 1,
                updatedAt: firestore_2.FieldValue.serverTimestamp(),
            });
            failed++;
        }
    }
    await writeAuditLog({
        coachId: callerUid,
        action: 'allocation_success',
        details: `Batch allocation: ${allocated} allocated, ${failed} failed out of ${instances.length} pending`,
    });
    console.log(`[allocateAllPendingInstances] Coach ${callerUid}: ${allocated} allocated, ${failed} failed`);
    return { success: true, allocated, failed, total: instances.length };
});
// ─── 19. rescheduleInstance — Move a single occurrence to a different date/time ──
exports.rescheduleInstance = (0, https_1.onCall)({ region: 'us-central1', secrets: [zoomAccountId, zoomClientId, zoomClientSecret, emailApiKey, twilioAccountSid, twilioAuthToken, twilioFromNumber] }, async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { instanceId, newDate, newStartTime } = request.data;
    if (!instanceId || !newDate || !newStartTime) {
        throw new https_1.HttpsError('invalid-argument', 'instanceId, newDate, and newStartTime are required');
    }
    const instanceRef = db.collection('session_instances').doc(instanceId);
    const instanceSnap = await instanceRef.get();
    if (!instanceSnap.exists)
        throw new https_1.HttpsError('not-found', 'Session instance not found');
    const instance = instanceSnap.data();
    if (instance.coachId !== callerUid && instance.memberId !== callerUid) {
        throw new https_1.HttpsError('permission-denied', 'You can only reschedule your own sessions');
    }
    const rescheduleSource = (instance.memberId === callerUid) ? 'member_action' : 'coach_action';
    if (!['scheduled', 'allocated', 'allocation_failed'].includes(instance.status)) {
        throw new https_1.HttpsError('failed-precondition', `Cannot reschedule instance in status "${instance.status}"`);
    }
    const originalDate = instance.scheduledDate;
    const originalTime = instance.scheduledStartTime;
    const existingMeetingId = instance.zoomMeetingId;
    // Delete existing Zoom meeting if one was allocated
    if (existingMeetingId) {
        const provider = (0, zoom_1.getZoomProvider)({ accountId: zoomAccountId.value(), clientId: zoomClientId.value(), clientSecret: zoomClientSecret.value() });
        try {
            await provider.deleteMeeting(existingMeetingId);
            await writeSessionEvent({
                occurrenceId: instanceId,
                eventType: 'meeting_deleted',
                source: rescheduleSource,
                providerMode: provider.mode,
                zoomMeetingId: existingMeetingId,
                timestamp: firestore_2.FieldValue.serverTimestamp(),
                payload: { reason: 'reschedule' },
            });
        }
        catch (err) {
            console.warn(`[rescheduleInstance] Failed to delete Zoom meeting ${existingMeetingId}: ${err.message}`);
        }
    }
    // Calculate new end time
    const [h, m] = newStartTime.split(':').map(Number);
    const endMinutes = h * 60 + m + instance.durationMinutes;
    const endH = Math.floor(endMinutes / 60) % 24;
    const endM = endMinutes % 60;
    const newEndTime = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;
    await instanceRef.update({
        scheduledDate: newDate,
        scheduledStartTime: newStartTime,
        scheduledEndTime: newEndTime,
        status: 'scheduled', // Reset to scheduled so it can be re-allocated
        zoomRoomId: firestore_2.FieldValue.delete(),
        zoomRoomLabel: firestore_2.FieldValue.delete(),
        zoomMeetingId: firestore_2.FieldValue.delete(),
        zoomMeetingUuid: firestore_2.FieldValue.delete(),
        zoomJoinUrl: firestore_2.FieldValue.delete(),
        zoomStartUrl: firestore_2.FieldValue.delete(),
        zoomMeetingPassword: firestore_2.FieldValue.delete(),
        zoomProviderMode: firestore_2.FieldValue.delete(),
        allocatedAt: firestore_2.FieldValue.delete(),
        rescheduledFrom: `${originalDate} ${originalTime}`,
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
    });
    await writeSessionEvent({
        occurrenceId: instanceId,
        eventType: 'session_rescheduled',
        source: rescheduleSource,
        providerMode: existingMeetingId ? (0, zoom_1.getZoomProvider)({ accountId: zoomAccountId.value(), clientId: zoomClientId.value(), clientSecret: zoomClientSecret.value() }).mode : 'mock',
        timestamp: firestore_2.FieldValue.serverTimestamp(),
        payload: { from: `${originalDate} ${originalTime}`, to: `${newDate} ${newStartTime}` },
    });
    // Prompt 4: Cancel old reminders (new ones created on re-allocation)
    try {
        const canceledCount = await (0, reminders_1.cancelRemindersForInstance)(instanceId);
        console.log(`[rescheduleInstance] Canceled ${canceledCount} old reminder(s) for ${instanceId}`);
    }
    catch (err) {
        console.warn(`[rescheduleInstance] Reminder cancellation failed for ${instanceId}: ${err.message}`);
    }
    await writeAuditLog({
        coachId: callerUid,
        action: 'instance_rescheduled',
        sessionInstanceId: instanceId,
        memberId: instance.memberId,
        details: `Rescheduled from ${originalDate} ${originalTime} to ${newDate} ${newStartTime}`,
    });
    return { success: true };
});
// ─── 20. cancelInstance — Cancel a single session instance ───────────────────
exports.cancelInstance = (0, https_1.onCall)({ region: 'us-central1', secrets: [zoomAccountId, zoomClientId, zoomClientSecret] }, async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { instanceId } = request.data;
    if (!instanceId)
        throw new https_1.HttpsError('invalid-argument', 'instanceId is required');
    const instanceRef = db.collection('session_instances').doc(instanceId);
    const instanceSnap = await instanceRef.get();
    if (!instanceSnap.exists)
        throw new https_1.HttpsError('not-found', 'Session instance not found');
    const instance = instanceSnap.data();
    if (instance.coachId !== callerUid && instance.memberId !== callerUid) {
        throw new https_1.HttpsError('permission-denied', 'You can only cancel your own sessions');
    }
    const cancelSource = (instance.memberId === callerUid) ? 'member_action' : 'coach_action';
    // Delete existing Zoom meeting if one was allocated
    const cancelMeetingId = instance.zoomMeetingId;
    if (cancelMeetingId) {
        const provider = (0, zoom_1.getZoomProvider)({ accountId: zoomAccountId.value(), clientId: zoomClientId.value(), clientSecret: zoomClientSecret.value() });
        try {
            await provider.deleteMeeting(cancelMeetingId);
            await writeSessionEvent({
                occurrenceId: instanceId,
                eventType: 'meeting_deleted',
                source: cancelSource,
                providerMode: provider.mode,
                zoomMeetingId: cancelMeetingId,
                timestamp: firestore_2.FieldValue.serverTimestamp(),
                payload: { reason: 'cancellation' },
            });
        }
        catch (err) {
            console.warn(`[cancelInstance] Failed to delete Zoom meeting ${cancelMeetingId}: ${err.message}`);
        }
    }
    await instanceRef.update({
        status: 'cancelled',
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
    });
    await writeSessionEvent({
        occurrenceId: instanceId,
        eventType: 'session_cancelled',
        source: cancelSource,
        providerMode: cancelMeetingId ? (0, zoom_1.getZoomProvider)({ accountId: zoomAccountId.value(), clientId: zoomClientId.value(), clientSecret: zoomClientSecret.value() }).mode : 'mock',
        timestamp: firestore_2.FieldValue.serverTimestamp(),
        payload: { meetingId: cancelMeetingId || null },
    });
    // Prompt 4: Cancel pending reminders for this instance
    try {
        const canceledCount = await (0, reminders_1.cancelRemindersForInstance)(instanceId);
        console.log(`[cancelInstance] Canceled ${canceledCount} reminder(s) for ${instanceId}`);
    }
    catch (err) {
        console.warn(`[cancelInstance] Reminder cancellation failed for ${instanceId}: ${err.message}`);
    }
    await writeAuditLog({
        coachId: callerUid,
        action: 'instance_cancelled',
        sessionInstanceId: instanceId,
        memberId: instance.memberId,
        details: `Cancelled session for ${instance.memberName} on ${instance.scheduledDate} at ${instance.scheduledStartTime}`,
    });
    return { success: true };
});
// ─── 21. zoomWebhook — Handle Zoom webhook events ──────────────────────────
// Handles: meeting.started, meeting.ended, meeting.participant_joined,
//          meeting.participant_left, recording.completed
// CRC validation for Zoom endpoint verification is handled inline.
// ────────────────────────────────────────────────────────────────────────────
const ZOOM_WEBHOOK_SECRET = (0, params_1.defineSecret)('ZOOM_WEBHOOK_SECRET');
exports.zoomWebhook = (0, https_1.onRequest)({ region: 'us-central1', secrets: [ZOOM_WEBHOOK_SECRET] }, async (req, res) => {
    var _a, _b, _c, _d, _e, _f;
    // Only accept POST
    if (req.method !== 'POST') {
        res.status(405).send('Method Not Allowed');
        return;
    }
    const body = req.body;
    // ── CRC validation (Zoom endpoint verification) ──
    if (body.event === 'endpoint.url_validation') {
        const plainToken = (_a = body.payload) === null || _a === void 0 ? void 0 : _a.plainToken;
        const secret = ZOOM_WEBHOOK_SECRET.value();
        if (!plainToken || !secret) {
            res.status(400).json({ error: 'Missing plainToken or secret' });
            return;
        }
        const response = (0, zoom_1.generateCrcResponse)(plainToken, secret);
        res.status(200).json(response);
        return;
    }
    // ── Signature verification ──
    const signature = req.headers['x-zm-signature'];
    const timestamp = req.headers['x-zm-request-timestamp'];
    const secret = ZOOM_WEBHOOK_SECRET.value();
    if (!signature || !timestamp || !secret) {
        console.warn('[zoomWebhook] Missing signature, timestamp, or secret');
        res.status(401).send('Unauthorized');
        return;
    }
    const rawBody = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    if (!(0, zoom_1.verifyWebhookSignature)(signature, timestamp, rawBody, secret)) {
        console.warn('[zoomWebhook] Invalid webhook signature');
        res.status(401).send('Invalid signature');
        return;
    }
    // ── Event processing ──
    const eventType = body.event;
    const payload = ((_b = body.payload) === null || _b === void 0 ? void 0 : _b.object) || {};
    const meetingId = String(payload.id || '');
    const meetingUuid = payload.uuid || '';
    // Build idempotency key from event + meeting + timestamp
    const idempotencyKey = `zoom_${eventType}_${meetingId}_${timestamp}`;
    // Find the session instance linked to this Zoom meeting
    let occurrenceId = null;
    if (meetingId) {
        const instanceSnap = await db.collection('session_instances')
            .where('zoomMeetingId', '==', meetingId)
            .limit(1)
            .get();
        if (!instanceSnap.empty) {
            occurrenceId = instanceSnap.docs[0].id;
        }
    }
    switch (eventType) {
        case 'meeting.started': {
            if (occurrenceId) {
                await db.collection('session_instances').doc(occurrenceId).update({
                    status: 'in_progress',
                    actualStartTime: payload.start_time || null,
                    updatedAt: firestore_2.FieldValue.serverTimestamp(),
                });
            }
            await writeSessionEvent({
                occurrenceId: occurrenceId || `unlinked_${meetingId}`,
                eventType: 'meeting_started',
                source: 'zoom_webhook',
                providerMode: 'live',
                zoomMeetingId: meetingId,
                zoomMeetingUuid: meetingUuid,
                timestamp: firestore_2.FieldValue.serverTimestamp(),
                idempotencyKey,
                payload: { startTime: payload.start_time },
            });
            break;
        }
        case 'meeting.ended': {
            if (occurrenceId) {
                await db.collection('session_instances').doc(occurrenceId).update({
                    status: 'completed',
                    actualEndTime: payload.end_time || null,
                    updatedAt: firestore_2.FieldValue.serverTimestamp(),
                });
            }
            await writeSessionEvent({
                occurrenceId: occurrenceId || `unlinked_${meetingId}`,
                eventType: 'meeting_ended',
                source: 'zoom_webhook',
                providerMode: 'live',
                zoomMeetingId: meetingId,
                zoomMeetingUuid: meetingUuid,
                timestamp: firestore_2.FieldValue.serverTimestamp(),
                idempotencyKey,
                payload: { endTime: payload.end_time, duration: payload.duration },
            });
            break;
        }
        case 'meeting.participant_joined': {
            const participant = ((_d = (_c = body.payload) === null || _c === void 0 ? void 0 : _c.object) === null || _d === void 0 ? void 0 : _d.participant) || {};
            await writeSessionEvent({
                occurrenceId: occurrenceId || `unlinked_${meetingId}`,
                eventType: 'participant_joined',
                source: 'zoom_webhook',
                providerMode: 'live',
                zoomMeetingId: meetingId,
                zoomMeetingUuid: meetingUuid,
                timestamp: firestore_2.FieldValue.serverTimestamp(),
                idempotencyKey: `zoom_pj_${meetingId}_${participant.id}_${timestamp}`,
                payload: {
                    participantId: participant.id,
                    participantName: participant.user_name,
                    participantEmail: participant.email,
                    joinTime: participant.join_time,
                },
            });
            // Update attendance on the instance
            if (occurrenceId) {
                await db.collection('session_instances').doc(occurrenceId).update({
                    [`attendance.${participant.id || participant.user_name}`]: {
                        name: participant.user_name,
                        email: participant.email,
                        joinTime: participant.join_time,
                    },
                    updatedAt: firestore_2.FieldValue.serverTimestamp(),
                });
            }
            break;
        }
        case 'meeting.participant_left': {
            const leftParticipant = ((_f = (_e = body.payload) === null || _e === void 0 ? void 0 : _e.object) === null || _f === void 0 ? void 0 : _f.participant) || {};
            await writeSessionEvent({
                occurrenceId: occurrenceId || `unlinked_${meetingId}`,
                eventType: 'participant_left',
                source: 'zoom_webhook',
                providerMode: 'live',
                zoomMeetingId: meetingId,
                zoomMeetingUuid: meetingUuid,
                timestamp: firestore_2.FieldValue.serverTimestamp(),
                idempotencyKey: `zoom_pl_${meetingId}_${leftParticipant.id}_${timestamp}`,
                payload: {
                    participantId: leftParticipant.id,
                    participantName: leftParticipant.user_name,
                    leaveTime: leftParticipant.leave_time,
                },
            });
            // Update attendance leave time on the instance
            if (occurrenceId) {
                const pKey = leftParticipant.id || leftParticipant.user_name;
                await db.collection('session_instances').doc(occurrenceId).update({
                    [`attendance.${pKey}.leaveTime`]: leftParticipant.leave_time,
                    updatedAt: firestore_2.FieldValue.serverTimestamp(),
                });
            }
            break;
        }
        case 'recording.completed': {
            const recordingFiles = payload.recording_files || [];
            const recordings = recordingFiles.map((f) => ({
                fileType: f.file_type,
                fileSize: f.file_size,
                downloadUrl: f.download_url,
                playUrl: f.play_url,
                recordingStart: f.recording_start,
                recordingEnd: f.recording_end,
                status: f.status,
            }));
            await writeSessionEvent({
                occurrenceId: occurrenceId || `unlinked_${meetingId}`,
                eventType: 'recording_completed',
                source: 'zoom_webhook',
                providerMode: 'live',
                zoomMeetingId: meetingId,
                zoomMeetingUuid: meetingUuid,
                timestamp: firestore_2.FieldValue.serverTimestamp(),
                idempotencyKey,
                payload: { recordingCount: recordings.length, recordings },
            });
            // Store recordings on the instance + Zoom recording URL for direct access
            const zoomRecordingUrl = payload.share_url || (recordingFiles.length > 0 ? recordingFiles[0].play_url : null);
            // Extract transcription data if available
            const transcriptFiles = recordingFiles.filter((f) => f.file_type === 'TRANSCRIPT' || f.recording_type === 'audio_transcript');
            const transcripts = transcriptFiles.map((f) => ({
                downloadUrl: f.download_url,
                fileType: f.file_type,
                status: f.status,
            }));
            if (occurrenceId) {
                const recUpdate = {
                    recordings,
                    recordingAvailable: true,
                    recordingCompletedAt: firestore_2.FieldValue.serverTimestamp(),
                    updatedAt: firestore_2.FieldValue.serverTimestamp(),
                };
                if (zoomRecordingUrl)
                    recUpdate.zoomRecordingUrl = zoomRecordingUrl;
                if (transcripts.length > 0)
                    recUpdate.transcripts = transcripts;
                await db.collection('session_instances').doc(occurrenceId).update(recUpdate);
            }
            break;
        }
        default: {
            // Log unhandled events for future expansion
            await writeSessionEvent({
                occurrenceId: occurrenceId || `unlinked_${meetingId}`,
                eventType: `zoom_unhandled_${eventType}`,
                source: 'zoom_webhook',
                providerMode: 'live',
                zoomMeetingId: meetingId,
                zoomMeetingUuid: meetingUuid,
                timestamp: firestore_2.FieldValue.serverTimestamp(),
                idempotencyKey,
                payload: body,
            });
            break;
        }
    }
    console.log(`[zoomWebhook] Processed ${eventType} for meeting ${meetingId} (instance: ${occurrenceId || 'unlinked'})`);
    res.status(200).json({ status: 'ok' });
});
// ─── Prompt 4: Admin Operations & Communications Layer ──────────────────────
// Provider health, reminder scheduler, dead-letter handling, event log, iCal feed
// ─────────────────────────────────────────────────────────────────────────────
const notifications_1 = require("./notifications");
const reminders_1 = require("./reminders");
const zoom_2 = require("./zoom");
// ─── 22. getSystemHealth — Provider health check for admin dashboard ────────
exports.getSystemHealth = (0, https_1.onCall)({ region: 'us-central1', secrets: [zoomAccountId, zoomClientId, zoomClientSecret, emailApiKey, twilioAccountSid, twilioAuthToken, twilioFromNumber] }, async () => {
    var _a, _b, _c;
    // Reset cached providers so health check reflects current secret availability
    (0, notifications_1.resetNotificationProviders)();
    const zoomProvider = (0, zoom_1.getZoomProvider)({ accountId: zoomAccountId.value(), clientId: zoomClientId.value(), clientSecret: zoomClientSecret.value() });
    const notifHealth = (0, notifications_1.getProviderHealth)();
    // Count recent dead-letter items
    const dlSnap = await db.collection('dead_letter')
        .where('resolved', '==', false)
        .limit(200)
        .get();
    // Count reminder stats for today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayTs = firestore_2.Timestamp.fromDate(todayStart);
    const reminderSnap = await db.collection('reminder_jobs')
        .where('createdAt', '>=', todayTs)
        .limit(500)
        .get();
    const reminderStats = { scheduled: 0, sent: 0, failed: 0, skipped: 0, canceled: 0, total: 0 };
    reminderSnap.docs.forEach(d => {
        const s = d.data().status;
        reminderStats.total++;
        if (s === 'scheduled')
            reminderStats.scheduled++;
        else if (s === 'sent')
            reminderStats.sent++;
        else if (s === 'failed')
            reminderStats.failed++;
        else if (s === 'skipped')
            reminderStats.skipped++;
        else if (s === 'canceled')
            reminderStats.canceled++;
    });
    // Count notification stats for today
    const notifSnap = await db.collection('notification_log')
        .where('createdAt', '>=', todayTs)
        .limit(500)
        .get();
    const notifStats = { pending: 0, sent: 0, failed: 0, total: 0 };
    notifSnap.docs.forEach(d => {
        const s = d.data().status;
        notifStats.total++;
        if (s === 'pending')
            notifStats.pending++;
        else if (s === 'sent')
            notifStats.sent++;
        else if (s === 'failed')
            notifStats.failed++;
    });
    // Zoom health details
    const zoomMode = zoomProvider instanceof zoom_2.MockZoomProvider ? 'mock' : 'live';
    const zoomName = zoomProvider instanceof zoom_2.MockZoomProvider ? 'MockZoomProvider' : 'RealZoomProvider (S2S OAuth)';
    const zoomCredentials = {
        accountId: !!process.env.ZOOM_ACCOUNT_ID,
        clientId: !!process.env.ZOOM_CLIENT_ID,
        clientSecret: !!process.env.ZOOM_CLIENT_SECRET,
        webhookSecret: !!process.env.ZOOM_WEBHOOK_SECRET,
    };
    // Attempt lightweight Zoom API call if live
    let zoomApiReachable = null;
    if (zoomMode === 'live') {
        try {
            // Try to get a meeting that doesn't exist — a 404 means API is reachable
            await zoomProvider.getMeeting('health-check-nonexistent');
            zoomApiReachable = true;
        }
        catch (err) {
            // A 404 or 400 means the API is reachable; only network errors mean unreachable
            if (((_a = err.message) === null || _a === void 0 ? void 0 : _a.includes('404')) || ((_b = err.message) === null || _b === void 0 ? void 0 : _b.includes('400')) || ((_c = err.message) === null || _c === void 0 ? void 0 : _c.includes('not found'))) {
                zoomApiReachable = true;
            }
            else {
                zoomApiReachable = false;
            }
        }
    }
    return {
        zoom: {
            mode: zoomMode,
            name: zoomName,
            credentials: zoomCredentials,
            apiReachable: zoomApiReachable,
        },
        notifications: notifHealth,
        deadLetterCount: dlSnap.size,
        reminderStats,
        notificationStats: notifStats,
        timestamp: new Date().toISOString(),
    };
});
// ─── 23. processReminders — Scheduled: process due reminder jobs every 5 min ──
exports.processReminders = (0, scheduler_1.onSchedule)({ schedule: 'every 5 minutes', timeZone: 'UTC', region: 'us-central1', secrets: [emailApiKey, twilioAccountSid, twilioAuthToken, twilioFromNumber] }, async () => {
    console.log('[processReminders] Starting reminder processing cycle');
    const stats = await (0, reminders_1.processDueReminders)();
    console.log(`[processReminders] Done: ${stats.processed} processed, ${stats.sent} sent, ${stats.failed} failed, ${stats.skipped} skipped`);
});
// ─── 24. retryDeadLetter — Admin: retry a specific dead-letter item ─────────
exports.retryDeadLetter = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a, _b;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { deadLetterId } = request.data;
    if (!deadLetterId)
        throw new https_1.HttpsError('invalid-argument', 'deadLetterId required');
    const dlRef = db.collection('dead_letter').doc(deadLetterId);
    const dlSnap = await dlRef.get();
    if (!dlSnap.exists)
        throw new https_1.HttpsError('not-found', 'Dead letter item not found');
    const dl = dlSnap.data();
    if (dl.resolved)
        throw new https_1.HttpsError('failed-precondition', 'Already resolved');
    const dlType = dl.type;
    try {
        if (dlType === 'notification_delivery_failed' && dl.sourceId) {
            const notifSnap = await db.collection('notification_log').doc(dl.sourceId).get();
            if (notifSnap.exists) {
                const notif = notifSnap.data();
                await (0, notifications_1.sendNotification)({
                    messageType: notif.messageType,
                    channel: notif.channel,
                    recipient: notif.recipient,
                    subject: notif.subject,
                    body: notif.body,
                    htmlBody: notif.htmlBody,
                    sessionInstanceId: notif.sessionInstanceId,
                    coachId: notif.coachId,
                    memberId: notif.memberId,
                });
            }
        }
        else if (dlType === 'reminder_processing_failed' && dl.sourceId) {
            const jobRef = db.collection('reminder_jobs').doc(dl.sourceId);
            await jobRef.update({ status: 'scheduled' });
        }
        else if (dlType === 'allocation_failed' && ((_b = dl.payload) === null || _b === void 0 ? void 0 : _b.instanceId)) {
            const instanceRef = db.collection('session_instances').doc(dl.payload.instanceId);
            await instanceRef.update({ status: 'scheduled' });
        }
        await dlRef.update({
            resolved: true,
            resolvedAt: firestore_2.Timestamp.now(),
            resolvedBy: callerUid,
        });
        return { success: true };
    }
    catch (err) {
        await dlRef.update({
            retryCount: (dl.retryCount || 0) + 1,
            lastRetryAt: firestore_2.Timestamp.now(),
            lastRetryError: err.message || String(err),
        });
        throw new https_1.HttpsError('internal', `Retry failed: ${err.message}`);
    }
});
// ─── 25. getDeadLetterItems — Admin: list unresolved dead-letter items ──────
exports.getDeadLetterItems = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { limit: maxItems = 50, includeResolved = false } = request.data || {};
    let query = db.collection('dead_letter')
        .orderBy('createdAt', 'desc')
        .limit(maxItems);
    if (!includeResolved) {
        query = query.where('resolved', '==', false);
    }
    const snap = await query.get();
    return snap.docs.map(d => (Object.assign({ id: d.id }, d.data())));
});
// ─── 26. getSessionEventLog — Admin: list session events with filters ───────
exports.getSessionEventLog = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { sessionInstanceId, eventType, limit: maxItems = 50 } = request.data || {};
    let query = db.collection('session_events')
        .orderBy('timestamp', 'desc')
        .limit(maxItems);
    if (sessionInstanceId) {
        query = query.where('sessionInstanceId', '==', sessionInstanceId);
    }
    if (eventType) {
        query = query.where('eventType', '==', eventType);
    }
    const snap = await query.get();
    return snap.docs.map(d => (Object.assign({ id: d.id }, d.data())));
});
// ─── 27. coachIcalFeed — HTTP: iCal feed for coach-live sessions ────────────
exports.coachIcalFeed = (0, https_1.onRequest)({ region: 'us-central1' }, async (req, res) => {
    const coachId = req.query.coachId;
    const token = req.query.token;
    if (!coachId) {
        res.status(400).send('Missing coachId');
        return;
    }
    // Token-based authentication: check coach document for icalToken
    // If no token stored yet, fall back to legacy base64 prefix for backward compat
    const coachDoc = await db.collection('coaches').doc(coachId).get();
    if (!coachDoc.exists) {
        res.status(404).send('Coach not found');
        return;
    }
    const coachData = coachDoc.data();
    const storedToken = coachData.icalToken;
    if (storedToken) {
        // Use the stored regenerable token
        if (token !== storedToken) {
            res.status(403).send('Invalid token');
            return;
        }
    }
    else {
        // Legacy fallback: base64 prefix
        const legacyToken = Buffer.from(coachId).toString('base64').substring(0, 16);
        if (token !== legacyToken) {
            res.status(403).send('Invalid token');
            return;
        }
    }
    // Item 9: Fetch ALL upcoming sessions (not just coach-live) for full calendar sync
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    const futureDate = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    const futureStr = futureDate.toISOString().split('T')[0];
    const snap = await db.collection('session_instances')
        .where('coachId', '==', coachId)
        .where('scheduledDate', '>=', todayStr)
        .where('scheduledDate', '<=', futureStr)
        .where('status', 'in', ['scheduled', 'allocated', 'in_progress'])
        .orderBy('scheduledDate', 'asc')
        .limit(500)
        .get();
    // Build iCal
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//GoArrive//Session Calendar//EN',
        'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH',
        'X-WR-CALNAME:GoArrive Coach Sessions',
    ];
    for (const doc of snap.docs) {
        const d = doc.data();
        const [year, month, day] = d.scheduledDate.split('-').map(Number);
        const [hours, mins] = d.scheduledStartTime.split(':').map(Number);
        const duration = d.liveCoachingDuration || d.durationMinutes || 60;
        const startOffset = d.liveCoachingStartMin || 0;
        const startDate = new Date(year, month - 1, day, hours, mins);
        startDate.setMinutes(startDate.getMinutes() + startOffset);
        const endDate = new Date(startDate.getTime() + duration * 60 * 1000);
        const formatIcalDate = (dt) => {
            return dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        };
        const memberName = d.memberName || 'Member';
        const sessionType = d.sessionType ? d.sessionType.charAt(0).toUpperCase() + d.sessionType.slice(1) : 'Session';
        const phase = d.guidancePhase === 'coach_guided' ? 'Fully Guided' :
            d.guidancePhase === 'shared_guidance' ? 'Shared Guidance' :
                d.guidancePhase === 'self_guided' ? 'Self-Reliant' : 'Session';
        const coachLive = d.coachExpectedLive ? ' [LIVE]' : '';
        const cts = d.commitToSaveEnabled ? ' [CTS]' : '';
        lines.push('BEGIN:VEVENT');
        lines.push(`UID:${doc.id}@goarrive.fit`);
        lines.push(`DTSTART:${formatIcalDate(startDate)}`);
        lines.push(`DTEND:${formatIcalDate(endDate)}`);
        lines.push(`SUMMARY:${sessionType} — ${memberName}${coachLive}${cts}`);
        const descParts = [
            `${sessionType} session with ${memberName}`,
            `Phase: ${phase}`,
            `Duration: ${d.durationMinutes || 30} min`,
            d.coachExpectedLive ? `Coach live: ${d.liveCoachingDuration || d.durationMinutes || 30} min` : 'Self-guided (no live)',
            d.coachNotes ? `Notes: ${d.coachNotes}` : '',
            d.zoomJoinUrl ? `Join: ${d.zoomJoinUrl}` : '',
        ].filter(Boolean).join('\\n');
        lines.push(`DESCRIPTION:${descParts}`);
        if (d.zoomJoinUrl)
            lines.push(`URL:${d.zoomJoinUrl}`);
        lines.push('STATUS:CONFIRMED');
        lines.push('END:VEVENT');
    }
    lines.push('END:VCALENDAR');
    res.set({
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': 'attachment; filename="goarrive-sessions.ics"',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.status(200).send(lines.join('\r\n'));
});
// ─── Prompt 5: updateMemberGuidancePhase — Phase-transition automation ──────
// When a member's guidance phase changes, update all their future scheduled
// instances and recurring slots with the correct hosting rules.
// Phase → hosting rules:
//   coach_guided   → hostingMode: 'coach_led', coachExpectedLive: true,  personalZoomRequired: true
//   shared_guidance → hostingMode: 'hosted',    coachExpectedLive: true,  personalZoomRequired: false
//   self_guided     → hostingMode: 'hosted',    coachExpectedLive: false, personalZoomRequired: false
const PHASE_HOSTING_RULES = {
    coach_guided: {
        hostingMode: 'coach_led',
        coachExpectedLive: true,
        personalZoomRequired: true,
    },
    shared_guidance: {
        hostingMode: 'hosted',
        coachExpectedLive: true,
        personalZoomRequired: false,
    },
    self_guided: {
        hostingMode: 'hosted',
        coachExpectedLive: false,
        personalZoomRequired: false,
    },
};
exports.updateMemberGuidancePhase = (0, https_1.onCall)({ region: 'us-central1', secrets: [zoomAccountId, zoomClientId, zoomClientSecret] }, async (request) => {
    var _a, _b;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { memberId, newPhase } = request.data;
    if (!memberId || !newPhase) {
        throw new https_1.HttpsError('invalid-argument', 'memberId and newPhase are required');
    }
    const rules = PHASE_HOSTING_RULES[newPhase];
    if (!rules) {
        throw new https_1.HttpsError('invalid-argument', `Invalid guidance phase: ${newPhase}. Must be coach_guided, shared_guidance, or self_guided.`);
    }
    // Authorization: caller must be the member's coach or a platform admin
    const callerClaims = (((_b = request.auth) === null || _b === void 0 ? void 0 : _b.token) || {});
    const isAdmin = callerClaims.role === 'admin' || callerClaims.platformAdmin === true;
    if (!isAdmin) {
        // Verify caller is the coach for this member by checking a slot or the member doc
        const memberDoc = await db.collection('members').doc(memberId).get();
        const memberData = memberDoc.data();
        if (!memberData || (memberData.coachId !== callerUid && memberData.createdBy !== callerUid)) {
            throw new https_1.HttpsError('permission-denied', 'Only the member\'s coach or an admin can transition phases');
        }
    }
    const todayStr = new Date().toISOString().split('T')[0];
    // Helper: commit writes in chunks of 450 (under Firestore 500-op batch limit)
    const CHUNK_SIZE = 450;
    async function commitInChunks(refs) {
        for (let i = 0; i < refs.length; i += CHUNK_SIZE) {
            const chunk = refs.slice(i, i + CHUNK_SIZE);
            const batch = db.batch();
            for (const item of chunk) {
                batch.update(item.ref, item.data);
            }
            await batch.commit();
        }
    }
    // 1. Update all future scheduled/allocated instances for this member
    const instancesSnap = await db.collection('session_instances')
        .where('memberId', '==', memberId)
        .where('scheduledDate', '>=', todayStr)
        .get();
    const instanceUpdates = [];
    let previousPhase = 'unknown';
    for (const instDoc of instancesSnap.docs) {
        const inst = instDoc.data();
        // Only update instances that haven't started yet
        if (['scheduled', 'allocated', 'allocation_failed'].includes(inst.status)) {
            // Idempotency: skip if already in the target phase
            if (inst.guidancePhase === newPhase)
                continue;
            if (previousPhase === 'unknown' && inst.guidancePhase)
                previousPhase = inst.guidancePhase;
            instanceUpdates.push({
                ref: instDoc.ref,
                data: {
                    guidancePhase: newPhase,
                    hostingMode: rules.hostingMode,
                    coachExpectedLive: rules.coachExpectedLive,
                    personalZoomRequired: rules.personalZoomRequired,
                    updatedAt: firestore_2.FieldValue.serverTimestamp(),
                },
            });
        }
    }
    if (instanceUpdates.length > 0)
        await commitInChunks(instanceUpdates);
    // 2. Update all active recurring slots for this member
    const slotsSnap = await db.collection('recurring_slots')
        .where('memberId', '==', memberId)
        .where('status', '==', 'active')
        .get();
    const slotUpdates = [];
    for (const slotDoc of slotsSnap.docs) {
        const slotData = slotDoc.data();
        // Idempotency: skip if already in the target phase
        if (slotData.guidancePhase === newPhase)
            continue;
        slotUpdates.push({
            ref: slotDoc.ref,
            data: {
                guidancePhase: newPhase,
                hostingMode: rules.hostingMode,
                coachExpectedLive: rules.coachExpectedLive,
                personalZoomRequired: rules.personalZoomRequired,
                updatedAt: firestore_2.FieldValue.serverTimestamp(),
            },
        });
    }
    if (slotUpdates.length > 0)
        await commitInChunks(slotUpdates);
    // 3. Write session events for audit trail
    await writeSessionEvent({
        occurrenceId: `phase_change_${memberId}_${Date.now()}`,
        eventType: 'phase_transition',
        source: 'coach_action',
        providerMode: (0, zoom_1.getZoomProvider)({ accountId: zoomAccountId.value(), clientId: zoomClientId.value(), clientSecret: zoomClientSecret.value() }).mode,
        timestamp: firestore_2.FieldValue.serverTimestamp(),
        payload: {
            memberId,
            newPhase,
            previousPhase,
            updatedInstances: instanceUpdates.length,
            updatedSlots: slotUpdates.length,
            hostingRules: rules,
        },
    });
    console.log(`[updateMemberGuidancePhase] member=${memberId} phase=${newPhase} instances=${instanceUpdates.length} slots=${slotUpdates.length}`);
    return {
        success: true,
        memberId,
        newPhase,
        updatedInstances: instanceUpdates.length,
        updatedSlots: slotUpdates.length,
        hostingRules: rules,
    };
});
// ─── PUBLIC SHARED PLAN ENDPOINT ──────────────────────────────────────────────
// Returns plan data for the shared plan page without requiring authentication.
// Only returns plans with status 'presented', 'accepted', or 'active'.
// This is the ONLY way unauthenticated visitors can view a plan.
exports.getSharedPlan = (0, https_1.onRequest)({ cors: true, region: 'us-central1' }, async (req, res) => {
    var _a, _b, _c;
    const memberId = req.query.memberId || ((_a = req.body) === null || _a === void 0 ? void 0 : _a.memberId);
    if (!memberId) {
        res.status(400).json({ error: 'memberId is required' });
        return;
    }
    try {
        // Try direct memberId key first (current format)
        let planSnap = await db.collection('member_plans').doc(memberId).get();
        // Fallback: try plan_${memberId} key (legacy format)
        if (!planSnap.exists) {
            planSnap = await db.collection('member_plans').doc(`plan_${memberId}`).get();
        }
        // Fallback: query by memberId field
        if (!planSnap.exists) {
            const q = await db.collection('member_plans')
                .where('memberId', '==', memberId)
                .limit(1)
                .get();
            if (!q.empty) {
                planSnap = q.docs[0];
            }
        }
        if (!planSnap.exists) {
            res.status(404).json({ error: 'No plan found for this member.' });
            return;
        }
        const planData = planSnap.data();
        const allowedStatuses = ['presented', 'accepted', 'active', 'pending'];
        if (!allowedStatuses.includes(planData.status || '')) {
            res.status(403).json({ error: 'This plan is still being built. Check back soon!' });
            return;
        }
        // Also fetch member name for display
        let memberName = '';
        try {
            const memberDoc = await db.collection('members').doc(memberId).get();
            if (memberDoc.exists) {
                memberName = ((_b = memberDoc.data()) === null || _b === void 0 ? void 0 : _b.name) || ((_c = memberDoc.data()) === null || _c === void 0 ? void 0 : _c.displayName) || '';
            }
        }
        catch (_) { /* ignore */ }
        // Return plan data with id
        res.status(200).json({
            plan: Object.assign({ id: planSnap.id }, planData),
            memberName,
        });
    }
    catch (err) {
        console.error('[getSharedPlan] Error:', err);
        res.status(500).json({ error: 'Something went wrong loading this plan.' });
    }
});
/**
 * seedMissingCoachDocs — Admin-only one-time utility.
 * Iterates all Firebase Auth users with role=coach claims and ensures each
 * has a corresponding document in the `coaches` collection.
 */
exports.seedMissingCoachDocs = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a, _b, _c, _d, _e;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const callerToken = (_b = request.auth) === null || _b === void 0 ? void 0 : _b.token;
    const isAdmin = (callerToken === null || callerToken === void 0 ? void 0 : callerToken.role) === 'platformAdmin' || (callerToken === null || callerToken === void 0 ? void 0 : callerToken.admin) === true;
    if (!isAdmin)
        throw new https_1.HttpsError('permission-denied', 'Admin only');
    const created = [];
    let nextPageToken;
    do {
        const listResult = await admin.auth().listUsers(100, nextPageToken);
        for (const user of listResult.users) {
            const claims = (_c = user.customClaims) !== null && _c !== void 0 ? _c : {};
            if (claims.role === 'coach' || claims.admin === true) {
                const docRef = db.collection('coaches').doc(user.uid);
                const existing = await docRef.get();
                if (!existing.exists) {
                    await docRef.set({
                        uid: user.uid,
                        email: (_d = user.email) !== null && _d !== void 0 ? _d : '',
                        name: (_e = user.displayName) !== null && _e !== void 0 ? _e : '',
                        role: claims.admin ? 'platformAdmin' : 'coach',
                        createdAt: Date.now(),
                        createdBy: 'seedMissingCoachDocs',
                    });
                    created.push(user.uid);
                }
            }
        }
        nextPageToken = listResult.pageToken;
    } while (nextPageToken);
    return { success: true, created };
});
/**
 * setAdminRole — One-time utility to set a user's role to platformAdmin.
 * Called by the admin from the admin page. Updates both custom claims and
 * the coaches collection doc.
 *
 * Input: { targetUid: string }
 */
exports.setAdminRole = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a, _b, _c;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const callerToken = (_b = request.auth) === null || _b === void 0 ? void 0 : _b.token;
    const isAdmin = (callerToken === null || callerToken === void 0 ? void 0 : callerToken.role) === 'platformAdmin' || (callerToken === null || callerToken === void 0 ? void 0 : callerToken.admin) === true;
    if (!isAdmin)
        throw new https_1.HttpsError('permission-denied', 'Admin only');
    const { targetUid } = request.data;
    const uid = targetUid || callerUid;
    // Update custom claims
    const user = await admin.auth().getUser(uid);
    const existingClaims = (_c = user.customClaims) !== null && _c !== void 0 ? _c : {};
    await admin.auth().setCustomUserClaims(uid, Object.assign(Object.assign({}, existingClaims), { role: 'platformAdmin', admin: true, coachId: uid }));
    // Update coaches doc if it exists
    const coachRef = db.collection('coaches').doc(uid);
    const coachDoc = await coachRef.get();
    if (coachDoc.exists) {
        await coachRef.update({ role: 'platformAdmin' });
    }
    console.log(`[setAdminRole] Set ${uid} to platformAdmin by ${callerUid}`);
    return { success: true, uid };
});
/**
 * adminGetCoachData — Server-side data fetch for admin "View as Coach" mode.
 * Returns a coach's members and their plan summaries without requiring
 * client-side Firestore queries (avoids rule-tightening risks).
 *
 * Input: { coachUid: string }
 * Output: { members: Array<{ id, name, email, phone, isArchived, planId, planStatus, checkoutStatus, contractMonths, displayMonthlyPrice }> }
 */
exports.adminGetCoachData = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a, _b, _c;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const callerToken = (_b = request.auth) === null || _b === void 0 ? void 0 : _b.token;
    const isAdmin = (callerToken === null || callerToken === void 0 ? void 0 : callerToken.role) === 'platformAdmin' || (callerToken === null || callerToken === void 0 ? void 0 : callerToken.admin) === true;
    if (!isAdmin)
        throw new https_1.HttpsError('permission-denied', 'Admin only');
    const { coachUid } = request.data;
    if (!coachUid)
        throw new https_1.HttpsError('invalid-argument', 'coachUid is required');
    // Fetch members for this coach
    const mSnap = await db.collection('members').where('coachId', '==', coachUid).get();
    // Fetch member plans for this coach
    const pSnap = await db.collection('member_plans').where('coachId', '==', coachUid).limit(200).get();
    const planMap = {};
    pSnap.docs.forEach(d => {
        var _a;
        const data = d.data();
        const mid = (_a = data.memberId) !== null && _a !== void 0 ? _a : d.id;
        planMap[mid] = Object.assign({ id: d.id }, data);
    });
    const rawMembers = mSnap.docs.map(d => {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l;
        const data = d.data();
        const plan = planMap[d.id];
        return {
            id: d.id,
            name: data.name || data.displayName || `${(_a = data.firstName) !== null && _a !== void 0 ? _a : ''} ${(_b = data.lastName) !== null && _b !== void 0 ? _b : ''}`.trim() || 'Unknown',
            email: (_c = data.email) !== null && _c !== void 0 ? _c : '',
            phone: (_d = data.phone) !== null && _d !== void 0 ? _d : '',
            isArchived: (_e = data.isArchived) !== null && _e !== void 0 ? _e : false,
            planId: (_f = plan === null || plan === void 0 ? void 0 : plan.id) !== null && _f !== void 0 ? _f : null,
            planStatus: (_g = plan === null || plan === void 0 ? void 0 : plan.status) !== null && _g !== void 0 ? _g : 'no plan',
            checkoutStatus: (_h = plan === null || plan === void 0 ? void 0 : plan.checkoutStatus) !== null && _h !== void 0 ? _h : null,
            contractMonths: (_j = plan === null || plan === void 0 ? void 0 : plan.contractMonths) !== null && _j !== void 0 ? _j : null,
            displayMonthlyPrice: (_l = (_k = plan === null || plan === void 0 ? void 0 : plan.pricingResult) === null || _k === void 0 ? void 0 : _k.displayMonthlyPrice) !== null && _l !== void 0 ? _l : null,
        };
    });
    // Deduplicate by email — keep the entry with a plan (or the most recent one)
    const seenEmails = new Map();
    for (const m of rawMembers) {
        const key = ((_c = m.email) === null || _c === void 0 ? void 0 : _c.toLowerCase()) || m.id;
        const existing = seenEmails.get(key);
        if (!existing) {
            seenEmails.set(key, m);
        }
        else {
            // Prefer the entry that has a plan or checkoutStatus
            const existingHasPlan = !!existing.planId || !!existing.checkoutStatus;
            const newHasPlan = !!m.planId || !!m.checkoutStatus;
            if (newHasPlan && !existingHasPlan) {
                seenEmails.set(key, m);
            }
        }
    }
    const members = Array.from(seenEmails.values());
    return { members };
});
// ─── 26. enforceCtsAccountability — Scheduled: auto-charge missed session fees ──
/**
 * Runs every hour. For each active Commit-to-Save member:
 *   1. Finds session_instances that were scheduled > 48 hours ago where the
 *      member did not attend (no attendance record and status is NOT 'completed').
 *   2. Checks idempotency via ctsAccountabilityFees collection.
 *   3. Creates a Stripe invoice item for the missed-session fee ($50 default)
 *      on the coach's connected account, then finalizes the invoice.
 *   4. Records the fee in ctsAccountabilityFees and ledgerEntries.
 *   5. Sends a notification to the member.
 *
 * The 48-hour window gives the member time to reschedule/make up the session.
 * Emergency waivers are handled manually by the coach (set waived: true on the
 * ctsAccountabilityFees doc).
 */
exports.enforceCtsAccountability = (0, scheduler_1.onSchedule)({ schedule: 'every 1 hours', timeZone: 'UTC', region: 'us-central1', secrets: [stripeSecretKey, emailApiKey, twilioAccountSid, twilioAuthToken, twilioFromNumber] }, async () => {
    var _a, _b, _c, _d;
    console.log('[enforceCtsAccountability] Starting CTS accountability check');
    const stripe = getStripe(stripeSecretKey.value());
    const now = firestore_2.Timestamp.now();
    const fortyEightHoursAgoMs = now.toMillis() - 48 * 60 * 60 * 1000;
    // Only look at sessions from the last 7 days (avoid scanning ancient data)
    const sevenDaysAgoMs = now.toMillis() - 7 * 24 * 60 * 60 * 1000;
    // Reset notification providers so secrets are freshly resolved
    const { resetNotificationProviders } = await Promise.resolve().then(() => __importStar(require('./notifications')));
    resetNotificationProviders();
    let totalProcessed = 0;
    let totalCharged = 0;
    let totalSkipped = 0;
    let totalFailed = 0;
    try {
        // 1. Find all active CTS consents
        const activeConsentsSnap = await db.collection('commitToSaveConsents')
            .where('status', '==', 'active')
            .get();
        if (activeConsentsSnap.empty) {
            console.log('[enforceCtsAccountability] No active CTS consents found');
            return;
        }
        console.log(`[enforceCtsAccountability] Found ${activeConsentsSnap.size} active CTS consents`);
        for (const consentDoc of activeConsentsSnap.docs) {
            const consent = consentDoc.data();
            const memberId = consent.memberId;
            const planId = consent.planId;
            const coachId = consent.coachId;
            const missedSessionFee = (_a = consent.missedSessionFee) !== null && _a !== void 0 ? _a : 50; // Default $50
            if (!memberId || !planId || !coachId) {
                console.warn('[enforceCtsAccountability] Skipping consent', consentDoc.id, '— missing fields');
                continue;
            }
            try {
                // 2. Find missed sessions for this member in the accountability window
                //    Sessions that were scheduled between 7 days ago and 48 hours ago,
                //    where the member did NOT attend.
                const fortyEightHoursAgoDate = new Date(fortyEightHoursAgoMs).toISOString().split('T')[0];
                const sevenDaysAgoDate = new Date(sevenDaysAgoMs).toISOString().split('T')[0];
                const instancesSnap = await db.collection('session_instances')
                    .where('memberId', '==', memberId)
                    .where('coachId', '==', coachId)
                    .where('scheduledDate', '>=', sevenDaysAgoDate)
                    .where('scheduledDate', '<=', fortyEightHoursAgoDate)
                    .get();
                for (const instanceDoc of instancesSnap.docs) {
                    const instance = instanceDoc.data();
                    totalProcessed++;
                    // Skip if session was cancelled, rescheduled, or completed
                    if (['completed', 'cancelled', 'rescheduled', 'in_progress'].includes(instance.status)) {
                        totalSkipped++;
                        continue;
                    }
                    // Skip if member actually attended (has attendance data or actualStartTime)
                    const hasAttendance = instance.attendance && Object.keys(instance.attendance).length > 0;
                    const hasActualStart = !!instance.actualStartTime;
                    const attendanceStatus = instance.attendanceStatus;
                    if (hasAttendance || hasActualStart || attendanceStatus === 'joined' || attendanceStatus === 'completed') {
                        totalSkipped++;
                        continue;
                    }
                    // Skip if CTS is not enabled on this specific session instance
                    if (instance.commitToSaveEnabled === false) {
                        totalSkipped++;
                        continue;
                    }
                    // 3a. Make-up session tracking: check if the member attended any
                    //     other session within 48 hours of the missed one.
                    //     If they did, treat it as a make-up and skip the fee.
                    const missedDateStr = instance.scheduledDate; // e.g. '2026-03-20'
                    const missedTimeStr = instance.scheduledStartTime || '00:00';
                    const missedMs = new Date(`${missedDateStr}T${missedTimeStr}:00`).getTime();
                    const makeUpWindowEnd = missedMs + 48 * 60 * 60 * 1000;
                    const makeUpWindowEndDate = new Date(makeUpWindowEnd).toISOString().split('T')[0];
                    // Look for any completed/attended session for this member within the make-up window
                    const makeUpSnap = await db.collection('session_instances')
                        .where('memberId', '==', memberId)
                        .where('coachId', '==', coachId)
                        .where('scheduledDate', '>=', missedDateStr)
                        .where('scheduledDate', '<=', makeUpWindowEndDate)
                        .get();
                    let hasMakeUp = false;
                    for (const muDoc of makeUpSnap.docs) {
                        if (muDoc.id === instanceDoc.id)
                            continue; // Skip the missed session itself
                        const muData = muDoc.data();
                        // Check if this other session was actually attended
                        const muHasAttendance = muData.attendance && Object.keys(muData.attendance).length > 0;
                        const muHasActualStart = !!muData.actualStartTime;
                        const muAttendanceStatus = muData.attendanceStatus;
                        const muStatus = muData.status;
                        if (muHasAttendance || muHasActualStart ||
                            muAttendanceStatus === 'joined' || muAttendanceStatus === 'completed' ||
                            muStatus === 'completed') {
                            hasMakeUp = true;
                            break;
                        }
                    }
                    if (hasMakeUp) {
                        // Member made up the session — mark it and skip the fee
                        await db.collection('session_instances').doc(instanceDoc.id).update({
                            status: 'made_up',
                            madeUpWithin48h: true,
                            updatedAt: firestore_2.FieldValue.serverTimestamp(),
                        });
                        totalSkipped++;
                        continue;
                    }
                    // 3b. Idempotency check — have we already charged for this instance?
                    const existingFeeSnap = await db.collection('ctsAccountabilityFees')
                        .where('sessionInstanceId', '==', instanceDoc.id)
                        .where('memberId', '==', memberId)
                        .limit(1)
                        .get();
                    if (!existingFeeSnap.empty) {
                        totalSkipped++; // Already processed
                        continue;
                    }
                    // 4. Look up Stripe details
                    const planSnap = await db.collection('member_plans').doc(planId).get();
                    const planData = planSnap.data();
                    const stripeCustomerId = planData === null || planData === void 0 ? void 0 : planData.stripeCustomerId;
                    if (!stripeCustomerId) {
                        console.warn('[enforceCtsAccountability] No stripeCustomerId for plan', planId, '— skipping');
                        totalSkipped++;
                        continue;
                    }
                    const coachAccountSnap = await db.collection('coachStripeAccounts').doc(coachId).get();
                    const stripeAccountId = (_b = coachAccountSnap.data()) === null || _b === void 0 ? void 0 : _b.stripeAccountId;
                    if (!stripeAccountId) {
                        console.warn('[enforceCtsAccountability] No stripeAccountId for coach', coachId, '— skipping');
                        totalSkipped++;
                        continue;
                    }
                    // 5. Create Stripe invoice item and finalize the invoice
                    try {
                        // Create an invoice item on the customer
                        await stripe.invoiceItems.create({
                            customer: stripeCustomerId,
                            amount: missedSessionFee * 100, // cents
                            currency: 'usd',
                            description: `Commit to Save — Missed Session Fee (${instance.scheduledDate} ${instance.scheduledStartTime || ''})`,
                            metadata: {
                                type: 'cts_missed_session_fee',
                                sessionInstanceId: instanceDoc.id,
                                memberId,
                                coachId,
                                planId,
                            },
                        }, { stripeAccount: stripeAccountId });
                        // Create and finalize the invoice (auto-charges the default payment method)
                        const invoice = await stripe.invoices.create({
                            customer: stripeCustomerId,
                            auto_advance: true, // Auto-finalize and attempt payment
                            collection_method: 'charge_automatically',
                            metadata: {
                                type: 'cts_missed_session_fee',
                                sessionInstanceId: instanceDoc.id,
                                memberId,
                                coachId,
                                planId,
                            },
                        }, { stripeAccount: stripeAccountId });
                        // Finalize the invoice to trigger payment
                        await stripe.invoices.finalizeInvoice(invoice.id, {}, { stripeAccount: stripeAccountId });
                        // Compute tier split for the fee
                        const activePayingSnap = await db.collection('member_plans')
                            .where('coachId', '==', coachId)
                            .where('checkoutStatus', '==', 'paid')
                            .get();
                        const tierSplit = getTierSplit(activePayingSnap.size);
                        const feeCents = missedSessionFee * 100;
                        const goArriveShareCents = Math.round(feeCents * tierSplit / 100);
                        const coachShareCents = feeCents - goArriveShareCents;
                        // 6. Record the fee in ctsAccountabilityFees
                        const feeRef = db.collection('ctsAccountabilityFees').doc();
                        await feeRef.set({
                            feeId: feeRef.id,
                            sessionInstanceId: instanceDoc.id,
                            memberId,
                            coachId,
                            planId,
                            consentId: consentDoc.id,
                            scheduledDate: instance.scheduledDate,
                            scheduledStartTime: instance.scheduledStartTime || '',
                            feeCents,
                            stripeInvoiceId: invoice.id,
                            stripeAccountId,
                            stripeCustomerId,
                            status: 'charged',
                            waived: false,
                            tierSplit,
                            goArriveShareCents,
                            coachShareCents,
                            createdAt: firestore_2.FieldValue.serverTimestamp(),
                        });
                        // 7. Record in ledgerEntries
                        const ledgerRef = db.collection('ledgerEntries').doc();
                        await ledgerRef.set({
                            entryId: ledgerRef.id,
                            billingEventId: `cts_fee_${feeRef.id}`,
                            memberId,
                            coachId,
                            planId,
                            snapshotId: (_c = planData === null || planData === void 0 ? void 0 : planData.acceptedSnapshotId) !== null && _c !== void 0 ? _c : '',
                            phase: 'continuation',
                            grossAmountCents: feeCents,
                            coachShareCents,
                            goArriveShareCents,
                            tierSnapshot: tierSplit,
                            applicationFeePercent: tierSplit,
                            stripeInvoiceId: invoice.id,
                            type: 'cts_missed_session_fee',
                            description: `CTS missed session fee — ${instance.scheduledDate}`,
                            createdAt: firestore_2.FieldValue.serverTimestamp(),
                        });
                        // 8. Update the session instance to mark it as missed
                        await db.collection('session_instances').doc(instanceDoc.id).update({
                            status: 'missed',
                            ctsFeeCarged: true,
                            ctsFeeId: feeRef.id,
                            updatedAt: firestore_2.FieldValue.serverTimestamp(),
                        });
                        // 9. Send notification to member
                        try {
                            const { sendNotification } = await Promise.resolve().then(() => __importStar(require('./notifications')));
                            const memberSnap = await db.collection('users').doc(memberId).get();
                            const memberData = memberSnap.exists ? memberSnap.data() : {};
                            const coachSnap = await db.collection('coaches').doc(coachId).get();
                            const coachName = ((_d = coachSnap.data()) === null || _d === void 0 ? void 0 : _d.name) || 'your coach';
                            await sendNotification({
                                messageType: 'admin_alert',
                                channel: 'email',
                                recipient: {
                                    uid: memberId,
                                    email: memberData.email || '',
                                    displayName: memberData.displayName || '',
                                    role: 'member',
                                },
                                subject: `Commit to Save — Missed Session Fee ($${missedSessionFee})`,
                                body: `Hi ${(memberData.displayName || 'there').split(' ')[0]}, you missed your session on ${instance.scheduledDate} and did not make it up within 48 hours. A $${missedSessionFee} accountability fee has been charged per your Commit to Save agreement. If this was an emergency, contact ${coachName} to request a waiver. — GoArrive`,
                                htmlBody: `
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #E8E6E3;">
  <div style="background: #1A1D23; border-radius: 12px; padding: 24px;">
    <h2 style="color: #FFC000; margin: 0 0 16px 0; font-size: 20px;">Missed Session Fee</h2>
    <p style="margin: 0 0 12px 0; line-height: 1.5;">Hi ${(memberData.displayName || 'there').split(' ')[0]}, you missed your session on <strong>${instance.scheduledDate}</strong> and did not make it up within 48 hours.</p>
    <p style="margin: 0 0 12px 0; line-height: 1.5;">A <strong>$${missedSessionFee}</strong> accountability fee has been charged per your Commit to Save agreement.</p>
    <p style="margin: 0 0 12px 0; line-height: 1.5; color: #9CA3AF;">If this was a family emergency or illness, contact <strong>${coachName}</strong> to request a waiver.</p>
    <p style="margin: 16px 0 0 0; color: #9CA3AF;">— GoArrive</p>
  </div>
</div>`,
                                memberId,
                                coachId,
                            });
                        }
                        catch (notifErr) {
                            console.warn('[enforceCtsAccountability] Failed to send notification for instance', instanceDoc.id, ':', notifErr);
                        }
                        totalCharged++;
                        console.log('[enforceCtsAccountability] Charged $' + missedSessionFee, 'for missed session', instanceDoc.id, 'member', memberId, 'invoice', invoice.id);
                    }
                    catch (stripeErr) {
                        totalFailed++;
                        console.error('[enforceCtsAccountability] Stripe charge failed for instance', instanceDoc.id, ':', stripeErr.message || stripeErr);
                        // Write to dead_letter for visibility
                        await db.collection('dead_letter').add({
                            type: 'cts_fee_charge_failed',
                            sourceCollection: 'session_instances',
                            sourceId: instanceDoc.id,
                            error: stripeErr.message || String(stripeErr),
                            payload: { memberId, coachId, planId, scheduledDate: instance.scheduledDate },
                            createdAt: firestore_2.Timestamp.now(),
                            resolved: false,
                        });
                    }
                }
            }
            catch (queryErr) {
                console.error('[enforceCtsAccountability] Error processing consent', consentDoc.id, ':', queryErr.message || queryErr);
            }
        }
    }
    catch (err) {
        console.error('[enforceCtsAccountability] Fatal error:', err.message || err);
    }
    console.log(`[enforceCtsAccountability] Done: ${totalProcessed} sessions checked, ` +
        `${totalCharged} charged, ${totalSkipped} skipped, ${totalFailed} failed`);
});
// ─── 27. waiveCtsFee — HTTPS callable: coach waives a CTS missed session fee ──
/**
 * Called by the coach from the billing dashboard to waive a specific CTS
 * accountability fee. Sets waived: true on the ctsAccountabilityFees doc
 * and issues a full Stripe refund for the invoice.
 *
 * Input: { feeId: string }
 * Auth: caller must be the coach who owns the plan, or a platformAdmin.
 */
exports.waiveCtsFee = (0, https_1.onCall)({ region: 'us-central1', secrets: [stripeSecretKey] }, async (request) => {
    var _a, _b, _c;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { feeId } = request.data;
    if (!feeId)
        throw new https_1.HttpsError('invalid-argument', 'feeId is required');
    // 1. Look up the fee doc
    const feeRef = db.collection('ctsAccountabilityFees').doc(feeId);
    const feeSnap = await feeRef.get();
    if (!feeSnap.exists)
        throw new https_1.HttpsError('not-found', 'Fee record not found');
    const fee = feeSnap.data();
    // Already waived?
    if (fee.waived === true) {
        return { success: true, message: 'Fee was already waived' };
    }
    // 2. Auth check: caller must be the coach or a platformAdmin
    const isPlatformAdmin = ((_c = (_b = request.auth) === null || _b === void 0 ? void 0 : _b.token) === null || _c === void 0 ? void 0 : _c.platformAdmin) === true;
    if (fee.coachId !== callerUid && !isPlatformAdmin) {
        throw new https_1.HttpsError('permission-denied', 'Only the coach or a platform admin can waive this fee');
    }
    // 3. Issue Stripe refund for the invoice
    const stripe = getStripe(stripeSecretKey.value());
    const stripeInvoiceId = fee.stripeInvoiceId;
    const stripeAccountId = fee.stripeAccountId;
    if (stripeInvoiceId && stripeAccountId) {
        try {
            // Get the invoice to find the payment intent or charge
            const invoice = await stripe.invoices.retrieve(stripeInvoiceId, { expand: ['payment_intent'] }, { stripeAccount: stripeAccountId });
            const paymentIntent = invoice.payment_intent;
            let chargeId;
            if (typeof paymentIntent === 'object' && (paymentIntent === null || paymentIntent === void 0 ? void 0 : paymentIntent.latest_charge)) {
                chargeId = typeof paymentIntent.latest_charge === 'string'
                    ? paymentIntent.latest_charge
                    : paymentIntent.latest_charge.id;
            }
            if (chargeId) {
                await stripe.refunds.create({ charge: chargeId, reason: 'requested_by_customer' }, { stripeAccount: stripeAccountId });
                console.log('[waiveCtsFee] Refund issued for charge', chargeId, 'on account', stripeAccountId);
            }
            else {
                // Invoice may not have been paid yet — void it instead
                if (invoice.status === 'open' || invoice.status === 'draft') {
                    await stripe.invoices.voidInvoice(stripeInvoiceId, {}, { stripeAccount: stripeAccountId });
                    console.log('[waiveCtsFee] Invoice voided:', stripeInvoiceId);
                }
                else {
                    console.warn('[waiveCtsFee] No charge found and invoice not voidable. Status:', invoice.status);
                }
            }
        }
        catch (stripeErr) {
            console.error('[waiveCtsFee] Stripe refund/void failed:', stripeErr.message || stripeErr);
            // Still mark as waived in Firestore even if Stripe refund fails
            // (coach can handle manually via Stripe dashboard)
        }
    }
    // 4. Update the fee doc
    await feeRef.update({
        waived: true,
        waivedAt: firestore_2.FieldValue.serverTimestamp(),
        waivedBy: callerUid,
        status: 'waived',
    });
    // 5. Record a negative ledger entry for the refund
    const ledgerRef = db.collection('ledgerEntries').doc();
    await ledgerRef.set({
        entryId: ledgerRef.id,
        billingEventId: `cts_fee_waiver_${feeId}`,
        memberId: fee.memberId,
        coachId: fee.coachId,
        planId: fee.planId,
        snapshotId: '',
        phase: 'continuation',
        grossAmountCents: -(fee.feeCents || 0),
        coachShareCents: -(fee.coachShareCents || 0),
        goArriveShareCents: -(fee.goArriveShareCents || 0),
        tierSnapshot: fee.tierSplit || 0,
        applicationFeePercent: fee.tierSplit || 0,
        stripeInvoiceId: stripeInvoiceId || '',
        type: 'cts_fee_waiver',
        description: `CTS fee waived — ${fee.scheduledDate || 'unknown date'}`,
        createdAt: firestore_2.FieldValue.serverTimestamp(),
    });
    console.log('[waiveCtsFee] Fee', feeId, 'waived by', callerUid);
    return { success: true, message: 'Fee waived and refund issued' };
});
// ─── Item 2: batchPhaseTransition — Auto-detect and apply phase transitions ──
// Runs daily. For each active member plan with contractStartAt and phases[],
// calculates which phase the member should be in based on weeks elapsed,
// then calls updateMemberGuidancePhase logic if the current slots are in a
// different phase.
const PLAN_INTENSITY_TO_SCHED_PHASE = {
    'Fully Guided': 'coach_guided',
    'Fully guided': 'coach_guided',
    'Shared Guidance': 'shared_guidance',
    'Blended': 'shared_guidance',
    'Self-Reliant': 'self_guided',
    'Self-reliant': 'self_guided',
};
exports.batchPhaseTransition = (0, scheduler_1.onSchedule)({ schedule: 'every day 03:00', region: 'us-central1', timeZone: 'America/New_York', secrets: [zoomAccountId, zoomClientId, zoomClientSecret] }, async () => {
    var _a, _b, _c, _d, _e;
    console.log('[batchPhaseTransition] Starting daily phase transition check');
    // Find all member plans that have contractStartAt and phases
    const plansSnap = await db.collection('member_plans')
        .where('checkoutStatus', 'in', ['paid', 'pay_in_full_paid'])
        .get();
    const now = new Date();
    let transitioned = 0;
    let skipped = 0;
    let errors = 0;
    for (const planDoc of plansSnap.docs) {
        try {
            const plan = planDoc.data();
            const memberId = planDoc.id;
            // Need contractStartAt and phases array
            const contractStartAt = (_c = (_b = (_a = plan.contractStartAt) === null || _a === void 0 ? void 0 : _a.toDate) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : plan.contractStartAt;
            if (!contractStartAt || !plan.phases || !Array.isArray(plan.phases) || plan.phases.length === 0) {
                skipped++;
                continue;
            }
            // Calculate weeks elapsed since contract start
            const msElapsed = now.getTime() - new Date(contractStartAt).getTime();
            const weeksElapsed = Math.floor(msElapsed / (7 * 24 * 60 * 60 * 1000));
            if (weeksElapsed < 0) {
                skipped++;
                continue;
            }
            // Determine which phase the member should be in
            let cumulativeWeeks = 0;
            let targetPhase = null;
            for (const phase of plan.phases) {
                cumulativeWeeks += (phase.weeks || 0);
                if (weeksElapsed < cumulativeWeeks) {
                    targetPhase = { id: phase.id, intensity: phase.intensity };
                    break;
                }
            }
            // If past all phases, use the last phase
            if (!targetPhase && plan.phases.length > 0) {
                const lastPhase = plan.phases[plan.phases.length - 1];
                targetPhase = { id: lastPhase.id, intensity: lastPhase.intensity };
            }
            if (!targetPhase) {
                skipped++;
                continue;
            }
            // Map plan intensity to scheduling guidance phase
            const newSchedPhase = PLAN_INTENSITY_TO_SCHED_PHASE[targetPhase.intensity];
            if (!newSchedPhase) {
                skipped++;
                continue;
            }
            // Check if any active slot for this member is in a different phase
            const slotsSnap = await db.collection('recurring_slots')
                .where('memberId', '==', memberId)
                .where('status', '==', 'active')
                .limit(1)
                .get();
            if (slotsSnap.empty) {
                skipped++;
                continue;
            }
            const currentSlotPhase = slotsSnap.docs[0].data().guidancePhase;
            if (currentSlotPhase === newSchedPhase) {
                skipped++;
                continue;
            }
            // Phase transition needed — apply it
            console.log(`[batchPhaseTransition] member=${memberId} from=${currentSlotPhase} to=${newSchedPhase} (phase ${targetPhase.id}, week ${weeksElapsed})`);
            const rules = PHASE_HOSTING_RULES[newSchedPhase];
            if (!rules) {
                skipped++;
                continue;
            }
            const todayStr = now.toISOString().split('T')[0];
            // Update future instances
            const instancesSnap = await db.collection('session_instances')
                .where('memberId', '==', memberId)
                .where('scheduledDate', '>=', todayStr)
                .get();
            const batch1 = db.batch();
            let instCount = 0;
            for (const instDoc of instancesSnap.docs) {
                const inst = instDoc.data();
                if (['scheduled', 'allocated', 'allocation_failed'].includes(inst.status) && inst.guidancePhase !== newSchedPhase) {
                    batch1.update(instDoc.ref, {
                        guidancePhase: newSchedPhase,
                        hostingMode: rules.hostingMode,
                        coachExpectedLive: rules.coachExpectedLive,
                        personalZoomRequired: rules.personalZoomRequired,
                        updatedAt: firestore_2.FieldValue.serverTimestamp(),
                    });
                    instCount++;
                }
            }
            if (instCount > 0)
                await batch1.commit();
            // Update active recurring slots
            const allSlotsSnap = await db.collection('recurring_slots')
                .where('memberId', '==', memberId)
                .where('status', '==', 'active')
                .get();
            const batch2 = db.batch();
            let slotCount = 0;
            for (const slotDoc of allSlotsSnap.docs) {
                if (slotDoc.data().guidancePhase !== newSchedPhase) {
                    batch2.update(slotDoc.ref, {
                        guidancePhase: newSchedPhase,
                        hostingMode: rules.hostingMode,
                        coachExpectedLive: rules.coachExpectedLive,
                        personalZoomRequired: rules.personalZoomRequired,
                        updatedAt: firestore_2.FieldValue.serverTimestamp(),
                    });
                    slotCount++;
                }
            }
            if (slotCount > 0)
                await batch2.commit();
            // Audit trail
            await writeSessionEvent({
                occurrenceId: `auto_phase_${memberId}_${Date.now()}`,
                eventType: 'phase_transition',
                source: 'batch_scheduler',
                providerMode: (0, zoom_1.getZoomProvider)({ accountId: zoomAccountId.value(), clientId: zoomClientId.value(), clientSecret: zoomClientSecret.value() }).mode,
                timestamp: firestore_2.FieldValue.serverTimestamp(),
                payload: {
                    memberId,
                    previousPhase: currentSlotPhase,
                    newPhase: newSchedPhase,
                    phaseId: targetPhase.id,
                    weeksElapsed,
                    updatedInstances: instCount,
                    updatedSlots: slotCount,
                },
            });
            // Item 5: Send notification to member and coach about phase transition
            const PHASE_LABELS = {
                coach_guided: 'Coach Guided',
                shared_guidance: 'Shared Guidance',
                self_guided: 'Self Guided',
            };
            const fromLabel = PHASE_LABELS[currentSlotPhase] || currentSlotPhase;
            const toLabel = PHASE_LABELS[newSchedPhase] || newSchedPhase;
            try {
                // Notify member
                const memberDoc = await db.collection('members').doc(memberId).get();
                const memberData = memberDoc.data();
                if (memberData === null || memberData === void 0 ? void 0 : memberData.email) {
                    await (0, notifications_1.sendNotification)({
                        messageType: 'admin_alert',
                        channel: 'email',
                        recipient: {
                            uid: memberId,
                            email: memberData.email,
                            displayName: memberData.name || 'Member',
                            role: 'member',
                        },
                        subject: `Your guidance phase has changed to ${toLabel}`,
                        body: `Hi ${((_d = memberData.name) === null || _d === void 0 ? void 0 : _d.split(' ')[0]) || 'there'},\n\nYour coaching sessions have transitioned from ${fromLabel} to ${toLabel} (Phase ${targetPhase.id}, Week ${weeksElapsed}).\n\nThis means your upcoming sessions will be updated automatically. No action is needed on your end.\n\n— GoArrive`,
                        memberId,
                    });
                }
                // Notify coach
                const coachIdForNotif = plan.coachId || (memberData === null || memberData === void 0 ? void 0 : memberData.coachId);
                if (coachIdForNotif) {
                    const coachDoc = await db.collection('coaches').doc(coachIdForNotif).get();
                    const coachData = coachDoc.data();
                    if (coachData === null || coachData === void 0 ? void 0 : coachData.email) {
                        await (0, notifications_1.sendNotification)({
                            messageType: 'admin_alert',
                            channel: 'email',
                            recipient: {
                                uid: coachIdForNotif,
                                email: coachData.email,
                                displayName: coachData.name || 'Coach',
                                role: 'coach',
                            },
                            subject: `${(memberData === null || memberData === void 0 ? void 0 : memberData.name) || 'A member'} transitioned to ${toLabel}`,
                            body: `Hi ${((_e = coachData.name) === null || _e === void 0 ? void 0 : _e.split(' ')[0]) || 'Coach'},\n\n${(memberData === null || memberData === void 0 ? void 0 : memberData.name) || 'A member'} has automatically transitioned from ${fromLabel} to ${toLabel} (Phase ${targetPhase.id}, Week ${weeksElapsed}).\n\n${instCount} upcoming instances and ${slotCount} slots were updated.\n\n— GoArrive`,
                            coachId: coachIdForNotif,
                            memberId,
                        });
                    }
                }
            }
            catch (notifErr) {
                console.warn(`[batchPhaseTransition] Notification failed for ${memberId}:`, notifErr.message);
            }
            transitioned++;
        }
        catch (err) {
            errors++;
            console.error(`[batchPhaseTransition] Error processing plan ${planDoc.id}:`, err.message || err);
        }
    }
    console.log(`[batchPhaseTransition] Done. transitioned=${transitioned} skipped=${skipped} errors=${errors}`);
});
// ─── Item 3: syncSlotDuration — Auto-sync session duration from plan changes ──
// Firestore trigger: when a member_plans document is updated and
// sessionLengthMinutes changes, update all active recurring slots for that member.
exports.syncSlotDuration = (0, firestore_1.onDocumentUpdated)({ document: 'member_plans/{memberId}', region: 'us-central1' }, async (event) => {
    var _a, _b, _c, _d;
    const before = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data();
    const after = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after) === null || _d === void 0 ? void 0 : _d.data();
    if (!before || !after)
        return;
    const memberId = event.params.memberId;
    const oldDuration = before.sessionLengthMinutes;
    const newDuration = after.sessionLengthMinutes;
    // Only act if sessionLengthMinutes actually changed
    if (!newDuration || oldDuration === newDuration)
        return;
    console.log(`[syncSlotDuration] member=${memberId} duration ${oldDuration} → ${newDuration}`);
    // Update all active recurring slots for this member
    const slotsSnap = await db.collection('recurring_slots')
        .where('memberId', '==', memberId)
        .where('status', '==', 'active')
        .get();
    if (slotsSnap.empty)
        return;
    const batch = db.batch();
    let count = 0;
    for (const slotDoc of slotsSnap.docs) {
        const slotData = slotDoc.data();
        // Only update if the slot's current duration matches the old plan duration
        // (don't override manually customized durations)
        if (slotData.durationMinutes === oldDuration) {
            batch.update(slotDoc.ref, {
                durationMinutes: newDuration,
                updatedAt: firestore_2.FieldValue.serverTimestamp(),
            });
            count++;
        }
    }
    if (count > 0) {
        await batch.commit();
        console.log(`[syncSlotDuration] Updated ${count} slots for member ${memberId}`);
    }
    // Item 9: Also update future session instances (skip started/completed/missed)
    const todayStr = new Date().toISOString().split('T')[0];
    const instSnap = await db.collection('session_instances')
        .where('memberId', '==', memberId)
        .where('scheduledDate', '>=', todayStr)
        .get();
    if (!instSnap.empty) {
        const instBatch = db.batch();
        let instCount = 0;
        const SKIP_STATUSES = ['completed', 'in_progress', 'missed', 'cancelled'];
        for (const instDoc of instSnap.docs) {
            const inst = instDoc.data();
            if (SKIP_STATUSES.includes(inst.status))
                continue;
            if (inst.durationMinutes === oldDuration) {
                instBatch.update(instDoc.ref, {
                    durationMinutes: newDuration,
                    updatedAt: firestore_2.FieldValue.serverTimestamp(),
                });
                instCount++;
            }
        }
        if (instCount > 0) {
            await instBatch.commit();
            console.log(`[syncSlotDuration] Updated ${instCount} future instances for member ${memberId}`);
        }
    }
});
// ─── Item 8: detectNoShows — Scheduled: auto-mark missed instances ──────────
// Runs every 30 minutes. Finds instances where:
//   - status is 'allocated' (Zoom room assigned)
//   - scheduledDate + scheduledStartTime + 15 min has passed
//   - No meeting.started event exists in session_events
// Marks them as 'missed' automatically.
exports.detectNoShows = (0, scheduler_1.onSchedule)({ schedule: '*/30 * * * *', timeZone: 'America/New_York', region: 'us-central1' }, async () => {
    const now = new Date();
    // Look at instances from the past 4 hours (to catch any that were missed)
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);
    const todayStr = now.toISOString().split('T')[0];
    const fourHoursAgoStr = fourHoursAgo.toISOString().split('T')[0];
    // Query allocated instances from today and possibly yesterday
    const datesToCheck = [todayStr];
    if (fourHoursAgoStr !== todayStr)
        datesToCheck.push(fourHoursAgoStr);
    let marked = 0;
    let checked = 0;
    let skipped = 0;
    for (const dateStr of datesToCheck) {
        const snap = await db.collection('session_instances')
            .where('status', '==', 'allocated')
            .where('scheduledDate', '==', dateStr)
            .limit(200)
            .get();
        for (const doc of snap.docs) {
            checked++;
            const inst = doc.data();
            const [h, m] = (inst.scheduledStartTime || '00:00').split(':').map(Number);
            const [year, month, day] = dateStr.split('-').map(Number);
            const scheduledTime = new Date(year, month - 1, day, h, m);
            // Configurable no-show grace period: plan-level > coach-level > default 15 min
            let gracePeriodMinutes = 15;
            try {
                // Check plan-level grace period first (most specific)
                if (inst.memberId && inst.coachId) {
                    const planSnap = await db.collection('member_plans')
                        .where('memberId', '==', inst.memberId)
                        .where('coachId', '==', inst.coachId)
                        .where('status', '==', 'active')
                        .limit(1)
                        .get();
                    if (!planSnap.empty) {
                        const planData = planSnap.docs[0].data();
                        if (typeof planData.noShowGraceMinutes === 'number' && planData.noShowGraceMinutes >= 5 && planData.noShowGraceMinutes <= 60) {
                            gracePeriodMinutes = planData.noShowGraceMinutes;
                        }
                    }
                }
                // Fall back to coach-level grace period if plan didn't set one
                if (gracePeriodMinutes === 15 && inst.coachId) {
                    const coachSnap = await db.collection('coaches').doc(inst.coachId).get();
                    if (coachSnap.exists) {
                        const coachData = coachSnap.data();
                        if (typeof coachData.noShowGraceMinutes === 'number' && coachData.noShowGraceMinutes >= 5 && coachData.noShowGraceMinutes <= 60) {
                            gracePeriodMinutes = coachData.noShowGraceMinutes;
                        }
                    }
                }
            }
            catch (err) {
                console.warn(`[detectNoShows] Failed to read grace period for ${inst.coachId}/${inst.memberId}: ${err.message}`);
            }
            const graceDeadline = new Date(scheduledTime.getTime() + gracePeriodMinutes * 60 * 1000);
            // Only mark as missed if grace period has passed
            if (now < graceDeadline) {
                skipped++;
                continue;
            }
            // Check if a meeting.started event exists for this instance
            const eventsSnap = await db.collection('session_events')
                .where('instanceId', '==', doc.id)
                .where('eventType', '==', 'meeting.started')
                .limit(1)
                .get();
            if (!eventsSnap.empty) {
                skipped++; // Meeting did start, not a no-show
                continue;
            }
            // No meeting started — mark as missed
            await doc.ref.update({
                status: 'missed',
                missedReason: 'auto_no_show',
                missedAt: firestore_2.FieldValue.serverTimestamp(),
                updatedAt: firestore_2.FieldValue.serverTimestamp(),
            });
            marked++;
            // Write audit log
            await writeAuditLog({
                coachId: inst.coachId,
                action: 'instance_auto_missed',
                recurringSlotId: inst.recurringSlotId || '',
                memberId: inst.memberId,
                details: `Auto-marked as missed (no-show): ${inst.memberName} on ${dateStr} at ${inst.scheduledStartTime}`,
            });
        }
    }
    console.log(`[detectNoShows] Done. checked=${checked} marked=${marked} skipped=${skipped}`);
});
// ─── requestSkipInstance — Member requests a skip (with coach approval) ──────
exports.requestSkipInstance = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { instanceId, skipCategory, reason } = request.data;
    if (!instanceId)
        throw new https_1.HttpsError('invalid-argument', 'instanceId is required');
    const instRef = db.collection('session_instances').doc(instanceId);
    const instSnap = await instRef.get();
    if (!instSnap.exists)
        throw new https_1.HttpsError('not-found', 'Session instance not found');
    const inst = instSnap.data();
    if (inst.memberId !== callerUid) {
        throw new https_1.HttpsError('permission-denied', 'You can only request skips for your own sessions');
    }
    if (!['scheduled', 'allocated', 'allocation_failed'].includes(inst.status)) {
        throw new https_1.HttpsError('failed-precondition', `Cannot request skip for instance in status "${inst.status}"`);
    }
    // Rate limiting: max 3 pending skip requests per member
    const pendingSnap = await db.collection('session_instances')
        .where('memberId', '==', callerUid)
        .where('status', '==', 'skip_requested')
        .limit(4)
        .get();
    if (pendingSnap.size >= 3) {
        throw new https_1.HttpsError('resource-exhausted', 'You already have 3 pending skip requests. Please wait for your coach to review them before requesting more.');
    }
    const VALID_SKIP_CATEGORIES = ['Holiday', 'Vacation', 'Illness', 'Other'];
    const resolvedCategory = skipCategory && VALID_SKIP_CATEGORIES.includes(skipCategory) ? skipCategory : 'Other';
    // Auto-approval rules: check coach settings
    let autoApproved = false;
    try {
        const coachSnap = await db.collection('coaches').doc(inst.coachId).get();
        if (coachSnap.exists) {
            const coachData = coachSnap.data();
            // Read auto-approval settings (field names match account.tsx UI)
            const autoCategories = coachData.autoApproveSkipCategories;
            const autoLeadDays = coachData.autoApproveSkipLeadDays;
            // Auto-approve by category
            if (autoCategories && autoCategories.includes(resolvedCategory)) {
                autoApproved = true;
            }
            // Auto-approve if requested far enough in advance (leadDays converted to hours)
            if (!autoApproved && typeof autoLeadDays === 'number' && autoLeadDays > 0) {
                const [year, month, day] = inst.scheduledDate.split('-').map(Number);
                const [h, m] = (inst.scheduledStartTime || inst.startTime || '00:00').split(':').map(Number);
                const sessionTime = new Date(year, month - 1, day, h, m);
                const hoursUntil = (sessionTime.getTime() - Date.now()) / (1000 * 60 * 60);
                if (hoursUntil >= autoLeadDays * 24) {
                    autoApproved = true;
                }
            }
        }
    }
    catch (err) {
        console.warn(`[requestSkipInstance] Failed to check auto-approval rules: ${err.message}`);
    }
    if (autoApproved) {
        // Auto-approve: skip directly
        await instRef.update({
            status: 'skipped',
            skipCategory: resolvedCategory,
            skipReason: reason || resolvedCategory,
            skipRequestedBy: callerUid,
            skipRequestedAt: firestore_2.FieldValue.serverTimestamp(),
            skipApprovedBy: 'auto',
            skipApprovedAt: firestore_2.FieldValue.serverTimestamp(),
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
        });
        await writeAuditLog({
            coachId: inst.coachId,
            action: 'skip_auto_approved',
            sessionInstanceId: instanceId,
            memberId: callerUid,
            details: `Auto-approved skip for ${inst.scheduledDate} [${resolvedCategory}]${reason ? ': ' + reason : ''}`,
        });
        // Notify member that skip was auto-approved
        try {
            const { sendNotification } = await Promise.resolve().then(() => __importStar(require('./notifications')));
            const memberSnap = await db.collection('members').doc(callerUid).get();
            const memberData = memberSnap.exists ? memberSnap.data() : {};
            await sendNotification({
                messageType: 'skip_request_resolved',
                channel: 'push',
                recipient: {
                    uid: callerUid,
                    email: memberData.email,
                    displayName: memberData.displayName || 'Member',
                    role: 'member',
                },
                subject: 'Skip Request Auto-Approved',
                body: `Your skip request for ${inst.scheduledDate} [${resolvedCategory}] was automatically approved.`,
                sessionInstanceId: instanceId,
                coachId: inst.coachId,
                memberId: callerUid,
            });
        }
        catch (err) {
            console.warn(`[requestSkipInstance] Failed to send auto-approval notification: ${err.message}`);
        }
        return { success: true, autoApproved: true };
    }
    await instRef.update({
        previousStatus: inst.status,
        status: 'skip_requested',
        skipCategory: resolvedCategory,
        skipReason: reason || resolvedCategory,
        skipRequestedAt: firestore_2.FieldValue.serverTimestamp(),
        skipRequestedBy: callerUid,
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
    });
    await writeAuditLog({
        coachId: inst.coachId,
        action: 'skip_requested_by_member',
        sessionInstanceId: instanceId,
        memberId: callerUid,
        details: `Member requested skip for ${inst.scheduledDate} [${resolvedCategory}]${reason ? ': ' + reason : ''}`,
    });
    // Push + email notification to coach
    try {
        const { sendNotification } = await Promise.resolve().then(() => __importStar(require('./notifications')));
        const coachSnap = await db.collection('coaches').doc(inst.coachId).get();
        const coachData = coachSnap.exists ? coachSnap.data() : {};
        const notifPayload = {
            messageType: 'skip_request_received',
            recipient: {
                uid: inst.coachId,
                email: coachData.email,
                displayName: coachData.displayName || 'Coach',
                role: 'coach',
            },
            subject: 'Skip Request from Member',
            body: `${inst.memberName || 'A member'} requested to skip their ${inst.scheduledDate} session [${resolvedCategory}].${reason ? ' Reason: ' + reason : ''}`,
            sessionInstanceId: instanceId,
            coachId: inst.coachId,
            memberId: callerUid,
        };
        // Send push notification
        await sendNotification(Object.assign(Object.assign({}, notifPayload), { channel: 'push' }));
        // Send email notification if coach has email
        if (coachData.email) {
            await sendNotification(Object.assign(Object.assign({}, notifPayload), { channel: 'email', htmlBody: `<p><strong>${inst.memberName || 'A member'}</strong> requested to skip their <strong>${inst.scheduledDate}</strong> session.</p><p><strong>Category:</strong> ${resolvedCategory}</p>${reason ? `<p><strong>Reason:</strong> ${reason}</p>` : ''}<p>Open the app to approve or deny this request.</p>` }));
        }
    }
    catch (err) {
        console.warn(`[requestSkipInstance] Failed to send skip request notification: ${err.message}`);
    }
    return { success: true, autoApproved: false };
});
// ─── checkSlotConflicts — Server-side real-time conflict detection ───────────
// Called during slot creation to catch race conditions where two coaches
// create overlapping slots simultaneously.
exports.checkSlotConflicts = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { coachId, dayOfWeek, startTime, durationMinutes, guidancePhase, excludeSlotId } = request.data;
    if (!coachId || dayOfWeek === undefined || !startTime || !durationMinutes) {
        throw new https_1.HttpsError('invalid-argument', 'coachId, dayOfWeek, startTime, and durationMinutes are required');
    }
    // Self-guided sessions don't need coach presence — no conflict
    if (guidancePhase === 'self_guided') {
        return { hasConflict: false, conflicts: [] };
    }
    // Parse the proposed slot time
    const [ph, pm] = startTime.split(':').map(Number);
    const proposedStart = ph * 60 + pm;
    const proposedEnd = proposedStart + durationMinutes;
    // Query all active slots for this coach on this day
    const slotsSnap = await db.collection('recurring_slots')
        .where('coachId', '==', coachId)
        .where('dayOfWeek', '==', dayOfWeek)
        .where('status', '==', 'active')
        .get();
    const conflicts = [];
    for (const slotDoc of slotsSnap.docs) {
        if (excludeSlotId && slotDoc.id === excludeSlotId)
            continue;
        const slot = slotDoc.data();
        if (slot.guidancePhase === 'self_guided')
            continue;
        const [sh, sm] = slot.startTime.split(':').map(Number);
        const slotStart = sh * 60 + sm;
        const slotEnd = slotStart + (slot.durationMinutes || 30);
        if (proposedStart < slotEnd && proposedEnd > slotStart) {
            conflicts.push({
                slotId: slotDoc.id,
                memberName: slot.memberName || 'Unknown',
                startTime: slot.startTime,
                durationMinutes: slot.durationMinutes || 30,
            });
        }
    }
    // Also check actual instances for the next 4 weeks (catches biweekly/monthly)
    const now = new Date();
    const fourWeeksOut = new Date(now.getTime() + 28 * 24 * 60 * 60 * 1000);
    const todayStr = now.toISOString().split('T')[0];
    const futureStr = fourWeeksOut.toISOString().split('T')[0];
    const instancesSnap = await db.collection('session_instances')
        .where('coachId', '==', coachId)
        .where('scheduledDate', '>=', todayStr)
        .where('scheduledDate', '<=', futureStr)
        .where('status', 'in', ['scheduled', 'allocated'])
        .get();
    for (const instDoc of instancesSnap.docs) {
        const inst = instDoc.data();
        if (excludeSlotId && (inst.recurringSlotId === excludeSlotId || inst.slotId === excludeSlotId))
            continue;
        // Check if instance falls on the same day of week
        const instDate = new Date(inst.scheduledDate + 'T00:00:00');
        if (instDate.getDay() !== dayOfWeek)
            continue;
        // Check if the instance's parent slot is already counted
        const parentAlreadyCounted = conflicts.some(c => c.slotId === inst.recurringSlotId || c.slotId === inst.slotId);
        if (parentAlreadyCounted)
            continue;
        const [ih, im] = (inst.scheduledStartTime || inst.startTime || '00:00').split(':').map(Number);
        const instStart = ih * 60 + im;
        const instEnd = instStart + (inst.durationMinutes || 30);
        if (proposedStart < instEnd && proposedEnd > instStart) {
            conflicts.push({
                slotId: inst.recurringSlotId || inst.slotId || instDoc.id,
                memberName: inst.memberName || 'Unknown',
                startTime: inst.scheduledStartTime || inst.startTime || '00:00',
                durationMinutes: inst.durationMinutes || 30,
            });
        }
    }
    return { hasConflict: conflicts.length > 0, conflicts };
});
// ─── refreshRecordingUrl — Proxy to get fresh Zoom recording download URL ───
// Zoom recording play_url and download_url contain time-limited tokens.
// This CF fetches a fresh URL via the Zoom API using S2S OAuth.
exports.refreshRecordingUrl = (0, https_1.onCall)({ region: 'us-central1', secrets: [zoomAccountId, zoomClientId, zoomClientSecret] }, async (request) => {
    var _a, _b, _c, _d, _e;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { instanceId } = request.data;
    if (!instanceId)
        throw new https_1.HttpsError('invalid-argument', 'instanceId is required');
    // Verify caller is coach or admin
    const coachSnap = await db.collection('coaches').doc(callerUid).get();
    const isCoach = coachSnap.exists;
    const adminSnap = await db.collection('admins').doc(callerUid).get();
    const isAdmin = adminSnap.exists;
    if (!isCoach && !isAdmin) {
        throw new https_1.HttpsError('permission-denied', 'Only coaches and admins can access recordings');
    }
    const instRef = db.collection('session_instances').doc(instanceId);
    const instSnap = await instRef.get();
    if (!instSnap.exists)
        throw new https_1.HttpsError('not-found', 'Session instance not found');
    const inst = instSnap.data();
    // Coach can only access their own sessions
    if (isCoach && !isAdmin && inst.coachId !== callerUid) {
        throw new https_1.HttpsError('permission-denied', 'You can only access recordings for your own sessions');
    }
    const zoomMeetingId = inst.zoomMeetingId;
    if (!zoomMeetingId) {
        throw new https_1.HttpsError('failed-precondition', 'No Zoom meeting associated with this session');
    }
    // Cache: if recordings were refreshed within the last 4 hours, return cached data
    const lastRefreshed = inst.recordingRefreshedAt;
    if (lastRefreshed) {
        const refreshedMs = typeof lastRefreshed.toMillis === 'function'
            ? lastRefreshed.toMillis()
            : typeof lastRefreshed._seconds === 'number'
                ? lastRefreshed._seconds * 1000
                : 0;
        const fourHoursMs = 4 * 60 * 60 * 1000;
        if (Date.now() - refreshedMs < fourHoursMs) {
            return {
                success: true,
                recordingUrl: inst.zoomRecordingUrl || null,
                cached: true,
                message: 'Recording URL was refreshed recently. Using cached version.',
            };
        }
    }
    try {
        const provider = (0, zoom_1.getZoomProvider)({
            accountId: zoomAccountId.value(),
            clientId: zoomClientId.value(),
            clientSecret: zoomClientSecret.value(),
        });
        if (provider.mode === 'mock') {
            return {
                success: true,
                recordingUrl: inst.zoomRecordingUrl || null,
                message: 'Mock mode — returning stored URL',
            };
        }
        // Use the Zoom API to get fresh recording URLs
        // GET /meetings/{meetingId}/recordings
        const realProvider = provider;
        const token = await realProvider.getToken();
        const response = await fetch(`https://api.zoom.us/v2/meetings/${zoomMeetingId}/recordings`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        });
        if (!response.ok) {
            if (response.status === 404) {
                return { success: false, error: 'Recording not found or has been deleted from Zoom' };
            }
            const errorText = await response.text();
            throw new Error(`Zoom API error (${response.status}): ${errorText}`);
        }
        const data = await response.json();
        const freshShareUrl = data.share_url;
        const freshPlayUrl = (_c = (_b = data.recording_files) === null || _b === void 0 ? void 0 : _b.find(f => f.file_type === 'MP4')) === null || _c === void 0 ? void 0 : _c.play_url;
        const freshDownloadUrl = (_e = (_d = data.recording_files) === null || _d === void 0 ? void 0 : _d.find(f => f.file_type === 'MP4')) === null || _e === void 0 ? void 0 : _e.download_url;
        const recordingUrl = freshShareUrl || freshPlayUrl || inst.zoomRecordingUrl;
        // Update the instance with fresh URLs
        const updateData = {
            updatedAt: firestore_2.FieldValue.serverTimestamp(),
            recordingRefreshedAt: firestore_2.FieldValue.serverTimestamp(),
        };
        if (recordingUrl)
            updateData.zoomRecordingUrl = recordingUrl;
        if (data.recording_files) {
            updateData.recordings = data.recording_files.map(f => ({
                fileType: f.file_type,
                playUrl: f.play_url,
                downloadUrl: f.download_url,
                recordingStart: f.recording_start,
                recordingEnd: f.recording_end,
                status: f.status,
            }));
        }
        await instRef.update(updateData);
        return {
            success: true,
            recordingUrl,
            downloadUrl: freshDownloadUrl || null,
            playUrl: freshPlayUrl || null,
            shareUrl: freshShareUrl || null,
        };
    }
    catch (err) {
        console.error(`[refreshRecordingUrl] Error: ${err.message}`);
        throw new https_1.HttpsError('internal', `Failed to refresh recording URL: ${err.message}`);
    }
});
// ─── regenerateIcalToken — Coach regenerates their iCal feed token ───────────
exports.regenerateIcalToken = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const coachRef = db.collection('coaches').doc(callerUid);
    const coachSnap = await coachRef.get();
    if (!coachSnap.exists)
        throw new https_1.HttpsError('permission-denied', 'Not a coach');
    // Generate a new random token (24 chars, URL-safe)
    const crypto = await Promise.resolve().then(() => __importStar(require('crypto')));
    const newToken = crypto.randomBytes(18).toString('base64url');
    await coachRef.update({
        icalToken: newToken,
        icalTokenUpdatedAt: firestore_2.FieldValue.serverTimestamp(),
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
    });
    return { success: true, token: newToken };
});
// ─── migrateIcalTokens — One-time migration to generate iCal tokens for all coaches ───
exports.migrateIcalTokens = (0, https_1.onCall)({ region: 'us-central1' }, async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    // Only admins can run this migration
    const adminSnap = await db.collection('admins').doc(callerUid).get();
    if (!adminSnap.exists)
        throw new https_1.HttpsError('permission-denied', 'Only admins can run migrations');
    const crypto = await Promise.resolve().then(() => __importStar(require('crypto')));
    const coachesSnap = await db.collection('coaches').get();
    let migrated = 0;
    let skipped = 0;
    const batch = db.batch();
    for (const doc of coachesSnap.docs) {
        const data = doc.data();
        if (data.icalToken) {
            skipped++;
            continue;
        }
        const newToken = crypto.randomBytes(18).toString('base64url');
        batch.update(doc.ref, {
            icalToken: newToken,
            icalTokenUpdatedAt: firestore_2.FieldValue.serverTimestamp(),
        });
        migrated++;
    }
    if (migrated > 0) {
        await batch.commit();
    }
    await writeAuditLog({
        coachId: callerUid,
        action: 'ical_token_migration',
        details: `Migrated ${migrated} coaches, skipped ${skipped} (already had tokens)`,
    });
    return { success: true, migrated, skipped };
});
// ─── Google Calendar Integration ─────────────────────────────────────────────
function getGoogleOAuth2Client(redirectUri) {
    const uri = redirectUri !== null && redirectUri !== void 0 ? redirectUri : `https://us-central1-goarrive.cloudfunctions.net/googleCalendarCallback`;
    return new googleapis_1.google.auth.OAuth2(googleClientId.value().trim(), googleClientSecret.value().trim(), uri);
}
/**
 * initGoogleCalendarAuth — Generate OAuth2 consent URL for Google Calendar.
 * Coach calls this to start the OAuth flow.
 */
exports.initGoogleCalendarAuth = (0, https_1.onCall)({ secrets: [googleClientId, googleClientSecret] }, async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    // Verify caller is a coach
    const coachDoc = await db.collection('coaches').doc(callerUid).get();
    if (!coachDoc.exists)
        throw new https_1.HttpsError('permission-denied', 'Coach only');
    const oauth2Client = getGoogleOAuth2Client();
    const scopes = ['https://www.googleapis.com/auth/calendar.events'];
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent',
        state: callerUid, // pass coach UID through state
    });
    return { authUrl };
});
/**
 * googleCalendarCallback — HTTP endpoint that handles the OAuth2 redirect from Google.
 * Stores refresh_token on the coach document.
 */
exports.googleCalendarCallback = (0, https_1.onRequest)({ secrets: [googleClientId, googleClientSecret] }, async (req, res) => {
    try {
        const code = req.query.code;
        const coachId = req.query.state;
        if (!code || !coachId) {
            res.status(400).send('Missing code or state parameter');
            return;
        }
        const oauth2Client = getGoogleOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);
        if (!tokens.refresh_token) {
            res.status(400).send('No refresh token received. Please revoke access at https://myaccount.google.com/permissions and try again.');
            return;
        }
        // Decode the real email from the id_token JWT payload (base64url middle segment)
        let googleCalendarEmail = 'connected';
        if (tokens.id_token) {
            try {
                const payload = JSON.parse(Buffer.from(tokens.id_token.split('.')[1], 'base64url').toString('utf8'));
                if (payload.email)
                    googleCalendarEmail = payload.email;
            }
            catch (_) { /* fallback to 'connected' */ }
        }
        // Store tokens on coach document
        await db.collection('coaches').doc(coachId).update({
            googleCalendarRefreshToken: tokens.refresh_token,
            googleCalendarConnectedAt: firestore_2.FieldValue.serverTimestamp(),
            googleCalendarEmail,
        });
        await writeAuditLog({
            coachId,
            action: 'google_calendar_connected',
            details: 'Google Calendar OAuth2 connected successfully',
        });
        // Redirect to the app's account page
        res.redirect('https://goarrive.web.app/account?gcal=connected');
    }
    catch (err) {
        console.error('[googleCalendarCallback] Error:', err);
        res.status(500).send('Failed to connect Google Calendar: ' + (err.message || 'Unknown error'));
    }
});
/**
 * syncToGoogleCalendar — Push upcoming sessions to Google Calendar as events.
 * Coach calls this manually or it can be triggered after slot creation.
 */
exports.syncToGoogleCalendar = (0, https_1.onCall)({ secrets: [googleClientId, googleClientSecret] }, async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const coachDoc = await db.collection('coaches').doc(callerUid).get();
    if (!coachDoc.exists)
        throw new https_1.HttpsError('permission-denied', 'Coach only');
    const coachData = coachDoc.data();
    const refreshToken = coachData.googleCalendarRefreshToken;
    if (!refreshToken) {
        throw new https_1.HttpsError('failed-precondition', 'Google Calendar not connected. Please connect first in Account settings.');
    }
    const oauth2Client = getGoogleOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: refreshToken });
    const calendar = googleapis_1.google.calendar({ version: 'v3', auth: oauth2Client });
    // Fetch upcoming instances for this coach (next 30 days)
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const future = new Date();
    future.setDate(future.getDate() + 30);
    const futureStr = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, '0')}-${String(future.getDate()).padStart(2, '0')}`;
    const instSnap = await db.collection('session_instances')
        .where('coachId', '==', callerUid)
        .where('scheduledDate', '>=', todayStr)
        .where('scheduledDate', '<=', futureStr)
        .where('status', 'in', ['scheduled', 'allocated'])
        .get();
    let created = 0;
    let skipped = 0;
    for (const doc of instSnap.docs) {
        const inst = doc.data();
        // Skip if already synced
        if (inst.googleCalendarEventId) {
            skipped++;
            continue;
        }
        try {
            const startDateTime = `${inst.scheduledDate}T${inst.scheduledTime || '09:00'}:00`;
            const durationMin = inst.durationMinutes || 30;
            const endDate = new Date(startDateTime);
            endDate.setMinutes(endDate.getMinutes() + durationMin);
            const endDateTime = endDate.toISOString();
            const event = await calendar.events.insert({
                calendarId: 'primary',
                requestBody: {
                    summary: `GoArrive: ${inst.memberName || 'Session'} (${inst.sessionType || 'coaching'})`,
                    description: `GoArrive coaching session with ${inst.memberName || 'member'}.\nSession ID: ${doc.id}`,
                    start: {
                        dateTime: startDateTime,
                        timeZone: inst.timezone || 'America/New_York',
                    },
                    end: {
                        dateTime: endDateTime,
                        timeZone: inst.timezone || 'America/New_York',
                    },
                    reminders: {
                        useDefault: false,
                        overrides: [{ method: 'popup', minutes: 15 }],
                    },
                },
            });
            // Store the Google Calendar event ID on the instance
            await doc.ref.update({
                googleCalendarEventId: event.data.id,
                googleCalendarSyncedAt: firestore_2.FieldValue.serverTimestamp(),
            });
            created++;
        }
        catch (err) {
            console.error(`[syncToGoogleCalendar] Failed to create event for ${doc.id}:`, err.message);
        }
    }
    await writeAuditLog({
        coachId: callerUid,
        action: 'google_calendar_sync',
        details: `Synced ${created} events, skipped ${skipped} (already synced)`,
    });
    return { success: true, created, skipped };
});
/**
 * disconnectGoogleCalendar — Remove Google Calendar OAuth tokens from coach document.
 */
exports.disconnectGoogleCalendar = (0, https_1.onCall)(async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const coachDoc = await db.collection('coaches').doc(callerUid).get();
    if (!coachDoc.exists)
        throw new https_1.HttpsError('permission-denied', 'Coach only');
    await db.collection('coaches').doc(callerUid).update({
        googleCalendarRefreshToken: firestore_2.FieldValue.delete(),
        googleCalendarConnectedAt: firestore_2.FieldValue.delete(),
        googleCalendarEmail: firestore_2.FieldValue.delete(),
    });
    await writeAuditLog({
        coachId: callerUid,
        action: 'google_calendar_disconnected',
        details: 'Google Calendar OAuth tokens removed',
    });
    return { success: true };
});
// ─── Google Calendar Conflict-Check Accounts ─────────────────────────────────
/**
 * initGcalConflictAuth — Generate OAuth2 consent URL for a conflict-check Google account.
 * The state encodes "coachId:conflict" so the callback knows to store it as a conflict account.
 */
exports.initGcalConflictAuth = (0, https_1.onCall)({ secrets: [googleClientId, googleClientSecret] }, async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const coachDoc = await db.collection('coaches').doc(callerUid).get();
    if (!coachDoc.exists)
        throw new https_1.HttpsError('permission-denied', 'Coach only');
    const conflictRedirectUri = `https://us-central1-goarrive.cloudfunctions.net/gcalConflictCallback`;
    const oauth2Client = getGoogleOAuth2Client(conflictRedirectUri);
    // We need calendar.readonly to list calendars and check freebusy
    const scopes = [
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/userinfo.email',
    ];
    const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: scopes,
        prompt: 'consent',
        // Encode purpose in state so the callback can distinguish
        state: `${callerUid}:conflict`,
    });
    return { authUrl };
});
/**
 * gcalConflictCallback — HTTP endpoint that handles the OAuth2 redirect for conflict-check accounts.
 * Adds the new account to coaches/{coachId}.gcalConflictAccounts array.
 */
exports.gcalConflictCallback = (0, https_1.onRequest)({ secrets: [googleClientId, googleClientSecret] }, async (req, res) => {
    try {
        const code = req.query.code;
        const rawState = req.query.state;
        if (!code || !rawState) {
            res.status(400).send('Missing code or state parameter');
            return;
        }
        // State is "coachId:conflict"
        const [coachId, purpose] = rawState.split(':');
        if (!coachId || purpose !== 'conflict') {
            res.status(400).send('Invalid state parameter');
            return;
        }
        const conflictRedirectUri = `https://us-central1-goarrive.cloudfunctions.net/gcalConflictCallback`;
        const oauth2Client = getGoogleOAuth2Client(conflictRedirectUri);
        const { tokens } = await oauth2Client.getToken(code);
        if (!tokens.refresh_token) {
            res.status(400).send('No refresh token received. Please revoke access at https://myaccount.google.com/permissions and try again.');
            return;
        }
        // Fetch the email for this account using the access token
        oauth2Client.setCredentials(tokens);
        const oauth2 = googleapis_1.google.oauth2({ version: 'v2', auth: oauth2Client });
        const userInfo = await oauth2.userinfo.get();
        const email = userInfo.data.email || 'unknown';
        // Build a stable accountId from the email
        const accountId = email.replace(/[^a-zA-Z0-9]/g, '_');
        // Load existing conflict accounts
        const coachDoc = await db.collection('coaches').doc(coachId).get();
        if (!coachDoc.exists) {
            res.status(404).send('Coach not found');
            return;
        }
        const coachData = coachDoc.data();
        const existingAccounts = coachData.gcalConflictAccounts || [];
        // Replace if already exists (re-auth), otherwise append
        const filtered = existingAccounts.filter((a) => a.accountId !== accountId);
        filtered.push({
            accountId,
            email,
            refreshToken: tokens.refresh_token,
            connectedAt: new Date().toISOString(),
            calendars: [], // populated when coach selects sub-calendars
        });
        await db.collection('coaches').doc(coachId).update({
            gcalConflictAccounts: filtered,
        });
        await writeAuditLog({
            coachId,
            action: 'gcal_conflict_account_connected',
            details: `Conflict-check Google account connected: ${email}`,
        });
        res.redirect(`https://goarrive.web.app/account?gcal=conflict_connected&email=${encodeURIComponent(email)}`);
    }
    catch (err) {
        console.error('[gcalConflictCallback] Error:', err);
        res.status(500).send('Failed to connect conflict-check Google Calendar: ' + (err.message || 'Unknown error'));
    }
});
/**
 * listGcalConflictCalendars — List all calendars for a specific conflict-check account.
 * Returns the calendar list so the coach can pick which sub-calendars to check.
 */
exports.listGcalConflictCalendars = (0, https_1.onCall)({ secrets: [googleClientId, googleClientSecret] }, async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { accountId } = request.data;
    if (!accountId)
        throw new https_1.HttpsError('invalid-argument', 'accountId required');
    const coachDoc = await db.collection('coaches').doc(callerUid).get();
    if (!coachDoc.exists)
        throw new https_1.HttpsError('permission-denied', 'Coach only');
    const coachData = coachDoc.data();
    const accounts = coachData.gcalConflictAccounts || [];
    const account = accounts.find((a) => a.accountId === accountId);
    if (!account)
        throw new https_1.HttpsError('not-found', 'Conflict account not found');
    const oauth2Client = getGoogleOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: account.refreshToken });
    const calendar = googleapis_1.google.calendar({ version: 'v3', auth: oauth2Client });
    const calList = await calendar.calendarList.list({ minAccessRole: 'reader' });
    const items = (calList.data.items || []).map((c) => ({
        id: c.id,
        name: c.summary,
        primary: c.primary || false,
    }));
    return { calendars: items };
});
/**
 * updateGcalConflictCalendars — Save the selected sub-calendar IDs for a conflict-check account.
 */
exports.updateGcalConflictCalendars = (0, https_1.onCall)({ secrets: [googleClientId, googleClientSecret] }, async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { accountId, selectedCalendarIds } = request.data;
    if (!accountId)
        throw new https_1.HttpsError('invalid-argument', 'accountId required');
    const coachRef = db.collection('coaches').doc(callerUid);
    const coachDoc = await coachRef.get();
    if (!coachDoc.exists)
        throw new https_1.HttpsError('permission-denied', 'Coach only');
    const coachData = coachDoc.data();
    const accounts = coachData.gcalConflictAccounts || [];
    const idx = accounts.findIndex((a) => a.accountId === accountId);
    if (idx === -1)
        throw new https_1.HttpsError('not-found', 'Conflict account not found');
    accounts[idx].selectedCalendarIds = selectedCalendarIds;
    await coachRef.update({ gcalConflictAccounts: accounts });
    await writeAuditLog({
        coachId: callerUid,
        action: 'gcal_conflict_calendars_updated',
        details: `Updated selected calendars for ${accounts[idx].email}: ${selectedCalendarIds.join(', ')}`,
    });
    return { success: true };
});
/**
 * removeGcalConflictAccount — Remove a conflict-check Google account from the coach's list.
 */
exports.removeGcalConflictAccount = (0, https_1.onCall)(async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { accountId } = request.data;
    if (!accountId)
        throw new https_1.HttpsError('invalid-argument', 'accountId required');
    const coachRef = db.collection('coaches').doc(callerUid);
    const coachDoc = await coachRef.get();
    if (!coachDoc.exists)
        throw new https_1.HttpsError('permission-denied', 'Coach only');
    const coachData = coachDoc.data();
    const accounts = coachData.gcalConflictAccounts || [];
    const filtered = accounts.filter((a) => a.accountId !== accountId);
    await coachRef.update({ gcalConflictAccounts: filtered });
    await writeAuditLog({
        coachId: callerUid,
        action: 'gcal_conflict_account_removed',
        details: `Removed conflict-check account: ${accountId}`,
    });
    return { success: true };
});
/**
 * checkGcalConflicts — Check if a proposed time slot conflicts with any event in the
 * coach's selected conflict-check calendars across all connected Google accounts.
 * Returns { hasConflict: boolean, conflictingEvents: { calendarEmail, summary, start, end }[] }
 */
exports.checkGcalConflicts = (0, https_1.onCall)({ secrets: [googleClientId, googleClientSecret] }, async (request) => {
    var _a, _b, _c, _d, _e;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be signed in');
    const { startDateTime, endDateTime, timezone } = request.data;
    if (!startDateTime || !endDateTime) {
        throw new https_1.HttpsError('invalid-argument', 'startDateTime and endDateTime required');
    }
    const coachDoc = await db.collection('coaches').doc(callerUid).get();
    if (!coachDoc.exists)
        throw new https_1.HttpsError('permission-denied', 'Coach only');
    const coachData = coachDoc.data();
    const accounts = coachData.gcalConflictAccounts || [];
    const conflictingEvents = [];
    for (const account of accounts) {
        const selectedIds = account.selectedCalendarIds || [];
        if (selectedIds.length === 0)
            continue; // skip if no calendars selected
        try {
            const oauth2Client = getGoogleOAuth2Client();
            oauth2Client.setCredentials({ refresh_token: account.refreshToken });
            const calendar = googleapis_1.google.calendar({ version: 'v3', auth: oauth2Client });
            // Use freebusy query for efficiency — one API call per account
            const freebusyRes = await calendar.freebusy.query({
                requestBody: {
                    timeMin: startDateTime,
                    timeMax: endDateTime,
                    timeZone: timezone || 'UTC',
                    items: selectedIds.map((id) => ({ id })),
                },
            });
            const calendars = freebusyRes.data.calendars || {};
            for (const calId of selectedIds) {
                const busy = ((_b = calendars[calId]) === null || _b === void 0 ? void 0 : _b.busy) || [];
                for (const slot of busy) {
                    conflictingEvents.push({
                        calendarEmail: account.email,
                        summary: `Busy on ${account.email}`,
                        start: slot.start || startDateTime,
                        end: slot.end || endDateTime,
                    });
                }
            }
        }
        catch (err) {
            console.error(`[checkGcalConflicts] Error checking account ${account.email}:`, err.message);
            // Detect revoked/expired tokens and mark the account so the UI can prompt re-auth
            const isTokenError = ((_c = err.message) === null || _c === void 0 ? void 0 : _c.includes('invalid_grant')) || ((_d = err.message) === null || _d === void 0 ? void 0 : _d.includes('Token has been expired or revoked'));
            if (isTokenError) {
                try {
                    const coachDocRef = db.collection('coaches').doc(callerUid);
                    const freshSnap = await coachDocRef.get();
                    const freshAccounts = ((_e = freshSnap.data()) === null || _e === void 0 ? void 0 : _e.gcalConflictAccounts) || [];
                    const updated = freshAccounts.map((a) => a.accountId === account.accountId ? Object.assign(Object.assign({}, a), { tokenExpired: true }) : a);
                    await coachDocRef.update({ gcalConflictAccounts: updated });
                }
                catch (updateErr) {
                    console.error('[checkGcalConflicts] Failed to mark tokenExpired:', updateErr.message);
                }
            }
            // Don't throw — continue checking other accounts
        }
    }
    return {
        hasConflict: conflictingEvents.length > 0,
        conflictingEvents,
    };
});
// ─── Workout Push Notifications ─────────────────────────────────────────────
/**
 * Send a push notification to a member when a workout is assigned to them.
 * Fires on workout_assignments document creation.
 *
 * Risk 8: Rate-limited — if a member received an assignment notification
 * within the last 60 seconds, this trigger skips the push to avoid spam
 * during batch assignments. Uses a lightweight Firestore cooldown doc.
 */
exports.onWorkoutAssigned = (0, firestore_1.onDocumentCreated)('workout_assignments/{assignmentId}', async (event) => {
    var _a;
    const snap = event.data;
    if (!snap)
        return;
    const data = snap.data();
    const memberId = data.memberId;
    if (!memberId) {
        console.warn('[onWorkoutAssigned] No memberId on assignment', snap.id);
        return;
    }
    // ── Rate-limit check (Risk 8) ──────────────────────────────────────
    const cooldownRef = db
        .collection('_notification_cooldowns')
        .doc(`workout_assigned_${memberId}`);
    const cooldownSnap = await cooldownRef.get();
    const cooldownData = cooldownSnap.data();
    const COOLDOWN_MS = 60000; // 60 seconds
    if (cooldownData === null || cooldownData === void 0 ? void 0 : cooldownData.lastSentAt) {
        const lastSent = cooldownData.lastSentAt.toDate
            ? cooldownData.lastSentAt.toDate()
            : new Date(cooldownData.lastSentAt);
        if (Date.now() - lastSent.getTime() < COOLDOWN_MS) {
            console.log(`[onWorkoutAssigned] Skipping push for ${memberId} — cooldown active (batch assignment).`);
            return;
        }
    }
    // Set cooldown timestamp before sending
    await cooldownRef.set({ lastSentAt: firestore_2.FieldValue.serverTimestamp() }, { merge: true });
    // Look up member's Expo push tokens
    const tokensSnap = await db
        .collection('users')
        .doc(memberId)
        .collection('fcmTokens')
        .get();
    if (tokensSnap.empty) {
        console.log('[onWorkoutAssigned] No push tokens for member', memberId);
        return;
    }
    const workoutName = data.workoutName || 'a workout';
    const scheduledDate = data.scheduledFor
        ? data.scheduledFor.toDate().toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
        })
        : 'soon';
    const title = 'New Workout Assigned';
    const body = `Your coach assigned "${workoutName}" for ${scheduledDate}. Open GoArrive to get started.`;
    // Also try legacy fcmToken field on user doc
    let legacyToken;
    try {
        const userDoc = await db.collection('users').doc(memberId).get();
        legacyToken = (_a = userDoc.data()) === null || _a === void 0 ? void 0 : _a.fcmToken;
    }
    catch (_b) { }
    // Send via FCM to all registered tokens
    const tokens = [];
    tokensSnap.docs.forEach((d) => {
        var _a;
        const t = (_a = d.data()) === null || _a === void 0 ? void 0 : _a.token;
        if (t)
            tokens.push(t);
    });
    if (legacyToken && !tokens.includes(legacyToken)) {
        tokens.push(legacyToken);
    }
    for (const token of tokens) {
        try {
            await messaging.send({
                token,
                notification: { title, body },
                data: { type: 'workout_assigned', assignmentId: snap.id },
                webpush: {
                    notification: { title, body, icon: '/icons/icon-192.png' },
                    fcmOptions: { link: '/workouts' },
                },
                apns: {
                    payload: { aps: { alert: { title, body }, sound: 'default', badge: 1 } },
                },
            });
            console.log('[onWorkoutAssigned] Push sent to token', token.substring(0, 20) + '...');
        }
        catch (err) {
            const code = (err === null || err === void 0 ? void 0 : err.code) || '';
            if (code === 'messaging/registration-token-not-registered' ||
                code === 'messaging/invalid-registration-token') {
                console.warn('[onWorkoutAssigned] Stale token, removing');
                // Remove stale token from subcollection
                const staleDoc = tokensSnap.docs.find((d) => { var _a; return ((_a = d.data()) === null || _a === void 0 ? void 0 : _a.token) === token; });
                if (staleDoc)
                    await staleDoc.ref.delete().catch(() => { });
            }
            else {
                console.error('[onWorkoutAssigned] FCM error:', err);
            }
        }
    }
});
/**
 * Send a push notification to a member when their coach reviews a workout log.
 * Fires on workout_logs document update when coachReaction or coachNote is added.
 */
exports.onWorkoutLogReviewed = (0, firestore_1.onDocumentUpdated)('workout_logs/{logId}', async (event) => {
    var _a, _b, _c, _d, _e;
    const before = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data();
    const after = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after) === null || _d === void 0 ? void 0 : _d.data();
    if (!before || !after)
        return;
    // Only fire when review fields change
    const reactionChanged = before.coachReaction !== after.coachReaction;
    const noteChanged = before.coachNote !== after.coachNote;
    if (!reactionChanged && !noteChanged)
        return;
    const memberId = after.memberId;
    if (!memberId)
        return;
    // Look up member's push tokens
    const tokensSnap = await db
        .collection('users')
        .doc(memberId)
        .collection('fcmTokens')
        .get();
    let legacyToken;
    try {
        const userDoc = await db.collection('users').doc(memberId).get();
        legacyToken = (_e = userDoc.data()) === null || _e === void 0 ? void 0 : _e.fcmToken;
    }
    catch (_f) { }
    const tokens = [];
    tokensSnap.docs.forEach((d) => {
        var _a;
        const t = (_a = d.data()) === null || _a === void 0 ? void 0 : _a.token;
        if (t)
            tokens.push(t);
    });
    if (legacyToken && !tokens.includes(legacyToken)) {
        tokens.push(legacyToken);
    }
    if (tokens.length === 0) {
        console.log('[onWorkoutLogReviewed] No push tokens for member', memberId);
        return;
    }
    const workoutName = after.workoutName || 'your workout';
    const reaction = after.coachReaction || '';
    const title = 'Coach Feedback';
    const body = reaction
        ? `Your coach reacted ${reaction} to "${workoutName}". ${after.coachNote ? 'They also left a note.' : ''}`
        : `Your coach left feedback on "${workoutName}".`;
    for (const token of tokens) {
        try {
            await messaging.send({
                token,
                notification: { title, body: body.trim() },
                data: { type: 'workout_reviewed', logId: event.params.logId },
                webpush: {
                    notification: { title, body: body.trim(), icon: '/icons/icon-192.png' },
                    fcmOptions: { link: '/workouts' },
                },
                apns: {
                    payload: { aps: { alert: { title, body: body.trim() }, sound: 'default', badge: 1 } },
                },
            });
        }
        catch (err) {
            const code = (err === null || err === void 0 ? void 0 : err.code) || '';
            if (code === 'messaging/registration-token-not-registered' ||
                code === 'messaging/invalid-registration-token') {
                const staleDoc = tokensSnap.docs.find((d) => { var _a; return ((_a = d.data()) === null || _a === void 0 ? void 0 : _a.token) === token; });
                if (staleDoc)
                    await staleDoc.ref.delete().catch(() => { });
            }
            else {
                console.error('[onWorkoutLogReviewed] FCM error:', err);
            }
        }
    }
});
// ────────────────────────────────────────────────────────────────────────────
// Movement Media Transcoding Pipeline
// ────────────────────────────────────────────────────────────────────────────
// Triggers when a video is uploaded to movements/{coachId}/ in Firebase Storage.
// Generates a lightweight thumbnail poster (first frame) and updates the
// movement document with the thumbnailUrl.
//
// Requires: sharp (for image extraction from video poster)
// Note: Full ffmpeg transcoding requires a higher-memory Cloud Function or
// a dedicated media pipeline. This stub handles thumbnail generation from
// the uploaded poster/thumbnail, and sets the movement's thumbnailUrl field.
// ────────────────────────────────────────────────────────────────────────────
const storage_1 = require("firebase-functions/v2/storage");
exports.onMovementMediaUploaded = (0, storage_1.onObjectFinalized)({ region: 'us-east1', memory: '512MiB', timeoutSeconds: 120 }, async (event) => {
    const filePath = event.data.name;
    const contentType = event.data.contentType || '';
    // Only process files in the movements/ directory
    if (!filePath || !filePath.startsWith('movements/'))
        return;
    // Only process video/image files
    const isVideo = contentType.startsWith('video/');
    const isImage = contentType.startsWith('image/');
    if (!isVideo && !isImage)
        return;
    // Skip if this is already a thumbnail
    if (filePath.includes('_thumb'))
        return;
    const db = admin.firestore();
    const bucket = admin.storage().bucket(event.data.bucket);
    // Extract coachId from path: movements/{coachId}/{filename}
    const parts = filePath.split('/');
    if (parts.length < 3)
        return;
    const coachId = parts[1];
    // Get the download URL for the uploaded file
    const file = bucket.file(filePath);
    const [signedUrl] = await file.getSignedUrl({
        action: 'read',
        expires: '2099-12-31',
    });
    // For images, generate a resized thumbnail
    if (isImage) {
        try {
            // Download the image
            const [buffer] = await file.download();
            // Use sharp to create a 320px wide thumbnail
            let sharp;
            try {
                sharp = require('sharp');
            }
            catch (_a) {
                console.log('[onMovementMediaUploaded] sharp not available, skipping thumbnail generation');
                return;
            }
            const thumbBuffer = await sharp(buffer)
                .resize(320, 320, { fit: 'inside', withoutEnlargement: true })
                .jpeg({ quality: 75 })
                .toBuffer();
            // Upload thumbnail
            const thumbPath = filePath.replace(/\.[^.]+$/, '_thumb.jpg');
            const thumbFile = bucket.file(thumbPath);
            await thumbFile.save(thumbBuffer, {
                metadata: { contentType: 'image/jpeg' },
            });
            await thumbFile.makePublic();
            const thumbUrl = `https://storage.googleapis.com/${event.data.bucket}/${thumbPath}`;
            // Find and update the movement document that references this media
            const movementsSnap = await db
                .collection('movements')
                .where('coachId', '==', coachId)
                .where('mediaUrl', '==', signedUrl)
                .limit(1)
                .get();
            if (!movementsSnap.empty) {
                await movementsSnap.docs[0].ref.update({
                    thumbnailUrl: thumbUrl,
                    updatedAt: firestore_2.FieldValue.serverTimestamp(),
                });
            }
            console.log(`[onMovementMediaUploaded] Thumbnail generated: ${thumbPath}`);
        }
        catch (err) {
            console.error('[onMovementMediaUploaded] Thumbnail generation error:', err);
        }
    }
    // For videos, just log — full ffmpeg transcoding requires additional setup
    if (isVideo) {
        console.log(`[onMovementMediaUploaded] Video uploaded: ${filePath}. ` +
            `Full transcoding pipeline requires ffmpeg. ` +
            `Consider using Cloud Run or a dedicated media service for H.264 re-encoding.`);
        // Still update the movement doc with the video URL if we can match it
        try {
            const movementsSnap = await db
                .collection('movements')
                .where('coachId', '==', coachId)
                .limit(50)
                .get();
            // Find the movement whose mediaUrl matches the storage path
            for (const doc of movementsSnap.docs) {
                const data = doc.data();
                if (data.mediaUrl && data.mediaUrl.includes(encodeURIComponent(filePath.split('/').pop() || ''))) {
                    // If no thumbnail exists yet, set a placeholder note
                    if (!data.thumbnailUrl) {
                        await doc.ref.update({
                            transcodingStatus: 'pending',
                            updatedAt: firestore_2.FieldValue.serverTimestamp(),
                        });
                    }
                    break;
                }
            }
        }
        catch (err) {
            console.error('[onMovementMediaUploaded] Video doc update error:', err);
        }
    }
});
// ═══════════════════════════════════════════════════════════════════════════
// WORKOUT COMPLETION NOTIFICATION
// ═══════════════════════════════════════════════════════════════════════════
/**
 * onWorkoutCompleted — Firestore onCreate trigger
 *
 * Fires when a new workout_log document is created (member completes a workout).
 * Sends a push notification to the coach so they can review the log.
 */
exports.onWorkoutCompleted = (0, firestore_1.onDocumentCreated)('workout_logs/{logId}', async (event) => {
    const snap = event.data;
    if (!snap)
        return;
    const data = snap.data();
    const coachId = data.coachId;
    const memberName = data.memberName || 'A member';
    const workoutName = data.workoutName || 'a workout';
    if (!coachId) {
        console.warn('[onWorkoutCompleted] No coachId on workout_log, skipping.');
        return;
    }
    // ── Rate-limit check (Risk 8) ──────────────────────────────────────
    // Prevent coach notification spam when multiple members finish at once.
    const cooldownRef = db
        .collection('_notification_cooldowns')
        .doc(`workout_completed_${coachId}`);
    const cooldownSnap = await cooldownRef.get();
    const cooldownData = cooldownSnap.data();
    const COOLDOWN_MS = 30000; // 30 seconds between coach notifications
    if (cooldownData === null || cooldownData === void 0 ? void 0 : cooldownData.lastSentAt) {
        const lastSent = cooldownData.lastSentAt.toDate
            ? cooldownData.lastSentAt.toDate()
            : new Date(cooldownData.lastSentAt);
        if (Date.now() - lastSent.getTime() < COOLDOWN_MS) {
            console.log(`[onWorkoutCompleted] Skipping push for coach ${coachId} — cooldown active.`);
            return;
        }
    }
    await cooldownRef.set({ lastSentAt: firestore_2.FieldValue.serverTimestamp() }, { merge: true });
    // Look up coach's push tokens
    const tokensSnap = await db
        .collection('users')
        .doc(coachId)
        .collection('fcmTokens')
        .get();
    // Also check legacy pushToken field
    const coachDoc = await db.collection('users').doc(coachId).get();
    const coachData = coachDoc.exists ? coachDoc.data() : undefined;
    const legacyToken = coachData === null || coachData === void 0 ? void 0 : coachData.pushToken;
    const tokens = [];
    tokensSnap.docs.forEach((d) => {
        var _a;
        const t = (_a = d.data()) === null || _a === void 0 ? void 0 : _a.token;
        if (t)
            tokens.push(t);
    });
    if (legacyToken && !tokens.includes(legacyToken)) {
        tokens.push(legacyToken);
    }
    if (tokens.length === 0) {
        console.log('[onWorkoutCompleted] Coach has no push tokens, skipping.');
        return;
    }
    // Check if journal was submitted
    const hasJournal = data.journal && (data.journal.glow || data.journal.grow);
    const swaps = Array.isArray(data.movementSwaps) ? data.movementSwaps : [];
    const swapCount = swaps.length;
    const title = swapCount > 0 ? 'Workout Completed (with swaps)' : 'Workout Completed';
    let body;
    if (swapCount > 0 && hasJournal) {
        body = `${memberName} completed "${workoutName}" with ${swapCount} movement swap${swapCount !== 1 ? 's' : ''} and left a reflection.`;
    }
    else if (swapCount > 0) {
        body = `${memberName} completed "${workoutName}" with ${swapCount} movement swap${swapCount !== 1 ? 's' : ''}. Tap to review.`;
    }
    else if (hasJournal) {
        body = `${memberName} completed "${workoutName}" and left a reflection.`;
    }
    else {
        body = `${memberName} completed "${workoutName}". Tap to review.`;
    }
    for (const token of tokens) {
        try {
            await messaging.send({
                token,
                notification: { title, body },
                data: { type: 'workout_completed', logId: snap.id, memberId: data.memberId || '' },
                apns: {
                    payload: { aps: { alert: { title, body }, sound: 'default', badge: 1 } },
                },
            });
            console.log(`[onWorkoutCompleted] Push sent to token ${token.substring(0, 20)}...`);
        }
        catch (err) {
            const code = (err === null || err === void 0 ? void 0 : err.code) || '';
            if (code === 'messaging/registration-token-not-registered' ||
                code === 'messaging/invalid-registration-token') {
                console.warn('[onWorkoutCompleted] Stale token, removing');
                const staleDoc = tokensSnap.docs.find((d) => { var _a; return ((_a = d.data()) === null || _a === void 0 ? void 0 : _a.token) === token; });
                if (staleDoc)
                    await staleDoc.ref.delete().catch(() => { });
            }
            else {
                console.error('[onWorkoutCompleted] FCM error:', err);
            }
        }
    }
});
// ── Recurring Assignment Continuation (Risk 3 / Suggestion 7) ──────────────
// Runs every Sunday at midnight UTC. Finds recurring assignment groups
// that are still active and generates the next week's assignments.
exports.continueRecurringAssignments = (0, scheduler_1.onSchedule)({ schedule: '0 0 * * 0', region: 'us-east1', timeoutSeconds: 300 }, async () => {
    const firestore = admin.firestore();
    const now = new Date();
    // Find all recurring groups that haven't expired
    const groupsSnap = await firestore
        .collection('recurring_schedules')
        .where('isActive', '==', true)
        .where('nextGenerateAfter', '<=', firestore_2.Timestamp.fromDate(now))
        .get();
    if (groupsSnap.empty) {
        console.log('[continueRecurringAssignments] No active recurring schedules to process.');
        return;
    }
    const batch = firestore.batch();
    let assignmentCount = 0;
    for (const scheduleDoc of groupsSnap.docs) {
        const schedule = scheduleDoc.data();
        const { coachId, memberId, workoutId, workoutName, workoutSnapshot, recurringDays, // 0=Mon..6=Sun
        endDate, } = schedule;
        // Check if the schedule has expired
        const endDateObj = (endDate === null || endDate === void 0 ? void 0 : endDate.toDate) ? endDate.toDate() : new Date(endDate);
        if (endDateObj < now) {
            batch.update(scheduleDoc.ref, { isActive: false });
            continue;
        }
        // Generate assignments for the coming week (next 7 days)
        const startOfWeek = new Date(now);
        startOfWeek.setDate(startOfWeek.getDate() + 1); // Start from Monday
        startOfWeek.setHours(0, 0, 0, 0);
        for (const dayIdx of (recurringDays || [])) {
            const targetDate = new Date(startOfWeek);
            // dayIdx: 0=Mon..6=Sun → JS: Mon=1..Sun=0
            const targetJsDay = dayIdx === 6 ? 0 : dayIdx + 1;
            const currentJsDay = targetDate.getDay();
            let diff = targetJsDay - currentJsDay;
            if (diff < 0)
                diff += 7;
            targetDate.setDate(targetDate.getDate() + diff);
            targetDate.setHours(0, 0, 0, 0);
            // Don't generate past the end date
            if (targetDate > endDateObj)
                continue;
            const assignRef = firestore.collection('workout_assignments').doc();
            batch.set(assignRef, {
                coachId,
                memberId,
                workoutId,
                workoutName: workoutName || 'Workout',
                workoutSnapshot: workoutSnapshot || null,
                scheduledFor: firestore_2.Timestamp.fromDate(targetDate),
                status: 'scheduled',
                recurringGroupId: scheduleDoc.id,
                createdAt: firestore_2.FieldValue.serverTimestamp(),
            });
            assignmentCount++;
        }
        // Update nextGenerateAfter to next Sunday
        const nextSunday = new Date(now);
        nextSunday.setDate(nextSunday.getDate() + 7);
        nextSunday.setHours(0, 0, 0, 0);
        batch.update(scheduleDoc.ref, {
            nextGenerateAfter: firestore_2.Timestamp.fromDate(nextSunday),
            lastGeneratedAt: firestore_2.FieldValue.serverTimestamp(),
        });
    }
    await batch.commit();
    console.log(`[continueRecurringAssignments] Generated ${assignmentCount} assignments from ${groupsSnap.size} schedules.`);
});
// ═══════════════════════════════════════════════════════════════════════════
// Risk 3: Cleanup stale notification cooldown documents
// Runs daily at 3:15 AM UTC. Deletes cooldown docs older than 24 hours
// to prevent unbounded growth of the _notification_cooldowns collection.
// ═══════════════════════════════════════════════════════════════════════════
exports.cleanupNotificationCooldowns = (0, scheduler_1.onSchedule)({
    schedule: '15 3 * * *',
    timeZone: 'Etc/UTC',
    retryCount: 3,
    memory: '256MiB',
}, async () => {
    const TAG = '[cleanupNotificationCooldowns]';
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h ago
    let totalDeleted = 0;
    let hasMore = true;
    try {
        // Paginate in batches of 500 (Firestore batch limit)
        while (hasMore) {
            const staleSnap = await db
                .collection('_notification_cooldowns')
                .where('lastSentAt', '<', firestore_2.Timestamp.fromDate(cutoff))
                .limit(500)
                .get();
            if (staleSnap.empty) {
                hasMore = false;
                break;
            }
            const batch = db.batch();
            staleSnap.docs.forEach((doc) => batch.delete(doc.ref));
            await batch.commit();
            totalDeleted += staleSnap.size;
            // If we got fewer than 500, we're done
            if (staleSnap.size < 500)
                hasMore = false;
        }
        // Log metrics for monitoring
        console.log(`${TAG} Completed. Deleted ${totalDeleted} stale cooldown docs.`);
        // Write a health-check doc for monitoring
        await db.collection('_system_health').doc('cooldown_cleanup').set({
            lastRunAt: firestore_2.Timestamp.now(),
            docsDeleted: totalDeleted,
            status: 'success',
        });
    }
    catch (err) {
        console.error(`${TAG} Error during cleanup:`, err);
        // Write failure status for monitoring
        await db.collection('_system_health').doc('cooldown_cleanup').set({
            lastRunAt: firestore_2.Timestamp.now(),
            docsDeleted: totalDeleted,
            status: 'error',
            error: String(err),
        }).catch(() => { }); // Don't fail on monitoring write
        throw err; // Re-throw to trigger Cloud Functions retry
    }
});
// ─── Server-side GIF Generation ──────────────────────────────────────────────
/**
 * generateMovementGif — Firestore trigger (onDocumentUpdated)
 *
 * When a movement document has a videoUrl but no thumbnailUrl (or thumbnailUrl
 * is empty), this function generates an animated GIF thumbnail server-side
 * using ffmpeg, uploads it to Firebase Storage, and patches the document.
 *
 * This offloads the CPU-intensive GIF generation from the coach's browser.
 * ffmpeg is available in the Cloud Functions runtime (Node 20 on Cloud Run).
 *
 * Trigger conditions:
 *   - videoUrl is set and non-empty
 *   - thumbnailUrl is empty or missing
 *   - The update didn't just set a thumbnailUrl (prevents infinite loop)
 */
exports.generateMovementGif = (0, firestore_1.onDocumentUpdated)('movements/{movementId}', async (event) => {
    var _a, _b, _c, _d;
    const TAG = '[generateMovementGif]';
    const before = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data();
    const after = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after) === null || _d === void 0 ? void 0 : _d.data();
    if (!before || !after)
        return;
    const videoUrl = after.videoUrl;
    const thumbnailUrl = after.thumbnailUrl;
    const coachId = after.coachId;
    const movementId = event.params.movementId;
    // Skip if no video URL
    if (!videoUrl)
        return;
    // Skip if thumbnailUrl is already set (non-empty)
    if (thumbnailUrl && thumbnailUrl.trim().length > 0)
        return;
    // Skip if gifGenerationFailed was just set (prevents retry loop from this trigger)
    const beforeFailed = before.gifGenerationFailed;
    const afterFailed = after.gifGenerationFailed;
    if (!beforeFailed && afterFailed)
        return;
    // Skip if the before state already had no thumbnail and no video change
    // (prevents re-triggering on unrelated field updates)
    const beforeVideoUrl = before.videoUrl;
    const beforeThumbnailUrl = before.thumbnailUrl;
    if (beforeVideoUrl === videoUrl &&
        (!beforeThumbnailUrl || beforeThumbnailUrl.trim().length === 0) &&
        !before.gifGenerationFailed // Allow retry when gifGenerationFailed is cleared
    ) {
        return;
    }
    console.log(`${TAG} Generating GIF for movement ${movementId}`);
    try {
        const { execSync } = await Promise.resolve().then(() => __importStar(require('child_process')));
        const os = await Promise.resolve().then(() => __importStar(require('os')));
        const path = await Promise.resolve().then(() => __importStar(require('path')));
        const fs = await Promise.resolve().then(() => __importStar(require('fs')));
        const tmpDir = os.tmpdir();
        // ── Step 1: Check if ffmpeg is available ──────────────────────────
        let ffmpegAvailable = false;
        try {
            execSync('which ffmpeg', { stdio: 'pipe' });
            ffmpegAvailable = true;
            console.log(`${TAG} ffmpeg found in runtime`);
        }
        catch (_e) {
            console.warn(`${TAG} ffmpeg NOT found in runtime — using JPEG fallback`);
        }
        let fileBuffer;
        let contentType;
        let fileExtension;
        if (ffmpegAvailable) {
            // ── Primary path: ffmpeg animated GIF ─────────────────────────
            const outputPath = path.join(tmpDir, `${movementId}.gif`);
            const ffmpegCmd = [
                'ffmpeg', '-y',
                '-i', `"${videoUrl}"`,
                '-t', '3',
                '-vf', '"fps=8,scale=240:300:force_original_aspect_ratio=increase,crop=240:300,split[s0][s1];[s0]palettegen=max_colors=64[p];[s1][p]paletteuse=dither=bayer"',
                '-loop', '0',
                `"${outputPath}"`,
            ].join(' ');
            execSync(ffmpegCmd, { timeout: 30000, stdio: 'pipe' });
            if (!fs.existsSync(outputPath)) {
                throw new Error('ffmpeg did not produce output file');
            }
            fileBuffer = fs.readFileSync(outputPath);
            fs.unlinkSync(outputPath);
            contentType = 'image/gif';
            fileExtension = 'gif';
            console.log(`${TAG} GIF generated via ffmpeg (${fileBuffer.length} bytes)`);
        }
        else {
            // ── Fallback path: static JPEG frame via ffmpeg-less approach ──
            // Download the first bytes of the video and extract a poster frame
            // using ffmpeg's single-frame mode, or if truly unavailable, download
            // a frame via HTTP range request.
            // Since Cloud Run 2nd gen typically has ffmpeg, this is a safety net.
            // We attempt a single-frame JPEG extraction as a lighter operation.
            const outputPath = path.join(tmpDir, `${movementId}.jpg`);
            try {
                // Try ffprobe/ffmpeg single frame (lighter than full GIF)
                execSync(`ffmpeg -y -i "${videoUrl}" -vframes 1 -vf "scale=240:300:force_original_aspect_ratio=increase,crop=240:300" "${outputPath}"`, { timeout: 15000, stdio: 'pipe' });
            }
            catch (_f) {
                // If even single-frame fails, download poster via HTTP
                const https = await Promise.resolve().then(() => __importStar(require('https')));
                const http = await Promise.resolve().then(() => __importStar(require('http')));
                const fetcher = videoUrl.startsWith('https') ? https : http;
                await new Promise((resolve, reject) => {
                    fetcher.get(videoUrl, { headers: { Range: 'bytes=0-524288' } }, (res) => {
                        // We can't extract a frame from raw bytes without ffmpeg,
                        // so mark as failed and let the retry pick it up later
                        res.resume();
                        reject(new Error('No ffmpeg available and HTTP range cannot produce a thumbnail'));
                    }).on('error', reject);
                });
            }
            if (!fs.existsSync(outputPath)) {
                throw new Error('Fallback did not produce output file');
            }
            fileBuffer = fs.readFileSync(outputPath);
            fs.unlinkSync(outputPath);
            contentType = 'image/jpeg';
            fileExtension = 'jpg';
            console.log(`${TAG} Static JPEG generated as fallback (${fileBuffer.length} bytes)`);
        }
        // ── Step 2: Upload to Firebase Storage ───────────────────────────
        const bucket = admin.storage().bucket();
        const storagePath = `movements/${coachId || 'system'}/thumbnails/${movementId}_${Date.now()}.${fileExtension}`;
        const file = bucket.file(storagePath);
        await file.save(fileBuffer, {
            metadata: { contentType },
            public: true,
        });
        const downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePath)}?alt=media`;
        // ── Step 3: Patch Firestore with URL and clear any failure flag ──
        await event.data.after.ref.update({
            thumbnailUrl: downloadUrl,
            gifGenerationFailed: firestore_2.FieldValue.delete(),
            gifGenerationFailedAt: firestore_2.FieldValue.delete(),
            gifGenerationError: firestore_2.FieldValue.delete(),
        });
        console.log(`${TAG} Thumbnail saved for movement ${movementId}`);
    }
    catch (err) {
        console.error(`${TAG} Error generating thumbnail:`, err);
        // Mark the document so the retry scheduler can pick it up
        try {
            await event.data.after.ref.update({
                gifGenerationFailed: true,
                gifGenerationFailedAt: firestore_2.Timestamp.now(),
                gifGenerationError: String(err).slice(0, 500),
            });
        }
        catch (updateErr) {
            console.error(`${TAG} Could not mark failure:`, updateErr);
        }
    }
});
// ─── Thumbnail Cache Invalidation ────────────────────────────────────────────
/**
 * cleanupOldMovementThumbnails — Firestore trigger (onDocumentUpdated)
 *
 * When a movement's thumbnailUrl changes (new GIF uploaded), this function
 * deletes the old GIF file from Firebase Storage to prevent orphaned files.
 *
 * Only deletes files that are in the movements/ Storage path and end with .gif.
 */
exports.cleanupOldMovementThumbnails = (0, firestore_1.onDocumentUpdated)('movements/{movementId}', async (event) => {
    var _a, _b, _c, _d;
    const TAG = '[cleanupOldThumbnails]';
    const before = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data();
    const after = (_d = (_c = event.data) === null || _c === void 0 ? void 0 : _c.after) === null || _d === void 0 ? void 0 : _d.data();
    if (!before || !after)
        return;
    const oldUrl = before.thumbnailUrl;
    const newUrl = after.thumbnailUrl;
    // Only act when thumbnailUrl actually changed and old URL existed
    if (!oldUrl || oldUrl === newUrl)
        return;
    if (!newUrl || newUrl.trim().length === 0)
        return; // Don't delete if new is empty (clearing)
    // Extract the Storage path from the old Firebase Storage URL
    // Format: https://firebasestorage.googleapis.com/v0/b/{bucket}/o/{encodedPath}?alt=media&token=...
    try {
        const urlObj = new URL(oldUrl);
        const pathMatch = urlObj.pathname.match(/\/o\/(.+)/);
        if (!pathMatch) {
            console.log(`${TAG} Could not extract path from old URL: ${oldUrl}`);
            return;
        }
        const storagePath = decodeURIComponent(pathMatch[1]);
        // Safety check: only delete files in the movements/ thumbnails path
        if (!storagePath.includes('/thumbnails/') || !storagePath.endsWith('.gif')) {
            console.log(`${TAG} Skipping non-thumbnail path: ${storagePath}`);
            return;
        }
        const bucket = admin.storage().bucket();
        const file = bucket.file(storagePath);
        const [exists] = await file.exists();
        if (exists) {
            await file.delete();
            console.log(`${TAG} Deleted old thumbnail: ${storagePath}`);
        }
        else {
            console.log(`${TAG} Old thumbnail already gone: ${storagePath}`);
        }
    }
    catch (err) {
        console.error(`${TAG} Error cleaning up old thumbnail:`, err);
        // Non-fatal — orphaned file is not critical
    }
});
// ─── Retry Failed GIF Generation (every 6 hours) ────────────────────────────
/**
 * retryFailedGifGeneration — Scheduled function
 *
 * Runs every 6 hours. Queries movements where gifGenerationFailed === true
 * and the failure happened more than 30 minutes ago (to avoid hammering
 * immediately after a transient failure). Clears the failure flag, which
 * triggers generateMovementGif to re-attempt via the onDocumentUpdated trigger.
 *
 * Safety limits:
 *   - Processes at most 20 documents per run
 *   - Only retries failures older than 30 minutes
 *   - Only retries failures newer than 7 days (gives up after that)
 */
exports.retryFailedGifGeneration = (0, scheduler_1.onSchedule)({ schedule: '0 */6 * * *', timeZone: 'UTC' }, async () => {
    const TAG = '[retryFailedGif]';
    const now = firestore_2.Timestamp.now();
    const thirtyMinAgo = firestore_2.Timestamp.fromMillis(now.toMillis() - 30 * 60 * 1000);
    const sevenDaysAgo = firestore_2.Timestamp.fromMillis(now.toMillis() - 7 * 24 * 60 * 60 * 1000);
    try {
        const failedSnap = await db
            .collection('movements')
            .where('gifGenerationFailed', '==', true)
            .where('gifGenerationFailedAt', '>', sevenDaysAgo)
            .where('gifGenerationFailedAt', '<', thirtyMinAgo)
            .limit(20)
            .get();
        if (failedSnap.empty) {
            console.log(`${TAG} No failed GIF generations to retry.`);
            return;
        }
        console.log(`${TAG} Found ${failedSnap.size} failed movement(s) to retry.`);
        let retried = 0;
        for (const doc of failedSnap.docs) {
            try {
                // Clear the failure flag — this triggers generateMovementGif
                // because gifGenerationFailed goes from true to deleted,
                // and the guard clause allows re-entry when the flag is cleared
                await doc.ref.update({
                    gifGenerationFailed: firestore_2.FieldValue.delete(),
                    gifGenerationFailedAt: firestore_2.FieldValue.delete(),
                    gifGenerationError: firestore_2.FieldValue.delete(),
                });
                retried++;
                console.log(`${TAG} Cleared failure flag for ${doc.id}`);
            }
            catch (err) {
                console.error(`${TAG} Error clearing flag for ${doc.id}:`, err);
            }
        }
        console.log(`${TAG} Retried ${retried}/${failedSnap.size} movement(s).`);
    }
    catch (err) {
        console.error(`${TAG} Error querying failed movements:`, err);
    }
});
// ─── 27. analyzeMovement — AI-powered movement analysis via GPT-4.1-mini ────
// Accepts either a contact sheet (base64 JPEG) or a GIF URL, sends it to
// GPT-4.1-mini vision, and returns structured movement metadata plus a
// confidence score (0-1). The contact sheet path is the default — it sends
// 12 ordered frames in a single image, which is much cheaper than a full
// animated GIF. Falls back to GIF URL if provided for backwards compat.
//
// ME-008: OPENAI_API_KEY must be set as a Firebase secret.
//         firebase functions:secrets:set OPENAI_API_KEY
// ─────────────────────────────────────────────────────────────────────────────
const openaiApiKey = (0, params_1.defineSecret)('OPENAI_API_KEY');
exports.analyzeMovement = (0, https_1.onCall)({ region: 'us-central1', secrets: [openaiApiKey], timeoutSeconds: 60, maxInstances: 20 }, async (request) => {
    var _a, _b, _c, _d;
    const { gifUrl, contactSheet } = request.data;
    if (!gifUrl && !contactSheet) {
        throw new https_1.HttpsError('invalid-argument', 'Either contactSheet or gifUrl is required');
    }
    const apiKey = openaiApiKey.value();
    if (!apiKey) {
        throw new https_1.HttpsError('internal', 'OpenAI API key not configured');
    }
    const isContactSheet = !!contactSheet;
    const systemPrompt = `You are a fitness movement analysis expert. You will be shown ${isContactSheet ? 'a contact sheet of sequential frames extracted from a fitness/exercise movement video. The frames are ordered left-to-right, top-to-bottom, showing the movement progression over time.' : 'an animated GIF of a fitness/exercise movement.'} Analyze it carefully and return a JSON object with the following fields:

- "name": string — the standard exercise name (e.g. "Barbell Back Squat", "Dumbbell Lateral Raise")
- "category": string — one of: "Upper Body Push", "Upper Body Pull", "Lower Body Push", "Lower Body Pull", "Core", "Cardio", "Mobility"
- "equipment": string — one of: "Bodyweight", "Dumbbell", "Barbell", "Kettlebell", "Band", "Cable", "Machine", or "" if unclear
- "difficulty": string — one of: "Beginner", "Intermediate", "Advanced"
- "muscleGroups": string[] — array from: "Chest", "Back", "Shoulders", "Biceps", "Triceps", "Quads", "Hamstrings", "Glutes", "Calves", "Core", "Full Body"
- "description": string — 1-2 sentence coaching cue (form tips, what to focus on)
- "regression": string — an easier alternative exercise name
- "progression": string — a harder alternative exercise name
- "contraindications": string — brief note on who should avoid this (e.g. "Avoid with lower back injury")
- "workSec": number — recommended work duration in seconds (typically 30-45)
- "restSec": number — recommended rest duration in seconds (typically 15-30)
- "confidence": number — your confidence in the analysis from 0.0 to 1.0 (1.0 = certain, 0.7+ = good, below 0.7 = uncertain/ambiguous)

Set confidence below 0.7 if: the movement is unclear, frames are too dark/blurry to identify, you are guessing between multiple possible movements, or the equipment/form cannot be determined.

Return ONLY valid JSON, no markdown, no explanation.`;
    // Build the image content block
    const imageContent = contactSheet
        ? { type: 'image_url', image_url: { url: contactSheet, detail: 'high' } }
        : { type: 'image_url', image_url: { url: gifUrl, detail: 'high' } };
    try {
        const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'gpt-4.1-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    {
                        role: 'user',
                        content: [
                            imageContent,
                            {
                                type: 'text',
                                text: `Analyze this fitness movement${isContactSheet ? ' from the contact sheet frames' : ''} and return the JSON metadata.`,
                            },
                        ],
                    },
                ],
                max_tokens: 600,
                temperature: 0.3,
            }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[analyzeMovement] OpenAI API error:', response.status, errorText);
            throw new https_1.HttpsError('internal', `OpenAI API error: ${response.status}`);
        }
        const result = await response.json();
        const content = ((_d = (_c = (_b = (_a = result.choices) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.message) === null || _c === void 0 ? void 0 : _c.content) === null || _d === void 0 ? void 0 : _d.trim()) || '';
        // Parse JSON from the response (strip markdown fences if present)
        let jsonStr = content;
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }
        const analysis = JSON.parse(jsonStr);
        return {
            name: analysis.name || '',
            category: analysis.category || '',
            equipment: analysis.equipment || '',
            difficulty: analysis.difficulty || '',
            muscleGroups: Array.isArray(analysis.muscleGroups) ? analysis.muscleGroups : [],
            description: analysis.description || '',
            regression: analysis.regression || '',
            progression: analysis.progression || '',
            contraindications: analysis.contraindications || '',
            workSec: typeof analysis.workSec === 'number' ? analysis.workSec : 30,
            restSec: typeof analysis.restSec === 'number' ? analysis.restSec : 15,
            confidence: typeof analysis.confidence === 'number' ? analysis.confidence : 0.5,
        };
    }
    catch (err) {
        if (err instanceof https_1.HttpsError)
            throw err;
        console.error('[analyzeMovement] Unexpected error:', err);
        throw new https_1.HttpsError('internal', 'Failed to analyze movement');
    }
});
// ─── reconcileConnectedAccountPayments ──────────────────────────────────────
/**
 * Admin-only callable: reconciles missed webhook events from connected accounts.
 *
 * For each coach with a connected Stripe account, queries checkout sessions
 * and invoices on the connected account, cross-references with Firestore,
 * and retroactively:
 *   1. Updates member_plans.checkoutStatus for completed checkouts
 *   2. Creates missing memberSubscription records
 *   3. Creates missing ledgerEntries for paid invoices
 *
 * This function exists because the webhook endpoint may not have been
 * configured to listen for connected account events. After fixing the
 * webhook configuration, this function should be run once to backfill
 * any missed events, then can be used periodically as an audit tool.
 *
 * ME-001: Requires STRIPE_SECRET_KEY secret.
 */
exports.reconcileConnectedAccountPayments = (0, https_1.onCall)({ secrets: [stripeSecretKey], timeoutSeconds: 540 }, async (request) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z, _0, _1, _2, _3, _4, _5, _6, _7, _8, _9, _10;
    // Admin-only guard
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be logged in');
    const callerSnap = await db.collection('coaches').doc(callerUid).get();
    const callerRole = (_b = callerSnap.data()) === null || _b === void 0 ? void 0 : _b.role;
    if (callerRole !== 'platformAdmin')
        throw new https_1.HttpsError('permission-denied', 'Admin only');
    const stripe = getStripe(stripeSecretKey.value());
    const results = [];
    // Get all coach Stripe accounts
    const coachAccountsSnap = await db.collection('coachStripeAccounts').get();
    for (const doc of coachAccountsSnap.docs) {
        const coachId = doc.id;
        const stripeAccountId = doc.data().stripeAccountId;
        if (!stripeAccountId)
            continue;
        const coachSnap = await db.collection('coaches').doc(coachId).get();
        const coachName = (_f = (_d = (_c = coachSnap.data()) === null || _c === void 0 ? void 0 : _c.name) !== null && _d !== void 0 ? _d : (_e = coachSnap.data()) === null || _e === void 0 ? void 0 : _e.displayName) !== null && _f !== void 0 ? _f : coachId;
        const result = {
            coachId,
            coachName,
            sessionsReconciled: 0,
            invoicesReconciled: 0,
            errors: [],
        };
        try {
            // ── 1. Reconcile checkout sessions ──
            const sessions = await stripe.checkout.sessions.list({ limit: 100, expand: ['data.subscription'] }, { stripeAccount: stripeAccountId });
            for (const session of sessions.data) {
                if (session.payment_status !== 'paid')
                    continue;
                const planId = (_g = session.metadata) === null || _g === void 0 ? void 0 : _g.planId;
                if (!planId)
                    continue;
                // Check if this plan's checkoutStatus is already 'paid'
                const planSnap = await db.collection('member_plans').doc(planId).get();
                if (!planSnap.exists)
                    continue;
                const planData = planSnap.data();
                if (planData.checkoutStatus === 'paid' || planData.checkoutStatus === 'pay_in_full_paid') {
                    continue; // Already reconciled
                }
                // This session was paid but the plan wasn't updated — reconcile it
                const paymentOption = (_j = (_h = session.metadata) === null || _h === void 0 ? void 0 : _h.paymentOption) !== null && _j !== void 0 ? _j : 'monthly';
                const snapshotId = (_k = session.metadata) === null || _k === void 0 ? void 0 : _k.snapshotId;
                const memberId = (_l = session.metadata) === null || _l === void 0 ? void 0 : _l.memberId;
                const intentId = (_m = session.metadata) === null || _m === void 0 ? void 0 : _m.intentId;
                const snapshotSnap = snapshotId
                    ? await db.collection('acceptedPlanSnapshots').doc(snapshotId).get()
                    : null;
                const snapshot = snapshotSnap === null || snapshotSnap === void 0 ? void 0 : snapshotSnap.data();
                const contractMonths = (_o = snapshot === null || snapshot === void 0 ? void 0 : snapshot.contractLengthMonths) !== null && _o !== void 0 ? _o : 12;
                // Use session creation time as the contract start
                const sessionCreatedAt = firestore_2.Timestamp.fromMillis(((_p = session.created) !== null && _p !== void 0 ? _p : Date.now() / 1000) * 1000);
                const contractEndAt = firestore_2.Timestamp.fromMillis(sessionCreatedAt.toMillis() + contractMonths * 30.44 * 24 * 60 * 60 * 1000);
                await db.collection('member_plans').doc(planId).update({
                    status: 'active',
                    checkoutStatus: paymentOption === 'pay_in_full' ? 'pay_in_full_paid' : 'paid',
                    acceptedAt: sessionCreatedAt,
                    contractStartAt: sessionCreatedAt,
                    contractEndAt,
                    acceptedSnapshotId: snapshotId !== null && snapshotId !== void 0 ? snapshotId : null,
                    updatedAt: firestore_2.FieldValue.serverTimestamp(),
                    reconciledAt: firestore_2.FieldValue.serverTimestamp(),
                    reconciledFrom: 'reconcileConnectedAccountPayments',
                });
                // Update checkoutIntent if exists
                if (intentId) {
                    const intentRef = db.collection('checkoutIntents').doc(intentId);
                    const intentSnap = await intentRef.get();
                    if (intentSnap.exists) {
                        await intentRef.update({
                            status: 'completed',
                            updatedAt: firestore_2.FieldValue.serverTimestamp(),
                        });
                    }
                }
                // Create memberSubscription if subscription exists
                if (session.subscription) {
                    const subId = typeof session.subscription === 'string'
                        ? session.subscription
                        : session.subscription.id;
                    const existingSubSnap = await db.collection('memberSubscriptions').doc(subId).get();
                    if (!existingSubSnap.exists) {
                        const tierSplit = parseInt((_r = (_q = session.metadata) === null || _q === void 0 ? void 0 : _q.tierSplit) !== null && _r !== void 0 ? _r : '40', 10);
                        await db.collection('memberSubscriptions').doc(subId).set({
                            subscriptionId: subId,
                            memberId: memberId !== null && memberId !== void 0 ? memberId : '',
                            coachId,
                            planId,
                            snapshotId: snapshotId !== null && snapshotId !== void 0 ? snapshotId : '',
                            stripeAccountId,
                            stripeCustomerId: session.customer,
                            paymentOption,
                            phase: 'contract',
                            contractStartAt: sessionCreatedAt,
                            contractEndAt,
                            status: 'active',
                            tierSnapshot: tierSplit,
                            createdAt: firestore_2.FieldValue.serverTimestamp(),
                            updatedAt: firestore_2.FieldValue.serverTimestamp(),
                            reconciledAt: firestore_2.FieldValue.serverTimestamp(),
                        });
                    }
                }
                result.sessionsReconciled++;
                console.log(`[reconcile] Reconciled checkout session ${session.id} for plan ${planId}`);
            }
            // ── 1b. Reconcile active subscriptions (create memberSubscription if missing) ──
            const subscriptions = await stripe.subscriptions.list({ limit: 100, status: 'active' }, { stripeAccount: stripeAccountId });
            for (const sub of subscriptions.data) {
                const subId = sub.id;
                const existingSubSnap = await db.collection('memberSubscriptions').doc(subId).get();
                if (existingSubSnap.exists)
                    continue; // Already tracked
                // Get metadata from the subscription
                const planId = (_s = sub.metadata) === null || _s === void 0 ? void 0 : _s.planId;
                const memberId = (_t = sub.metadata) === null || _t === void 0 ? void 0 : _t.memberId;
                const snapshotId = (_u = sub.metadata) === null || _u === void 0 ? void 0 : _u.snapshotId;
                const tierSplit = parseInt((_w = (_v = sub.metadata) === null || _v === void 0 ? void 0 : _v.tierSplit) !== null && _w !== void 0 ? _w : '40', 10);
                const paymentOption = (_y = (_x = sub.metadata) === null || _x === void 0 ? void 0 : _x.paymentOption) !== null && _y !== void 0 ? _y : 'monthly';
                const contractMonths = parseInt((_0 = (_z = sub.metadata) === null || _z === void 0 ? void 0 : _z.contractMonths) !== null && _0 !== void 0 ? _0 : '12', 10);
                if (!planId || !memberId)
                    continue; // Can't reconcile without plan/member info
                const subCreatedAt = firestore_2.Timestamp.fromMillis(sub.created * 1000);
                const contractEndAt = firestore_2.Timestamp.fromMillis(subCreatedAt.toMillis() + contractMonths * 30.44 * 24 * 60 * 60 * 1000);
                await db.collection('memberSubscriptions').doc(subId).set({
                    subscriptionId: subId,
                    memberId,
                    coachId,
                    planId,
                    snapshotId: snapshotId !== null && snapshotId !== void 0 ? snapshotId : '',
                    stripeAccountId,
                    stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : (_2 = (_1 = sub.customer) === null || _1 === void 0 ? void 0 : _1.id) !== null && _2 !== void 0 ? _2 : '',
                    paymentOption,
                    phase: 'contract',
                    contractStartAt: subCreatedAt,
                    contractEndAt,
                    status: 'active',
                    tierSnapshot: tierSplit,
                    createdAt: firestore_2.FieldValue.serverTimestamp(),
                    updatedAt: firestore_2.FieldValue.serverTimestamp(),
                    reconciledAt: firestore_2.FieldValue.serverTimestamp(),
                });
                // Also update the member_plan if not already paid
                const planSnap = await db.collection('member_plans').doc(planId).get();
                if (planSnap.exists) {
                    const planData = planSnap.data();
                    if (planData.checkoutStatus !== 'paid' && planData.checkoutStatus !== 'pay_in_full_paid') {
                        await db.collection('member_plans').doc(planId).update({
                            status: 'active',
                            checkoutStatus: paymentOption === 'pay_in_full' ? 'pay_in_full_paid' : 'paid',
                            stripeSubscriptionId: subId,
                            stripeCustomerId: typeof sub.customer === 'string' ? sub.customer : (_4 = (_3 = sub.customer) === null || _3 === void 0 ? void 0 : _3.id) !== null && _4 !== void 0 ? _4 : '',
                            updatedAt: firestore_2.FieldValue.serverTimestamp(),
                            reconciledAt: firestore_2.FieldValue.serverTimestamp(),
                            reconciledFrom: 'reconcileConnectedAccountPayments',
                        });
                    }
                }
                result.sessionsReconciled++;
                console.log(`[reconcile] Reconciled subscription ${subId} for plan ${planId}`);
            }
            // ── 2. Reconcile invoices (create missing ledger entries) ──
            const invoices = await stripe.invoices.list({ limit: 100, status: 'paid' }, { stripeAccount: stripeAccountId });
            for (const invoice of invoices.data) {
                const subId = invoice.subscription;
                if (!subId)
                    continue;
                // Check if ledger entry already exists for this invoice
                const existingLedger = await db.collection('ledgerEntries')
                    .where('stripeInvoiceId', '==', invoice.id)
                    .limit(1)
                    .get();
                if (!existingLedger.empty)
                    continue; // Already has ledger entry
                // Find the memberSubscription (doc ID = subscription ID)
                const subDoc = await db.collection('memberSubscriptions').doc(subId).get();
                if (!subDoc.exists)
                    continue;
                const subData = subDoc.data();
                const contractEndAt = subData.contractEndAt;
                const invoiceCreatedAt = firestore_2.Timestamp.fromMillis(((_5 = invoice.created) !== null && _5 !== void 0 ? _5 : Date.now() / 1000) * 1000);
                const phase = contractEndAt && invoiceCreatedAt.toMillis() > contractEndAt.toMillis()
                    ? 'continuation' : 'contract';
                const grossAmountCents = invoice.amount_paid;
                const tierSnapshot = ((_6 = subData.tierSnapshot) !== null && _6 !== void 0 ? _6 : 40);
                const applicationFeePercent = tierSnapshot;
                const goArriveShareCents = Math.round(grossAmountCents * applicationFeePercent / 100);
                const coachShareCents = grossAmountCents - goArriveShareCents;
                const ledgerRef = db.collection('ledgerEntries').doc();
                await ledgerRef.set({
                    entryId: ledgerRef.id,
                    billingEventId: `reconcile_${invoice.id}`,
                    memberId: subData.memberId,
                    coachId: subData.coachId,
                    planId: subData.planId,
                    snapshotId: subData.snapshotId,
                    phase,
                    grossAmountCents,
                    coachShareCents,
                    goArriveShareCents,
                    tierSnapshot,
                    applicationFeePercent,
                    stripeInvoiceId: invoice.id,
                    stripeChargeId: invoice.charge,
                    contractStartAt: (_7 = subData.contractStartAt) !== null && _7 !== void 0 ? _7 : null,
                    contractEndAt: (_8 = subData.contractEndAt) !== null && _8 !== void 0 ? _8 : null,
                    pricingSnapshotId: (_9 = subData.snapshotId) !== null && _9 !== void 0 ? _9 : '',
                    ruleSnapshot: {
                        tierSplit: tierSnapshot,
                        applicationFeePercent,
                        resolvedAt: invoiceCreatedAt.toDate().toISOString(),
                    },
                    createdAt: firestore_2.FieldValue.serverTimestamp(),
                    reconciledAt: firestore_2.FieldValue.serverTimestamp(),
                    reconciledFrom: 'reconcileConnectedAccountPayments',
                });
                result.invoicesReconciled++;
                console.log(`[reconcile] Created ledger entry for invoice ${invoice.id}`);
            }
        }
        catch (err) {
            result.errors.push((_10 = err.message) !== null && _10 !== void 0 ? _10 : String(err));
            console.error(`[reconcile] Error processing coach ${coachId}:`, err);
        }
        results.push(result);
    }
    return { results };
});
// ─── setProfitShareStartDate ────────────────────────────────────────────────
/**
 * Admin-only callable: sets the profitShareStartDate for a coach.
 * This date determines when the coach's profit share earnings begin
 * to be calculated and pro-rated.
 */
exports.setProfitShareStartDate = (0, https_1.onCall)(async (request) => {
    var _a, _b;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be logged in');
    const callerSnap = await db.collection('coaches').doc(callerUid).get();
    const callerRole = (_b = callerSnap.data()) === null || _b === void 0 ? void 0 : _b.role;
    if (callerRole !== 'platformAdmin')
        throw new https_1.HttpsError('permission-denied', 'Admin only');
    const { coachId, startDate } = request.data;
    if (!coachId || !startDate) {
        throw new https_1.HttpsError('invalid-argument', 'coachId and startDate (YYYY-MM-DD) are required');
    }
    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(startDate)) {
        throw new https_1.HttpsError('invalid-argument', 'startDate must be in YYYY-MM-DD format');
    }
    const dateMs = new Date(startDate + 'T00:00:00Z').getTime();
    if (isNaN(dateMs)) {
        throw new https_1.HttpsError('invalid-argument', 'Invalid date');
    }
    await db.collection('coaches').doc(coachId).update({
        profitShareStartDate: firestore_2.Timestamp.fromMillis(dateMs),
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
    });
    console.log(`[setProfitShareStartDate] Coach ${coachId} profitShareStartDate set to ${startDate}`);
    return { success: true, coachId, startDate };
});
// ─── setYearlyEarningsCap ───────────────────────────────────────────────────────
/**
 * Admin-only callable: sets the yearly earnings cap for a coach.
 *
 * Stores in coaches/{coachId}.yearlyCapsCents as a map: { '2027': 5000000 }
 * If no cap is set for a year, the previous year's cap carries over.
 * Cap resets January 1 each year.
 */
exports.setYearlyEarningsCap = (0, https_1.onCall)(async (request) => {
    var _a;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be logged in');
    const callerSnap = await db.collection('coaches').doc(callerUid).get();
    const callerData = callerSnap.data();
    const isAdmin = (callerData === null || callerData === void 0 ? void 0 : callerData.role) === 'platformAdmin' || (callerData === null || callerData === void 0 ? void 0 : callerData.admin) === true;
    if (!isAdmin)
        throw new https_1.HttpsError('permission-denied', 'Admin only');
    const { coachId, year, capDollars } = request.data;
    if (!coachId || !year || !capDollars) {
        throw new https_1.HttpsError('invalid-argument', 'coachId, year, and capDollars are required');
    }
    if (year < 2024 || year > 2100) {
        throw new https_1.HttpsError('invalid-argument', 'Year must be between 2024 and 2100');
    }
    if (capDollars <= 0 || capDollars > 10000000) {
        throw new https_1.HttpsError('invalid-argument', 'Cap must be between $1 and $10,000,000');
    }
    const capCents = Math.round(capDollars * 100);
    await db.collection('coaches').doc(coachId).update({
        [`yearlyCapsCents.${year}`]: capCents,
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
    });
    console.log(`[setYearlyEarningsCap] Coach ${coachId} cap for ${year} set to $${capDollars} (${capCents} cents)`);
    return { success: true, coachId, year, capCents };
});
// ─── getConnectedAccountData ────────────────────────────────────────────────
/**
 * Admin-only callable: retrieves payment data from a coach's connected
 * Stripe account for the admin dashboard.
 *
 * Returns:
 *   - customers: list of customers on the connected account
 *   - subscriptions: list of subscriptions on the connected account
 *   - recentInvoices: recent paid invoices
 *   - recentCharges: recent charges
 *   - balance: connected account balance
 *
 * ME-001: Requires STRIPE_SECRET_KEY secret.
 */
exports.getConnectedAccountData = (0, https_1.onCall)({ secrets: [stripeSecretKey] }, async (request) => {
    var _a, _b, _c;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be logged in');
    const callerSnap = await db.collection('coaches').doc(callerUid).get();
    const callerRole = (_b = callerSnap.data()) === null || _b === void 0 ? void 0 : _b.role;
    if (callerRole !== 'platformAdmin')
        throw new https_1.HttpsError('permission-denied', 'Admin only');
    const { coachId } = request.data;
    if (!coachId)
        throw new https_1.HttpsError('invalid-argument', 'coachId is required');
    // Get the coach's connected Stripe account
    const coachAccountSnap = await db.collection('coachStripeAccounts').doc(coachId).get();
    const stripeAccountId = (_c = coachAccountSnap.data()) === null || _c === void 0 ? void 0 : _c.stripeAccountId;
    if (!stripeAccountId) {
        throw new https_1.HttpsError('not-found', 'Coach has no connected Stripe account');
    }
    const stripe = getStripe(stripeSecretKey.value());
    // Fetch data from connected account
    const [customers, subscriptions, invoices, charges, balance] = await Promise.all([
        stripe.customers.list({ limit: 50 }, { stripeAccount: stripeAccountId }),
        stripe.subscriptions.list({ limit: 50 }, { stripeAccount: stripeAccountId }),
        stripe.invoices.list({ limit: 20, status: 'paid' }, { stripeAccount: stripeAccountId }),
        stripe.charges.list({ limit: 20 }, { stripeAccount: stripeAccountId }),
        stripe.balance.retrieve({ stripeAccount: stripeAccountId }),
    ]);
    return {
        stripeAccountId,
        customers: customers.data.map(c => ({
            id: c.id,
            name: c.name,
            email: c.email,
            created: c.created,
        })),
        subscriptions: subscriptions.data.map(s => ({
            id: s.id,
            customer: s.customer,
            status: s.status,
            currentPeriodEnd: s.current_period_end,
            metadata: s.metadata,
            items: s.items.data.map(i => {
                var _a;
                return ({
                    id: i.id,
                    priceId: typeof i.price === 'string' ? i.price : i.price.id,
                    amount: typeof i.price === 'string' ? null : i.price.unit_amount,
                    interval: typeof i.price === 'string' ? null : (_a = i.price.recurring) === null || _a === void 0 ? void 0 : _a.interval,
                });
            }),
        })),
        invoices: invoices.data.map(i => ({
            id: i.id,
            customer: i.customer,
            status: i.status,
            amountPaid: i.amount_paid,
            created: i.created,
            periodStart: i.period_start,
            periodEnd: i.period_end,
        })),
        charges: charges.data.map(c => ({
            id: c.id,
            amount: c.amount,
            status: c.status,
            customer: c.customer,
            created: c.created,
            refunded: c.refunded,
            amountRefunded: c.amount_refunded,
            applicationFeeAmount: c.application_fee_amount,
        })),
        balance: {
            available: balance.available,
            pending: balance.pending,
        },
    };
});
// ─── createMissingLedgerEntry ────────────────────────────────────────────────
/**
 * Admin-only callable: creates a ledger entry for a specific invoice
 * on a coach's connected Stripe account. Used for manual reconciliation
 * when the webhook didn't fire.
 */
exports.createMissingLedgerEntry = (0, https_1.onCall)({ secrets: [stripeSecretKey] }, async (request) => {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid)
        throw new https_1.HttpsError('unauthenticated', 'Must be logged in');
    const callerSnap = await db.collection('coaches').doc(callerUid).get();
    const callerRole = (_b = callerSnap.data()) === null || _b === void 0 ? void 0 : _b.role;
    if (callerRole !== 'platformAdmin')
        throw new https_1.HttpsError('permission-denied', 'Admin only');
    const { coachId } = request.data;
    if (!coachId)
        throw new https_1.HttpsError('invalid-argument', 'coachId is required');
    // Get coach's connected Stripe account
    const coachAccountSnap = await db.collection('coachStripeAccounts').doc(coachId).get();
    const stripeAccountId = (_c = coachAccountSnap.data()) === null || _c === void 0 ? void 0 : _c.stripeAccountId;
    if (!stripeAccountId)
        throw new https_1.HttpsError('not-found', 'Coach has no connected Stripe account');
    const stripe = getStripe(stripeSecretKey.value());
    // Get all paid invoices from connected account
    const invoices = await stripe.invoices.list({ limit: 100, status: 'paid' }, { stripeAccount: stripeAccountId });
    let created = 0;
    const entries = [];
    for (const invoice of invoices.data) {
        const subId = invoice.subscription;
        if (!subId)
            continue;
        // Check if ledger entry already exists
        const existingSnap = await db.collection('ledgerEntries')
            .where('stripeInvoiceId', '==', invoice.id)
            .limit(1)
            .get();
        if (!existingSnap.empty) {
            console.log(`[createMissingLedgerEntry] Ledger entry already exists for invoice ${invoice.id}`);
            continue;
        }
        // Get memberSubscription
        const subDoc = await db.collection('memberSubscriptions').doc(subId).get();
        if (!subDoc.exists) {
            console.log(`[createMissingLedgerEntry] No memberSubscription for ${subId}, skipping`);
            continue;
        }
        const subData = subDoc.data();
        const contractEndAt = subData.contractEndAt;
        const invoiceCreatedAt = firestore_2.Timestamp.fromMillis(((_d = invoice.created) !== null && _d !== void 0 ? _d : Date.now() / 1000) * 1000);
        const phase = contractEndAt && invoiceCreatedAt.toMillis() > contractEndAt.toMillis()
            ? 'continuation' : 'contract';
        const grossAmountCents = invoice.amount_paid;
        const tierSnapshot = ((_e = subData.tierSnapshot) !== null && _e !== void 0 ? _e : 40);
        const applicationFeePercent = tierSnapshot;
        const goArriveShareCents = Math.round(grossAmountCents * applicationFeePercent / 100);
        const coachShareCents = grossAmountCents - goArriveShareCents;
        const ledgerRef = db.collection('ledgerEntries').doc();
        await ledgerRef.set({
            entryId: ledgerRef.id,
            billingEventId: `manual_reconcile_${invoice.id}`,
            memberId: subData.memberId,
            coachId: subData.coachId,
            planId: subData.planId,
            snapshotId: subData.snapshotId,
            phase,
            grossAmountCents,
            coachShareCents,
            goArriveShareCents,
            tierSnapshot,
            applicationFeePercent,
            stripeInvoiceId: invoice.id,
            stripeChargeId: invoice.charge,
            contractStartAt: (_f = subData.contractStartAt) !== null && _f !== void 0 ? _f : null,
            contractEndAt: (_g = subData.contractEndAt) !== null && _g !== void 0 ? _g : null,
            pricingSnapshotId: (_h = subData.snapshotId) !== null && _h !== void 0 ? _h : '',
            ruleSnapshot: {
                tierSplit: tierSnapshot,
                applicationFeePercent,
                resolvedAt: invoiceCreatedAt.toDate().toISOString(),
            },
            createdAt: firestore_2.FieldValue.serverTimestamp(),
            reconciledAt: firestore_2.FieldValue.serverTimestamp(),
            reconciledFrom: 'createMissingLedgerEntry',
        });
        created++;
        entries.push({
            invoiceId: invoice.id,
            amount: grossAmountCents,
            coachShare: coachShareCents,
            goArriveShare: goArriveShareCents,
        });
        console.log(`[createMissingLedgerEntry] Created ledger entry for invoice ${invoice.id}`);
    }
    return { created, entries };
});
// ─── generateVoice — OpenAI TTS for workout cues and movement names ─────────
// Accepts text + optional voice (onyx, nova), generates MP3 via OpenAI TTS,
// uploads to Firebase Storage, returns the download URL.
// ─────────────────────────────────────────────────────────────────────────────
exports.generateVoice = (0, https_1.onCall)({ region: 'us-central1', secrets: [openaiApiKey], timeoutSeconds: 30 }, async (request) => {
    const { text, voice, storagePath } = request.data;
    if (!text || typeof text !== 'string' || text.length === 0) {
        throw new https_1.HttpsError('invalid-argument', 'text is required');
    }
    if (text.length > 500) {
        throw new https_1.HttpsError('invalid-argument', 'text must be under 500 characters');
    }
    const apiKey = openaiApiKey.value();
    if (!apiKey) {
        throw new https_1.HttpsError('internal', 'OpenAI API key not configured');
    }
    const selectedVoice = voice || 'onyx';
    const path = storagePath || `voice_cache/tts/${Date.now()}.mp3`;
    try {
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: 'tts-1',
                voice: selectedVoice,
                input: text,
            }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            console.error('[generateVoice] OpenAI TTS error:', response.status, errorText);
            throw new https_1.HttpsError('internal', `OpenAI TTS error: ${response.status}`);
        }
        const audioBuffer = Buffer.from(await response.arrayBuffer());
        const bucket = admin.storage().bucket();
        const file = bucket.file(path);
        await file.save(audioBuffer, { contentType: 'audio/mpeg' });
        await file.makePublic();
        const url = `https://storage.googleapis.com/${bucket.name}/${path}`;
        return { url, path };
    }
    catch (err) {
        if (err.code)
            throw err;
        console.error('[generateVoice] Failed:', err);
        throw new https_1.HttpsError('internal', 'Voice generation failed');
    }
});
//# sourceMappingURL=index.js.map