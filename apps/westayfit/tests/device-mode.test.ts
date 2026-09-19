/**
 * Whose screen is this — the store and the routing decision, tested directly.
 *
 * The two route modules that ask the question live under bracketed dynamic
 * paths and cannot be imported by the harness, which is exactly why the rules
 * live in src/deviceMode.ts — the same reason src/kioskSession.ts and
 * src/stationSession.ts exist.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  clearDeviceMode,
  decideDeviceEntry,
  DEVICE_CHOICE_HEADING,
  DEVICE_CHOICE_INTRO,
  DEVICE_CHOICE_NOTE,
  DEVICE_CHOICE_PERSONAL_DESCRIPTION,
  DEVICE_CHOICE_PERSONAL_LABEL,
  DEVICE_CHOICE_SHARED_DESCRIPTION,
  DEVICE_CHOICE_SHARED_DESCRIPTION_SIGNUP,
  DEVICE_CHOICE_SHARED_LABEL,
  DEVICE_MODE_KEY,
  DEVICE_MODES,
  DEVICE_SHARED_BODY,
  DEVICE_SHARED_CONTINUE,
  DEVICE_SHARED_RESET,
  DEVICE_SHARED_TITLE,
  isDeviceMode,
  readDeviceMode,
  saveDeviceMode,
  type DeviceMode,
} from '../src/deviceMode';
import { kioskStartRoute } from '../src/kioskSession';

afterEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('the two answers', () => {
  it('is exactly two, and nothing else counts as one', () => {
    expect(DEVICE_MODES).toEqual(['personal', 'shared']);
    expect(isDeviceMode('personal')).toBe(true);
    expect(isDeviceMode('shared')).toBe(true);
    // Everything a storage read, a URL or a stale build could hand it.
    expect(isDeviceMode('kiosk')).toBe(false);
    expect(isDeviceMode('Personal')).toBe(false);
    expect(isDeviceMode('')).toBe(false);
    expect(isDeviceMode(null)).toBe(false);
    expect(isDeviceMode(undefined)).toBe(false);
    expect(isDeviceMode(1)).toBe(false);
    expect(isDeviceMode({ mode: 'shared' })).toBe(false);
  });

  it('owns exactly one storage key, and it is not one of anybody else’s', () => {
    expect(DEVICE_MODE_KEY).toBe('wsf.deviceMode');
    expect(DEVICE_MODE_KEY).not.toBe('wsf.kioskReturnGoalId');
    expect(DEVICE_MODE_KEY).not.toBe('wsf.stationCredential');
    expect(DEVICE_MODE_KEY).not.toBe('wsf.pendingEventGoalId');
  });
});

describe('remembering the answer', () => {
  it('is null before anybody has been asked', () => {
    expect(readDeviceMode()).toBeNull();
  });

  it('round-trips both answers, and stores the bare word and nothing else', () => {
    for (const mode of DEVICE_MODES) {
      expect(saveDeviceMode(mode)).toBe(true);
      expect(readDeviceMode()).toBe(mode);
      // THE WHOLE STORED VALUE. Not a JSON envelope, not a timestamp, not a
      // uid: a fact about a device with no person in it.
      expect(window.localStorage.getItem(DEVICE_MODE_KEY)).toBe(mode);
    }
  });

  it('writes to localStorage and never to sessionStorage', () => {
    saveDeviceMode('shared');
    expect(window.sessionStorage.getItem(DEVICE_MODE_KEY)).toBeNull();
    expect(Object.keys(window.sessionStorage)).toHaveLength(0);
  });

  it('survives being read many times without changing', () => {
    saveDeviceMode('personal');
    expect(readDeviceMode()).toBe('personal');
    expect(readDeviceMode()).toBe('personal');
    expect(window.localStorage.getItem(DEVICE_MODE_KEY)).toBe('personal');
  });

  it('forgets it on request, which is the way back for a phone that mistapped', () => {
    saveDeviceMode('shared');
    clearDeviceMode();
    expect(readDeviceMode()).toBeNull();
    expect(window.localStorage.getItem(DEVICE_MODE_KEY)).toBeNull();
  });

  it('clearing a key that was never written is not an error', () => {
    expect(() => clearDeviceMode()).not.toThrow();
    expect(readDeviceMode()).toBeNull();
  });

  // A value this build does not recognise is NOT guessed at. Treating an
  // unknown word as "shared" would strand a personal phone; treating it as
  // "personal" would leave a shared device signed in. It is no answer, so the
  // question is asked again.
  it('treats a value it does not recognise as no answer at all', () => {
    for (const junk of ['kiosk', 'PERSONAL', '{"mode":"shared"}', '', 'true']) {
      window.localStorage.setItem(DEVICE_MODE_KEY, junk);
      expect(readDeviceMode()).toBeNull();
    }
  });

  it('refuses to store a value that is not one of the two answers', () => {
    expect(saveDeviceMode('kiosk' as unknown as DeviceMode)).toBe(false);
    expect(saveDeviceMode(null as unknown as DeviceMode)).toBe(false);
    expect(window.localStorage.getItem(DEVICE_MODE_KEY)).toBeNull();
  });
});

describe('a browser that will not let it remember anything', () => {
  it('reports the failure rather than claiming the answer was kept', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(saveDeviceMode('shared')).toBe(false);
  });

  it('reads as no answer rather than throwing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(readDeviceMode()).toBeNull();
  });

  it('swallows a failing removal, because nothing else reads the key', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    expect(() => clearDeviceMode()).not.toThrow();
  });
});

describe('decideDeviceEntry', () => {
  const goalId = 'uiD-goal-abc_123';

  it('asks when the device has never answered', () => {
    expect(decideDeviceEntry({ mode: null, goalId })).toEqual({ kind: 'ask' });
  });

  it('runs the ordinary path for a device that said it is somebody’s own', () => {
    expect(decideDeviceEntry({ mode: 'personal', goalId })).toEqual({ kind: 'personal' });
  });

  // THE ONE CLAIM THAT MATTERS ABOUT THE SHARED ANSWER: it hands off to the
  // route that already implements a shared session, byte for byte the address
  // src/kioskSession.ts builds. There is no second shared-session route.
  it('hands a shared screen to the EXISTING kiosk start route for that goal', () => {
    const decision = decideDeviceEntry({ mode: 'shared', goalId });
    expect(decision).toEqual({ kind: 'shared', route: `/kiosk/${goalId}` });
    expect(decision.kind === 'shared' && decision.route).toBe(kioskStartRoute(goalId));
  });

  it('encodes the goal id into the hand-off exactly as the kiosk route does', () => {
    const odd = 'goal-with_underscores-and-dashes';
    expect(decideDeviceEntry({ mode: 'shared', goalId: odd })).toEqual({
      kind: 'shared',
      route: kioskStartRoute(odd),
    });
  });

  it('ignores surrounding whitespace on a goal id from a route parameter', () => {
    expect(decideDeviceEntry({ mode: 'shared', goalId: `  ${goalId}  ` })).toEqual({
      kind: 'shared',
      route: kioskStartRoute(goalId),
    });
    expect(decideDeviceEntry({ mode: null, goalId: `  ${goalId}  ` })).toEqual({ kind: 'ask' });
  });

  // THE BRANCH THAT SHOULD NEVER HAPPEN. Both QR links are built from a real
  // goal id by src/ui/eventLinks.ts, so a missing or misshapen one cannot
  // arrive from a scan. If it ever does there is no kiosk address to build, so
  // nothing is offered and nothing is asked: the ordinary path runs and shows
  // its own answer for a goal it cannot load. It never builds a path out of an
  // unusable value.
  it('offers nothing and asks nothing when there is no usable goal to hand off to', () => {
    for (const bad of ['', '   ', null, undefined, 'has spaces', '../escape', 'a/b', 'x'.repeat(129)]) {
      expect(decideDeviceEntry({ mode: null, goalId: bad })).toEqual({ kind: 'personal' });
      expect(decideDeviceEntry({ mode: 'personal', goalId: bad })).toEqual({ kind: 'personal' });
      // Even a device that HAS said it is shared: no address, no hand-off.
      expect(decideDeviceEntry({ mode: 'shared', goalId: bad })).toEqual({ kind: 'personal' });
    }
  });

  it('accepts a goal id of exactly the maximum length', () => {
    const long = 'g'.repeat(128);
    expect(decideDeviceEntry({ mode: 'shared', goalId: long })).toEqual({
      kind: 'shared',
      route: kioskStartRoute(long),
    });
  });

  it('is a pure decision: it reads nothing from storage and writes nothing', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem');
    const set = vi.spyOn(Storage.prototype, 'setItem');
    decideDeviceEntry({ mode: 'shared', goalId });
    decideDeviceEntry({ mode: null, goalId });
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });

  it('the stored answer and the decision agree end to end', () => {
    saveDeviceMode('shared');
    expect(decideDeviceEntry({ mode: readDeviceMode(), goalId })).toEqual({
      kind: 'shared',
      route: kioskStartRoute(goalId),
    });
    clearDeviceMode();
    expect(decideDeviceEntry({ mode: readDeviceMode(), goalId })).toEqual({ kind: 'ask' });
  });
});

describe('the words on screen', () => {
  // Pinned here so the spec and the UI cannot drift apart silently, and so a
  // copy change is a deliberate edit in two places.
  it('are the ones the screens and the browser spec both read', () => {
    expect(DEVICE_CHOICE_HEADING).toBe('Whose screen is this?');
    expect(DEVICE_CHOICE_INTRO).toBe('It changes what happens when you’re finished.');
    expect(DEVICE_CHOICE_PERSONAL_LABEL).toBe('My own phone');
    expect(DEVICE_CHOICE_PERSONAL_DESCRIPTION).toBe(
      'You stay signed in, exactly as you would anywhere else.'
    );
    expect(DEVICE_CHOICE_SHARED_LABEL).toBe('A shared screen here');
    expect(DEVICE_CHOICE_SHARED_DESCRIPTION).toBe(
      'You sign in, add your part, and finish. Nothing about you stays on this screen.'
    );
    expect(DEVICE_CHOICE_SHARED_DESCRIPTION_SIGNUP).toBe(
      'We won’t make an account on a screen other people use. You’ll go to that screen’s own page instead.'
    );
    expect(DEVICE_SHARED_TITLE).toBe('This is a shared screen');
    expect(DEVICE_SHARED_BODY).toBe(
      'Add your part here, then finish. Nothing about you stays on this screen.'
    );
    expect(DEVICE_SHARED_CONTINUE).toBe('Add your part on this screen');
    expect(DEVICE_SHARED_RESET).toBe('This is my own phone');
  });

  // The standing quality bar: a device question must not become a claim about
  // a person, a verification, or an admission decision.
  it('claim nothing about who is holding the device, and offer no way in', () => {
    const all = [
      DEVICE_CHOICE_HEADING,
      DEVICE_CHOICE_INTRO,
      DEVICE_CHOICE_PERSONAL_LABEL,
      DEVICE_CHOICE_PERSONAL_DESCRIPTION,
      DEVICE_CHOICE_SHARED_LABEL,
      DEVICE_CHOICE_SHARED_DESCRIPTION,
      DEVICE_CHOICE_SHARED_DESCRIPTION_SIGNUP,
      DEVICE_CHOICE_NOTE,
      DEVICE_SHARED_TITLE,
      DEVICE_SHARED_BODY,
      DEVICE_SHARED_CONTINUE,
      DEVICE_SHARED_RESET,
    ].join(' ');
    expect(all).not.toMatch(/verif|witness|proof|we saw|confirm(ed|s) that you/i);
    expect(all).not.toMatch(/join code|invite code|invitation code/i);
    // No developer or configuration vocabulary in front of a member.
    expect(all).not.toMatch(/kiosk|goalId|localStorage|session token|uid/i);
  });

  it('say plainly, before the tap, what the shared answer costs', () => {
    expect(DEVICE_CHOICE_SHARED_DESCRIPTION).toContain('Nothing about you stays on this screen.');
    expect(DEVICE_CHOICE_SHARED_DESCRIPTION_SIGNUP).toContain('won’t make an account');
    expect(DEVICE_CHOICE_PERSONAL_DESCRIPTION).toContain('stay signed in');
    expect(DEVICE_CHOICE_NOTE).toContain('this device only');
  });
});
