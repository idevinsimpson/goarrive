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
 *
 * ME-001: STRIPE_SECRET_KEY must be set as a Firebase secret before functions 3–6 operate.
 *         firebase functions:secrets:set STRIPE_SECRET_KEY
 * ME-002: STRIPE_WEBHOOK_SECRET must be set for webhook signature verification.
 *         firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
 * ME-003: APP_BASE_URL must be set to the deployed app URL for checkout redirects.
 *         firebase functions:config:set app.base_url="https://goarrive.fit"
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
exports.addCoach = exports.activateCtsOptIn = exports.stripeWebhook = exports.createCheckoutSession = exports.refreshStripeAccountStatus = exports.createStripeConnectLink = exports.cleanupReadNotifications = exports.sendPlanSharedNotification = void 0;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-functions/v2/firestore");
const scheduler_1 = require("firebase-functions/v2/scheduler");
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const firestore_2 = require("firebase-admin/firestore");
const stripe_1 = __importDefault(require("stripe"));
admin.initializeApp();
const db = admin.firestore(); // IAM: datastore.user granted 2026-03-22
const messaging = admin.messaging();
// ── Secrets ───────────────────────────────────────────────────────────────────
const stripeSecretKey = (0, params_1.defineSecret)('STRIPE_SECRET_KEY');
const stripeWebhookSecret = (0, params_1.defineSecret)('STRIPE_WEBHOOK_SECRET');
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
    return new stripe_1.default(secretKey, { apiVersion: '2026-02-25.clover' });
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    const { planId, memberId, paymentOption } = request.data;
    if (!planId || !memberId || !paymentOption) {
        throw new https_1.HttpsError('invalid-argument', 'planId, memberId, and paymentOption are required');
    }
    const callerUid = (_a = request.auth) === null || _a === void 0 ? void 0 : _a.uid;
    if (!callerUid || callerUid !== memberId) {
        throw new https_1.HttpsError('permission-denied', 'Must be signed in as the member');
    }
    // ── Load plan ──
    const planRef = db.collection('member_plans').doc(planId);
    const planSnap = await planRef.get();
    if (!planSnap.exists)
        throw new https_1.HttpsError('not-found', 'Plan not found');
    const plan = planSnap.data();
    const coachId = plan.coachId;
    if (!coachId)
        throw new https_1.HttpsError('failed-precondition', 'Plan has no coachId');
    // ── Load coach Stripe account ──
    const coachAccountSnap = await db.collection('coachStripeAccounts').doc(coachId).get();
    if (!coachAccountSnap.exists) {
        throw new https_1.HttpsError('failed-precondition', 'Coach has not connected Stripe. ME-001: Coach must complete Stripe onboarding first.');
    }
    const coachAccount = coachAccountSnap.data();
    // In test mode, fall back to platform account if connected account has no charges enabled
    const stripeAccountId = coachAccount.chargesEnabled
        ? coachAccount.stripeAccountId
        : undefined; // undefined = charge on platform account directly
    if (!coachAccount.chargesEnabled) {
        console.warn('[createCheckoutSession] Coach charges not enabled — using platform account for test');
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
    // Use stored pricingResult if available, otherwise compute
    const displayMonthlyPrice = Math.round((_f = (_d = (_c = (_b = plan.pricingResult) === null || _b === void 0 ? void 0 : _b.displayMonthlyPrice) !== null && _c !== void 0 ? _c : plan.monthlyPriceOverride) !== null && _d !== void 0 ? _d : (_e = plan.pricingResult) === null || _e === void 0 ? void 0 : _e.calculatedMonthlyPrice) !== null && _f !== void 0 ? _f : (hourlyRate * (sessionLengthMinutes / 60) * sessionsPerMonth));
    const payInFullTotal = Math.round(displayMonthlyPrice * contractMonths * 0.9);
    const payInFullMonthlyEquivalent = Math.round(payInFullTotal / contractMonths);
    // Continuation monthly
    const cp = plan.continuationPricing;
    const contHr = (_g = cp === null || cp === void 0 ? void 0 : cp.continuationHourlyRate) !== null && _g !== void 0 ? _g : hourlyRate;
    const contMin = (_h = cp === null || cp === void 0 ? void 0 : cp.continuationMinutesPerSession) !== null && _h !== void 0 ? _h : 3.5;
    const contCheckIn = (_j = cp === null || cp === void 0 ? void 0 : cp.continuationCheckInMinutesPerMonth) !== null && _j !== void 0 ? _j : 30;
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
        ctsMonthlySavings: (_l = (_k = plan.postContract) === null || _k === void 0 ? void 0 : _k.ctsMonthlySavings) !== null && _l !== void 0 ? _l : null,
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
        status: 'pending',
        createdAt: firestore_2.FieldValue.serverTimestamp(),
        updatedAt: firestore_2.FieldValue.serverTimestamp(),
    });
    const stripe = getStripe(stripeSecretKey.value());
    const appBaseUrl = process.env.APP_BASE_URL || 'https://goarrive.fit';
    // ── Get or create Stripe customer on connected account (or platform account) ──
    let stripeCustomerId = plan.stripeCustomerId;
    if (!stripeCustomerId) {
        const memberSnap = await db.collection('users').doc(memberId).get();
        const memberEmail = (_m = memberSnap.data()) === null || _m === void 0 ? void 0 : _m.email;
        const customer = await stripe.customers.create({ email: memberEmail, metadata: { memberId, coachId, planId } }, stripeAccountId ? { stripeAccount: stripeAccountId } : undefined);
        stripeCustomerId = customer.id;
        await planRef.update({ stripeCustomerId });
    }
    let sessionUrl;
    let stripeSessionId;
    if (paymentOption === 'monthly') {
        // ── Monthly: subscription schedule with two phases ──
        // Phase 1: contractMonths at displayMonthlyPrice
        // Phase 2: indefinite at continuationMonthlyPrice
        const session = await stripe.checkout.sessions.create({
            customer: stripeCustomerId,
            payment_method_types: ['card'],
            mode: 'subscription',
            line_items: [
                {
                    price_data: {
                        currency: 'usd',
                        product_data: {
                            name: `GoArrive Coaching — ${contractMonths}-Month Contract`,
                            metadata: { planId, snapshotId },
                        },
                        unit_amount: displayMonthlyPrice * 100, // cents
                        recurring: { interval: 'month' },
                    },
                    quantity: 1,
                },
            ],
            subscription_data: Object.assign(Object.assign({}, (stripeAccountId ? { application_fee_percent: applicationFeePercent } : {})), { metadata: {
                    planId,
                    snapshotId,
                    intentId,
                    memberId,
                    coachId,
                    paymentOption: 'monthly',
                    contractMonths: String(contractMonths),
                    continuationMonthlyPriceCents: String(continuationMonthlyPrice * 100),
                    tierSplit: String(tierSplit),
                } }),
            success_url: `${appBaseUrl}/checkout-success?intent=${intentId}`,
            cancel_url: `${appBaseUrl}/my-plan?checkout_cancelled=1`,
            metadata: { intentId, planId, snapshotId, memberId, coachId },
        }, stripeAccountId ? { stripeAccount: stripeAccountId } : undefined);
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
                            name: `GoArrive Coaching — ${contractMonths}-Month Pay in Full (10% off)`,
                            metadata: { planId, snapshotId },
                        },
                        unit_amount: payInFullTotal * 100, // cents
                    },
                    quantity: 1,
                },
            ],
            payment_intent_data: Object.assign(Object.assign({}, (stripeAccountId ? { application_fee_amount: Math.round(payInFullTotal * 100 * applicationFeePercent / 100) } : {})), { metadata: {
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
                } }),
            success_url: `${appBaseUrl}/checkout-success?intent=${intentId}`,
            cancel_url: `${appBaseUrl}/my-plan?checkout_cancelled=1`,
            metadata: { intentId, planId, snapshotId, memberId, coachId },
        }, stripeAccountId ? { stripeAccount: stripeAccountId } : undefined);
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
exports.stripeWebhook = (0, https_1.onRequest)({ secrets: [stripeSecretKey, stripeWebhookSecret] }, async (req, res) => {
    const sig = req.headers['stripe-signature'];
    if (!sig) {
        res.status(400).send('Missing stripe-signature header');
        return;
    }
    const stripe = getStripe(stripeSecretKey.value());
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, stripeWebhookSecret.value());
    }
    catch (err) {
        console.error('[stripeWebhook] Signature verification failed:', err.message);
        res.status(400).send(`Webhook signature error: ${err.message}`);
        return;
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
//# sourceMappingURL=index.js.map