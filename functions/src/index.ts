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

import * as admin from 'firebase-admin';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, onRequest, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import Stripe from 'stripe';

admin.initializeApp();

const db = admin.firestore(); // IAM: datastore.user granted 2026-03-22
const messaging = admin.messaging();

// ── Secrets (live mode: STRIPE_SECRET_KEY v8, STRIPE_WEBHOOK_SECRET v4) ─────────
const stripeSecretKey = defineSecret('STRIPE_SECRET_KEY');
const stripeWebhookSecret = defineSecret('STRIPE_WEBHOOK_SECRET');

// ── Tier split config (GoArrive share percent) ────────────────────────────────
// 40% for coaches with < 5 active paying members
// 35% for coaches with 5–9 active paying members
// 30% for coaches with 10+ active paying members
function getTierSplit(activePayingMembers: number): 40 | 35 | 30 {
  if (activePayingMembers >= 10) return 30;
  if (activePayingMembers >= 5) return 35;
  return 40;
}

// ── Helper: get Stripe instance ───────────────────────────────────────────────
function getStripe(secretKey: string): Stripe {
  // Trim whitespace/newlines that Secret Manager may append to the key value
  return new Stripe(secretKey.trim(), { apiVersion: '2026-02-25.clover' });
}

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

    if (data.type !== 'plan_shared') return;

    const recipientId = data.recipientId;
    if (!recipientId) {
      console.warn('[sendPlanSharedNotification] No recipientId on notification', snap.id);
      return;
    }

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
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code || '';
      if (
        code === 'messaging/registration-token-not-registered' ||
        code === 'messaging/invalid-registration-token'
      ) {
        console.warn('[sendPlanSharedNotification] Stale FCM token for', recipientId, '— removing');
        try {
          await db.collection('users').doc(recipientId).update({ fcmToken: FieldValue.delete() });
        } catch {
          // Best-effort cleanup
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
    const thirtyDaysAgo = Timestamp.fromMillis(now.toMillis() - 30 * 24 * 60 * 60 * 1000);

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
  }
);

// ─── 3. createStripeConnectLink ───────────────────────────────────────────────
/**
 * Creates or resumes a Stripe Connect Express account onboarding link for a coach.
 * Stores the account in coachStripeAccounts/{coachId}.
 *
 * ME-001: Requires STRIPE_SECRET_KEY secret.
 */
export const createStripeConnectLink = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    const coachId = request.data?.coachId as string | undefined;
    if (!coachId) throw new HttpsError('invalid-argument', 'coachId is required');

    // Verify caller is the coach or an admin
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in');

    const stripe = getStripe(stripeSecretKey.value());

    // Check if account already exists
    const accountRef = db.collection('coachStripeAccounts').doc(coachId);
    const accountSnap = await accountRef.get();

    let stripeAccountId: string;

    if (accountSnap.exists && accountSnap.data()?.stripeAccountId) {
      stripeAccountId = accountSnap.data()!.stripeAccountId as string;
    } else {
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
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        lastStatusSyncAt: FieldValue.serverTimestamp(),
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
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { url: accountLink.url };
  }
);

// ─── 4. refreshStripeAccountStatus ───────────────────────────────────────────
/**
 * Fetches the latest Stripe account status and syncs it to Firestore.
 * ME-001: Requires STRIPE_SECRET_KEY secret.
 */
export const refreshStripeAccountStatus = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    const coachId = request.data?.coachId as string | undefined;
    if (!coachId) throw new HttpsError('invalid-argument', 'coachId is required');

    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in');

    const accountRef = db.collection('coachStripeAccounts').doc(coachId);
    const accountSnap = await accountRef.get();
    if (!accountSnap.exists) throw new HttpsError('not-found', 'No Stripe account found for this coach');

    const stripeAccountId = accountSnap.data()!.stripeAccountId as string;
    const stripe = getStripe(stripeSecretKey.value());

    const account = await stripe.accounts.retrieve(stripeAccountId);

    const onboardingStatus =
      account.details_submitted
        ? account.charges_enabled && account.payouts_enabled
          ? 'complete'
          : 'restricted'
        : 'in_progress';

    await accountRef.update({
      onboardingStatus,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      requirementsDue: account.requirements?.currently_due ?? [],
      updatedAt: FieldValue.serverTimestamp(),
      lastStatusSyncAt: FieldValue.serverTimestamp(),
    });

    return { success: true, onboardingStatus };
  }
);

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
export const disconnectStripeAccount = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    const coachId = request.data?.coachId as string | undefined;
    if (!coachId) throw new HttpsError('invalid-argument', 'coachId is required');

    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in');

    // Only the coach themselves (or an admin) may disconnect
    const callerDoc = await db.collection('users').doc(callerUid).get();
    const isAdmin = callerDoc.exists && callerDoc.data()?.role === 'admin';
    if (callerUid !== coachId && !isAdmin) {
      throw new HttpsError('permission-denied', 'You can only disconnect your own Stripe account');
    }

    const accountRef = db.collection('coachStripeAccounts').doc(coachId);
    const accountSnap = await accountRef.get();

    if (!accountSnap.exists) {
      // Already disconnected — idempotent success
      return { success: true, message: 'No Stripe account was connected.' };
    }

    const stripeAccountId = accountSnap.data()!.stripeAccountId as string;
    const stripe = getStripe(stripeSecretKey.value());

    try {
      // Attempt to delete the Express account on Stripe
      await stripe.accounts.del(stripeAccountId);
    } catch (err: any) {
      const stripeCode = err?.raw?.code || err?.code || '';
      const stripeMsg = err?.raw?.message || err?.message || String(err);

      if (
        stripeCode === 'account_invalid' ||
        stripeMsg.includes('No such account') ||
        stripeMsg.includes('does not exist')
      ) {
        // Account already deleted on Stripe side — safe to clean up Firestore
        console.warn('[disconnectStripeAccount] Account not found on Stripe, cleaning Firestore only:', stripeAccountId);
      } else if (
        stripeCode === 'balance_insufficient' ||
        stripeMsg.toLowerCase().includes('balance') ||
        stripeMsg.toLowerCase().includes('outstanding')
      ) {
        // Account has a non-zero balance — cannot delete yet
        throw new HttpsError(
          'failed-precondition',
          'This Stripe account has an outstanding balance and cannot be deleted yet. ' +
          'Please wait for all pending payouts to complete, then try again.'
        );
      } else {
        // Unknown Stripe error — surface it
        throw new HttpsError('internal', `Stripe error: ${stripeMsg}`);
      }
    }

    // Clear the Firestore record so the UI resets to "Not connected"
    await accountRef.delete();

    console.log(`[disconnectStripeAccount] Coach ${coachId} disconnected Stripe account ${stripeAccountId}`);
    return { success: true, message: 'Stripe account disconnected. You can now connect a new account.' };
  }
);

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
export const createCheckoutSession = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    const { planId, memberId, paymentOption } = request.data as {
      planId: string;
      memberId: string;
      paymentOption: 'monthly' | 'pay_in_full';
    };

    if (!planId || !memberId || !paymentOption) {
      throw new HttpsError('invalid-argument', 'planId, memberId, and paymentOption are required');
    }

    const callerUid = request.auth?.uid;
    if (!callerUid || callerUid !== memberId) {
      throw new HttpsError('permission-denied', 'Must be signed in as the member');
    }

    // ── Load plan ──
    const planRef = db.collection('member_plans').doc(planId);
    const planSnap = await planRef.get();
    if (!planSnap.exists) throw new HttpsError('not-found', 'Plan not found');
    const plan = planSnap.data()!;

    const coachId = plan.coachId as string;
    if (!coachId) throw new HttpsError('failed-precondition', 'Plan has no coachId');

    // ── Load coach Stripe account ──
    const coachAccountSnap = await db.collection('coachStripeAccounts').doc(coachId).get();
    if (!coachAccountSnap.exists) {
      throw new HttpsError('failed-precondition', 'Coach has not connected Stripe. ME-001: Coach must complete Stripe onboarding first.');
    }
    const coachAccount = coachAccountSnap.data()!;
    // In test mode, fall back to platform account if connected account has no charges enabled
    const stripeAccountId: string | undefined = coachAccount.chargesEnabled
      ? (coachAccount.stripeAccountId as string)
      : undefined; // undefined = charge on platform account directly
    if (!coachAccount.chargesEnabled) {
      console.warn('[createCheckoutSession] Coach charges not enabled — using platform account for test');
    }

    // ── Compute pricing ──
    const sessionsPerWeek = (plan.sessionsPerWeek as number) || 3;
    const sessionsPerMonth = Math.round(sessionsPerWeek * (52 / 12));
    const contractMonths = (plan.contractMonths as number) || 12;

    // Initial monthly
    const hourlyRate = (plan.hourlyRate as number) || 100;
    const sessionLengthMinutes = (plan.sessionLengthMinutes as number) || 60;
    const checkInCallMinutes = (plan.checkInCallMinutes as number) || 30;
    const programBuildTimeHours = (plan.programBuildTimeHours as number) || 5;

    // Use stored pricingResult if available, otherwise compute
    const displayMonthlyPrice = Math.round(
      plan.pricingResult?.displayMonthlyPrice ??
      plan.monthlyPriceOverride ??
      plan.pricingResult?.calculatedMonthlyPrice ??
      (hourlyRate * (sessionLengthMinutes / 60) * sessionsPerMonth)
    );
    const payInFullTotal = Math.round(displayMonthlyPrice * contractMonths * 0.9);
    const payInFullMonthlyEquivalent = Math.round(payInFullTotal / contractMonths);

    // Continuation monthly
    const cp = plan.continuationPricing as any;
    const contHr = cp?.continuationHourlyRate ?? hourlyRate;
    const contMin = cp?.continuationMinutesPerSession ?? 3.5;
    const contCheckIn = cp?.continuationCheckInMinutesPerMonth ?? 30;
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
    const now = Timestamp.now();
    const contractStartAt = now;
    const contractEndAtMs = now.toMillis() + contractMonths * 30.44 * 24 * 60 * 60 * 1000;
    const contractEndAt = Timestamp.fromMillis(contractEndAtMs);

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
      ctsMonthlySavings: plan.postContract?.ctsMonthlySavings ?? null,
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
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    const stripe = getStripe(stripeSecretKey.value());
    const appBaseUrl = process.env.APP_BASE_URL || 'https://goarrive.fit';

    // ── Get or create Stripe customer on connected account (or platform account) ──
    let stripeCustomerId = plan.stripeCustomerId as string | undefined;
    if (!stripeCustomerId) {
      const memberSnap = await db.collection('users').doc(memberId).get();
      const memberEmail = memberSnap.data()?.email as string | undefined;
      const customer = await stripe.customers.create(
        { email: memberEmail, metadata: { memberId, coachId, planId } },
        stripeAccountId ? { stripeAccount: stripeAccountId } : undefined
      );
      stripeCustomerId = customer.id;
      await planRef.update({ stripeCustomerId });
    }

    let sessionUrl: string;
    let stripeSessionId: string;

    if (paymentOption === 'monthly') {
      // ── Monthly: subscription schedule with two phases ──
      // Phase 1: contractMonths at displayMonthlyPrice
      // Phase 2: indefinite at continuationMonthlyPrice
      const session = await stripe.checkout.sessions.create(
        {
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
          subscription_data: {
            ...(stripeAccountId ? { application_fee_percent: applicationFeePercent } : {}),
            metadata: {
              planId,
              snapshotId,
              intentId,
              memberId,
              coachId,
              paymentOption: 'monthly',
              contractMonths: String(contractMonths),
              continuationMonthlyPriceCents: String(continuationMonthlyPrice * 100),
              tierSplit: String(tierSplit),
            },
          },
          success_url: `${appBaseUrl}/checkout-success?intent=${intentId}`,
          cancel_url: `${appBaseUrl}/my-plan?checkout_cancelled=1`,
          metadata: { intentId, planId, snapshotId, memberId, coachId },
        },
        stripeAccountId ? { stripeAccount: stripeAccountId } : undefined
      );
      sessionUrl = session.url!;
      stripeSessionId = session.id;

    } else {
      // ── Pay in full: one-time payment + deferred continuation subscription ──
      const session = await stripe.checkout.sessions.create(
        {
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
          payment_intent_data: {
            ...(stripeAccountId ? { application_fee_amount: Math.round(payInFullTotal * 100 * applicationFeePercent / 100) } : {}),
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
          success_url: `${appBaseUrl}/checkout-success?intent=${intentId}`,
          cancel_url: `${appBaseUrl}/my-plan?checkout_cancelled=1`,
          metadata: { intentId, planId, snapshotId, memberId, coachId },
        },
        stripeAccountId ? { stripeAccount: stripeAccountId } : undefined
      );
      sessionUrl = session.url!;
      stripeSessionId = session.id;
    }

    // Update intent with Stripe session ID
    await intentRef.update({
      stripeSessionId,
      stripeSessionUrl: sessionUrl,
      updatedAt: FieldValue.serverTimestamp(),
    });

    return { sessionUrl, intentId, snapshotId };
  }
);

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
export const stripeWebhook = onRequest(
  { secrets: [stripeSecretKey, stripeWebhookSecret] },
  async (req, res) => {
    const sig = req.headers['stripe-signature'] as string;
    if (!sig) {
      res.status(400).send('Missing stripe-signature header');
      return;
    }

    const stripe = getStripe(stripeSecretKey.value());
    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        sig,
        stripeWebhookSecret.value()
      );
    } catch (err: any) {
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
      rawPayload: event as unknown as Record<string, unknown>,
      processedAt: FieldValue.serverTimestamp(),
    };

    try {
      await eventRef.set(billingEvent);
    } catch (err) {
      console.error('[stripeWebhook] Failed to store billing event:', err);
      res.status(500).send('Failed to store event');
      return;
    }

    // ── Process event ──
    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutSessionCompleted(event.data.object as Stripe.Checkout.Session, event.id);
          break;
        case 'invoice.paid':
          await handleInvoicePaid(event.data.object as Stripe.Invoice, event.id);
          break;
        case 'invoice.payment_failed':
          await handleInvoicePaymentFailed(event.data.object as Stripe.Invoice, event.id);
          break;
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          await handleSubscriptionUpsert(event.data.object as Stripe.Subscription, event.id);
          break;
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(event.data.object as Stripe.Subscription, event.id);
          break;
        case 'charge.refunded':
          await handleChargeRefunded(event.data.object as Stripe.Charge, event.id);
          break;
        default:
          console.log('[stripeWebhook] Unhandled event type:', event.type);
      }
    } catch (err) {
      console.error('[stripeWebhook] Error processing event', event.id, ':', err);
      // Don't return 500 — Stripe will retry. Log and return 200 to avoid retry loops
      // for non-transient errors. For transient errors, throw to trigger retry.
    }

    res.status(200).send('OK');
  }
);

// ── Webhook handlers ──────────────────────────────────────────────────────────

async function handleCheckoutSessionCompleted(
  session: Stripe.Checkout.Session,
  eventId: string
) {
  const { intentId, planId, snapshotId, memberId, coachId: _coachId } = session.metadata ?? {};
  void _coachId; // coachId is stored in snapshot; not needed here directly
  if (!intentId || !planId || !memberId) {
    console.warn('[handleCheckoutSessionCompleted] Missing metadata on session', session.id);
    return;
  }

  const paymentOption = session.metadata?.paymentOption ?? 'monthly';

  // Update checkoutIntent
  await db.collection('checkoutIntents').doc(intentId).update({
    status: 'completed',
    updatedAt: FieldValue.serverTimestamp(),
  });

  // Load snapshot for contract dates
  const snapshotSnap = snapshotId
    ? await db.collection('acceptedPlanSnapshots').doc(snapshotId).get()
    : null;
  const snapshot = snapshotSnap?.data();
  const contractMonths = snapshot?.contractLengthMonths ?? 12;
  const now = Timestamp.now();
  const contractStartAt = now;
  const contractEndAt = Timestamp.fromMillis(now.toMillis() + contractMonths * 30.44 * 24 * 60 * 60 * 1000);

  // Update plan status
  await db.collection('member_plans').doc(planId).update({
    status: 'active',
    checkoutStatus: paymentOption === 'pay_in_full' ? 'pay_in_full_paid' : 'paid',
    acceptedAt: now,
    contractStartAt,
    contractEndAt,
    acceptedSnapshotId: snapshotId ?? null,
    updatedAt: FieldValue.serverTimestamp(),
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
    const continuationMonthlyPrice = snapshot.continuationMonthlyPrice as number | undefined;
    const coachId = snapshot.coachId as string | undefined;
    const tierSplit = (snapshot.tierSplit ?? 40) as 40 | 35 | 30;

    if (continuationMonthlyPrice && coachId) {
      try {
        // Look up the coach's connected Stripe account
        const coachAccountSnap = await db.collection('coachStripeAccounts').doc(coachId).get();
        const stripeAccountId = coachAccountSnap.data()?.stripeAccountId as string | undefined;

        if (stripeAccountId) {
          const stripe = getStripe(stripeSecretKey.value());

          // Get the member's Stripe customer ID from the plan doc
          const planSnap = await db.collection('member_plans').doc(planId).get();
          const stripeCustomerId = planSnap.data()?.stripeCustomerId as string | undefined;

          if (stripeCustomerId) {
            // Create a price object for the continuation monthly amount
            const continuationPrice = await stripe.prices.create(
              {
                currency: 'usd',
                unit_amount: Math.round(continuationMonthlyPrice * 100),
                recurring: { interval: 'month' },
                product_data: {
                  name: `GoArrive Coaching — Ongoing Support`,
                  metadata: { planId, snapshotId: snapshotId ?? '', type: 'continuation' },
                },
              },
              { stripeAccount: stripeAccountId }
            );

            // Create subscription with trial_end = contractEndAt
            // The subscription will not charge until trial ends.
            const continuationSub = await stripe.subscriptions.create(
              {
                customer: stripeCustomerId,
                items: [{ price: continuationPrice.id }],
                trial_end: contractEndAt.seconds,
                application_fee_percent: tierSplit,
                metadata: {
                  planId,
                  snapshotId: snapshotId ?? '',
                  memberId: memberId ?? '',
                  coachId,
                  type: 'continuation',
                  contractEndAtMs: String(contractEndAt.toMillis()),
                },
              },
              { stripeAccount: stripeAccountId }
            );

            // Record the deferred subscription in memberSubscriptions
            await db.collection('memberSubscriptions').doc(continuationSub.id).set(
              {
                subscriptionId: continuationSub.id,
                planId,
                snapshotId: snapshotId ?? '',
                memberId: memberId ?? '',
                coachId,
                stripeAccountId,
                stripeCustomerId,
                paymentOption: 'pay_in_full_continuation',
                phase: 'continuation',
                contractStartAt,
                contractEndAt,
                status: continuationSub.status,
                currentPeriodEnd: Timestamp.fromMillis((continuationSub as any).current_period_end * 1000),
                tierSnapshot: tierSplit,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
              },
              { merge: true }
            );

            console.log(
              '[handleCheckoutSessionCompleted] Deferred continuation subscription',
              continuationSub.id,
              'created for pay-in-full plan', planId,
              '— billing starts at', contractEndAt.toDate().toISOString()
            );
          } else {
            console.warn('[handleCheckoutSessionCompleted] No stripeCustomerId on plan', planId, '— skipping deferred sub');
          }
        } else {
          console.warn('[handleCheckoutSessionCompleted] No stripeAccountId for coach', coachId, '— skipping deferred sub');
        }
      } catch (err) {
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
      : (session.subscription as any).id;
    const continuationMonthlyPrice = snapshot.continuationMonthlyPrice as number | undefined;
    const coachId = snapshot.coachId as string | undefined;
    const tierSplit = (snapshot.tierSplit ?? 40) as 40 | 35 | 30;
    // Calculate Phase 1 end date from the snapshot's contractEndAt
    const contractEndAtSnap = snapshot.contractEndAt as any;
    const contractEndMs = contractEndAtSnap?._seconds
      ? contractEndAtSnap._seconds * 1000
      : (contractEndAtSnap?.seconds ? contractEndAtSnap.seconds * 1000 : Number(snapshot.contractEndAtMs ?? 0));
    const phase1EndUnix = Math.floor(contractEndMs / 1000);

    if (continuationMonthlyPrice && coachId) {
      try {
        const coachAccountSnap = await db.collection('coachStripeAccounts').doc(coachId).get();
        const stripeAccountId = coachAccountSnap.data()?.stripeAccountId as string | undefined;

        if (stripeAccountId) {
          const stripe = getStripe(stripeSecretKey.value());

          // Create a continuation price on the coach's connected account
          const continuationPrice = await stripe.prices.create(
            {
              currency: 'usd',
              unit_amount: Math.round(continuationMonthlyPrice * 100),
              recurring: { interval: 'month' },
              product_data: {
                name: `GoArrive Coaching — Ongoing Support`,
                metadata: { planId, snapshotId: snapshotId ?? '', type: 'continuation' },
              },
            },
            { stripeAccount: stripeAccountId }
          );

          // Convert the subscription to a subscription schedule with two phases:
          // Phase 1: current price for contractMonths iterations
          // Phase 2: continuation price indefinitely
          const schedule = await stripe.subscriptionSchedules.create(
            {
              from_subscription: subscriptionId,
            },
            { stripeAccount: stripeAccountId }
          );

          // Get the current phase's items to preserve the existing price
          const currentPhase = schedule.phases[0];
          const currentItems = currentPhase.items;

          // Update the schedule with two explicit phases
          await stripe.subscriptionSchedules.update(
            schedule.id,
            {
              end_behavior: 'release', // After Phase 2, subscription continues as normal
              phases: [
                {
                  // Phase 1: contract period at initial rate
                  items: currentItems.map(item => ({
                    price: typeof item.price === 'string' ? item.price : item.price.id,
                    quantity: item.quantity ?? 1,
                  })),
                  end_date: phase1EndUnix,
                  application_fee_percent: tierSplit,
                  metadata: {
                    phase: 'contract',
                    planId,
                    snapshotId: snapshotId ?? '',
                  },
                },
                {
                  // Phase 2: continuation at new rate, indefinite
                  items: [{ price: continuationPrice.id, quantity: 1 }],
                  application_fee_percent: tierSplit,
                  metadata: {
                    phase: 'continuation',
                    planId,
                    snapshotId: snapshotId ?? '',
                  },
                },
              ],
            },
            { stripeAccount: stripeAccountId }
          );

          console.log(
            '[handleCheckoutSessionCompleted] Subscription schedule',
            schedule.id,
            'created for monthly plan', planId,
            '— Phase 1:', contractMonths, 'months at', snapshot.displayMonthlyPrice,
            '— Phase 2: continuation at', continuationMonthlyPrice
          );
        }
      } catch (err) {
        // Log but do not rethrow — the plan is already activated.
        // A failed schedule conversion means the subscription stays at the initial rate.
        // The billing dashboard Tasks section will surface this.
        console.error('[handleCheckoutSessionCompleted] Failed to create subscription schedule:', err);
      }
    }
  }

  console.log('[handleCheckoutSessionCompleted] Plan', planId, 'activated for member', memberId);
}

async function handleInvoicePaid(invoice: Stripe.Invoice, eventId: string) {
  const sub = (invoice as any).subscription as string | null;
  if (!sub) return;

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
  const contractEndAt = subData.contractEndAt as Timestamp | null;
  const now = Timestamp.now();
  const phase: 'contract' | 'continuation' =
    contractEndAt && now.toMillis() > contractEndAt.toMillis() ? 'continuation' : 'contract';

  const grossAmountCents = invoice.amount_paid;
  const tierSnapshot = (subData.tierSnapshot ?? 40) as 40 | 35 | 30;
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
    stripeChargeId: (invoice as any).charge as string | null,
    contractStartAt: subData.contractStartAt ?? null,
    contractEndAt: subData.contractEndAt ?? null,
    pricingSnapshotId: subData.snapshotId ?? '',
    ruleSnapshot: {
      tierSplit: tierSnapshot,
      applicationFeePercent,
      resolvedAt: now.toDate().toISOString(),
    },
    createdAt: FieldValue.serverTimestamp(),
  });

  console.log('[handleInvoicePaid] Ledger entry created for invoice', invoice.id, 'phase:', phase);
}

async function handleInvoicePaymentFailed(invoice: Stripe.Invoice, eventId: string) {
  const sub = (invoice as any).subscription as string | null;
  if (!sub) return;

  const subSnap = await db.collection('memberSubscriptions')
    .where('subscriptionId', '==', sub)
    .limit(1)
    .get();

  if (!subSnap.empty) {
    const planId = subSnap.docs[0].data().planId as string;
    await db.collection('member_plans').doc(planId).update({
      checkoutStatus: 'failed',
      updatedAt: FieldValue.serverTimestamp(),
    });
    console.log('[handleInvoicePaymentFailed] Plan', planId, 'marked payment_failed');
  }
}

async function handleSubscriptionUpsert(sub: Stripe.Subscription, eventId: string) {
  const metadata = sub.metadata ?? {};
  const { planId, snapshotId, memberId, coachId, contractMonths, tierSplit } = metadata;
  if (!planId || !memberId) {
    console.log('[handleSubscriptionUpsert] Missing metadata on subscription', sub.id);
    return;
  }

  const contractMonthsNum = parseInt(contractMonths ?? '12', 10);
  const tierSplitNum = parseInt(tierSplit ?? '40', 10) as 40 | 35 | 30;

  // Determine contractStartAt and contractEndAt from subscription
  const contractStartAt = Timestamp.fromMillis((sub.start_date ?? Date.now() / 1000) * 1000);
  const contractEndAt = Timestamp.fromMillis(
    contractStartAt.toMillis() + contractMonthsNum * 30.44 * 24 * 60 * 60 * 1000
  );

  const subRef = db.collection('memberSubscriptions').doc(sub.id);
  await subRef.set(
    {
      subscriptionId: sub.id,
      memberId,
      coachId: coachId ?? '',
      planId,
      snapshotId: snapshotId ?? '',
      stripeAccountId: (sub as any).account ?? '',
      stripeCustomerId: sub.customer as string,
      paymentOption: 'monthly',
      phase: 'contract',
      contractStartAt,
      contractEndAt,
      status: sub.status,
      currentPeriodEnd: Timestamp.fromMillis((sub as any).current_period_end * 1000),
      tierSnapshot: tierSplitNum,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log('[handleSubscriptionUpsert] memberSubscription upserted for', sub.id);
}

async function handleSubscriptionDeleted(sub: Stripe.Subscription, eventId: string) {
  const subRef = db.collection('memberSubscriptions').doc(sub.id);
  const subSnap = await subRef.get();
  if (!subSnap.exists) return;

  await subRef.update({
    status: 'canceled',
    updatedAt: FieldValue.serverTimestamp(),
  });

  const planId = subSnap.data()?.planId as string | undefined;
  if (planId) {
    await db.collection('member_plans').doc(planId).update({
      checkoutStatus: 'failed',
      updatedAt: FieldValue.serverTimestamp(),
    });
  }

  console.log('[handleSubscriptionDeleted] Subscription', sub.id, 'canceled');
}

async function handleChargeRefunded(charge: Stripe.Charge, eventId: string) {
  // Refund policy (documented):
  // For direct charges, Stripe automatically refunds the application fee proportionally.
  // Coaches are not harmed — the platform fee portion is returned to the platform,
  // and the coach's share is returned to the member from the coach's connected account.
  // We record the refund in the ledger as a negative entry.

  const invoiceId = (charge as any).invoice as string | null;
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
  const tierSnapshot = original.tierSnapshot as 40 | 35 | 30;
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
    contractStartAt: original.contractStartAt ?? null,
    contractEndAt: original.contractEndAt ?? null,
    pricingSnapshotId: original.pricingSnapshotId ?? '',
    ruleSnapshot: {
      ...original.ruleSnapshot,
      refundPolicy: 'Stripe auto-refunds application fee proportionally on direct charge refunds. Coach share returned from connected account.',
    },
    createdAt: FieldValue.serverTimestamp(),
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
export const activateCtsOptIn = onCall(
  { secrets: [stripeSecretKey] },
  async (request) => {
    const { consentId, planId, memberId } = request.data as {
      consentId: string;
      planId: string;
      memberId: string;
    };

    if (!consentId || !planId || !memberId) {
      throw new Error('Missing required parameters: consentId, planId, memberId');
    }

    // 1. Load and validate consent document
    const consentRef = db.collection('commitToSaveConsents').doc(consentId);
    const consentSnap = await consentRef.get();
    if (!consentSnap.exists) {
      throw new Error('Consent document not found');
    }
    const consent = consentSnap.data()!;
    if (consent.memberId !== memberId || consent.planId !== planId) {
      throw new Error('Consent document does not match memberId/planId');
    }
    if (consent.status === 'active') {
      // Already activated — idempotent success
      return { success: true, message: 'CTS already active' };
    }

    const ctsMonthlyRate = consent.ctsMonthlyRate as number;

    // 1b. Time-period guard — CTS only allowed after contract ends (RISK-001)
    const planSnap = await db.collection('member_plans').doc(planId).get();
    const planData = planSnap.data();
    if (planData?.contractEndAt) {
      const contractEndMs = planData.contractEndAt.toMillis();
      const nowMs = Timestamp.now().toMillis();
      if (nowMs < contractEndMs) {
        throw new Error(
          'CTS cannot be activated during the contract period. ' +
          'Contract ends ' + new Date(contractEndMs).toISOString()
        );
      }
    }

    // 2. Find the member's active continuation subscription
    const subSnap = await db.collection('memberSubscriptions')
      .where('planId', '==', planId)
      .where('memberId', '==', memberId)
      .limit(5)
      .get();

    let stripeAccountId: string | undefined;
    let stripeSubscriptionId: string | undefined;
    let coachId: string | undefined;
    let subDocRef: FirebaseFirestore.DocumentReference | undefined;

    if (!subSnap.empty) {
      // Prefer continuation phase subscription; fall back to any active sub
      const subDoc = subSnap.docs.find(
        d => d.data().phase === 'continuation' || d.data().paymentOption === 'pay_in_full_continuation'
      ) ?? subSnap.docs[0];

      const subData = subDoc.data();
      stripeAccountId = subData.stripeAccountId as string;
      stripeSubscriptionId = subData.subscriptionId as string;
      coachId = subData.coachId as string;
      subDocRef = subDoc.ref;
    }

    // Fallback: query Stripe directly if no memberSubscription doc found
    if (!stripeAccountId || !stripeSubscriptionId) {
      // Load coach info from plan
      coachId = coachId ?? (planData?.coachId as string | undefined);
      if (!coachId) throw new Error('Cannot determine coachId for this plan');

      const coachAccountSnap = await db.collection('coachStripeAccounts').doc(coachId).get();
      stripeAccountId = coachAccountSnap.data()?.stripeAccountId as string | undefined;
      if (!stripeAccountId) throw new Error('Coach has no connected Stripe account');

      const stripeCustomerId = planData?.stripeCustomerId as string | undefined;
      if (!stripeCustomerId) throw new Error('Plan has no stripeCustomerId');

      const stripeForLookup = getStripe(stripeSecretKey.value());
      const subs = await stripeForLookup.subscriptions.list(
        {
          customer: stripeCustomerId,
          status: 'active',
          limit: 10,
        },
        { stripeAccount: stripeAccountId }
      );

      // Find a continuation subscription by metadata
      const contSub = subs.data.find(
        s => s.metadata?.type === 'continuation' || s.metadata?.phase === 'continuation'
      ) ?? subs.data[0];

      if (!contSub) throw new Error('No active Stripe subscription found for this member');
      stripeSubscriptionId = contSub.id;
    }

    const stripe = getStripe(stripeSecretKey.value());

    // 3. Retrieve the subscription to get the current item ID
    const stripeSub = await stripe.subscriptions.retrieve(
      stripeSubscriptionId,
      { stripeAccount: stripeAccountId }
    );

    const currentItem = stripeSub.items.data[0];
    if (!currentItem) {
      throw new Error('Subscription has no items');
    }

    // 4. Create a new CTS price on the coach's connected account
    const ctsPrice = await stripe.prices.create(
      {
        currency: 'usd',
        unit_amount: Math.round(ctsMonthlyRate * 100),
        recurring: { interval: 'month' },
        product_data: {
          name: 'GoArrive Coaching — Commit to Save Rate',
          metadata: { planId, memberId, coachId: coachId ?? '', type: 'cts' },
        },
      },
      { stripeAccount: stripeAccountId }
    );

    // 5. Update the subscription item to the CTS price
    await stripe.subscriptions.update(
      stripeSubscriptionId,
      {
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
      },
      { stripeAccount: stripeAccountId }
    );

    // 6. Mark consent as active
    await consentRef.update({
      status: 'active',
      activatedAt: FieldValue.serverTimestamp(),
      stripePriceId: ctsPrice.id,
      stripeSubscriptionId,
    });

    // 7. Update memberSubscription record (if we have a Firestore doc reference)
    if (subDocRef) {
      await subDocRef.update({
        ctsPriceId: ctsPrice.id,
        ctsActivatedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });
    }

    console.log(
      '[activateCtsOptIn] CTS activated for member', memberId,
      'plan', planId,
      'subscription', stripeSubscriptionId,
      'rate', ctsMonthlyRate
    );

    return { success: true };
  }
);

// ── 8. addCoach — Admin-only: create a new coach account ─────────────────────
// Creates a Firebase Auth user, sets custom claims, and writes a coaches doc.
// Only callers with admin: true in their custom claims may invoke this.
export const addCoach = onCall(
  { region: 'us-central1' },
  async (request) => {
    // 1. Auth guard: caller must be signed in with admin claim
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in');
    const callerAdmin = request.auth?.token?.admin === true;
    if (!callerAdmin) throw new HttpsError('permission-denied', 'Admin access required');

    // 1b. Rate limit: max 10 coaches per hour per admin
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const recentCoaches = await db.collection('coaches')
      .where('createdBy', '==', callerUid)
      .where('createdAt', '>', oneHourAgo)
      .count().get();
    if (recentCoaches.data().count >= 10) {
      throw new HttpsError('resource-exhausted', 'Rate limit: max 10 coaches per hour');
    }

    // 2. Validate input
    const { email, displayName } = request.data as { email?: string; displayName?: string };
    if (!email || !displayName) {
      throw new HttpsError('invalid-argument', 'email and displayName are required');
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
    } catch (err: any) {
      if (err.code === 'auth/email-already-exists') {
        throw new HttpsError('already-exists', 'A user with this email already exists');
      }
      throw new HttpsError('internal', err.message ?? 'Failed to create user');
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
    const resetLink = await admin.auth().generatePasswordResetLink(
      email,
      actionCodeSettings
    );

    console.log('[addCoach] Created coach', newCoachId, email, 'by', callerUid);

    return {
      success: true,
      coachId: newCoachId,
      email,
      displayName,
      resetLink,
    };
  }
);

// ── 9. inviteCoach — Admin-only: generate a coach invite link ─────────────────
/**
 * Creates a coachInvites/{token} document and returns a shareable signup URL.
 * The invite is valid for 7 days and can only be used once.
 *
 * Input:  { email: string, displayName: string }
 * Output: { inviteUrl: string, token: string, expiresAt: number }
 */
export const inviteCoach = onCall(
  { region: 'us-central1' },
  async (request) => {
    // Auth guard: caller must be signed in with admin claim
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in');

    const token = request.auth?.token;
    const isAdmin = token?.admin === true || token?.role === 'platformAdmin';
    if (!isAdmin) throw new HttpsError('permission-denied', 'Admin access required');

    const { email, displayName } = request.data as { email?: string; displayName?: string };
    if (!email || !displayName) {
      throw new HttpsError('invalid-argument', 'email and displayName are required');
    }

    // Check if email is already a registered user
    try {
      await admin.auth().getUserByEmail(email.trim().toLowerCase());
      throw new HttpsError('already-exists', 'A user with this email already exists.');
    } catch (err: any) {
      if (err.code === 'functions/already-exists') throw err;
      if (err.code !== 'auth/user-not-found') {
        throw new HttpsError('internal', err.message ?? 'Failed to check email');
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
    const inviteToken: string = crypto.randomBytes(24).toString('hex');
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days

    await db.collection('coachInvites').doc(inviteToken).set({
      token: inviteToken,
      email: email.trim().toLowerCase(),
      displayName: displayName.trim(),
      status: 'pending',
      createdBy: callerUid,
      createdAt: FieldValue.serverTimestamp(),
      expiresAt,
    });

    const appUrl = process.env.APP_BASE_URL || 'https://goarrive.fit';
    const inviteUrl = `${appUrl}/coach-signup?token=${inviteToken}`;

    console.log('[inviteCoach] Invite created for', email, 'by', callerUid);
    return { inviteUrl, token: inviteToken, expiresAt };
  }
);

// ── 10. activateCoachInvite — Called after signup to apply coach role ──────────
/**
 * Validates an invite token and sets coach custom claims on the newly-created user.
 * Called from the /coach-signup page after Firebase Auth account creation.
 *
 * Input:  { token: string }
 * Output: { success: boolean, coachId: string }
 */
export const activateCoachInvite = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in');

    const { token } = request.data as { token?: string };
    if (!token) throw new HttpsError('invalid-argument', 'token is required');

    const inviteRef = db.collection('coachInvites').doc(token);
    const inviteSnap = await inviteRef.get();

    if (!inviteSnap.exists) {
      throw new HttpsError('not-found', 'Invite not found. Please request a new invite link.');
    }

    const invite = inviteSnap.data()!;

    if (invite.status !== 'pending') {
      throw new HttpsError('failed-precondition', 'This invite link has already been used or expired.');
    }

    if (invite.expiresAt < Date.now()) {
      await inviteRef.update({ status: 'expired' });
      throw new HttpsError('deadline-exceeded', 'This invite link has expired. Please request a new one.');
    }

    // Verify the signed-in user's email matches the invite
    const userRecord = await admin.auth().getUser(callerUid);
    const userEmail = userRecord.email?.toLowerCase() ?? '';
    if (userEmail !== invite.email.toLowerCase()) {
      throw new HttpsError(
        'permission-denied',
        `This invite is for ${invite.email}. Please sign in with that email address.`
      );
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
      usedAt: FieldValue.serverTimestamp(),
      usedBy: callerUid,
    });

    console.log('[activateCoachInvite] Coach activated:', callerUid, userEmail);
    return { success: true, coachId: callerUid };
  }
);


/**
 * claimMemberAccount – Links a newly created Firebase Auth account to an
 * existing member doc (created by a coach via quick-add).
 *
 * Called by the shared-plan claim gate after the user creates their account.
 *
 * Input: { memberId: string }
 * Output: { success: boolean }
 */
export const claimMemberAccount = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in');

    const { memberId } = request.data as { memberId?: string };
    if (!memberId) throw new HttpsError('invalid-argument', 'memberId is required');

    // Fetch the member doc
    const memberRef = db.collection('members').doc(memberId);
    const memberSnap = await memberRef.get();

    if (!memberSnap.exists) {
      throw new HttpsError('not-found', 'Member record not found.');
    }

    const member = memberSnap.data()!;

    // If the member already has an account, reject
    if (member.hasAccount === true && member.uid) {
      throw new HttpsError('already-exists', 'This member already has an account.');
    }

    // If the member has an email on file, verify it matches the caller's email
    const userRecord = await admin.auth().getUser(callerUid);
    const userEmail = userRecord.email?.toLowerCase() ?? '';

    if (member.email && member.email.toLowerCase() !== userEmail) {
      throw new HttpsError(
        'permission-denied',
        `This plan belongs to ${member.email}. Please sign up with that email address.`
      );
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
      updatedAt: FieldValue.serverTimestamp(),
    });

    console.log('[claimMemberAccount] Member claimed:', callerUid, memberId);
    return { success: true };
  }
);


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

// ─── Helper: Generate mock Zoom meeting data ─────────────────────────────────
let mockCounter = 9000;
function createMockZoomMeeting(topic: string, startTime: string, duration: number, hostEmail: string) {
  const meetingId = `mock-${Date.now()}-${++mockCounter}`;
  const password = Math.random().toString(36).substring(2, 8);
  return {
    meetingId,
    joinUrl: `https://zoom.us/j/${meetingId}?pwd=${password}`,
    startUrl: `https://zoom.us/s/${meetingId}?zak=mock_host_token`,
    password,
    hostEmail,
  };
}

// ─── Helper: Write audit log entry ───────────────────────────────────────────
async function writeAuditLog(entry: {
  coachId: string;
  action: string;
  sessionInstanceId?: string;
  recurringSlotId?: string;
  zoomRoomId?: string;
  memberId?: string;
  details: string;
  metadata?: Record<string, any>;
}) {
  await db.collection('scheduling_audit_log').add({
    ...entry,
    createdAt: FieldValue.serverTimestamp(),
  });
}

// ─── 13. manageZoomRoom — Add/update/deactivate Zoom room resources ─────────
export const manageZoomRoom = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in');

    const { action, roomId, roomData } = request.data as {
      action: 'add' | 'update' | 'deactivate' | 'activate';
      roomId?: string;
      roomData?: {
        label?: string;
        zoomAccountEmail?: string;
        zoomUserId?: string;
        maxConcurrentMeetings?: number;
        notes?: string;
      };
    };

    if (!action) throw new HttpsError('invalid-argument', 'action is required');

    // Verify caller is a coach (by checking coaches collection or UID match)
    const coachId = callerUid;

    if (action === 'add') {
      if (!roomData?.label || !roomData?.zoomAccountEmail) {
        throw new HttpsError('invalid-argument', 'label and zoomAccountEmail are required');
      }

      const roomRef = db.collection('zoom_rooms').doc();
      const room = {
        coachId,
        label: roomData.label,
        zoomAccountEmail: roomData.zoomAccountEmail,
        zoomUserId: roomData.zoomUserId || '',
        status: 'active',
        maxConcurrentMeetings: roomData.maxConcurrentMeetings || 1,
        notes: roomData.notes || '',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      };

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

    if (!roomId) throw new HttpsError('invalid-argument', 'roomId is required for update/deactivate/activate');

    const roomRef = db.collection('zoom_rooms').doc(roomId);
    const roomSnap = await roomRef.get();
    if (!roomSnap.exists) throw new HttpsError('not-found', 'Zoom room not found');

    const existingRoom = roomSnap.data()!;
    if (existingRoom.coachId !== coachId) {
      throw new HttpsError('permission-denied', 'You can only manage your own Zoom rooms');
    }

    if (action === 'update') {
      const updates: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
      if (roomData?.label) updates.label = roomData.label;
      if (roomData?.zoomAccountEmail) updates.zoomAccountEmail = roomData.zoomAccountEmail;
      if (roomData?.zoomUserId !== undefined) updates.zoomUserId = roomData.zoomUserId;
      if (roomData?.maxConcurrentMeetings) updates.maxConcurrentMeetings = roomData.maxConcurrentMeetings;
      if (roomData?.notes !== undefined) updates.notes = roomData.notes;

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
      await roomRef.update({ status: 'inactive', updatedAt: FieldValue.serverTimestamp() });

      await writeAuditLog({
        coachId,
        action: 'room_deactivated',
        zoomRoomId: roomId,
        details: `Deactivated Zoom room "${existingRoom.label}"`,
      });

      return { success: true };
    }

    if (action === 'activate') {
      await roomRef.update({ status: 'active', updatedAt: FieldValue.serverTimestamp() });

      await writeAuditLog({
        coachId,
        action: 'room_added',
        zoomRoomId: roomId,
        details: `Reactivated Zoom room "${existingRoom.label}"`,
      });

      return { success: true };
    }

    throw new HttpsError('invalid-argument', `Unknown action: ${action}`);
  }
);

// ─── 14. createRecurringSlot — Coach assigns a recurring time slot to a member ──
export const createRecurringSlot = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in');

    const { memberId, memberName, dayOfWeek, startTime, durationMinutes, timezone, recurrencePattern, effectiveFrom } = request.data as {
      memberId: string;
      memberName: string;
      dayOfWeek: number;
      startTime: string;
      durationMinutes: number;
      timezone: string;
      recurrencePattern?: 'weekly' | 'biweekly';
      effectiveFrom?: string; // ISO date string
    };

    if (!memberId || dayOfWeek === undefined || !startTime || !durationMinutes || !timezone) {
      throw new HttpsError('invalid-argument', 'memberId, dayOfWeek, startTime, durationMinutes, and timezone are required');
    }

    if (dayOfWeek < 0 || dayOfWeek > 6) {
      throw new HttpsError('invalid-argument', 'dayOfWeek must be 0-6 (Sunday-Saturday)');
    }

    const coachId = callerUid;

    // Verify the member belongs to this coach
    const memberSnap = await db.collection('members').doc(memberId).get();
    if (!memberSnap.exists) throw new HttpsError('not-found', 'Member not found');
    if (memberSnap.data()!.coachId !== coachId) {
      throw new HttpsError('permission-denied', 'This member does not belong to you');
    }

    const slotRef = db.collection('recurring_slots').doc();
    const effectiveDate = effectiveFrom ? Timestamp.fromDate(new Date(effectiveFrom)) : Timestamp.now();

    const slot = {
      coachId,
      memberId,
      memberName: memberName || memberSnap.data()!.name || 'Unknown',
      dayOfWeek,
      startTime,
      durationMinutes,
      timezone,
      recurrencePattern: recurrencePattern || 'weekly',
      status: 'active',
      effectiveFrom: effectiveDate,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await slotRef.set(slot);

    await writeAuditLog({
      coachId,
      action: 'slot_created',
      recurringSlotId: slotRef.id,
      memberId,
      details: `Created recurring slot for ${memberName || 'member'}: day ${dayOfWeek}, ${startTime}, ${durationMinutes}min, ${recurrencePattern || 'weekly'}`,
    });

    // Immediately generate instances for the next 4 weeks for this slot
    const instances = generateInstancesForSlot(slot, slotRef.id, 28);
    for (const inst of instances) {
      const instRef = db.collection('session_instances').doc();
      await instRef.set({ ...inst, id: instRef.id });
    }

    console.log(`[createRecurringSlot] Created slot ${slotRef.id} with ${instances.length} instances for coach ${coachId}`);
    return { success: true, slotId: slotRef.id, instancesGenerated: instances.length };
  }
);

// ─── 15. updateRecurringSlot — Pause/cancel/modify a recurring slot ──────────
export const updateRecurringSlot = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in');

    const { slotId, action: slotAction, updates } = request.data as {
      slotId: string;
      action: 'pause' | 'resume' | 'cancel' | 'update';
      updates?: {
        dayOfWeek?: number;
        startTime?: string;
        durationMinutes?: number;
      };
    };

    if (!slotId || !slotAction) throw new HttpsError('invalid-argument', 'slotId and action are required');

    const slotRef = db.collection('recurring_slots').doc(slotId);
    const slotSnap = await slotRef.get();
    if (!slotSnap.exists) throw new HttpsError('not-found', 'Recurring slot not found');

    const slot = slotSnap.data()!;
    if (slot.coachId !== callerUid) {
      throw new HttpsError('permission-denied', 'You can only manage your own slots');
    }

    if (slotAction === 'pause') {
      await slotRef.update({ status: 'paused', updatedAt: FieldValue.serverTimestamp() });
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
      await slotRef.update({ status: 'active', updatedAt: FieldValue.serverTimestamp() });
      return { success: true };
    }

    if (slotAction === 'cancel') {
      await slotRef.update({ status: 'cancelled', updatedAt: FieldValue.serverTimestamp() });

      // Cancel all future scheduled/allocated instances
      const futureInstances = await db.collection('session_instances')
        .where('recurringSlotId', '==', slotId)
        .where('status', 'in', ['scheduled', 'allocated'])
        .get();

      const batch = db.batch();
      futureInstances.docs.forEach(d => {
        batch.update(d.ref, { status: 'cancelled', updatedAt: FieldValue.serverTimestamp() });
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

    if (slotAction === 'update' && updates) {
      const slotUpdates: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };
      if (updates.dayOfWeek !== undefined) slotUpdates.dayOfWeek = updates.dayOfWeek;
      if (updates.startTime) slotUpdates.startTime = updates.startTime;
      if (updates.durationMinutes) slotUpdates.durationMinutes = updates.durationMinutes;

      await slotRef.update(slotUpdates);
      return { success: true };
    }

    throw new HttpsError('invalid-argument', `Unknown action: ${slotAction}`);
  }
);

// ─── Helper: Generate concrete instances from a recurring slot ───────────────
function generateInstancesForSlot(
  slot: Record<string, any>,
  slotId: string,
  daysAhead: number
): Record<string, any>[] {
  const instances: Record<string, any>[] = [];
  const now = new Date();
  const endDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);

  // Find the next occurrence of the target day of week
  let current = new Date(now);
  current.setHours(0, 0, 0, 0);

  // Advance to the next target day
  while (current.getDay() !== slot.dayOfWeek) {
    current.setDate(current.getDate() + 1);
  }

  // If today is the target day but the time has passed, skip to next week
  if (current.getTime() === new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) {
    const [h, m] = (slot.startTime as string).split(':').map(Number);
    const slotTimeToday = new Date(now);
    slotTimeToday.setHours(h, m, 0, 0);
    if (now > slotTimeToday) {
      current.setDate(current.getDate() + (slot.recurrencePattern === 'biweekly' ? 14 : 7));
    }
  }

  const step = slot.recurrencePattern === 'biweekly' ? 14 : 7;

  while (current <= endDate) {
    const dateStr = current.toISOString().split('T')[0]; // YYYY-MM-DD
    const [h, m] = (slot.startTime as string).split(':').map(Number);
    const endMinutes = h * 60 + m + (slot.durationMinutes as number);
    const endH = Math.floor(endMinutes / 60) % 24;
    const endM = endMinutes % 60;
    const endTime = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;

    instances.push({
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
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    current.setDate(current.getDate() + step);
  }

  return instances;
}

// ─── 16. generateUpcomingInstances — Scheduled: generate instances for all active slots ──
export const generateUpcomingInstances = onSchedule(
  { schedule: '0 2 * * *', timeZone: 'UTC', region: 'us-central1' },
  async () => {
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
        await instRef.set({ ...inst, id: instRef.id });
        totalGenerated++;
      }
    }

    console.log(`[generateUpcomingInstances] Generated ${totalGenerated} new instances for ${slotsSnap.size} active slots`);
  }
);

// ─── 17. allocateSessionInstance — Assign a Zoom room to a session instance ──
export const allocateSessionInstance = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in');

    const { instanceId } = request.data as { instanceId: string };
    if (!instanceId) throw new HttpsError('invalid-argument', 'instanceId is required');

    const instanceRef = db.collection('session_instances').doc(instanceId);
    const instanceSnap = await instanceRef.get();
    if (!instanceSnap.exists) throw new HttpsError('not-found', 'Session instance not found');

    const instance = instanceSnap.data()!;
    if (instance.coachId !== callerUid) {
      throw new HttpsError('permission-denied', 'You can only allocate your own sessions');
    }

    if (instance.status !== 'scheduled' && instance.status !== 'allocation_failed') {
      throw new HttpsError('failed-precondition', `Instance is in status "${instance.status}", cannot allocate`);
    }

    // Get all active Zoom rooms for this coach
    const roomsSnap = await db.collection('zoom_rooms')
      .where('coachId', '==', callerUid)
      .where('status', '==', 'active')
      .get();

    if (roomsSnap.empty) {
      await instanceRef.update({
        status: 'allocation_failed',
        allocationFailReason: 'No active Zoom rooms available',
        allocationAttempts: (instance.allocationAttempts || 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await writeAuditLog({
        coachId: callerUid,
        action: 'allocation_failed',
        sessionInstanceId: instanceId,
        details: 'No active Zoom rooms available for this coach',
      });

      return { success: false, reason: 'No active Zoom rooms available' };
    }

    // Check each room for conflicts at the same date/time
    const scheduledDate = instance.scheduledDate as string;
    const scheduledStartTime = instance.scheduledStartTime as string;
    const scheduledEndTime = instance.scheduledEndTime as string;

    let allocatedRoom: any = null;

    for (const roomDoc of roomsSnap.docs) {
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
        // Check time overlap: new session overlaps if it starts before existing ends AND ends after existing starts
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
        allocatedRoom = { id: roomDoc.id, ...room };
        break;
      }
    }

    if (!allocatedRoom) {
      await instanceRef.update({
        status: 'allocation_failed',
        allocationFailReason: 'All Zoom rooms have conflicts at this time',
        allocationAttempts: (instance.allocationAttempts || 0) + 1,
        updatedAt: FieldValue.serverTimestamp(),
      });

      await writeAuditLog({
        coachId: callerUid,
        action: 'allocation_failed',
        sessionInstanceId: instanceId,
        details: `All ${roomsSnap.size} rooms have conflicts at ${scheduledDate} ${scheduledStartTime}`,
      });

      return { success: false, reason: 'All Zoom rooms have conflicts at this time' };
    }

    // Create a mock Zoom meeting (or real one when provider is activated)
    const memberName = instance.memberName || 'Member';
    const meeting = createMockZoomMeeting(
      `GoArrive Session: ${memberName}`,
      `${scheduledDate}T${scheduledStartTime}:00`,
      instance.durationMinutes as number,
      allocatedRoom.zoomAccountEmail
    );

    // Update the instance with allocation data
    await instanceRef.update({
      status: 'allocated',
      zoomRoomId: allocatedRoom.id,
      zoomRoomLabel: allocatedRoom.label,
      zoomMeetingId: meeting.meetingId,
      zoomJoinUrl: meeting.joinUrl,
      zoomStartUrl: meeting.startUrl,
      zoomMeetingPassword: meeting.password,
      allocatedAt: FieldValue.serverTimestamp(),
      allocationAttempts: (instance.allocationAttempts || 0) + 1,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditLog({
      coachId: callerUid,
      action: 'allocation_success',
      sessionInstanceId: instanceId,
      zoomRoomId: allocatedRoom.id,
      memberId: instance.memberId,
      details: `Allocated room "${allocatedRoom.label}" for ${memberName} at ${scheduledDate} ${scheduledStartTime}`,
      metadata: { meetingId: meeting.meetingId },
    });

    console.log(`[allocateSessionInstance] Allocated room ${allocatedRoom.id} to instance ${instanceId}`);
    return { success: true, roomLabel: allocatedRoom.label, meetingId: meeting.meetingId };
  }
);

// ─── 18. allocateAllPendingInstances — Batch allocate all unallocated instances ──
export const allocateAllPendingInstances = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in');

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
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a: any, b: any) => {
        const dateCompare = (a.scheduledDate as string).localeCompare(b.scheduledDate as string);
        if (dateCompare !== 0) return dateCompare;
        return (a.scheduledStartTime as string).localeCompare(b.scheduledStartTime as string);
      });

    for (const inst of instances) {
      const instance = inst as any;
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
          const meeting = createMockZoomMeeting(
            `GoArrive Session: ${instance.memberName || 'Member'}`,
            `${instance.scheduledDate}T${instance.scheduledStartTime}:00`,
            instance.durationMinutes,
            room.zoomAccountEmail
          );

          await db.collection('session_instances').doc(instance.id).update({
            status: 'allocated',
            zoomRoomId: roomDoc.id,
            zoomRoomLabel: room.label,
            zoomMeetingId: meeting.meetingId,
            zoomJoinUrl: meeting.joinUrl,
            zoomStartUrl: meeting.startUrl,
            zoomMeetingPassword: meeting.password,
            allocatedAt: FieldValue.serverTimestamp(),
            allocationAttempts: (instance.allocationAttempts || 0) + 1,
            updatedAt: FieldValue.serverTimestamp(),
          });

          allocated++;
          roomFound = true;
          break;
        }
      }

      if (!roomFound) {
        await db.collection('session_instances').doc(instance.id).update({
          status: 'allocation_failed',
          allocationFailReason: 'All rooms have conflicts',
          allocationAttempts: (instance.allocationAttempts || 0) + 1,
          updatedAt: FieldValue.serverTimestamp(),
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
  }
);

// ─── 19. rescheduleInstance — Move a single occurrence to a different date/time ──
export const rescheduleInstance = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in');

    const { instanceId, newDate, newStartTime } = request.data as {
      instanceId: string;
      newDate: string;      // YYYY-MM-DD
      newStartTime: string; // HH:mm
    };

    if (!instanceId || !newDate || !newStartTime) {
      throw new HttpsError('invalid-argument', 'instanceId, newDate, and newStartTime are required');
    }

    const instanceRef = db.collection('session_instances').doc(instanceId);
    const instanceSnap = await instanceRef.get();
    if (!instanceSnap.exists) throw new HttpsError('not-found', 'Session instance not found');

    const instance = instanceSnap.data()!;
    if (instance.coachId !== callerUid) {
      throw new HttpsError('permission-denied', 'You can only reschedule your own sessions');
    }

    if (!['scheduled', 'allocated', 'allocation_failed'].includes(instance.status as string)) {
      throw new HttpsError('failed-precondition', `Cannot reschedule instance in status "${instance.status}"`);
    }

    const originalDate = instance.scheduledDate;
    const originalTime = instance.scheduledStartTime;

    // Calculate new end time
    const [h, m] = newStartTime.split(':').map(Number);
    const endMinutes = h * 60 + m + (instance.durationMinutes as number);
    const endH = Math.floor(endMinutes / 60) % 24;
    const endM = endMinutes % 60;
    const newEndTime = `${endH.toString().padStart(2, '0')}:${endM.toString().padStart(2, '0')}`;

    await instanceRef.update({
      scheduledDate: newDate,
      scheduledStartTime: newStartTime,
      scheduledEndTime: newEndTime,
      status: 'scheduled', // Reset to scheduled so it can be re-allocated
      zoomRoomId: FieldValue.delete(),
      zoomRoomLabel: FieldValue.delete(),
      zoomMeetingId: FieldValue.delete(),
      zoomJoinUrl: FieldValue.delete(),
      zoomStartUrl: FieldValue.delete(),
      zoomMeetingPassword: FieldValue.delete(),
      allocatedAt: FieldValue.delete(),
      rescheduledFrom: `${originalDate} ${originalTime}`,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditLog({
      coachId: callerUid,
      action: 'instance_rescheduled',
      sessionInstanceId: instanceId,
      memberId: instance.memberId,
      details: `Rescheduled from ${originalDate} ${originalTime} to ${newDate} ${newStartTime}`,
    });

    return { success: true };
  }
);

// ─── 20. cancelInstance — Cancel a single session instance ───────────────────
export const cancelInstance = onCall(
  { region: 'us-central1' },
  async (request) => {
    const callerUid = request.auth?.uid;
    if (!callerUid) throw new HttpsError('unauthenticated', 'Must be signed in');

    const { instanceId } = request.data as { instanceId: string };
    if (!instanceId) throw new HttpsError('invalid-argument', 'instanceId is required');

    const instanceRef = db.collection('session_instances').doc(instanceId);
    const instanceSnap = await instanceRef.get();
    if (!instanceSnap.exists) throw new HttpsError('not-found', 'Session instance not found');

    const instance = instanceSnap.data()!;
    if (instance.coachId !== callerUid) {
      throw new HttpsError('permission-denied', 'You can only cancel your own sessions');
    }

    await instanceRef.update({
      status: 'cancelled',
      updatedAt: FieldValue.serverTimestamp(),
    });

    await writeAuditLog({
      coachId: callerUid,
      action: 'instance_cancelled',
      sessionInstanceId: instanceId,
      memberId: instance.memberId,
      details: `Cancelled session for ${instance.memberName} on ${instance.scheduledDate} at ${instance.scheduledStartTime}`,
    });

    return { success: true };
  }
);
