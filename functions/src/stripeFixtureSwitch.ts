import Stripe from 'stripe';
import { HttpsError } from 'firebase-functions/v2/https';

// Hardcoded allowlist of seed coach IDs that route to Stripe test mode.
// Do NOT read this from Firestore — a doc flag that flips modes is an integrity hazard both ways.
export const FIXTURE_COACH_IDS = new Set(['test-coach-seed-001']);

export function isFixtureCoach(coachId: string): boolean {
  return FIXTURE_COACH_IDS.has(coachId);
}

function getStripe(secretKey: string): Stripe {
  return new Stripe(secretKey.trim(), { apiVersion: '2026-02-25.clover' });
}

export function getStripeForCoach(coachId: string, liveKey: string, testKey: string | undefined): Stripe {
  if (isFixtureCoach(coachId)) {
    if (!testKey) {
      throw new HttpsError(
        'failed-precondition',
        'STRIPE_TEST_KEY secret is not set — fixture-coach path requires a test-mode key',
      );
    }
    if (!testKey.startsWith('sk_test_')) {
      throw new HttpsError(
        'internal',
        'STRIPE_TEST_KEY does not start with sk_test_ — refusing to run fixture-coach path against a non-test key',
      );
    }
    return getStripe(testKey);
  }
  return getStripe(liveKey);
}
