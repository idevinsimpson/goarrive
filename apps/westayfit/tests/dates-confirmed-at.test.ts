import { describe, expect, it } from 'vitest';

import { formatClock, formatConfirmedAt } from '../src/ui/dates';

/**
 * W12-6 (INT-12): a "Confirmed" line names the day when it is not today.
 * Every case fixes `now`, the zone and the locale, so the result does not
 * depend on the machine running it.
 */
const NY = { timeZone: 'America/New_York', locale: 'en-US' };
const at = (iso: string) => new Date(iso);

describe('formatConfirmedAt', () => {
  it('the same local day: the clock alone', () => {
    expect(formatConfirmedAt(at('2026-10-21T19:41:00Z'), at('2026-10-21T23:00:00Z'), NY)).toBe('Confirmed 3:41 PM');
  });

  it('the previous day: the date as well, even under 24 hours earlier', () => {
    // 11:58 PM on Oct 20 in New York, read at 12:05 AM on Oct 21: seven minutes, another day.
    expect(formatConfirmedAt(at('2026-10-21T03:58:00Z'), at('2026-10-21T04:05:00Z'), NY)).toBe('Confirmed Oct 20, 11:58 PM');
    expect(formatConfirmedAt(at('2026-10-20T19:41:00Z'), at('2026-10-21T15:00:00Z'), NY)).toBe('Confirmed Oct 20, 3:41 PM');
  });

  it('across a year boundary: the year too', () => {
    expect(formatConfirmedAt(at('2026-01-01T04:58:00Z'), at('2026-01-01T05:05:00Z'), NY)).toBe('Confirmed Dec 31, 2025, 11:58 PM');
  });

  it('a DST change day is still one day (23 and 25 hours long), compared on the calendar, not by hours', () => {
    // Fall back, Nov 1 2026: 12:30 AM EDT and 11:30 PM EST are 24 h apart and the same day.
    expect(formatConfirmedAt(at('2026-11-01T04:30:00Z'), at('2026-11-02T04:30:00Z'), NY)).toBe('Confirmed 12:30 AM');
    // Spring forward, Mar 8 2026: 12:30 AM EST and 11:30 PM EDT, 22 h apart, the same day.
    expect(formatConfirmedAt(at('2026-03-08T05:30:00Z'), at('2026-03-09T03:30:00Z'), NY)).toBe('Confirmed 12:30 AM');
    // And just past midnight after the 25-hour day: another day.
    expect(formatConfirmedAt(at('2026-11-02T04:30:00Z'), at('2026-11-02T05:10:00Z'), NY)).toBe('Confirmed Nov 1, 11:30 PM');
  });

  it('a refresh that did not land: "Last confirmed", on the same day or another', () => {
    expect(formatConfirmedAt(at('2026-10-21T19:41:00Z'), at('2026-10-21T23:00:00Z'), { ...NY, failed: true })).toBe('Last confirmed 3:41 PM');
    expect(formatConfirmedAt(at('2026-10-20T19:41:00Z'), at('2026-10-21T15:00:00Z'), { ...NY, failed: true })).toBe(
      'Last confirmed Oct 20, 3:41 PM',
    );
  });

  it('the reader\'s own zone by default; an unusable time or zone is withheld', () => {
    const same = new Date();
    expect(formatConfirmedAt(same, same)).toBe(`Confirmed ${formatClock(same)}`);
    expect(formatConfirmedAt(new Date(Number.NaN), same)).toBeNull();
    expect(formatConfirmedAt(same, same, { timeZone: 'Not/AZone' })).toBeNull();
  });
});
