import { beforeEach, describe, expect, it } from 'vitest';

import {
  EVENT_RETURN_MAX_AGE_MS,
  clearEventReturn,
  eventRoute,
  readEventReturn,
  setEventReturn,
} from '../src/eventReturn';
import { nextRouteAfterAuth, setPendingJoinCode } from '../src/pendingJoinCode';
import { setKioskReturnGoal } from '../src/kioskSession';

/**
 * THE EVENT RETURN, exercised directly.
 *
 * The defect these exist for: a visitor scanned an event QR, signed in, and
 * landed on the app's home because nothing carried the event across the auth
 * round trip. The danger in fixing that is the obvious one — a "come back to
 * where you were" mechanism is an open-redirect and a cross-context leak if it
 * remembers a URL or forgets which event an activity belonged to. So these
 * tests are mostly about what it REFUSES.
 */

const GOAL = 'goal-abc_123';
const OTHER_GOAL = 'goal-zzz_999';
const NOW = 1_700_000_000_000;

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('the route is built, never remembered', () => {
  it('constructs /event/<goalId> from the id', () => {
    expect(eventRoute(GOAL)).toBe(`/event/${GOAL}`);
  });

  it('percent-encodes anything that would otherwise change the path', () => {
    // Defence in depth: nothing with these characters can be STORED, but the
    // route builder is exported and must be safe for any caller.
    expect(eventRoute('a/b')).toBe('/event/a%2Fb');
    expect(eventRoute('a?b=c')).toBe('/event/a%3Fb%3Dc');
    expect(eventRoute('../admin')).toBe('/event/..%2Fadmin');
  });
});

describe('what may be stored', () => {
  it('round-trips a plausible goal id', () => {
    setEventReturn(GOAL, NOW);
    expect(readEventReturn(NOW)).toBe(GOAL);
  });

  for (const bad of [
    'https://evil.example.com/steal',
    '/event/other',
    '../../admin',
    'goal with spaces',
    'goal?query=1',
    'goal#frag',
    '',
    'x'.repeat(129),
  ]) {
    it(`refuses to store ${JSON.stringify(bad)}`, () => {
      setEventReturn(bad, NOW);
      expect(readEventReturn(NOW)).toBeNull();
    });
  }

  it('stores no route, so a tampered record cannot become a redirect', () => {
    setEventReturn(GOAL, NOW);
    const raw = window.sessionStorage.getItem('wsf.eventReturn') ?? '';
    expect(raw).not.toContain('/event/');
    expect(raw).not.toContain('http');
  });
});

describe('what a read refuses', () => {
  it('a value written by something else, in the wrong shape', () => {
    window.sessionStorage.setItem('wsf.eventReturn', 'https://evil.example.com');
    expect(readEventReturn(NOW)).toBeNull();
  });

  it('a JSON array, or a bare string, or a record missing its stamp', () => {
    for (const raw of ['[]', '"goal-abc"', '{"goalId":"goal-abc"}', '{"at":1}', 'null']) {
      window.sessionStorage.setItem('wsf.eventReturn', raw);
      expect(readEventReturn(NOW)).toBeNull();
    }
  });

  it('a record whose goal id would traverse or redirect', () => {
    window.sessionStorage.setItem(
      'wsf.eventReturn',
      JSON.stringify({ goalId: 'https://evil.example.com/x', at: NOW })
    );
    expect(readEventReturn(NOW)).toBeNull();
  });

  it('a stale record — a phone in a pocket between two events', () => {
    setEventReturn(GOAL, NOW);
    expect(readEventReturn(NOW + EVENT_RETURN_MAX_AGE_MS - 1)).toBe(GOAL);
    expect(readEventReturn(NOW + EVENT_RETURN_MAX_AGE_MS + 1)).toBeNull();
  });

  it('a record stamped in the future, which is as untrustworthy as an expired one', () => {
    setEventReturn(GOAL, NOW + 60_000);
    expect(readEventReturn(NOW)).toBeNull();
  });
});

describe('clearing', () => {
  it('forgets the handoff', () => {
    setEventReturn(GOAL, NOW);
    clearEventReturn();
    expect(readEventReturn(NOW)).toBeNull();
    expect(window.sessionStorage.getItem('wsf.eventReturn')).toBeNull();
  });

  it('stores no activity key at all — that journey is /join/<code>\u2019s, not this one', () => {
    setEventReturn(GOAL, NOW);
    // A duplicate activity handoff here would fight the scanned join flow,
    // which already carries event AND activity through a real round trip.
    expect(window.sessionStorage.getItem('wsf.eventReturnActivity')).toBeNull();
  });

  it('is safe to call when nothing was ever stored', () => {
    expect(() => clearEventReturn()).not.toThrow();
  });
});

describe('storage that is unavailable', () => {
  it('reads null and never throws when sessionStorage is denied', () => {
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new Error('denied');
      },
    });
    try {
      expect(() => setEventReturn(GOAL, NOW)).not.toThrow();
      expect(readEventReturn(NOW)).toBeNull();
      expect(() => clearEventReturn()).not.toThrow();
    } finally {
      if (original) Object.defineProperty(window, 'sessionStorage', original);
    }
  });
});


describe('nextRouteAfterAuth — which destination claims the terminal hop', () => {
  it('sends a scanned event back to its own address', () => {
    setEventReturn(GOAL, Date.now());
    expect(nextRouteAfterAuth('/')).toBe(`/event/${GOAL}`);
  });

  it('a pending join code still wins — that visitor is mid-way through joining', () => {
    setPendingJoinCode('a'.repeat(20));
    setEventReturn(GOAL, Date.now());
    expect(nextRouteAfterAuth('/')).toBe(`/join/${'a'.repeat(20)}`);
  });

  it('an event return beats a kiosk return', () => {
    setKioskReturnGoal(OTHER_GOAL);
    setEventReturn(GOAL, Date.now());
    expect(nextRouteAfterAuth('/')).toBe(`/event/${GOAL}`);
  });

  it('a kiosk return still works when no event was scanned', () => {
    setKioskReturnGoal(OTHER_GOAL);
    expect(nextRouteAfterAuth('/')).toBe(`/contribute/${OTHER_GOAL}?kiosk=1`);
  });

  it('falls back to the caller default when nothing is pending', () => {
    expect(nextRouteAfterAuth('/')).toBe('/');
  });

  it('a STALE event return does not claim the hop', () => {
    setEventReturn(GOAL, Date.now() - EVENT_RETURN_MAX_AGE_MS - 1000);
    expect(nextRouteAfterAuth('/')).toBe('/');
  });

  it('a tampered event return cannot redirect anywhere', () => {
    window.sessionStorage.setItem(
      'wsf.eventReturn',
      JSON.stringify({ goalId: 'https://evil.example.com', at: Date.now() })
    );
    expect(nextRouteAfterAuth('/')).toBe('/');
  });
});
