import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INT-13 part A (W12-11) — on a phone, coming back to the app re-checks the
 * address on verify-email: a member who left for their mail app to tap the
 * link is routed on as soon as they return. Silent, like the poll; never while
 * a tap is checking; never for an account that changed meanwhile; nothing on
 * the web. AppState is faked (background → active, then the hook's 400 ms
 * settle); the backend is stubbed.
 */

const ctl = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'android' | 'web',
  appListeners: new Set<(s: string) => void>(),
  calls: [] as Array<[string, unknown]>,
  reloads: 0,
  verifiedAfterReload: true,
  profileExists: true,
  currentUid: 'u1',
  switchAccountDuringReload: false,
  holdReload: null as null | (() => void),
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
  const navigation = { dispatch: (a: unknown) => ctl.calls.push(['dispatch', a]) };
  return {
    router: {
      replace: (h: string) => ctl.calls.push(['replace', h]),
      push: (h: string) => ctl.calls.push(['push', h]),
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
    // Held when the test asks: it answers when the test releases it.
    if (ctl.holdReload !== null) await new Promise<void>((resolve) => (ctl.holdReload = resolve));
    if (ctl.switchAccountDuringReload) ctl.currentUid = 'someone-else';
    u.emailVerified = ctl.verifiedAfterReload;
  },
  signOut: async () => undefined,
  onAuthStateChanged: () => () => undefined,
}));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  getDoc: async () => ({ exists: () => ctl.profileExists, data: () => ({}) }),
}));
vi.mock('../src/firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: { uid: ctl.currentUid } }),
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
  ctl.profileExists = true;
  ctl.currentUid = 'u1';
  ctl.switchAccountDuringReload = false;
  ctl.holdReload = null;
  USER.emailVerified = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await act(async () => undefined);
};
const app = (s: string) => act(() => ctl.appListeners.forEach((h) => h(s)));
/** Leave the app, come back, and let the hook's settle pass. */
async function returnToApp() {
  app('background');
  act(() => vi.advanceTimersByTime(5_000));
  app('active');
  act(() => vi.advanceTimersByTime(RESUME_SETTLE_MS));
  await settle();
}
const text = () => container.textContent ?? '';

async function mount() {
  act(() => root.render(<VerifyEmail />));
  await settle();
}

describe('INT-13A: verify-email re-checks when the member comes back to the app', () => {
  for (const os of ['ios', 'android'] as const) {
    it(`${os}: verified with a profile → lands on the destination (Home only, pushed)`, async () => {
      ctl.os = os;
      await mount();
      expect(ctl.reloads).toBe(0);
      await returnToApp();
      expect(ctl.reloads).toBe(1);
      expect(ctl.calls).toEqual([
        ['dispatch', HOME_ONLY_RESET],
        ['push', '/join/AbCdEf'],
      ]);
    });
  }

  it('verified without a profile → /profile-setup', async () => {
    ctl.profileExists = false;
    await mount();
    await returnToApp();
    expect(ctl.calls).toEqual([['replace', '/profile-setup']]);
  });

  it('still unverified: nothing routes, and the screen says nothing new (no status, no error)', async () => {
    ctl.verifiedAfterReload = false;
    await mount();
    const before = text();
    await returnToApp();
    expect(ctl.reloads).toBe(1);
    expect(ctl.calls).toEqual([]);
    expect(text()).toBe(before);
    expect(text()).not.toMatch(/Still unverified|failed/i);
  });

  it('the account changed while it was checking: it routes nowhere', async () => {
    ctl.switchAccountDuringReload = true;
    await mount();
    await returnToApp();
    expect(ctl.reloads).toBe(1);
    expect(ctl.calls).toEqual([]);
  });

  it('inactive alone (Control Center, a call banner) is not a return: no check', async () => {
    await mount();
    app('inactive');
    act(() => vi.advanceTimersByTime(5_000));
    app('active');
    act(() => vi.advanceTimersByTime(RESUME_SETTLE_MS));
    await settle();
    expect(ctl.reloads).toBe(0);
  });

  it('a tap’s check in flight: the return does not start another', async () => {
    ctl.verifiedAfterReload = false;
    ctl.holdReload = () => undefined;
    await mount();
    act(() => (container.querySelector('[data-testid="wsf-verify-check"]') as HTMLElement).click());
    await settle();
    expect(ctl.reloads).toBe(1);
    await returnToApp();
    expect(ctl.reloads).toBe(1);
    act(() => ctl.holdReload!());
    await settle();
  });

  it('web: no re-check on return (the web keeps its visibility path)', async () => {
    ctl.os = 'web';
    await mount();
    await returnToApp();
    expect(ctl.reloads).toBe(0);
    expect(ctl.calls).toEqual([]);
  });
});
