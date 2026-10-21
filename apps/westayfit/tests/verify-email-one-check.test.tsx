import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RV12-641-N1 — verify-email runs ONE CHECK AT A TIME. A tap ("I have
 * verified"), the unconfigured poll and a return to the app all claim the same
 * check first: one that finds it held does not start a second check (a tap
 * returns, a tick skips to its next turn, a return does nothing), and each
 * releases only its own claim, also when its check fails. Before, a tap or a
 * tick during a return's check (and, on the web, the poll's visibility tick
 * during its own timed tick) started a second check, and both routed.
 *
 * Reloads can be held in flight and released one at a time, or made to fail;
 * AppState is faked (background → active, then the hook's settle); the
 * backend is stubbed.
 */

const ctl = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'android' | 'web',
  appListeners: new Set<(s: string) => void>(),
  calls: [] as Array<[string, unknown]>,
  reloads: 0,
  verifiedAfterReload: true,
  hold: false,
  pending: [] as Array<() => void>,
  failNext: false,
  outcome: null as null | 'unconfigured',
}));

vi.mock('react-native', async () => {
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return ctl.os;
      },
      select: (o: Record<string, unknown>) => (ctl.os in o ? o[ctl.os] : ctl.os !== 'web' && 'native' in o ? o.native : o.default),
    },
    AppState: {
      currentState: 'active',
      addEventListener: (_t: string, h: (s: string) => void) => {
        ctl.appListeners.add(h);
        return { remove: () => ctl.appListeners.delete(h) };
      },
    },
  };
});
vi.mock('expo-router', () => {
  const navigation = { dispatch: (a: unknown) => ctl.calls.push(['dispatch', a]), getState: () => undefined };
  return {
    router: {
      replace: (h: string) => ctl.calls.push(['replace', h]),
      push: (h: string) => ctl.calls.push(['push', h]),
      dismissTo: (h: string) => ctl.calls.push(['dismissTo', h]),
    },
    useNavigation: () => navigation,
    useFocusEffect: (cb: () => void | (() => void)) => {
      useEffect(() => cb(), [cb]);
    },
  };
});
const USER = vi.hoisted(() => ({ uid: 'u1', email: 'member@example.com', emailVerified: false, getIdToken: async () => 't' }));
vi.mock('firebase/auth', () => ({
  reload: async (u: { emailVerified: boolean }) => {
    ctl.reloads += 1;
    if (ctl.failNext) {
      ctl.failNext = false;
      throw Object.assign(new Error('offline'), { code: 'auth/network-request-failed' });
    }
    if (ctl.hold) await new Promise<void>((resolve) => ctl.pending.push(resolve));
    u.emailVerified = ctl.verifiedAfterReload;
  },
  signOut: async () => undefined,
  onAuthStateChanged: () => () => undefined,
}));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  getDoc: async () => ({ exists: () => true, data: () => ({}) }),
}));
vi.mock('../src/firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: { uid: 'u1' } }),
  getFirebaseFirestore: () => ({}),
  wsfIsStaging: false,
}));
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: USER, slow: false }) }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/pendingJoinCode', () => ({ routeAfterAuth: async () => '/join/AbCdEf', readPendingJoinCode: () => null }));
vi.mock('../src/postAuthDestination', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  usePostAuthDestinationsReady: () => undefined,
}));
vi.mock('../src/authDestination', () => ({ readAuthDestinationKind: () => null, authDestinationCard: () => ({}) }));
vi.mock('../src/verificationEmail', () => ({ requestVerificationEmail: async () => ({ sent: true }) }));
vi.mock('../src/verificationSendState', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  readVerificationSend: () => ctl.outcome,
}));

import { HOME_ONLY_RESET } from '../src/ui/authLanding';
import { RESUME_SETTLE_MS } from '../src/useResumeRefresh';

const { default: VerifyEmail } = await import('../app/verify-email');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  ctl.os = 'ios';
  ctl.appListeners.clear();
  ctl.calls = [];
  ctl.reloads = 0;
  ctl.verifiedAfterReload = true;
  ctl.hold = false;
  ctl.pending = [];
  ctl.failNext = false;
  ctl.outcome = null;
  USER.emailVerified = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  ctl.hold = false;
  ctl.pending.splice(0).forEach((r) => r());
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await act(async () => undefined);
};
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const app = (s: string) => act(() => ctl.appListeners.forEach((h) => h(s)));
/** Leave the app briefly and come back; the hook's settle passes. */
async function returnToApp() {
  app('background');
  advance(100);
  app('active');
  advance(RESUME_SETTLE_MS);
  await settle();
}
const tap = async () => {
  act(() => (container.querySelector('[data-testid="wsf-verify-check"]') as HTMLElement).click());
  await settle();
};
/** The oldest held reload answers. */
const releaseOne = async () => {
  ctl.pending.shift()?.();
  await settle();
};
const ROUTED = [
  ['dispatch', HOME_ONLY_RESET],
  ['push', '/join/AbCdEf'],
];

async function mount() {
  act(() => root.render(<VerifyEmail />));
  await settle();
}

describe('one check at a time (RV12-641-N1)', () => {
  it('a tap during a return’s check starts no second check; one route; the claim is free again after', async () => {
    await mount();
    ctl.hold = true;
    await returnToApp();
    expect(ctl.reloads).toBe(1);
    await tap();
    expect(ctl.reloads).toBe(1);
    // A tap that found the claim held released nothing: a second tap starts nothing either.
    await tap();
    expect(ctl.reloads).toBe(1);
    expect(ctl.calls).toEqual([]);
    ctl.hold = false;
    await releaseOne();
    expect(ctl.calls).toEqual(ROUTED);
    // Released: a later tap checks again.
    ctl.calls = [];
    await tap();
    expect(ctl.reloads).toBe(2);
    expect(ctl.calls).toEqual(ROUTED);
  });

  it('a return during a tap’s check starts no second check; one route', async () => {
    await mount();
    ctl.hold = true;
    await tap();
    expect(ctl.reloads).toBe(1);
    await returnToApp();
    expect(ctl.reloads).toBe(1);
    ctl.hold = false;
    await releaseOne();
    expect(ctl.reloads).toBe(1);
    expect(ctl.calls).toEqual(ROUTED);
  });

  it('a second tap while the first is checking starts nothing', async () => {
    await mount();
    ctl.hold = true;
    await tap();
    await tap();
    expect(ctl.reloads).toBe(1);
    ctl.hold = false;
    await releaseOne();
    expect(ctl.calls).toEqual(ROUTED);
  });

  it('the unconfigured poll: a tick during a return’s check skips to its next turn; it checks again once the claim is free', async () => {
    ctl.outcome = 'unconfigured';
    ctl.verifiedAfterReload = false;
    await mount();
    expect(ctl.reloads).toBe(1); // the immediate tick, unverified; the next in 2 s
    ctl.hold = true;
    await returnToApp(); // ~0.5 s: the return claims and is held
    expect(ctl.reloads).toBe(2);
    advance(2_000); // the poll's tick fires while the return is checking
    await settle();
    expect(ctl.reloads).toBe(2);
    ctl.hold = false;
    await releaseOne(); // the return answers (unverified) and releases
    expect(ctl.calls).toEqual([]);
    advance(4_000); // the tick's next turn
    await settle();
    expect(ctl.reloads).toBe(3);
  });

  it('the unconfigured poll: a return during a tick’s check does nothing', async () => {
    ctl.outcome = 'unconfigured';
    ctl.hold = true;
    await mount();
    expect(ctl.reloads).toBe(1); // the immediate tick, held
    await returnToApp();
    expect(ctl.reloads).toBe(1);
    ctl.hold = false;
    await releaseOne();
    expect(ctl.calls).toEqual(ROUTED);
  });

  it('web: the poll’s visibility tick during its own timed check no longer fires a duplicate check (the one web change)', async () => {
    ctl.os = 'web';
    ctl.outcome = 'unconfigured';
    ctl.hold = true;
    await mount();
    expect(ctl.reloads).toBe(1);
    act(() => document.dispatchEvent(new Event('visibilitychange')));
    await settle();
    expect(ctl.reloads).toBe(1);
    ctl.hold = false;
    await releaseOne();
    expect(ctl.calls).toEqual([['replace', '/join/AbCdEf']]);
  });

  it('a rejected tap releases the claim: the error is shown, and the next tap checks', async () => {
    await mount();
    ctl.failNext = true;
    await tap();
    expect(ctl.reloads).toBe(1);
    expect(container.querySelector('[data-testid="wsf-verify-error"]')).not.toBeNull();
    await tap();
    expect(ctl.reloads).toBe(2);
    expect(ctl.calls).toEqual(ROUTED);
  });

  it('a rejected return releases the claim, silently: the next tap checks', async () => {
    await mount();
    ctl.failNext = true;
    await returnToApp();
    expect(ctl.reloads).toBe(1);
    expect(container.querySelector('[data-testid="wsf-verify-error"]')).toBeNull();
    await tap();
    expect(ctl.reloads).toBe(2);
    expect(ctl.calls).toEqual(ROUTED);
  });

  it('a rejected tick releases the claim: a return checks', async () => {
    ctl.outcome = 'unconfigured';
    ctl.failNext = true;
    await mount();
    expect(ctl.reloads).toBe(1);
    await returnToApp();
    expect(ctl.reloads).toBe(2);
    expect(ctl.calls).toEqual(ROUTED);
  });
});

describe('INT-01: verify-email and profile-setup export the contained screen boundary', () => {
  for (const file of ['app/verify-email.tsx', 'app/profile-setup.tsx']) {
    it(file, () => {
      const src = readFileSync(nodePath.resolve(__dirname, '..', file), 'utf8');
      expect(src).toContain("export const ErrorBoundary = nativeErrorBoundary('screen');");
      expect(src).toContain("import { nativeErrorBoundary } from '../src/ui/RouteErrorFallback';");
    });
  }
});
