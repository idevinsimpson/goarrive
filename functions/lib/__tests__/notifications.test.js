"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Cloud Functions tests — Notification rate limiting & recurring scheduling
 *
 * Risk 7: Refactored to import actual exported functions from notificationUtils.
 *
 * To run: cd functions && npx jest
 */
const notificationUtils_1 = require("../notificationUtils");
describe('shouldSendNotification', () => {
    test('sends notification when no previous send', () => {
        expect((0, notificationUtils_1.shouldSendNotification)(null, new Date())).toBe(true);
    });
    test('blocks notification within cooldown window', () => {
        const lastSent = new Date('2026-03-26T10:00:00Z');
        const now = new Date('2026-03-26T10:00:30Z'); // 30s later
        expect((0, notificationUtils_1.shouldSendNotification)(lastSent, now)).toBe(false);
    });
    test('allows notification after cooldown expires', () => {
        const lastSent = new Date('2026-03-26T10:00:00Z');
        const now = new Date('2026-03-26T10:01:01Z'); // 61s later
        expect((0, notificationUtils_1.shouldSendNotification)(lastSent, now)).toBe(true);
    });
    test('allows notification exactly at cooldown boundary', () => {
        const lastSent = new Date('2026-03-26T10:00:00Z');
        const now = new Date('2026-03-26T10:01:00Z'); // exactly 60s
        expect((0, notificationUtils_1.shouldSendNotification)(lastSent, now)).toBe(true);
    });
    test('uses custom cooldown for coach notifications (30s)', () => {
        const lastSent = new Date('2026-03-26T10:00:00Z');
        const now = new Date('2026-03-26T10:00:31Z'); // 31s later
        expect((0, notificationUtils_1.shouldSendNotification)(lastSent, now, 30000)).toBe(true);
    });
    test('blocks coach notification within 30s cooldown', () => {
        const lastSent = new Date('2026-03-26T10:00:00Z');
        const now = new Date('2026-03-26T10:00:20Z'); // 20s later
        expect((0, notificationUtils_1.shouldSendNotification)(lastSent, now, 30000)).toBe(false);
    });
});
describe('getNextWeekDates', () => {
    test('generates correct dates for Mon/Wed/Fri', () => {
        const ref = new Date('2026-03-26T00:00:00Z'); // Thursday
        const dates = (0, notificationUtils_1.getNextWeekDates)([1, 3, 5], ref); // Mon, Wed, Fri
        expect(dates).toHaveLength(3);
        expect(dates[0].getDay()).toBe(1); // Monday
        expect(dates[1].getDay()).toBe(3); // Wednesday
        expect(dates[2].getDay()).toBe(5); // Friday
    });
    test('generates correct dates for Tue/Thu', () => {
        const ref = new Date('2026-03-26T00:00:00Z');
        const dates = (0, notificationUtils_1.getNextWeekDates)([2, 4], ref);
        expect(dates).toHaveLength(2);
        expect(dates[0].getDay()).toBe(2); // Tuesday
        expect(dates[1].getDay()).toBe(4); // Thursday
    });
    test('handles Sunday correctly', () => {
        const ref = new Date('2026-03-26T00:00:00Z');
        const dates = (0, notificationUtils_1.getNextWeekDates)([0], ref); // Sunday
        expect(dates).toHaveLength(1);
        expect(dates[0].getDay()).toBe(0);
    });
    test('returns empty array for empty daysOfWeek', () => {
        const ref = new Date('2026-03-26T00:00:00Z');
        const dates = (0, notificationUtils_1.getNextWeekDates)([], ref);
        expect(dates).toHaveLength(0);
    });
});
//# sourceMappingURL=notifications.test.js.map