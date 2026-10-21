import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MarkerResolver, ResolvedMarker } from '../src/markerEntry';
import { bootNative, createFakeAsyncStorage, flush, type FakeAsyncStorage } from './nativeStorageHarness';

/**
 * W13-13 (ST-04 case 6, second half). ON A PHONE, "NOT NOW — BACK TO HOME" ON
 * THE MARKER SCREEN'S SIGNED-OUT STEP SPENDS THE MARKER RETURN.
 *
 * src/ui/MarkerEntryScreen.tsx wires the signed-out step's "Not now — back to
 * home" to `clearMarkerReturn`, and `SecondaryLink` passes `onPress` through
 * (src/AuthFormPrimitives.tsx). Until now no test pressed it: the only "Not
 * now" pin was the event screen's e2e spec, and tests/marker-entry.test.ts
 * calls the clear function directly.
 *
 * Here the screen is rendered through react-native-web over the NATIVE
 * storage implementations (tests/nativeStorageHarness.ts), with a stubbed
 * resolver (no backend). A return is armed, "Not now" is pressed by its text
 * (it has no testID), and the app is relaunched over the same disk: nothing
 * routes back to the marker. The control relaunches without pressing it: the
 * return is still there, so the press is what spent it. Not a device run.
 */

const A = 'member-a';
const SLUG = 'flag-01';
const NOT_NOW = 'Not now — back to home';
const KEY = 'wsf.markerReturn';

const AUTH = vi.hoisted(() => ({ ready: true, user: null as null | { uid: string; emailVerified: boolean } }));
vi.mock('../src/auth', () => ({ useWsfAuth: () => AUTH }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/ui/WsfWordmark', () => ({ WsfWordmark: () => null }));
/*
  A hand-built expo-router (the real package cannot load here). Focus effects
  do nothing: the screen spends the return on focus only for a viewer who is
  signed in, and this is the signed-out step. `Link asChild` renders its child,
  which keeps the child's own onPress, as the real one does before it
  navigates.
*/
vi.mock('expo-router', () => ({
  useFocusEffect: () => undefined,
  Link: ({ children }: { children?: ReactNode }) => children ?? null,
}));

/** What the signed-out visitor's scan resolves to: the signed-out step. */
const MARKER: ResolvedMarker = {
  markerSlug: SLUG,
  label: 'Flag 01',
  communityName: 'Oak Grove',
  goalId: 'goal-1',
  goalTitle: '500 squats',
  goalState: 'open',
  kioskMode: 'off',
  viewer: 'signedOut',
  communityGroupId: null,
};

let disk: FakeAsyncStorage;
let cleanup: Array<() => void> = [];

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  disk = createFakeAsyncStorage();
});

afterEach(() => {
  for (const c of cleanup.splice(0)) c();
});

/** A fresh process over `disk`, its destinations read. Returns the modules the test uses. */
async function launch() {
  bootNative(disk);
  const destinations = await import('../src/postAuthDestination');
  await destinations.postAuthDestinationsReady();
  return {
    arming: await import('../src/handoffArming'),
    marker: await import('../src/markerEntry'),
    next: await import('../src/pendingJoinCode'),
  };
}

/** The marker screen, signed out, in the process booted last. */
async function renderSignedOut() {
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { MarkerEntryScreen } = await import('../src/ui/MarkerEntryScreen');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const resolve = vi.fn(async (_slug: string) => MARKER);
  const resolver: MarkerResolver = {
    resolve,
    join: async () => {
      throw new Error('join is not pressed on the signed-out step');
    },
  };
  await React.act(async () => {
    root.render(React.createElement(MarkerEntryScreen, { slug: SLUG, resolver }));
  });
  await React.act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
  cleanup.push(() => {
    React.act(() => root.unmount());
    container.remove();
  });
  /** The innermost element whose whole text is `text`. */
  const byText = (text: string) =>
    Array.from(container.querySelectorAll<HTMLElement>('*')).filter(
      (el) => el.textContent === text && !Array.from(el.children).some((c) => c.textContent === text),
    );
  return {
    container,
    resolve,
    byText,
    press: async (el: HTMLElement) => {
      await React.act(async () => {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      });
      await flush();
    },
  };
}

describe('W13-13: "Not now — back to home" on the marker screen spends the return (native)', () => {
  it.each([
    ['owned by the account that armed it (A)', A],
    ['a signed-out handoff (whoever signs in next)', null],
  ] as const)('a return %s is gone after the press and a relaunch', async (_label, owner) => {
    const first = await launch();
    expect(await first.arming.armMarkerReturn(SLUG, owner)).toBe(true);
    expect(first.marker.readMarkerReturn(Date.now(), owner)).toBe(SLUG);
    expect(disk.map.has(KEY)).toBe(true);

    const screen = await renderSignedOut();
    expect(screen.resolve).toHaveBeenCalledWith(SLUG);
    expect(screen.container.querySelector('[data-testid="wsf-marker-signed-out"]')).not.toBeNull();
    const notNow = screen.byText(NOT_NOW);
    expect(notNow).toHaveLength(1);
    await screen.press(notNow[0]!);
    expect(disk.map.has(KEY)).toBe(false);

    // The app is relaunched over the same disk.
    const again = await launch();
    expect(again.marker.readMarkerReturn()).toBeNull();
    expect(again.marker.readMarkerReturn(Date.now(), A)).toBeNull();
    expect(again.next.nextRouteAfterAuth('/')).toBe('/');
    expect(again.next.nextRouteAfterAuth('/', A)).toBe('/');
  });

  it('control: without the press, the relaunch still routes A back to the marker', async () => {
    const first = await launch();
    expect(await first.arming.armMarkerReturn(SLUG, A)).toBe(true);
    const screen = await renderSignedOut();
    expect(screen.byText(NOT_NOW)).toHaveLength(1);
    await flush();

    const again = await launch();
    expect(again.marker.readMarkerReturn(Date.now(), A)).toBe(SLUG);
    expect(again.next.nextRouteAfterAuth('/', A)).not.toBe('/');
    expect(again.next.nextRouteAfterAuth('/', A)).toContain(SLUG);
  });
});
