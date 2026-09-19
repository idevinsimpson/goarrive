import { describe, expect, it } from 'vitest';

import { samePulse, type GoalPulse } from '../src/displayPulse';

/**
 * The public display polls every 2 seconds and, on a wall display, nearly
 * every answer is the one already on screen. `samePulse` is what lets that
 * tick change nothing — so it has to be exact in BOTH directions: equal
 * answers must compare equal, and a change to ANY published field must not.
 * A false positive here would freeze a real change on a wall display.
 */

const BASE: GoalPulse = {
  sharedTotal: 241,
  target: 500,
  unit: 'squats',
  status: 'active',
  communityDisplayName: 'Maple Street Movers',
  goalTitle: 'Squats together this week',
  startsAt: '2026-09-15T04:00:00.000Z',
  endsAt: '2026-10-06T03:30:00.000Z',
  timezone: 'America/New_York',
};

/** Every field, and a value that differs from the base in each. */
const CHANGES: Array<[keyof GoalPulse, Partial<GoalPulse>]> = [
  ['sharedTotal', { sharedTotal: 242 }],
  ['target', { target: 501 }],
  ['unit', { unit: 'reps' }],
  ['status', { status: 'closed' }],
  ['communityDisplayName', { communityDisplayName: 'Maple Street Walkers' }],
  ['goalTitle', { goalTitle: 'Squats together this month' }],
  ['startsAt', { startsAt: '2026-09-16T04:00:00.000Z' }],
  ['endsAt', { endsAt: '2026-10-07T03:30:00.000Z' }],
  ['timezone', { timezone: 'America/Chicago' }],
];

describe('samePulse', () => {
  it('two separately built answers with identical fields are the same pulse', () => {
    expect(samePulse({ ...BASE }, { ...BASE })).toBe(true);
  });

  it('an answer is the same as itself', () => {
    expect(samePulse(BASE, BASE)).toBe(true);
  });

  for (const [field, patch] of CHANGES) {
    it(`a changed ${field} is not the same pulse`, () => {
      expect(samePulse(BASE, { ...BASE, ...patch })).toBe(false);
      // and in the other direction: the comparison is symmetric
      expect(samePulse({ ...BASE, ...patch }, BASE)).toBe(false);
    });
  }

  it('closing a goal is a change even when every number is unmoved', () => {
    const closed: GoalPulse = { ...BASE, status: 'closed' };
    expect(closed.sharedTotal).toBe(BASE.sharedTotal);
    expect(closed.target).toBe(BASE.target);
    expect(samePulse(BASE, closed)).toBe(false);
  });

  it('every field of the published shape is compared', () => {
    // If a field is ever added to GoalPulse without being added to samePulse,
    // the display would stop repainting when it changes. This asserts the two
    // lists are the same length as the shape itself.
    expect(Object.keys(BASE).sort()).toEqual(CHANGES.map(([f]) => f as string).sort());
    for (const key of Object.keys(BASE) as Array<keyof GoalPulse>) {
      const patch = CHANGES.find(([f]) => f === key);
      expect(patch, `no change case for ${key}`).toBeDefined();
      expect(samePulse(BASE, { ...BASE, ...patch![1] })).toBe(false);
    }
  });
});
