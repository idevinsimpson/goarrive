import { describe, expect, it } from 'vitest';

import { UNKNOWN_SHARED, knownShared } from '../src/goalTruth';
import {
  bodyOf,
  heroEyebrow,
  isReachedNow,
  orderedGoals,
  relTime,
  sharedCell,
  statusOf,
  summaryLine,
  unitTotals,
  type ProgressGoal,
  type ProgressState,
} from '../src/progressParity';

/**
 * PROGRESS-PARITY-1: the pure rules behind ProgressParityView. Each is the
 * reference's own rule (Lovable `09b8a73c`, src/demo/model.ts) applied to
 * canonical facts, plus the two things canonical can be and the prototype
 * never is: a shared total that did not answer, and a closed goal whose
 * outcome is therefore unknown.
 */

const goal = (over: Partial<ProgressGoal> = {}): ProgressGoal => ({
  goalId: 'g',
  title: '500 squats together',
  communityId: 'oak',
  community: 'Oak Grove Together',
  unit: 'squats',
  yourPart: 25,
  target: 500,
  shared: knownShared(241),
  open: true,
  periodLabel: null,
  ...over,
});

describe('statusOf — the four lifecycle pills, and nothing claimed on an unknown total', () => {
  it('open and short of the target is OPEN', () => {
    expect(statusOf(goal())).toEqual({ label: 'OPEN', tone: 'open' });
  });
  it('open at or past the target is REACHED · STILL OPEN', () => {
    expect(statusOf(goal({ shared: knownShared(500) })).label).toBe('REACHED · STILL OPEN');
    expect(statusOf(goal({ shared: knownShared(515) })).label).toBe('REACHED · STILL OPEN');
  });
  it('closed at or past the target is CLOSED · REACHED on navy', () => {
    expect(statusOf(goal({ open: false, shared: knownShared(1024), target: 1000 }))).toEqual({
      label: 'CLOSED · REACHED',
      tone: 'closedReached',
    });
  });
  it('closed short of the target is CLOSED · UNFINISHED, muted', () => {
    expect(statusOf(goal({ open: false, shared: knownShared(612), target: 800 }))).toEqual({
      label: 'CLOSED · UNFINISHED',
      tone: 'muted',
    });
  });
  it('closed with no answer for the total says CLOSED · RESULT UNAVAILABLE', () => {
    expect(statusOf(goal({ open: false, shared: UNKNOWN_SHARED }))).toEqual({ label: 'CLOSED · RESULT UNAVAILABLE', tone: 'muted' });
  });
  it('open with no answer for the total is OPEN, never REACHED', () => {
    expect(statusOf(goal({ shared: UNKNOWN_SHARED })).label).toBe('OPEN');
  });
});

describe('isReachedNow', () => {
  it('needs a confirmed total and a usable target', () => {
    expect(isReachedNow({ shared: knownShared(500), target: 500 })).toBe(true);
    expect(isReachedNow({ shared: UNKNOWN_SHARED, target: 500 })).toBe(false);
    expect(isReachedNow({ shared: knownShared(10), target: 0 })).toBe(false);
  });
});

describe('unitTotals — one total per unit, never summed across units', () => {
  it('adds the same unit and keeps the reference fixture at 145 squats', () => {
    const goals = [
      goal({ goalId: 'a', yourPart: 25 }),
      goal({ goalId: 'b', yourPart: 20 }),
      goal({ goalId: 'c', yourPart: 60 }),
      goal({ goalId: 'd', yourPart: 40 }),
    ];
    expect(unitTotals(goals)).toEqual([{ unit: 'squats', total: 145 }]);
  });
  it('keeps squats and step-ups apart, in first-seen order', () => {
    const goals = [
      goal({ goalId: 'a', unit: 'squats', yourPart: 120 }),
      goal({ goalId: 'b', unit: 'step-ups', yourPart: 45 }),
      goal({ goalId: 'c', unit: 'squats', yourPart: 30 }),
    ];
    expect(unitTotals(goals)).toEqual([
      { unit: 'squats', total: 150 },
      { unit: 'step-ups', total: 45 },
    ]);
  });
  it('never merges two spellings', () => {
    const goals = [goal({ goalId: 'a', unit: 'laps' }), goal({ goalId: 'b', unit: 'Laps' })];
    expect(unitTotals(goals)).toHaveLength(2);
  });
});

describe('summaryLine', () => {
  it('counts goals and distinct communities by id', () => {
    const goals = [
      goal({ goalId: 'a' }),
      goal({ goalId: 'b', communityId: 'harbor', community: 'Harbor Lunch Crew' }),
      goal({ goalId: 'c' }),
      goal({ goalId: 'd' }),
    ];
    expect(summaryLine(goals)).toBe('Across 4 goals in 2 communities. Each unit stays separate.');
  });
  it('is singular for one of each', () => {
    expect(summaryLine([goal()])).toBe('Across 1 goal in 1 community. Each unit stays separate.');
  });
});

describe('bodyOf — which body the ready state shows', () => {
  const ready = (over: Partial<Extract<ProgressState, { kind: 'ready' }>> = {}) => ({
    kind: 'ready' as const,
    memberName: 'Alex M.',
    open: [],
    finished: [],
    partial: false,
    canStart: true,
    receipts: null,
    ...over,
  });
  it('goals when anything is recorded', () => {
    expect(bodyOf(ready({ finished: [goal({ open: false })] }))).toBe('goals');
  });
  it('first-eligible only when nothing is recorded AND a goal can take it', () => {
    expect(bodyOf(ready({ canStart: true }))).toBe('firstEligible');
    expect(bodyOf(ready({ canStart: false }))).toBe('noOpenGoal');
  });
});

describe('orderedGoals', () => {
  it('open first, then finished, as given', () => {
    const o = [goal({ goalId: 'o1' }), goal({ goalId: 'o2' })];
    const f = [goal({ goalId: 'f1', open: false })];
    expect(orderedGoals(o, f).map((g) => g.goalId)).toEqual(['o1', 'o2', 'f1']);
  });
});

describe('sharedCell', () => {
  it('total / target unit', () => {
    expect(sharedCell(goal({ shared: knownShared(1024), target: 1000 }))).toBe('1,024 / 1,000 squats');
  });
  it('a bare total with no usable target', () => {
    expect(sharedCell(goal({ shared: knownShared(30), target: 0 }))).toBe('30 squats');
  });
  it('Unknown when the total did not answer — never zero', () => {
    expect(sharedCell(goal({ shared: UNKNOWN_SHARED }))).toBe('Unknown');
  });
});

describe('heroEyebrow', () => {
  it('private to you, and whose, without the prototype’s "Sample data"', () => {
    expect(heroEyebrow('Alex M.')).toBe('PRIVATE TO YOU · ALEX M.');
    expect(heroEyebrow(null)).toBe('PRIVATE TO YOU');
    expect(heroEyebrow('  ')).toBe('PRIVATE TO YOU');
  });
});

describe('relTime — the reference’s wording, deterministic', () => {
  const now = Date.UTC(2026, 8, 25, 16);
  it('minutes, hours, yesterday, days', () => {
    expect(relTime(now - 20_000, now)).toBe('just now');
    expect(relTime(now - 8 * 60_000, now)).toBe('8 min ago');
    expect(relTime(now - 3 * 3_600_000, now)).toBe('3 hr ago');
    expect(relTime(now - 26 * 3_600_000, now)).toBe('yesterday');
    expect(relTime(now - 41 * 86_400_000, now)).toBe('41 days ago');
  });
});
