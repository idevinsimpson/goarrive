/**
 * Cloud Functions test scaffolding — Notification rate limiting (Suggestion 10)
 *
 * These tests validate the rate-limiting logic used in push notification
 * Cloud Functions. They test the cooldown mechanism in isolation.
 *
 * To run: cd functions && npx jest
 */

describe('Notification Rate Limiting Logic', () => {
  const COOLDOWN_MS = 60_000;

  function shouldSendNotification(
    lastSentAt: Date | null,
    now: Date,
    cooldownMs: number = COOLDOWN_MS,
  ): boolean {
    if (!lastSentAt) return true;
    return now.getTime() - lastSentAt.getTime() >= cooldownMs;
  }

  test('sends notification when no previous send', () => {
    expect(shouldSendNotification(null, new Date())).toBe(true);
  });

  test('blocks notification within cooldown window', () => {
    const lastSent = new Date('2026-03-26T10:00:00Z');
    const now = new Date('2026-03-26T10:00:30Z'); // 30s later
    expect(shouldSendNotification(lastSent, now)).toBe(false);
  });

  test('allows notification after cooldown expires', () => {
    const lastSent = new Date('2026-03-26T10:00:00Z');
    const now = new Date('2026-03-26T10:01:01Z'); // 61s later
    expect(shouldSendNotification(lastSent, now)).toBe(true);
  });

  test('allows notification exactly at cooldown boundary', () => {
    const lastSent = new Date('2026-03-26T10:00:00Z');
    const now = new Date('2026-03-26T10:01:00Z'); // exactly 60s
    expect(shouldSendNotification(lastSent, now)).toBe(true);
  });

  test('uses custom cooldown for coach notifications (30s)', () => {
    const lastSent = new Date('2026-03-26T10:00:00Z');
    const now = new Date('2026-03-26T10:00:31Z'); // 31s later
    expect(shouldSendNotification(lastSent, now, 30_000)).toBe(true);
  });

  test('blocks coach notification within 30s cooldown', () => {
    const lastSent = new Date('2026-03-26T10:00:00Z');
    const now = new Date('2026-03-26T10:00:20Z'); // 20s later
    expect(shouldSendNotification(lastSent, now, 30_000)).toBe(false);
  });
});

describe('Recurring Assignment Scheduling Logic', () => {
  function getNextWeekDates(
    daysOfWeek: number[],
    referenceDate: Date,
  ): Date[] {
    const dates: Date[] = [];
    const monday = new Date(referenceDate);
    const dayOfWeek = monday.getDay();
    const daysFromMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
    monday.setDate(monday.getDate() - daysFromMon + 7); // Next Monday
    monday.setHours(0, 0, 0, 0);

    daysOfWeek.forEach((dow) => {
      const d = new Date(monday);
      const offset = dow === 0 ? 6 : dow - 1; // Convert Sun=0 to Mon=0 index
      d.setDate(monday.getDate() + offset);
      dates.push(d);
    });

    return dates.sort((a, b) => a.getTime() - b.getTime());
  }

  test('generates correct dates for Mon/Wed/Fri', () => {
    const ref = new Date('2026-03-26T00:00:00Z'); // Thursday
    const dates = getNextWeekDates([1, 3, 5], ref); // Mon, Wed, Fri
    expect(dates).toHaveLength(3);
    // Next week starts Mar 30 (Monday)
    expect(dates[0].getDay()).toBe(1); // Monday
    expect(dates[1].getDay()).toBe(3); // Wednesday
    expect(dates[2].getDay()).toBe(5); // Friday
  });

  test('generates correct dates for Tue/Thu', () => {
    const ref = new Date('2026-03-26T00:00:00Z');
    const dates = getNextWeekDates([2, 4], ref);
    expect(dates).toHaveLength(2);
    expect(dates[0].getDay()).toBe(2); // Tuesday
    expect(dates[1].getDay()).toBe(4); // Thursday
  });

  test('handles Sunday correctly', () => {
    const ref = new Date('2026-03-26T00:00:00Z');
    const dates = getNextWeekDates([0], ref); // Sunday
    expect(dates).toHaveLength(1);
    expect(dates[0].getDay()).toBe(0);
  });
});
