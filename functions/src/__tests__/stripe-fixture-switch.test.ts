/**
 * Unit tests for the Stripe test-mode fixture-switch guards.
 *
 * To run: cd functions && node_modules/.bin/jest --config jest.unit.config.cjs --no-coverage
 *
 * These tests import only the pure helper exports — no Firebase Admin SDK needed.
 */
import { HttpsError } from 'firebase-functions/v2/https';
import { isFixtureCoach, getStripeForCoach } from '../stripeFixtureSwitch';

// Minimal Stripe stub — enough to satisfy the return-type check.
jest.mock('stripe', () => {
  return jest.fn().mockImplementation((key: string) => ({ _key: key }));
});

describe('isFixtureCoach', () => {
  test('returns true for seed coach id', () => {
    expect(isFixtureCoach('test-coach-seed-001')).toBe(true);
  });

  test('returns false for a real coach id', () => {
    expect(isFixtureCoach('real-coach-abc')).toBe(false);
  });
});

describe('getStripeForCoach', () => {
  const LIVE_KEY = 'sk_live_yyy';
  const TEST_KEY = 'sk_test_xxx';

  test('fixture id with valid test key resolves to test-mode Stripe instance', () => {
    const instance = getStripeForCoach('test-coach-seed-001', LIVE_KEY, TEST_KEY) as any;
    expect(instance._key).toBe(TEST_KEY);
  });

  test('non-fixture id resolves to live-mode Stripe instance', () => {
    const instance = getStripeForCoach('real-coach-abc', LIVE_KEY, TEST_KEY) as any;
    expect(instance._key).toBe(LIVE_KEY);
  });

  test('fixture id with missing STRIPE_TEST_KEY throws failed-precondition', () => {
    expect(() => getStripeForCoach('test-coach-seed-001', LIVE_KEY, undefined)).toThrow(
      expect.objectContaining({
        code: 'failed-precondition',
        message: expect.stringContaining('STRIPE_TEST_KEY secret is not set'),
      } satisfies Partial<HttpsError>),
    );
  });

  test('fixture id with non-test-mode key in STRIPE_TEST_KEY throws internal', () => {
    expect(() => getStripeForCoach('test-coach-seed-001', LIVE_KEY, 'sk_live_pwned')).toThrow(
      expect.objectContaining({
        code: 'internal',
        message: expect.stringContaining('refusing to run fixture-coach path against a non-test key'),
      } satisfies Partial<HttpsError>),
    );
  });
});
