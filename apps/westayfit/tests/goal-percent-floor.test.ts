// Pin the E4-A1-R1 display invariant: the percentage a member reads on the
// contribute page and on the shared big-screen display is FLOORED, not
// rounded. A goal at 4999/5000 must read 99% — never 100% — because 100% is
// reserved for "goal reached" and a display that rounds up robs the last
// contributor of the moment the number ticks over.
//
// Also asserts the bar width clamps to 100 (visual only) even when the
// number overshoots: the fill can't exceed the track, but the text keeps
// climbing past 100%.

import { describe, expect, it } from 'vitest';

import { barPercent, integerPercent } from '../src/goalPercent';

describe('E4-A1 display percentage', () => {
  it('floors: 4999 / 5000 renders 99, not 100', () => {
    expect(integerPercent(4999, 5000)).toBe(99);
  });

  it('renders 0 when nothing has landed yet', () => {
    expect(integerPercent(0, 5000)).toBe(0);
  });

  it('renders 100 exactly at the goal', () => {
    expect(integerPercent(5000, 5000)).toBe(100);
  });

  it('never renders 100 for any total strictly below the target', () => {
    // Exhaustive-ish sweep for a small target to prove the floor holds at
    // every edge. This is the property that Devin's R1 called out by name.
    const target = 100;
    for (let n = 0; n < target; n += 1) {
      const pct = integerPercent(n, target);
      expect(pct).toBeLessThan(100);
    }
    expect(integerPercent(target, target)).toBe(100);
  });

  it('reports overshoot honestly (5015 / 5000 = 100, 5100 / 5000 = 102)', () => {
    // A shard write that arrives after the goal is reached still counts —
    // wsfContribute does not throw. The readout keeps climbing so a review
    // screenshot cannot hide the overshoot behind a 100% ceiling.
    expect(integerPercent(5015, 5000)).toBe(100);
    expect(integerPercent(5100, 5000)).toBe(102);
  });

  it('bar width clamps to 100 even on overshoot (visual invariant)', () => {
    // The bar CAN'T visually overshoot — the fill would leave the track. So
    // barPercent is the ceilinged twin of integerPercent.
    expect(barPercent(5100, 5000)).toBe(100);
    expect(barPercent(4999, 5000)).toBe(99);
    expect(barPercent(0, 5000)).toBe(0);
  });

  it('treats a zero or negative target as 0% (no division blow-up)', () => {
    expect(integerPercent(10, 0)).toBe(0);
    expect(integerPercent(10, -5)).toBe(0);
    expect(barPercent(10, 0)).toBe(0);
    expect(barPercent(10, -5)).toBe(0);
  });

  it('treats a negative current as 0% (never renders a negative pct)', () => {
    // Should not happen in practice — wsfAdjustGoal rejects any adjustment
    // that would drive the shared total below zero — but the arithmetic
    // must still be defensive: no reader ever sees "-4%".
    expect(integerPercent(-1, 5000)).toBe(0);
    expect(barPercent(-1, 5000)).toBe(0);
  });
});
