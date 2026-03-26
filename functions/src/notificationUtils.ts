/**
 * notificationUtils — Shared utility functions for notification rate limiting
 * and recurring assignment scheduling.
 *
 * Extracted for testability (Risk 7) so tests import real logic.
 */

/** Check if a notification should be sent based on cooldown */
export function shouldSendNotification(
  lastSentAt: Date | null,
  now: Date,
  cooldownMs: number = 60_000,
): boolean {
  if (!lastSentAt) return true;
  return now.getTime() - lastSentAt.getTime() >= cooldownMs;
}

/**
 * Calculate the next week's dates for given days of the week.
 * @param daysOfWeek Array of day numbers (0=Sun, 1=Mon, ..., 6=Sat)
 * @param referenceDate The reference date to calculate from
 */
export function getNextWeekDates(
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
