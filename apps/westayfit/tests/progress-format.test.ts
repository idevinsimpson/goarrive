// The presentation contract for confirmed progress, as approved by Devin on
// 2026-09-17: below the target, one decimal ROUNDED DOWN; positive progress
// under 0.1% reads "less than 0.1%"; at or beyond the target the mark reads
// 100% and stops at full while the exact total stays visible; reached and
// closed are separate facts.
//
// This supersedes the integer-floor expectation in goal-percent-floor.test.ts
// for the member and display surfaces: 35 of 5,000 used to read "0%" and now
// reads "0.7%". That is a presentation correction, not a data change.

import { describe, expect, it } from 'vitest';

import {
  beyondTarget,
  decimalPercent,
  fillRatio,
  isNearGoal,
  isReached,
  percentLabel,
  progressPhase,
  remaining,
  statusLine,
  totalOfTargetLabel,
} from '../src/ui/progressFormat';

describe('percentage text: one decimal, rounded down, capped at the goal', () => {
  it.each([
    [0, 5000, '0%'],
    [1, 5000, 'less than 0.1%'],
    [4, 5000, 'less than 0.1%'],
    [5, 5000, '0.1%'],
    [35, 5000, '0.7%'],
    [241, 500, '48.2%'],
    [261, 500, '52.2%'],
    [450, 500, '90.0%'],
    [4999, 5000, '99.9%'],
    [499, 500, '99.8%'],
    [500, 500, '100%'],
    [5000, 5000, '100%'],
    [5120, 5000, '100%'],
  ])('%i of %i reads %s', (completed, target, label) => {
    expect(percentLabel(completed, target)).toBe(label);
  });

  it('never rounds up: 999 of 1000 is 99.9, and 1 of 3 is 33.3', () => {
    expect(decimalPercent(999, 1000)).toBe(99.9);
    expect(decimalPercent(1, 3)).toBe(33.3);
    expect(decimalPercent(2, 3)).toBe(66.6);
  });

  it('uses integer arithmetic so 261 of 500 is exactly 52.2', () => {
    expect(decimalPercent(261, 500)).toBe(52.2);
    expect(decimalPercent(241, 500)).toBe(48.2);
  });

  it('never reads 100% for any total strictly below the target', () => {
    const target = 997;
    for (let t = 0; t < target; t += 1) {
      expect(percentLabel(t, target)).not.toBe('100%');
      expect(decimalPercent(t, target)).toBeLessThan(100);
    }
    expect(percentLabel(target, target)).toBe('100%');
  });

  it('treats a non-positive or missing target as nothing to show', () => {
    expect(percentLabel(10, 0)).toBe('0%');
    expect(percentLabel(10, -5)).toBe('0%');
    expect(percentLabel(10, Number.NaN)).toBe('0%');
    expect(fillRatio(10, 0)).toBe(0);
  });
});

describe('fill ratio: the true ratio, clamped', () => {
  it('is the real share below the goal and 1 at or beyond it', () => {
    expect(fillRatio(241, 500)).toBeCloseTo(0.482, 10);
    expect(fillRatio(500, 500)).toBe(1);
    expect(fillRatio(5120, 5000)).toBe(1);
    expect(fillRatio(0, 500)).toBe(0);
    expect(fillRatio(-3, 500)).toBe(0);
  });

  it('agrees with the text: floor(fill × 1000) / 10 is the printed percent', () => {
    for (const [c, t] of [
      [35, 5000],
      [241, 500],
      [261, 500],
      [4999, 5000],
      [7, 9],
    ]) {
      expect(Math.floor(fillRatio(c, t) * 1000 + 1e-9) / 10).toBe(decimalPercent(c, t));
    }
  });
});

describe('phases: reached and closed are separate facts', () => {
  it.each([
    [0, 500, 'active', 'openAtZero'],
    [241, 500, 'active', 'building'],
    [449, 500, 'active', 'building'],
    [450, 500, 'active', 'nearGoal'],
    [499, 500, 'active', 'nearGoal'],
    [500, 500, 'active', 'reachedOpen'],
    [620, 500, 'active', 'reachedOpen'],
    [500, 500, 'closed', 'closedReached'],
    [312, 500, 'closed', 'closedUnreached'],
    [0, 500, 'closed', 'closedUnreached'],
  ] as const)('%i of %i while %s is %s', (c, t, status, phase) => {
    expect(progressPhase(c, t, status)).toBe(phase);
  });

  it('near-goal begins at exactly 90% of the confirmed target and ends at reached', () => {
    expect(isNearGoal(4500, 5000)).toBe(true);
    expect(isNearGoal(4499, 5000)).toBe(false);
    expect(isNearGoal(5000, 5000)).toBe(false);
    expect(isReached(5000, 5000)).toBe(true);
    expect(isReached(4999, 5000)).toBe(false);
  });
});

describe('the exact total is retained beyond the goal', () => {
  it('keeps the full count and names the amount beyond the target', () => {
    expect(totalOfTargetLabel(5120, 5000, 'squats')).toBe('5,120 of 5,000 squats');
    expect(beyondTarget(5120, 5000)).toBe(120);
    expect(remaining(5120, 5000)).toBe(0);
    expect(remaining(241, 500)).toBe(259);
  });

  it('writes the one status line per phase', () => {
    expect(statusLine(0, 500, 'active')).toBe('500 to go');
    expect(statusLine(241, 500, 'active')).toBe('259 to go');
    expect(statusLine(450, 500, 'active')).toBe('Only 50 to go');
    expect(statusLine(500, 500, 'active')).toBe('Goal reached · still open');
    expect(statusLine(620, 500, 'active')).toBe('Goal reached · 120 beyond it · still open');
    expect(statusLine(500, 500, 'closed')).toBe('Goal reached');
    expect(statusLine(620, 500, 'closed')).toBe('Goal reached · 120 beyond it');
    expect(statusLine(312, 500, 'closed')).toBe('Closed at 62.4%');
  });
});
