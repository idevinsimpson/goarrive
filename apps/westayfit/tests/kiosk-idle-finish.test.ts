import { describe, expect, it } from 'vitest';

import {
  KIOSK_IDLE_MS,
  KIOSK_UNRESOLVED_NOTICE,
  KIOSK_UNRESOLVED_NOTICE_NO_RETRY,
  kioskMayFinishUnattended,
  kioskRemainingMs,
  type KioskOutcome,
  type KioskRestInput,
} from '../src/kioskSession';

/**
 * WHICH KIOSK SCREENS MAY END A SESSION BY THEMSELVES.
 *
 * The countdown used to start only for a receipt, a refusal or an unresolved
 * attempt. A goal that closed, one that cannot be found and a load that failed
 * carried a manual Finish and no deadline, so a shared device left on one of
 * them stayed exactly as the last visitor left it. These are the rules that
 * changed, tested where they live rather than through a screen.
 */

const REST: KioskRestInput = { outcome: 'none', attemptInFlight: false, loadSettled: false };
const OUTCOMES: KioskOutcome[] = ['confirmed', 'refused', 'unresolved', 'none'];

describe('a kiosk session may end unattended only from a screen it has come to rest on', () => {
  it('a settled outcome is a rest state, as it always was', () => {
    for (const outcome of ['confirmed', 'refused', 'unresolved'] as const) {
      expect(kioskMayFinishUnattended({ ...REST, outcome }), outcome).toBe(true);
    }
  });

  it('a settled LOAD is a rest state too — the three screens that had no deadline', () => {
    // closed goal, goal not found, load error: nothing further happens on any
    // of them without somebody acting.
    expect(kioskMayFinishUnattended({ ...REST, loadSettled: true })).toBe(true);
  });

  it('a screen somebody is standing at is not', () => {
    // entry, review, the movement screen, and the initial load: no outcome and
    // nothing settled.
    expect(kioskMayFinishUnattended(REST)).toBe(false);
  });

  it('IN FLIGHT IS NEVER REST, whatever else is true', () => {
    // Signing out from under a request that has not answered is how an outcome
    // becomes unknowable. This is the assertion that keeps the new deadline
    // from reaching a screen mid-request.
    for (const outcome of OUTCOMES) {
      for (const loadSettled of [false, true]) {
        expect(
          kioskMayFinishUnattended({ outcome, attemptInFlight: true, loadSettled }),
          `${outcome} / loadSettled=${loadSettled}`
        ).toBe(false);
      }
    }
  });

  it('every combination, stated once so a later edit cannot drift', () => {
    const table = OUTCOMES.flatMap((outcome) =>
      [false, true].flatMap((loadSettled) =>
        [false, true].map((attemptInFlight) => ({
          key: `${outcome}|load=${loadSettled}|inFlight=${attemptInFlight}`,
          may: kioskMayFinishUnattended({ outcome, attemptInFlight, loadSettled }),
        }))
      )
    );
    expect(table.filter((r) => r.may).map((r) => r.key)).toEqual([
      'confirmed|load=false|inFlight=false',
      'confirmed|load=true|inFlight=false',
      'refused|load=false|inFlight=false',
      'refused|load=true|inFlight=false',
      'unresolved|load=false|inFlight=false',
      'unresolved|load=true|inFlight=false',
      'none|load=true|inFlight=false',
    ]);
  });
});

describe('the deadline itself is unchanged by this', () => {
  it('is still 90 seconds', () => {
    expect(KIOSK_IDLE_MS).toBe(90_000);
  });

  it('is wall-clock, so a screen that comes back late is already past it', () => {
    // The countdown is a difference between two timestamps, not a decremented
    // counter, so a tab the operating system suspended does not owe itself the
    // time it was asleep. This is what makes a resumed kiosk finish on its next
    // tick rather than sit on the previous visitor's screen for another 90
    // seconds. It says nothing about the browser running while suspended.
    const started = 1_000_000;
    expect(kioskRemainingMs(started, started + 30_000)).toBe(60_000);
    expect(kioskRemainingMs(started, started + KIOSK_IDLE_MS + 5 * 60_000)).toBe(0);
  });
});

describe('what an unresolved session is told depends on what the screen can offer', () => {
  it('the accepted notice points at the retry, because that screen has one', () => {
    expect(KIOSK_UNRESOLVED_NOTICE).toContain('confirm this contribution here');
  });

  it('the no-retry variant promises no action the screen cannot perform', () => {
    // The load-error branch returns before the pending one, so an unresolved
    // session can render on a screen with no reconcile control at all. Saying
    // "you can confirm it here" there is a promise that screen cannot keep.
    // Not a naive substring: "elsewhere" contains "here", and the first
    // version of this assertion failed on that rather than on the copy.
    expect(KIOSK_UNRESOLVED_NOTICE_NO_RETRY).not.toContain('confirm this contribution here');
    expect(KIOSK_UNRESOLVED_NOTICE_NO_RETRY).not.toMatch(/you can|try to confirm/i);
    // It says why the retry is missing rather than offering one.
    expect(KIOSK_UNRESOLVED_NOTICE_NO_RETRY).toMatch(/couldn’t load this goal/i);
  });

  it('both keep the duplicate-entry warning, and neither claims the attempt landed', () => {
    for (const notice of [KIOSK_UNRESOLVED_NOTICE, KIOSK_UNRESOLVED_NOTICE_NO_RETRY]) {
      expect(notice).toContain('could count it twice');
      expect(notice).not.toMatch(/recorded|counted|confirmed|verified/i);
      // and neither promises the attempt travels to another device
      expect(notice).not.toMatch(/your own device|another device|saved to your account/i);
    }
  });
});
