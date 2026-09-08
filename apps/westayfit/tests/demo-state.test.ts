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
  });

  it('clamps at the goal and fires the milestone exactly once', () => {
    const first = addSquats(20);
    expect(first.newTotal).toBe(1000);
    expect(first.crossedMilestone).toBe(true);

    // Trying to add more after the goal keeps the total pinned and does not
    // fire the milestone a second time.
    const second = addSquats(50);
    expect(second.newTotal).toBe(1000);
    expect(second.previousTotal).toBe(1000);
    expect(second.addedCount).toBe(0);
    expect(second.crossedMilestone).toBe(false);
  });

  it('does not fire the milestone on a partial add that stops short', () => {
    const partial = addSquats(10);
    expect(partial.newTotal).toBe(990);
    expect(partial.crossedMilestone).toBe(false);
  });

  it('rejects negative and fractional counts honestly', () => {
    const zero = addSquats(0);
    expect(zero.newTotal).toBe(980);
    expect(zero.addedCount).toBe(0);

    const negative = addSquats(-15);
    expect(negative.newTotal).toBe(980);
    expect(negative.addedCount).toBe(0);

    const fractional = addSquats(2.7);
    expect(fractional.newTotal).toBe(982);
    expect(fractional.addedCount).toBe(2);
  });

  it('resetDemo returns to the baseline and clears milestone latch', () => {
    addSquats(20);
    resetDemo();
    const state = getDemoState();
    expect(state.squats.current).toBe(980);
    expect(state.milestoneCelebrated).toBe(false);

    const rerun = addSquats(20);
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
