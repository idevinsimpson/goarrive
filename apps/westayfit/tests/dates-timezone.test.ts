// A goal has one published window and one time zone. These tests prove the
// labels come out the same whatever the device's local zone is, by deriving
// every expectation in the GOAL zone and never from the runner's clock.

import { describe, expect, it } from 'vitest';

import { formatEndsAt, formatPeriod, isValidTimeZone } from '../src/ui/dates';

const NY = 'America/New_York';
const en = { locale: 'en-US' };

describe('goal window labels are derived in the goal time zone', () => {
  it('UTC boundary: an instant on Oct 6 UTC is still Mon, Oct 5 in New York', () => {
    // 2026-10-06T03:30:00Z = Mon 2026-10-05 23:30 EDT.
    const iso = '2026-10-06T03:30:00.000Z';
    const now = new Date('2026-09-18T12:00:00.000Z');
    expect(formatEndsAt(iso, { ...en, timeZone: NY, now })).toBe('Ends Mon, Oct 5');
    // The same instant read in UTC would be a different calendar day.
    expect(formatEndsAt(iso, { ...en, timeZone: 'UTC', now })).toBe('Ends Tue, Oct 6');
    // And in a zone east of UTC, later still.
    expect(formatEndsAt(iso, { ...en, timeZone: 'Asia/Tokyo', now })).toBe('Ends Tue, Oct 6');
  });

  it('"ends today" is decided on calendar parts in the goal zone', () => {
    const endsAt = '2026-10-06T03:30:00.000Z'; // Oct 5, 11:30 PM EDT
    // "Now" is Oct 5 at 9:00 PM EDT (Oct 6 01:00 UTC): same NY day → today.
    const nowSameNyDay = new Date('2026-10-06T01:00:00.000Z');
    expect(formatEndsAt(endsAt, { ...en, timeZone: NY, now: nowSameNyDay })).toBe(
      'Ends today at 11:30 PM EDT'
    );
    // In UTC those two instants are the same UTC day too, but at 3:30 AM.
    expect(formatEndsAt(endsAt, { ...en, timeZone: 'UTC', now: nowSameNyDay })).toBe(
      'Ends today at 3:30 AM UTC'
    );
    // "Now" is Oct 6 at 12:30 AM EDT (Oct 6 04:30 UTC): the NY day has turned.
    const nowNextNyDay = new Date('2026-10-06T04:30:00.000Z');
    expect(formatEndsAt(endsAt, { ...en, timeZone: NY, now: nowNextNyDay })).toBe('Ends Mon, Oct 5');
  });

  it('periods: same month, cross-month and cross-year, all in the goal zone', () => {
    // Aug 2 03:00 UTC = Aug 1 11:00 PM EDT; Aug 16 03:59 UTC = Aug 15 11:59 PM EDT.
    expect(formatPeriod('2026-08-02T03:00:00.000Z', '2026-08-16T03:59:00.000Z', { ...en, timeZone: NY })).toBe(
      'Aug 1 – 15'
    );
    expect(formatPeriod('2026-08-02T03:00:00.000Z', '2026-08-16T03:59:00.000Z', { ...en, timeZone: 'UTC' })).toBe(
      'Aug 2 – 16'
    );
    // Cross-month: Sep 30 11 PM EDT → Oct 14 11 PM EDT.
    expect(formatPeriod('2026-10-01T03:00:00.000Z', '2026-10-15T03:00:00.000Z', { ...en, timeZone: NY })).toBe(
      'Sep 30 – Oct 14'
    );
    // Cross-year: Dec 31 2026 11 PM EST → Jan 14 2027 11 PM EST.
    expect(formatPeriod('2027-01-01T04:00:00.000Z', '2027-01-15T04:00:00.000Z', { ...en, timeZone: NY })).toBe(
      'Dec 31, 2026 – Jan 14, 2027'
    );
  });

  it('is DST-safe: the zone designation follows the instant', () => {
    // 2026-03-08 is the US DST start. 06:30 UTC = 1:30 AM EST (before the jump).
    const before = '2026-03-08T06:30:00.000Z';
    expect(formatEndsAt(before, { ...en, timeZone: NY, now: new Date(before) })).toBe('Ends today at 1:30 AM EST');
    // 07:30 UTC = 3:30 AM EDT (the 2 AM hour does not exist).
    const after = '2026-03-08T07:30:00.000Z';
    expect(formatEndsAt(after, { ...en, timeZone: NY, now: new Date(after) })).toBe('Ends today at 3:30 AM EDT');
    // A period spanning the DST change keeps its calendar dates.
    expect(formatPeriod('2026-03-02T05:00:00.000Z', '2026-03-16T03:59:00.000Z', { ...en, timeZone: NY })).toBe(
      'Mar 2 – 15'
    );
  });

  it('withholds the label rather than substituting a zone when the goal zone is invalid', () => {
    expect(isValidTimeZone('America/New_York')).toBe(true);
    expect(isValidTimeZone('Not/AZone')).toBe(false);
    expect(isValidTimeZone('')).toBe(false);
    expect(isValidTimeZone(undefined)).toBe(false);
    expect(formatEndsAt('2026-10-06T03:30:00.000Z', { ...en, timeZone: 'Not/AZone' })).toBeNull();
    expect(formatPeriod('2026-08-02T03:00:00.000Z', '2026-08-16T03:59:00.000Z', { ...en, timeZone: 'Not/AZone' })).toBeNull();
    expect(formatPeriod('2026-08-02T03:00:00.000Z', '2026-08-16T03:59:00.000Z', { ...en, timeZone: '' })).toBeNull();
  });

  it('with no zone supplied, falls back to the reader’s zone (member surfaces)', () => {
    // Not asserting a specific day: that would depend on the runner's zone.
    expect(formatPeriod('2026-08-02T03:00:00.000Z', '2026-08-16T03:59:00.000Z', en)).toMatch(/^Aug \d+ – \d+$/);
    expect(formatEndsAt('2026-10-06T03:30:00.000Z', { ...en, now: new Date('2026-09-18T12:00:00.000Z') })).toMatch(/^Ends (Mon|Tue), Oct [56]$/);
  });

  it('rejects unparsable instants', () => {
    expect(formatEndsAt('not-a-date', { ...en, timeZone: NY })).toBeNull();
    expect(formatPeriod('x', '2026-08-16T03:59:00.000Z', { ...en, timeZone: NY })).toBeNull();
  });
});
