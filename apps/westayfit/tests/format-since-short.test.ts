import { describe, expect, it } from 'vitest';

import { formatEndedOn, formatSinceShort } from '../src/ui/dates';

const NOW = new Date('2026-09-21T12:00:00.000Z');
const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('formatSinceShort', () => {
  it('reads the first minute as "just now"', () => {
    expect(formatSinceShort(at(0), { now: NOW })).toBe('just now');
    expect(formatSinceShort(at(59_000), { now: NOW })).toBe('just now');
  });

  it('counts whole minutes up to an hour', () => {
    expect(formatSinceShort(at(60_000), { now: NOW })).toBe('1m');
    expect(formatSinceShort(at(4 * 60_000), { now: NOW })).toBe('4m');
    expect(formatSinceShort(at(59 * 60_000), { now: NOW })).toBe('59m');
  });

  it('turns over to hours at exactly one hour', () => {
    expect(formatSinceShort(at(60 * 60_000), { now: NOW })).toBe('1h');
    expect(formatSinceShort(at(23 * 60 * 60_000), { now: NOW })).toBe('23h');
  });

  it('turns over to days at exactly one day', () => {
    expect(formatSinceShort(at(24 * 60 * 60_000), { now: NOW })).toBe('1d');
    expect(formatSinceShort(at(9 * 24 * 60 * 60_000), { now: NOW })).toBe('9d');
  });

  it('never reads as a negative: a future instant is "just now"', () => {
    const ahead = new Date(NOW.getTime() + 3 * 60_000).toISOString();
    expect(formatSinceShort(ahead, { now: NOW })).toBe('just now');
  });

  it('returns null for a value that is not a date, rather than guessing', () => {
    expect(formatSinceShort('', { now: NOW })).toBeNull();
    expect(formatSinceShort('not-a-date', { now: NOW })).toBeNull();
  });
});

describe('formatEndedOn', () => {
  const NOW_2026 = new Date('2026-09-21T12:00:00.000Z');

  it('says Ended, in the past tense, and does not repeat the verb', () => {
    const label = formatEndedOn('2026-08-31T23:59:00.000Z', {
      now: NOW_2026,
      timeZone: 'America/New_York',
    });
    expect(label).toBe('Ended Aug 31');
    expect(label).not.toContain('Ends');
  });

  it('leaves the year off the current year and puts it on any other', () => {
    expect(
      formatEndedOn('2026-06-21T12:00:00.000Z', { now: NOW_2026, timeZone: 'America/New_York' }),
    ).toBe('Ended Jun 21');
    expect(
      formatEndedOn('2025-06-21T12:00:00.000Z', { now: NOW_2026, timeZone: 'America/New_York' }),
    ).toBe('Ended Jun 21, 2025');
  });

  it('withholds a label rather than naming a day it cannot resolve', () => {
    expect(formatEndedOn('not-a-date', { now: NOW_2026 })).toBeNull();
    expect(
      formatEndedOn('2026-08-31T00:00:00.000Z', { now: NOW_2026, timeZone: 'Not/AZone' }),
    ).toBeNull();
  });
});
