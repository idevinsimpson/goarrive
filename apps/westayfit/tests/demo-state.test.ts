import { beforeEach, describe, expect, it } from 'vitest';

import {
  addSquats,
  DEMO_STORAGE_KEY,
  getDemoState,
  INITIAL_DEMO_STATE,
  initDemoState,
  resetDemo,
} from '../src/demoState';

describe('demoState store', () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetDemo();
    initDemoState();
  });

  it('starts at the fixed 980 / 1000 baseline so the demo is replayable', () => {
    const state = getDemoState();
    expect(state.squats.current).toBe(INITIAL_DEMO_STATE.squats.current);
    expect(state.squats.goal).toBe(INITIAL_DEMO_STATE.squats.goal);
    expect(state.squats.current).toBe(980);
    expect(state.squats.goal).toBe(1000);
  });

  it('addSquats advances the total and reports the delta', () => {
    const result = addSquats(5);
    expect(result.previousTotal).toBe(980);
    expect(result.newTotal).toBe(985);
    expect(result.addedCount).toBe(5);
    expect(result.crossedMilestone).toBe(false);
    expect(result.rejected).toBe(false);
  });

  it('preserves overshoot past the goal: 980 + 35 records 1015 with one crossing', () => {
    const result = addSquats(35);
    expect(result.previousTotal).toBe(980);
    expect(result.newTotal).toBe(1015);
    expect(result.addedCount).toBe(35);
    expect(result.crossedMilestone).toBe(true);
    expect(getDemoState().squats.current).toBe(1015);
  });

  it('milestone fires exactly once per reset even with overshoot; later contributions still count', () => {
    const first = addSquats(35);
    expect(first.crossedMilestone).toBe(true);
    expect(first.newTotal).toBe(1015);

    // Later contributions still count and stack. Milestone does not re-fire.
    const second = addSquats(10);
    expect(second.previousTotal).toBe(1015);
    expect(second.newTotal).toBe(1025);
    expect(second.addedCount).toBe(10);
    expect(second.crossedMilestone).toBe(false);

    const third = addSquats(50);
    expect(third.newTotal).toBe(1075);
    expect(third.crossedMilestone).toBe(false);
  });

  it('milestone fires exactly at 1000 when the add lands on the boundary', () => {
    const first = addSquats(20);
    expect(first.newTotal).toBe(1000);
    expect(first.crossedMilestone).toBe(true);

    const second = addSquats(20);
    expect(second.previousTotal).toBe(1000);
    expect(second.newTotal).toBe(1020);
    expect(second.crossedMilestone).toBe(false);
  });

  it('does not fire the milestone on a partial add that stops short', () => {
    const partial = addSquats(10);
    expect(partial.newTotal).toBe(990);
    expect(partial.crossedMilestone).toBe(false);
  });

  it('rejects invalid input (negative, fractional, NaN, Infinity) without mutating state', () => {
    const beforeState = getDemoState().squats.current;

    const negative = addSquats(-15);
    expect(negative.rejected).toBe(true);
    expect(negative.addedCount).toBe(0);
    expect(negative.newTotal).toBe(beforeState);
    expect(getDemoState().squats.current).toBe(beforeState);

    const fractional = addSquats(2.7);
    expect(fractional.rejected).toBe(true);
    expect(fractional.addedCount).toBe(0);
    expect(fractional.newTotal).toBe(beforeState);
    expect(getDemoState().squats.current).toBe(beforeState);

    const nan = addSquats(Number.NaN);
    expect(nan.rejected).toBe(true);
    expect(nan.addedCount).toBe(0);
    expect(getDemoState().squats.current).toBe(beforeState);

    const inf = addSquats(Number.POSITIVE_INFINITY);
    expect(inf.rejected).toBe(true);
    expect(inf.addedCount).toBe(0);
    expect(getDemoState().squats.current).toBe(beforeState);
  });

  it('accepts zero as a no-op without rejecting or mutating state', () => {
    const zero = addSquats(0);
    expect(zero.rejected).toBe(false);
    expect(zero.addedCount).toBe(0);
    expect(zero.newTotal).toBe(980);
    expect(getDemoState().squats.current).toBe(980);
  });

  it('resetDemo returns to the baseline and clears the milestone latch so the demo can replay', () => {
    addSquats(35);
    expect(getDemoState().milestoneCelebrated).toBe(true);
    resetDemo();
    const state = getDemoState();
    expect(state.squats.current).toBe(980);
    expect(state.milestoneCelebrated).toBe(false);

    const rerun = addSquats(35);
    expect(rerun.newTotal).toBe(1015);
    expect(rerun.crossedMilestone).toBe(true);
  });

  it('persists state to localStorage so a second tab can read it', () => {
    addSquats(7);
    const raw = window.localStorage.getItem(DEMO_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as { squats: { current: number } };
    expect(parsed.squats.current).toBe(987);
  });

  it('re-reads state from localStorage on initDemoState', () => {
    // Simulate the state coming from another tab.
    window.localStorage.setItem(
      DEMO_STORAGE_KEY,
      JSON.stringify({
        squats: { current: 995, goal: 1000 },
        milestoneCelebrated: false,
        updatedAt: 1,
      })
    );
    initDemoState();
    expect(getDemoState().squats.current).toBe(995);
  });
});
