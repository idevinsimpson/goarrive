import { describe, expect, it } from 'vitest';

import { additionAgeLabel, additionLine } from '../src/ui/relativeTime';

/**
 * The recent-additions list says "+20 squats · 3 min ago" and nothing else, so
 * these two functions are the entire claim that list makes about time. What is
 * pinned here:
 *
 *   - the label can never be MORE precise than the minute the server stored,
 *     and never turns over mid-minute;
 *   - a device clock that is wrong says something vague, not something
 *     confidently false;
 *   - an unusable line is DROPPED, never rendered with a placeholder — a
 *     display that invents "recently" for a value it could not read is worse
 *     than a display that shows one line fewer.
 */

const at = (iso: string) => iso;
const now = (iso: string) => new Date(iso);

describe('additionAgeLabel', () => {
  it('says "just now" inside the same minute', () => {
    expect(additionAgeLabel(at('2026-09-18T13:04:00.000Z'), now('2026-09-18T13:04:00.000Z'))).toBe(
      'just now'
    );
    expect(additionAgeLabel(at('2026-09-18T13:04:00.000Z'), now('2026-09-18T13:04:59.999Z'))).toBe(
      'just now'
    );
  });

  it('turns over exactly when the printed minute does, not 60s after the event', () => {
    // The stored instant is a floored minute, so 13:04:00 -> 13:05:00 is one
    // minute of age however many seconds actually elapsed. Comparing raw
    // instants would have made 13:04:59.999 read "just now" and 13:05:00.000
    // read "1 min ago" — correct here, but it would also have made an `at` of
    // 13:04:30 (which the server never sends) behave differently. Flooring
    // both sides is what makes the label a function of the minutes alone.
    expect(additionAgeLabel(at('2026-09-18T13:04:00.000Z'), now('2026-09-18T13:05:00.000Z'))).toBe(
      '1 min ago'
    );
    expect(additionAgeLabel(at('2026-09-18T13:04:00.000Z'), now('2026-09-18T13:05:59.999Z'))).toBe(
      '1 min ago'
    );
  });

  it('counts minutes up to 59', () => {
    expect(additionAgeLabel(at('2026-09-18T13:01:00.000Z'), now('2026-09-18T13:04:00.000Z'))).toBe(
      '3 min ago'
    );
    expect(additionAgeLabel(at('2026-09-18T12:05:00.000Z'), now('2026-09-18T13:04:00.000Z'))).toBe(
      '59 min ago'
    );
  });

  it('switches to whole hours at 60 minutes and to whole days at 24 hours', () => {
    expect(additionAgeLabel(at('2026-09-18T12:04:00.000Z'), now('2026-09-18T13:04:00.000Z'))).toBe(
      '1 hr ago'
    );
    expect(additionAgeLabel(at('2026-09-18T11:00:00.000Z'), now('2026-09-18T13:04:00.000Z'))).toBe(
      '2 hr ago'
    );
    expect(additionAgeLabel(at('2026-09-17T14:04:00.000Z'), now('2026-09-18T13:04:00.000Z'))).toBe(
      '23 hr ago'
    );
    expect(additionAgeLabel(at('2026-09-17T13:04:00.000Z'), now('2026-09-18T13:04:00.000Z'))).toBe(
      '1 d ago'
    );
    expect(additionAgeLabel(at('2026-09-15T13:04:00.000Z'), now('2026-09-18T13:04:00.000Z'))).toBe(
      '3 d ago'
    );
  });

  it('reads a future instant as "just now" rather than a negative age', () => {
    // A device clock a few minutes behind the server's. The display cannot fix
    // the clock; it can decline to print "-4 min ago" or "in 4 minutes".
    expect(additionAgeLabel(at('2026-09-18T13:08:00.000Z'), now('2026-09-18T13:04:00.000Z'))).toBe(
      'just now'
    );
  });

  it('returns null for an instant it cannot read', () => {
    expect(additionAgeLabel('', now('2026-09-18T13:04:00.000Z'))).toBeNull();
    expect(additionAgeLabel('not a date', now('2026-09-18T13:04:00.000Z'))).toBeNull();
    expect(additionAgeLabel('2026-13-45T99:99:99Z', now('2026-09-18T13:04:00.000Z'))).toBeNull();
  });

  it('returns null when the device clock itself is unusable', () => {
    expect(additionAgeLabel(at('2026-09-18T13:04:00.000Z'), new Date(NaN))).toBeNull();
  });
});

describe('additionLine', () => {
  const NOW = now('2026-09-18T13:04:00.000Z');

  it('is the approved line, exactly', () => {
    expect(
      additionLine({ amount: 20, unit: 'squats', at: '2026-09-18T13:01:00.000Z' }, NOW)
    ).toBe('+20 squats · 3 min ago');
  });

  it('prints the unit the server sent, verbatim and unpluralized', () => {
    // "1 squats" is not this client's string to correct: the unit is whatever
    // the Champion wrote on the goal, and editing it here would put a word on
    // a public display that no one on the server ever approved.
    expect(additionLine({ amount: 1, unit: 'squats', at: '2026-09-18T13:04:00.000Z' }, NOW)).toBe(
      '+1 squats · just now'
    );
    expect(additionLine({ amount: 30, unit: 'minutes', at: '2026-09-18T12:04:00.000Z' }, NOW)).toBe(
      '+30 minutes · 1 hr ago'
    );
  });

  it('drops the unit rather than printing an empty gap when the server sent none', () => {
    expect(additionLine({ amount: 5, unit: '', at: '2026-09-18T13:04:00.000Z' }, NOW)).toBe(
      '+5 · just now'
    );
  });

  it('drops a line whose amount is not a usable positive number', () => {
    const base = { unit: 'squats', at: '2026-09-18T13:04:00.000Z' };
    expect(additionLine({ ...base, amount: 0 }, NOW)).toBeNull();
    expect(additionLine({ ...base, amount: -20 }, NOW)).toBeNull();
    expect(additionLine({ ...base, amount: Number.NaN }, NOW)).toBeNull();
    expect(additionLine({ ...base, amount: Number.POSITIVE_INFINITY }, NOW)).toBeNull();
    expect(additionLine({ ...base, amount: '20' as unknown as number }, NOW)).toBeNull();
  });

  it('drops a line whose instant is unusable, rather than filling one in', () => {
    expect(additionLine({ amount: 20, unit: 'squats', at: 'whenever' }, NOW)).toBeNull();
  });
});
