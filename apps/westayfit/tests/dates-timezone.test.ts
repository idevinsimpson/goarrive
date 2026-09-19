// A goal has one published window and one time zone. These tests prove the
// labels come out the same whatever the device's local zone is, by deriving
// every expectation in the GOAL zone and never from the runner's clock.

import { describe, expect, it } from 'vitest';

import {
  formatActiveWindowLabel,
  formatCountingSince,
  formatEndsAt,
  formatPeriod,
  formatReachedOn,
  hasWindowEnded,
  isValidTimeZone,
} from '../src/ui/dates';

const NY = 'America/New_York';
// A pinned "now" inside the fixtures' year, so the year-carrying period
// format (windows outside the reader's current year) does not start firing on
// these 2026 fixtures when the wall clock reaches 2027. Cases that care about
// "today" pass their own `now` and override this.
const en = { locale: 'en-US', now: new Date('2026-09-18T12:00:00.000Z') };

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

  it('A8: a window outside the reader’s current year carries the year on both ends', () => {
    const now2026 = new Date('2026-09-18T12:00:00.000Z');
    // Same-year window, but not THIS year: "Jun 1 – Jul 14" would read as 2026.
    expect(
      formatPeriod('2025-06-01T04:00:00.000Z', '2025-07-15T03:59:00.000Z', {
        ...en,
        timeZone: NY,
        now: now2026,
      })
    ).toBe('Jun 1, 2025 – Jul 14, 2025');
    // Same month, still a past year: the short "Aug 1 – 15" form is withheld.
    expect(
      formatPeriod('2025-08-02T03:00:00.000Z', '2025-08-16T03:59:00.000Z', {
        ...en,
        timeZone: NY,
        now: now2026,
      })
    ).toBe('Aug 1, 2025 – Aug 15, 2025');
    // A future year is the same rule.
    expect(
      formatPeriod('2027-08-02T03:00:00.000Z', '2027-08-16T03:59:00.000Z', {
        ...en,
        timeZone: NY,
        now: now2026,
      })
    ).toBe('Aug 1, 2027 – Aug 15, 2027');
    // The reader's current year keeps the short form.
    expect(
      formatPeriod('2026-08-02T03:00:00.000Z', '2026-08-16T03:59:00.000Z', {
        ...en,
        timeZone: NY,
        now: now2026,
      })
    ).toBe('Aug 1 – 15');
    // "Current year" is judged in the GOAL's zone, not the reader's device:
    // 2027-01-01T03:00Z is still Dec 31 2026 in New York.
    expect(
      formatPeriod('2026-12-20T05:00:00.000Z', '2026-12-31T05:00:00.000Z', {
        ...en,
        timeZone: NY,
        now: new Date('2027-01-01T03:00:00.000Z'),
      })
    ).toBe('Dec 20 – 31');
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

describe('an active goal whose window has already ended', () => {
  // Nothing closes a goal automatically, so `status: "active"` outlives the
  // published window. The end is ONE instant; only the wording of the date is
  // a matter of zone.
  const endsAt = '2026-10-06T03:30:00.000Z'; // Mon Oct 5, 11:30 PM EDT

  it('hasWindowEnded is an instant comparison, on the boundary and either side', () => {
    expect(hasWindowEnded(endsAt, { now: new Date('2026-10-06T03:29:59.999Z') })).toBe(false);
    // The end instant itself has not passed.
    expect(hasWindowEnded(endsAt, { now: new Date(endsAt) })).toBe(false);
    expect(hasWindowEnded(endsAt, { now: new Date('2026-10-06T03:30:00.001Z') })).toBe(true);
    // Unparsable is not "ended": a label is withheld, never invented.
    expect(hasWindowEnded('not-a-date', { now: new Date(endsAt) })).toBe(false);
  });

  it('is decided on the instant, not on the reader’s calendar day', () => {
    // 2026-10-06T02:00Z is Oct 6 in UTC but still Oct 5 (10 PM EDT) in New
    // York, and in BOTH zones the window is still open: the instant decides.
    const beforeEnd = new Date('2026-10-06T02:00:00.000Z');
    expect(hasWindowEnded(endsAt, { now: beforeEnd })).toBe(false);
    expect(formatActiveWindowLabel(endsAt, { ...en, timeZone: NY, now: beforeEnd })).toBe(
      'Open · Ends today at 11:30 PM EDT'
    );
    expect(formatActiveWindowLabel(endsAt, { ...en, timeZone: 'UTC', now: beforeEnd })).toBe(
      'Open · Ends today at 3:30 AM UTC'
    );
  });

  it('drops "Open · " and states the end once the instant has passed', () => {
    const open = new Date('2026-09-18T12:00:00.000Z');
    expect(formatActiveWindowLabel(endsAt, { ...en, timeZone: NY, now: open })).toBe(
      'Open · Ends Mon, Oct 5'
    );
    // Fifteen minutes after the end, still Oct 5 in New York: the "today"
    // wording is kept and only the verb changes.
    const justAfter = new Date('2026-10-06T03:45:00.000Z');
    expect(formatActiveWindowLabel(endsAt, { ...en, timeZone: NY, now: justAfter })).toBe(
      'Ended today at 11:30 PM EDT'
    );
    // A week later the date is named, in the goal's zone, with no "Open · ".
    const later = new Date('2026-10-13T12:00:00.000Z');
    const label = formatActiveWindowLabel(endsAt, { ...en, timeZone: NY, now: later });
    expect(label).toBe('Ended Mon, Oct 5');
    expect(label.startsWith('Open')).toBe(false);
    // The same instant in UTC names the NEXT calendar day — and is just as
    // ended. Zone changes the words, never the fact.
    expect(formatActiveWindowLabel(endsAt, { ...en, timeZone: 'UTC', now: later })).toBe(
      'Ended Tue, Oct 6'
    );
    // The date formatting is the "Ends" formatting, verb apart.
    expect(label.replace('Ended', 'Ends')).toBe(
      formatEndsAt(endsAt, { ...en, timeZone: NY, now: later })
    );
  });

  it('withholds the date rather than substituting a zone, in both tenses', () => {
    expect(formatActiveWindowLabel(endsAt, { ...en, timeZone: 'Not/AZone', now: new Date('2026-09-18T12:00:00.000Z') })).toBe('Open');
    expect(formatActiveWindowLabel(endsAt, { ...en, timeZone: 'Not/AZone', now: new Date('2026-10-13T12:00:00.000Z') })).toBe('Ended');
    expect(formatActiveWindowLabel('not-a-date', { ...en, timeZone: NY })).toBe('Open');
  });
});

describe('the day we reached it is written in the goal’s zone', () => {
  it('an instant on Sep 19 UTC is still Fri, Sep 18 in New York', () => {
    // 2026-09-19T01:30:00Z = Fri 2026-09-18 21:30 EDT.
    expect(formatReachedOn('2026-09-19T01:30:00.000Z', { ...en, timeZone: NY })).toBe(
      'Reached Sep 18'
    );
    expect(
      formatReachedOn('2026-09-19T01:30:00.000Z', { ...en, timeZone: 'Australia/Sydney' })
    ).toBe('Reached Sep 19');
  });

  it('carries the year once the crossing is not in the reader’s current year', () => {
    expect(formatReachedOn('2025-12-31T18:00:00.000Z', { ...en, timeZone: NY })).toBe(
      'Reached Dec 31, 2025'
    );
    expect(
      formatReachedOn('2026-09-18T16:00:00.000Z', {
        ...en,
        timeZone: NY,
        now: new Date('2027-01-05T12:00:00.000Z'),
      })
    ).toBe('Reached Sep 18, 2026');
  });

  it('withholds the label rather than naming a day it cannot place', () => {
    expect(formatReachedOn('not-a-date', { ...en, timeZone: NY })).toBeNull();
    expect(formatReachedOn('2026-09-18T16:00:00.000Z', { ...en, timeZone: 'Not/AZone' })).toBeNull();
  });
});

describe('a combined goal says what its total is counting SINCE', () => {
  // The boundary is the whole correction: a combined total with no stated
  // start is how the first build came to show repetitions nobody performed
  // for it. The label is written in the SETUP's zone, on exactly the rule the
  // crossing label uses, so two dates on one screen cannot disagree.
  it('an instant on Sep 19 UTC is still Sep 18 in New York', () => {
    expect(formatCountingSince('2026-09-19T01:30:00.000Z', { ...en, timeZone: NY })).toBe(
      'Counting since Sep 18'
    );
    expect(
      formatCountingSince('2026-09-19T01:30:00.000Z', { ...en, timeZone: 'Australia/Sydney' })
    ).toBe('Counting since Sep 19');
  });

  it('carries the year once the activation is not in the reader’s current year', () => {
    expect(formatCountingSince('2025-12-31T18:00:00.000Z', { ...en, timeZone: NY })).toBe(
      'Counting since Dec 31, 2025'
    );
  });

  it('withholds the label rather than naming a day it cannot place', () => {
    expect(formatCountingSince('not-a-date', { ...en, timeZone: NY })).toBeNull();
    expect(
      formatCountingSince('2026-09-18T16:00:00.000Z', { ...en, timeZone: 'Not/AZone' })
    ).toBeNull();
  });
});
