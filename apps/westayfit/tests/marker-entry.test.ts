import { readFileSync } from 'node:fs';
import path from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { authDestinationCard, authReturnHeading, readAuthDestinationKind } from '../src/authDestination';
import { setEventReturn } from '../src/eventReturn';
import { setKioskReturnGoal } from '../src/kioskSession';
import {
  MARKER_RETURN_MAX_AGE_MS,
  clearMarkerReturn,
  goalStateLine,
  markerRoute,
  markerStep,
  markerWays,
  normalizeMarkerSlug,
  readMarkerReturn,
  setMarkerReturn,
  type MarkerGoalState,
  type MarkerViewer,
} from '../src/markerEntry';
import { nextRouteAfterAuth, setPendingJoinCode } from '../src/pendingJoinCode';

/**
 * EVERGREEN-MARKER-ENTRY-1 (phase A) — the client half of the physical-marker
 * entry. All values are synthetic.
 */

const NOW = 1_700_000_000_000;
const read = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

beforeEach(() => {
  window.sessionStorage.clear();
});

describe('the slug', () => {
  it('accepts the printed shape, folding case and surrounding space', () => {
    expect(normalizeMarkerSlug('flag-01')).toBe('flag-01');
    expect(normalizeMarkerSlug(' FLAG-01 ')).toBe('flag-01');
    expect(normalizeMarkerSlug('a')).toBe('a');
    expect(normalizeMarkerSlug('x'.repeat(48))).toBe('x'.repeat(48));
  });

  it('refuses anything that could become a path, a query or another route', () => {
    for (const bad of ['', ' ', 'a/b', '../flag', 'flag?x=1', 'flag#x', 'flag_01', '-flag', 'flag-', 'x'.repeat(49), 'https://evil.example', '%2F', 7, null, undefined, {}]) {
      expect(normalizeMarkerSlug(bad), String(bad)).toBeNull();
    }
  });

  it('is the same rule the server applies', () => {
    const rule = /\^\[a-z0-9\]\(\?:\[a-z0-9-\]\{0,46\}\[a-z0-9\]\)\?\$/;
    expect(read('src/markerEntry.ts')).toMatch(rule);
    expect(read('../../functions-westayfit/src/index.ts')).toMatch(rule);
  });

  it('builds /go/<slug>, never a remembered URL', () => {
    expect(markerRoute('flag-01')).toBe('/go/flag-01');
  });
});

describe('the step a resolved marker puts the visitor on', () => {
  const viewers: MarkerViewer[] = ['signedOut', 'nonMember', 'member'];
  const states: MarkerGoalState[] = ['open', 'upcoming', 'ended', 'closed'];

  it('signed out always signs in first, and a non-member always joins first — whatever the goal', () => {
    for (const goalState of states) {
      expect(markerStep({ viewer: 'signedOut', goalState })).toBe('signIn');
      expect(markerStep({ viewer: 'nonMember', goalState })).toBe('join');
    }
  });

  it('a member chooses only on an open goal; anything else is the truthful not-open step', () => {
    expect(markerStep({ viewer: 'member', goalState: 'open' })).toBe('choose');
    for (const goalState of ['upcoming', 'ended', 'closed'] as const) {
      expect(markerStep({ viewer: 'member', goalState })).toBe('notOpen');
    }
  });

  it('covers every combination with exactly one step', () => {
    const seen = new Set<string>();
    for (const viewer of viewers) for (const goalState of states) seen.add(markerStep({ viewer, goalState }));
    expect([...seen].sort()).toEqual(['choose', 'join', 'notOpen', 'signIn']);
  });

  it('says the goal state plainly and never calls a closed or ended goal open', () => {
    expect(goalStateLine('open')).toBe('Open now');
    for (const s of ['upcoming', 'ended', 'closed'] as const) expect(goalStateLine(s)).not.toMatch(/open now/i);
  });
});

describe('the ways to take part', () => {
  it('phone is always the existing contribution screen', () => {
    for (const kioskMode of ['off', 'available', 'queue'] as const) {
      expect(markerWays({ goalId: 'goal-1', kioskMode }).phoneRoute).toBe('/contribute/goal-1');
    }
  });

  it('kiosk off OMITS the kiosk way entirely', () => {
    expect(markerWays({ goalId: 'goal-1', kioskMode: 'off' }).kiosk).toBeNull();
  });

  it('kiosk available is guidance only — no route, so nothing to queue into', () => {
    expect(markerWays({ goalId: 'goal-1', kioskMode: 'available' }).kiosk).toEqual({ kind: 'guidance' });
  });

  it('kiosk queue reaches the existing event screen, whose confirmed name is the only queue write', () => {
    expect(markerWays({ goalId: 'goal-1', kioskMode: 'queue' }).kiosk).toEqual({ kind: 'queue', route: '/event/goal-1' });
  });

  it('an unknown mode is treated as off', () => {
    expect(markerWays({ goalId: 'goal-1', kioskMode: 'always' as never }).kiosk).toBeNull();
  });
});

describe('the auth return stores a slug, never a URL', () => {
  it('round-trips a valid slug and refuses a malformed one', () => {
    setMarkerReturn('flag-01', NOW);
    expect(readMarkerReturn(NOW + 1000)).toBe('flag-01');
    clearMarkerReturn();
    setMarkerReturn('a/b', NOW);
    expect(readMarkerReturn(NOW)).toBeNull();
  });

  it('refuses a tampered, future or stale record', () => {
    const key = 'wsf.markerReturn';
    for (const raw of [
      '"flag-01"',
      '[]',
      'not json',
      JSON.stringify({ slug: '/signin', at: NOW }),
      JSON.stringify({ slug: 'FLAG-01', at: NOW }),
      JSON.stringify({ slug: 'flag-01', at: 'now' }),
      JSON.stringify({ slug: 'flag-01', at: NOW + 1 }),
    ]) {
      window.sessionStorage.setItem(key, raw);
      expect(readMarkerReturn(NOW), raw).toBeNull();
    }
    setMarkerReturn('flag-01', NOW);
    expect(readMarkerReturn(NOW + MARKER_RETURN_MAX_AGE_MS)).toBe('flag-01');
    expect(readMarkerReturn(NOW + MARKER_RETURN_MAX_AGE_MS + 1)).toBeNull();
  });

  it('the terminal auth hop returns to the marker', () => {
    setMarkerReturn('flag-01');
    expect(nextRouteAfterAuth('/')).toBe('/go/flag-01');
    clearMarkerReturn();
    expect(nextRouteAfterAuth('/')).toBe('/');
  });

  it('never outranks the three older destinations (their behaviour is unchanged)', () => {
    setMarkerReturn('flag-01');
    setKioskReturnGoal('goal-k');
    expect(nextRouteAfterAuth('/')).not.toBe('/go/flag-01');
    window.sessionStorage.clear();
    setMarkerReturn('flag-01');
    setEventReturn('goal-e');
    expect(nextRouteAfterAuth('/')).toBe('/event/goal-e');
    window.sessionStorage.clear();
    setMarkerReturn('flag-01');
    setPendingJoinCode('A'.repeat(22));
    expect(nextRouteAfterAuth('/')).toBe(`/join/${'A'.repeat(22)}`);
  });

  it('the identity screens say the scanned code is waiting, in the same order the router uses', () => {
    setMarkerReturn('flag-01');
    expect(readAuthDestinationKind()).toBe('marker');
    expect(authDestinationCard('marker').line).toBe('The code you scanned');
    expect(authReturnHeading('marker').intro).toMatch(/code you scanned/);
    setEventReturn('goal-e');
    expect(readAuthDestinationKind()).toBe('event');
  });

  it('the screen clears older returns when it arms its own, so a fresh scan wins', () => {
    const screen = read('src/ui/MarkerEntryScreen.tsx');
    const arm = screen.slice(screen.indexOf('const armReturn'), screen.indexOf('const onJoin'));
    expect(arm).toMatch(/clearPendingJoinCode\(\)/);
    expect(arm).toMatch(/clearEventReturn\(\)/);
    expect(arm.indexOf('setMarkerReturn')).toBeGreaterThan(arm.indexOf('clearEventReturn'));
  });
});

describe('a scan has no side effects', () => {
  const screen = read('src/ui/MarkerEntryScreen.tsx');
  const entry = read('src/markerEntry.ts');
  const route = read('app/go/[markerSlug].tsx');

  it('calls only the two marker callables, and joins only from the explicit Join tap', () => {
    const callables = [...entry.matchAll(/'(wsf[A-Za-z]+)'/g)].map((m) => m[1]);
    expect(callables.sort()).toEqual(['wsfJoinViaMarker', 'wsfResolveMarker']);
    expect(screen).not.toMatch(/httpsCallable|firebase\/firestore|wsfJoinTurnLine|wsfContribute/);
    const joinCalls = [...screen.matchAll(/resolver\.join\(/g)];
    expect(joinCalls).toHaveLength(1);
    expect(screen.slice(screen.indexOf('const onJoin'), screen.indexOf('const ways'))).toMatch(/resolver\.join\(/);
    expect(screen).toMatch(/onPress=\{\(\) => void onJoin\(\)\}/);
  });

  it('no timer, storage of identity, or analytics', () => {
    for (const src of [screen, entry, route]) {
      expect(src).not.toMatch(/setInterval|localStorage|analytics|logEvent|navigator\.sendBeacon/);
    }
  });

  it('the route reads only the slug from the address', () => {
    expect(route).toMatch(/useLocalSearchParams<\{ markerSlug: string \}>/);
    expect(route).toMatch(/normalizeMarkerSlug\(params\.markerSlug\)/);
    expect(route).not.toMatch(/params\.(?!markerSlug)/);
  });

  it('nothing initialises Firebase at module load (static export safety)', () => {
    expect(route).toMatch(/firebaseMarkerResolver\(getFirebaseFunctions\)/);
    expect(route).not.toMatch(/getFirebaseFunctions\(\)/);
  });
});
