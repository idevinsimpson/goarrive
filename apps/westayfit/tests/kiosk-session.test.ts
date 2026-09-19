import { beforeEach, describe, expect, it, vi } from 'vitest';

import { pendingKey, savePendingNew, type PendingContribution } from '../src/pendingContribution';
import {
  KIOSK_IDLE_MS,
  KIOSK_REFUSAL_BODY,
  KIOSK_REFUSAL_HEADLINE,
  KIOSK_UNRESOLVED_NOTICE,
  clearKioskReturnGoal,
  isKioskFlag,
  kioskContributeRoute,
  kioskCountdownExpired,
  kioskCountdownLabel,
  kioskFinishPlan,
  kioskRemainingMs,
  kioskRemainingSeconds,
  kioskSessionStorageKeys,
  kioskStartRoute,
  readKioskReturnGoal,
  runKioskFinish,
  setKioskReturnGoal,
} from '../src/kioskSession';

/**
 * KIOSK SESSION RULES, exercised directly.
 *
 * These are unit tests of the pure logic behind a shared device: what Finish
 * erases, what it must not erase, and when the idle countdown ends a session
 * nobody is standing at. They are NOT the browser run — they establish
 * nothing about sign-in, the contribution write, or what the rendered screen
 * shows. tests-e2e/ui-kiosk.spec.ts covers that.
 */

const GOAL = 'goal-kiosk-1';
const UID = 'uid-visitor-1';
const OTHER_UID = 'uid-visitor-2';
const ATTEMPT = 'attempt-aaa';

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe('the handoff across sign-in', () => {
  it('stores and returns the goal a kiosk visitor came from', () => {
    setKioskReturnGoal(GOAL);
    expect(readKioskReturnGoal()).toBe(GOAL);
    expect(kioskContributeRoute(GOAL)).toBe(`/contribute/${GOAL}?kiosk=1`);
    expect(kioskStartRoute(GOAL)).toBe(`/kiosk/${GOAL}`);
  });

  it('refuses a value that is not a goal id shape, rather than storing it', () => {
    setKioskReturnGoal('../../signin');
    expect(readKioskReturnGoal()).toBeNull();
    setKioskReturnGoal('');
    expect(readKioskReturnGoal()).toBeNull();
  });

  it('refuses a stored value that was tampered with after the fact', () => {
    window.sessionStorage.setItem('wsf.kioskReturnGoalId', 'https://example.com/evil');
    expect(readKioskReturnGoal()).toBeNull();
  });

  it('clears', () => {
    setKioskReturnGoal(GOAL);
    clearKioskReturnGoal();
    expect(readKioskReturnGoal()).toBeNull();
  });

  it('reads the kiosk flag off the route', () => {
    expect(isKioskFlag('1')).toBe(true);
    expect(isKioskFlag('true')).toBe(true);
    expect(isKioskFlag('0')).toBe(false);
    expect(isKioskFlag(undefined)).toBe(false);
    expect(isKioskFlag(1)).toBe(false);
  });
});

describe('the refusal a kiosk shows on an unauthorized goal', () => {
  it('is the public display’s generic refusal, byte for byte', () => {
    expect(KIOSK_REFUSAL_HEADLINE).toBe('Nothing to show here');
    expect(KIOSK_REFUSAL_BODY).toBe('This display isn’t currently available.');
  });

  it('names no reason, no goal and no community', () => {
    const text = `${KIOSK_REFUSAL_HEADLINE} ${KIOSK_REFUSAL_BODY}`;
    expect(text).not.toMatch(/authoriz|permission|not found|does not exist|champion|goal id/i);
  });
});

describe('the idle countdown', () => {
  it('starts at the full window and counts down in wall time', () => {
    expect(kioskRemainingMs(1_000, 1_000)).toBe(KIOSK_IDLE_MS);
    expect(kioskRemainingMs(1_000, 1_000 + 30_000)).toBe(KIOSK_IDLE_MS - 30_000);
  });

  it('clamps at zero rather than going negative when a tab was asleep', () => {
    expect(kioskRemainingMs(1_000, 1_000 + 10 * KIOSK_IDLE_MS)).toBe(0);
    expect(kioskCountdownExpired(kioskRemainingMs(1_000, 1_000 + 10 * KIOSK_IDLE_MS))).toBe(true);
  });

  it('treats a clock that moved backwards as "no time has passed", not as expiry', () => {
    expect(kioskRemainingMs(5_000, 1_000)).toBe(KIOSK_IDLE_MS);
    expect(kioskCountdownExpired(kioskRemainingMs(5_000, 1_000))).toBe(false);
  });

  it('is not expired while any time is left, and is expired at exactly zero', () => {
    expect(kioskCountdownExpired(1)).toBe(false);
    expect(kioskCountdownExpired(0)).toBe(true);
    expect(kioskCountdownExpired(-1)).toBe(true);
  });

  it('rounds seconds UP, so the last whole second is shown as one', () => {
    expect(kioskRemainingSeconds(KIOSK_IDLE_MS)).toBe(90);
    expect(kioskRemainingSeconds(1_001)).toBe(2);
    expect(kioskRemainingSeconds(1)).toBe(1);
    expect(kioskRemainingSeconds(0)).toBe(0);
  });

  it('reads plainly, and says nothing about the person', () => {
    expect(kioskCountdownLabel(90)).toBe('Finishing in 90 seconds');
    expect(kioskCountdownLabel(1)).toBe('Finishing in 1 second');
    expect(kioskCountdownLabel(0)).toBe('Finishing now…');
  });
});

describe('what Finish is allowed to erase', () => {
  it('clears this session’s draft when the outcome is known', () => {
    for (const outcome of ['confirmed', 'refused', 'none'] as const) {
      const plan = kioskFinishPlan(GOAL, outcome);
      expect(plan.clearPendingDraft).toBe(true);
      expect(plan.notice).toBeNull();
      expect(plan.signOut).toBe(true);
      expect(plan.returnTo).toBe(`/kiosk/${GOAL}`);
    }
  });

  it('KEEPS an unresolved attempt, and says where it is', () => {
    const plan = kioskFinishPlan(GOAL, 'unresolved');
    expect(plan.clearPendingDraft).toBe(false);
    expect(plan.notice).toBe('Your attempt is saved to your account; check it from your own device.');
    expect(plan.notice).toBe(KIOSK_UNRESOLVED_NOTICE);
    expect(plan.signOut).toBe(true);
  });

  it('never claims the unresolved attempt was recorded', () => {
    expect(KIOSK_UNRESOLVED_NOTICE).not.toMatch(/recorded|counted|confirmed|verified/i);
  });

  it('owns exactly one storage key', () => {
    expect(kioskSessionStorageKeys()).toEqual(['wsf.kioskReturnGoalId']);
  });
});

describe('runKioskFinish', () => {
  function deps(over: Partial<Parameters<typeof runKioskFinish>[1]> = {}) {
    return {
      signOut: vi.fn(async () => {}),
      clearPendingIfAttempt: vi.fn(() => true),
      clearKioskKeys: vi.fn(() => {}),
      ...over,
    };
  }

  it('signs out, clears kiosk keys and clears this attempt on a confirmed session', async () => {
    const d = deps();
    const result = await runKioskFinish(
      { goalId: GOAL, outcome: 'confirmed', uid: UID, attemptId: ATTEMPT },
      d
    );
    expect(d.clearPendingIfAttempt).toHaveBeenCalledWith(GOAL, UID, ATTEMPT);
    expect(d.clearKioskKeys).toHaveBeenCalledTimes(1);
    expect(d.signOut).toHaveBeenCalledTimes(1);
    expect(result.signedOut).toBe(true);
    expect(result.clearedPendingDraft).toBe(true);
    expect(result.returnTo).toBe(`/kiosk/${GOAL}`);
  });

  it('does NOT touch stored contributions when the outcome is unknown', async () => {
    const d = deps();
    const result = await runKioskFinish(
      { goalId: GOAL, outcome: 'unresolved', uid: UID, attemptId: ATTEMPT },
      d
    );
    expect(d.clearPendingIfAttempt).not.toHaveBeenCalled();
    expect(d.signOut).toHaveBeenCalledTimes(1);
    expect(d.clearKioskKeys).toHaveBeenCalledTimes(1);
    expect(result.clearedPendingDraft).toBe(false);
    expect(result.notice).toBe(KIOSK_UNRESOLVED_NOTICE);
  });

  it('leaves an unresolved attempt readable by the member who made it', async () => {
    const row: PendingContribution = {
      goalId: GOAL,
      attemptId: ATTEMPT,
      count: 30,
      ts: Date.now(),
      state: 'unknown',
    };
    savePendingNew(row, UID);
    // The real helper, not a stub: this is the end-to-end storage claim.
    const { clearPendingIfAttempt } = await import('../src/pendingContribution');
    await runKioskFinish(
      { goalId: GOAL, outcome: 'unresolved', uid: UID, attemptId: ATTEMPT },
      {
        signOut: async () => {},
        clearPendingIfAttempt,
        clearKioskKeys: clearKioskReturnGoal,
      }
    );
    expect(window.localStorage.getItem(pendingKey(GOAL, UID))).not.toBeNull();
  });

  it('cannot clear another account’s record, because the guarded helper refuses', async () => {
    const row: PendingContribution = {
      goalId: GOAL,
      attemptId: 'attempt-belonging-to-someone-else',
      count: 12,
      ts: Date.now(),
      state: 'unknown',
    };
    savePendingNew(row, OTHER_UID);
    const { clearPendingIfAttempt } = await import('../src/pendingContribution');
    const result = await runKioskFinish(
      // A confirmed session for UID, finishing on a device where OTHER_UID
      // left an unresolved attempt behind.
      { goalId: GOAL, outcome: 'confirmed', uid: UID, attemptId: ATTEMPT },
      { signOut: async () => {}, clearPendingIfAttempt, clearKioskKeys: clearKioskReturnGoal }
    );
    expect(result.signedOut).toBe(true);
    expect(window.localStorage.getItem(pendingKey(GOAL, OTHER_UID))).not.toBeNull();
  });

  it('reports a DIFFERENT attempt in the slot as not cleared', async () => {
    const d = deps({ clearPendingIfAttempt: vi.fn(() => false) });
    const result = await runKioskFinish(
      { goalId: GOAL, outcome: 'confirmed', uid: UID, attemptId: ATTEMPT },
      d
    );
    expect(result.clearedPendingDraft).toBe(false);
  });

  it('skips the clear when there is no account or no attempt', async () => {
    const d = deps();
    await runKioskFinish({ goalId: GOAL, outcome: 'none', uid: null, attemptId: null }, d);
    expect(d.clearPendingIfAttempt).not.toHaveBeenCalled();
    expect(d.signOut).toHaveBeenCalledTimes(1);
  });

  it('reports a FAILED sign-out instead of pretending the device is clean', async () => {
    const d = deps({
      signOut: vi.fn(async () => {
        throw new Error('network');
      }),
    });
    const result = await runKioskFinish(
      { goalId: GOAL, outcome: 'confirmed', uid: UID, attemptId: ATTEMPT },
      d
    );
    expect(result.signedOut).toBe(false);
  });

  it('still signs out when clearing storage throws', async () => {
    const d = deps({
      clearPendingIfAttempt: vi.fn(() => {
        throw new Error('storage');
      }),
      clearKioskKeys: vi.fn(() => {
        throw new Error('storage');
      }),
    });
    const result = await runKioskFinish(
      { goalId: GOAL, outcome: 'confirmed', uid: UID, attemptId: ATTEMPT },
      d
    );
    expect(result.signedOut).toBe(true);
    expect(result.clearedPendingDraft).toBe(false);
  });
});

describe('post-auth routing', () => {
  it('sends a kiosk visitor back to the kiosk contribution screen', async () => {
    const { nextRouteAfterAuth } = await import('../src/pendingJoinCode');
    setKioskReturnGoal(GOAL);
    expect(nextRouteAfterAuth('/')).toBe(`/contribute/${GOAL}?kiosk=1`);
  });

  it('lets a pending join code win — joining finishes first', async () => {
    const { nextRouteAfterAuth, setPendingJoinCode } = await import('../src/pendingJoinCode');
    setPendingJoinCode('abcdefghijklmnop');
    setKioskReturnGoal(GOAL);
    expect(nextRouteAfterAuth('/')).toBe('/join/abcdefghijklmnop');
  });

  it('is unchanged when no kiosk is in play', async () => {
    const { nextRouteAfterAuth } = await import('../src/pendingJoinCode');
    expect(nextRouteAfterAuth('/')).toBe('/');
  });
});
