import { describe, expect, it } from 'vitest';

import {
  initialsOf,
  leadAndOthers,
  partBlock,
  sharedCell,
  sharedLine,
  statusOf,
  whenLabel,
  type YouGoal,
  type YouState,
} from '../src/youParity';

/** YOU-PARITY-1: the pure presentation rules, tested without a screen. */

const goal = (over: Partial<YouGoal>): YouGoal => ({
  goalId: 'g',
  title: 'G',
  unit: 'squats',
  target: 500,
  yourPart: 25,
  sharedTotal: 241,
  open: true,
  ...over,
});

describe('statusOf — the reference four lifecycle pills', () => {
  it('open, below target', () => expect(statusOf(goal({}))).toEqual({ label: 'OPEN', tone: 'open' }));
  it('open, at or past target', () =>
    expect(statusOf(goal({ sharedTotal: 500 }))).toEqual({ label: 'REACHED · STILL OPEN', tone: 'open' }));
  it('closed and reached', () =>
    expect(statusOf(goal({ open: false, sharedTotal: 520 }))).toEqual({ label: 'CLOSED · REACHED', tone: 'closedReached' }));
  it('closed and unfinished', () =>
    expect(statusOf(goal({ open: false, sharedTotal: 360 }))).toEqual({ label: 'CLOSED · UNFINISHED', tone: 'closedUnfinished' }));
  it('no usable target never claims reached', () =>
    expect(statusOf(goal({ target: 0, sharedTotal: 10 })).label).toBe('OPEN'));
});

describe('initialsOf', () => {
  it('takes up to two initials', () => expect(initialsOf('Alex M.')).toBe('AM'));
  it('one word, one initial', () => expect(initialsOf('Devin')).toBe('D'));
  it('three words, still two', () => expect(initialsOf('ana de la cruz')).toBe('AD'));
  it('no name, no invented initials', () => {
    expect(initialsOf(null)).toBeNull();
    expect(initialsOf('   ')).toBeNull();
  });
});

describe('whenLabel', () => {
  it('open goals end, finished goals ended', () => {
    const iso = new Date(2026, 9, 2, 12).toISOString();
    expect(whenLabel({ open: true, endsAt: iso })).toBe('Ends Oct 2');
    expect(whenLabel({ open: false, endsAt: iso })).toBe('Ended Oct 2');
  });
  it('an unreadable window says nothing', () => {
    expect(whenLabel({ open: true })).toBeNull();
    expect(whenLabel({ open: true, endsAt: 'not a date' })).toBeNull();
  });
});

describe('leadAndOthers — the reference memberGoalRows order', () => {
  it('the first open goal leads; other open goals, then finished', () => {
    const a = goal({ goalId: 'a' });
    const b = goal({ goalId: 'b' });
    const c = goal({ goalId: 'c', open: false });
    const { lead, others } = leadAndOthers([a, b], [c]);
    expect(lead?.goalId).toBe('a');
    expect(others.map((g) => g.goalId)).toEqual(['b', 'c']);
  });
  it('with nothing open there is no lead, and finished goals are still listed', () => {
    const c = goal({ goalId: 'c', open: false });
    expect(leadAndOthers([], [c])).toEqual({ lead: null, others: [c] });
  });
});

describe('partBlock — Start moving only when it is true', () => {
  const base = {
    kind: 'member' as const,
    profile: { displayName: 'A', memberSince: null },
    community: { displayName: 'C', role: 'member', memberCount: 1 },
    finished: [],
    partial: false,
  };
  it('a credited open goal leads', () =>
    expect(partBlock({ ...base, open: [goal({})], eligible: true } as Extract<YouState, { kind: 'member' }>)).toBe('lead'));
  it('no own part, an eligible goal: start moving', () =>
    expect(partBlock({ ...base, open: [], eligible: true })).toBe('startMoving'));
  it('no own part, nothing eligible: say so, no Start moving', () =>
    expect(partBlock({ ...base, open: [], eligible: false })).toBe('noEligible'));
});

describe('shared figures keep their unit and never become a ratio', () => {
  it('lead line', () => expect(sharedLine(goal({}))).toBe('241 / 500 confirmed'));
  it('row cell', () => expect(sharedCell(goal({ sharedTotal: 155, target: 150 }))).toBe('155 / 150 squats'));
  it('no target: the total alone, in its unit', () => {
    expect(sharedLine(goal({ target: 0 }))).toBe('241 squats confirmed');
    expect(sharedCell(goal({ target: 0 }))).toBe('241 squats');
  });
});
