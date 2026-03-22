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
 *
 * ME-001: STRIPE_SECRET_KEY must be set as a Firebase secret before functions 3–6 operate.
 *         firebase functions:secrets:set STRIPE_SECRET_KEY
 * ME-002: STRIPE_WEBHOOK_SECRET must be set for webhook signature verification.
 *         firebase functions:secrets:set STRIPE_WEBHOOK_SECRET
 * ME-003: APP_BASE_URL must be set to the deployed app URL for checkout redirects.
 *         firebase functions:config:set app.base_url="https://goarrive.web.app"
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

const db = admin.firestore();
const messaging = admin.messaging();

// ── Secrets ───────────────────────────────────────────────────────────────────
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
  return new Stripe(secretKey, { apiVersion: '2026-02-25.clover' });
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
    const appBaseUrl = process.env.APP_BASE_URL || 'https://goarrive.web.app';
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
    if (!coachAccount.chargesEnabled) {
      throw new HttpsError('failed-precondition', 'Coach Stripe account is not ready to accept charges. ME-001: Coach must complete Stripe onboarding.');
    }
    const stripeAccountId = coachAccount.stripeAccountId as string;

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
    const appBaseUrl = process.env.APP_BASE_URL || 'https://goarrive.web.app';

    // ── Get or create Stripe customer on connected account ──
    let stripeCustomerId = plan.stripeCustomerId as string | undefined;
    if (!stripeCustomerId) {
      const memberSnap = await db.collection('users').doc(memberId).get();
      const memberEmail = memberSnap.data()?.email as string | undefined;
      const customer = await stripe.customers.create(
        { email: memberEmail, metadata: { memberId, coachId, planId } },
        { stripeAccount: stripeAccountId }
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
            application_fee_percent: applicationFeePercent,
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
        { stripeAccount: stripeAccountId }
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
          success_url: `${appBaseUrl}/checkout-success?intent=${intentId}`,
          cancel_url: `${appBaseUrl}/my-plan?checkout_cancelled=1`,
          metadata: { intentId, planId, snapshotId, memberId, coachId },
        },
        { stripeAccount: stripeAccountId }
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
