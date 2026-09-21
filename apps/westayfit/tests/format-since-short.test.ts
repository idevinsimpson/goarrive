import { describe, expect, it } from 'vitest';

import { formatSinceShort } from '../src/ui/dates';

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
