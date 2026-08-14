"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.FIXTURE_COACH_IDS = void 0;
exports.isFixtureCoach = isFixtureCoach;
exports.getStripeForCoach = getStripeForCoach;
const stripe_1 = __importDefault(require("stripe"));
const https_1 = require("firebase-functions/v2/https");
// Hardcoded allowlist of seed coach IDs that route to Stripe test mode.
// Do NOT read this from Firestore — a doc flag that flips modes is an integrity hazard both ways.
exports.FIXTURE_COACH_IDS = new Set(['test-coach-seed-001']);
function isFixtureCoach(coachId) {
    return exports.FIXTURE_COACH_IDS.has(coachId);
}
function getStripe(secretKey) {
    return new stripe_1.default(secretKey.trim(), { apiVersion: '2026-02-25.clover' });
}
function getStripeForCoach(coachId, liveKey, testKey) {
    if (isFixtureCoach(coachId)) {
        if (!testKey) {
            throw new https_1.HttpsError('failed-precondition', 'STRIPE_TEST_KEY secret is not set — fixture-coach path requires a test-mode key');
        }
        if (!testKey.startsWith('sk_test_')) {
            throw new https_1.HttpsError('internal', 'STRIPE_TEST_KEY does not start with sk_test_ — refusing to run fixture-coach path against a non-test key');
        }
        return getStripe(testKey);
    }
    return getStripe(liveKey);
}
//# sourceMappingURL=stripeFixtureSwitch.js.map