import { describe, expect, it } from 'vitest';

import {
  UNKNOWN_SHARED,
  hasInstrument,
  isReachedNow,
  knownShared,
  sharedCell,
  sharedTotalOf,
  statusOf,
} from '../src/goalTruth';

/**
 * GOAL TRUTH (Director #492 `5841012915`): a shared position is known or it is
 * not, and an unknown one never becomes 0, a Living WE, or a reached /
 * unfinished claim.
 */

describe('goalTruth', () => {
  it('an unknown total has no number and no instrument', () => {
    expect(sharedTotalOf({ shared: UNKNOWN_SHARED })).toBeNull();
    expect(hasInstrument({ shared: UNKNOWN_SHARED, target: 500 })).toBe(false);
    expect(isReachedNow({ shared: UNKNOWN_SHARED, target: 500 })).toBe(false);
  });

  it('an instrument needs a confirmed total and a positive target', () => {
    expect(hasInstrument({ shared: knownShared(0), target: 500 })).toBe(true);
    expect(hasInstrument({ shared: knownShared(10), target: 0 })).toBe(false);
  });

  it('the four pills, plus CLOSED alone for a closed goal with an unknown total', () => {
    expect(statusOf({ open: true, target: 500, shared: knownShared(241) }).label).toBe('OPEN');
    expect(statusOf({ open: true, target: 500, shared: knownShared(500) }).label).toBe('REACHED · STILL OPEN');
    expect(statusOf({ open: false, target: 500, shared: knownShared(520) })).toEqual({ label: 'CLOSED · REACHED', tone: 'closedReached' });
    expect(statusOf({ open: false, target: 500, shared: knownShared(360) })).toEqual({ label: 'CLOSED · UNFINISHED', tone: 'muted' });
    expect(statusOf({ open: true, target: 500, shared: UNKNOWN_SHARED }).label).toBe('OPEN');
    expect(statusOf({ open: false, target: 500, shared: UNKNOWN_SHARED })).toEqual({ label: 'CLOSED', tone: 'muted' });
  });

  it('a Shared cell is Unknown, never 0', () => {
    expect(sharedCell({ open: false, target: 500, unit: 'squats', shared: UNKNOWN_SHARED })).toBe('Unknown');
    expect(sharedCell({ open: true, target: 150, unit: 'squats', shared: knownShared(155) })).toBe('155 / 150 squats');
    expect(sharedCell({ open: true, target: 0, unit: 'laps', shared: knownShared(30) })).toBe('30 laps');
  });
});
