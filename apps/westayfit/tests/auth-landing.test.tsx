import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INT-20 (W12-12) — where a member lands when signing in is done, on a phone:
 * src/ui/authLanding.ts (Home-only RESET, then the destination PUSHED over it;
 * the web keeps `replace`), applied at the integrator's terminal hops
 * (verify-email clearing, profile-setup finishing) and on Progress → MOVE.
 * The screens are rendered with their backend stubbed; Platform.OS is
 * switchable.
 */

const ctl = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'android' | 'web',
  calls: [] as Array<[string, unknown]>,
  next: '/join/AbCdEf',
  profileExists: true,
  verifiedAfterReload: true,
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
  };
});

vi.mock('expo-router', async () => {
  const React = await import('react');
  const navigation = { dispatch: (a: unknown) => ctl.calls.push(['dispatch', a]) };
  return {
    router: {
      replace: (href: string) => ctl.calls.push(['replace', href]),
      push: (href: string) => ctl.calls.push(['push', href]),
    },
    useNavigation: () => navigation,
    useLocalSearchParams: () => ({}),
    useFocusEffect: (cb: () => void | (() => void)) => {
      React.useEffect(() => cb(), [cb]);
    },
  };
});
const USER = vi.hoisted(() => ({
  uid: 'u1',
  email: 'member@example.com',
  emailVerified: false,
  getIdToken: async () => 'token',
}));
vi.mock('firebase/auth', () => ({
  reload: async (u: { emailVerified: boolean }) => {
    u.emailVerified = ctl.verifiedAfterReload;
  },
  signOut: async () => undefined,
  onAuthStateChanged: () => () => undefined,
}));
vi.mock('firebase/firestore', () => ({
  doc: () => ({}),
  getDoc: async () => ({ exists: () => ctl.profileExists, data: () => ({ displayName: 'Member' }) }),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: { created: true } }) }));
vi.mock('../src/firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: { uid: USER.uid } }),
  getFirebaseFirestore: () => ({}),
  getFirebaseFunctions: () => ({}),
  wsfIsStaging: false,
}));
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: USER }) }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/pendingJoinCode', () => ({ routeAfterAuth: async () => ctl.next, readPendingJoinCode: () => null }));
vi.mock('../src/postAuthDestination', async (importOriginal) => ({
  ...((await importOriginal()) as object),
  usePostAuthDestinationsReady: () => undefined,
}));
vi.mock('../src/authDestination', () => ({ readAuthDestinationKind: () => null, authDestinationCard: () => ({}) }));
vi.mock('../src/verificationEmail', () => ({ requestVerificationEmail: async () => ({ sent: true }) }));
// Progress (app/(tabs)/activity.tsx), with one open goal and nothing recorded yet.
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  peekGoals: () => undefined,
  peekMemberProfile: () => undefined,
  peekMyCommunities: () => undefined,
  peekOwnCredit: () => undefined,
  wasRefused: () => false,
  readMyCommunities: async () => ({ items: [{ groupId: 'oak', displayName: 'Oak Grove Together' }] }),
  readGoals: async () => ({
    goals: [
      {
        goalId: 'g-a',
        title: '500 squats together',
        target: 500,
        unit: 'squats',
        status: 'active',
        endsAt: new Date(Date.now() + 86_400_000).toISOString(),
        timezone: 'UTC',
        sharedTotal: 120,
      },
    ],
  }),
  readOwnCredit: async () => ({ ownCredit: 0, unit: 'squats' }),
}));

import { HOME_ONLY_RESET, landAfterAuth } from '../src/ui/authLanding';
import { SIGNED_OUT_HOME_RESET } from '../src/ui/signOutReset';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  ctl.os = 'ios';
  ctl.calls = [];
  ctl.next = '/join/AbCdEf';
  ctl.profileExists = true;
  ctl.verifiedAfterReload = true;
  USER.emailVerified = false;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const settle = async () => {
  for (let i = 0; i < 10; i += 1) await act(async () => undefined);
};
const press = (testID: string) => act(() => (container.querySelector(`[data-testid="${testID}"]`) as HTMLElement).click());

describe('landAfterAuth', () => {
  const deps = () => ({
    dispatch: (a: unknown) => ctl.calls.push(['dispatch', a]),
    push: (h: string) => ctl.calls.push(['push', h]),
    replace: (h: string) => ctl.calls.push(['replace', h]),
  });

  it('native: the root stack is reset to Home only, then the destination is pushed over it', () => {
    for (const platform of ['ios', 'android']) {
      ctl.calls = [];
      landAfterAuth('/join/AbCdEf', { ...deps(), platform });
      expect(ctl.calls).toEqual([
        ['dispatch', HOME_ONLY_RESET],
        ['push', '/join/AbCdEf'],
      ]);
    }
  });

  it('native: Home itself is only the reset (nothing pushed over it)', () => {
    landAfterAuth('/', { ...deps(), platform: 'ios' });
    expect(ctl.calls).toEqual([['dispatch', HOME_ONLY_RESET]]);
  });

  it('web: replace, exactly as before', () => {
    landAfterAuth('/join/AbCdEf', { ...deps(), platform: 'web' });
    landAfterAuth('/', { ...deps(), platform: 'web' });
    expect(ctl.calls).toEqual([
      ['replace', '/join/AbCdEf'],
      ['replace', '/'],
    ]);
  });

  it('the reset is the signed-out reset: one (tabs) route whose only history is Home’s index', () => {
    expect(HOME_ONLY_RESET).toBe(SIGNED_OUT_HOME_RESET);
    expect(HOME_ONLY_RESET).toEqual({
      type: 'RESET',
      payload: {
        index: 0,
        routes: [{ name: '(tabs)', state: { index: 0, routes: [{ name: '(home)', state: { index: 0, routes: [{ name: 'index' }] } }] } }],
      },
    });
  });
});

describe('verify-email’s terminal hop', () => {
  it('native: verified with a profile → Home only, the destination pushed', async () => {
    const { default: VerifyEmail } = await import('../app/verify-email');
    act(() => root.render(<VerifyEmail />));
    await settle();
    press('wsf-verify-check');
    await settle();
    expect(ctl.calls).toEqual([
      ['dispatch', HOME_ONLY_RESET],
      ['push', '/join/AbCdEf'],
    ]);
  });

  it('web: replace, as before', async () => {
    ctl.os = 'web';
    const { default: VerifyEmail } = await import('../app/verify-email');
    act(() => root.render(<VerifyEmail />));
    await settle();
    press('wsf-verify-check');
    await settle();
    expect(ctl.calls).toEqual([['replace', '/join/AbCdEf']]);
  });

  it('the /profile-setup gate keeps replace on every platform', async () => {
    ctl.profileExists = false;
    const { default: VerifyEmail } = await import('../app/verify-email');
    act(() => root.render(<VerifyEmail />));
    await settle();
    press('wsf-verify-check');
    await settle();
    expect(ctl.calls).toEqual([['replace', '/profile-setup']]);
  });
});

describe('profile-setup’s terminal hops', () => {
  it('native: an existing profile → Home only (nothing pushed for Home)', async () => {
    USER.emailVerified = true;
    ctl.next = '/';
    const { default: ProfileSetup } = await import('../app/profile-setup');
    act(() => root.render(<ProfileSetup />));
    await settle();
    expect(ctl.calls).toEqual([['dispatch', HOME_ONLY_RESET]]);
  });

  it('web: an existing profile → replace, as before', async () => {
    ctl.os = 'web';
    USER.emailVerified = true;
    const { default: ProfileSetup } = await import('../app/profile-setup');
    act(() => root.render(<ProfileSetup />));
    await settle();
    expect(ctl.calls).toEqual([['replace', '/join/AbCdEf']]);
  });

  it('both terminal hops land through landAfterAuth; the sign-out hop keeps replace', () => {
    const src = readFileSync(nodePath.resolve(__dirname, '../app/profile-setup.tsx'), 'utf8');
    expect(src.match(/land\(/g)?.length).toBe(2);
    expect(src).toMatch(/land\(await routeAfterAuth\('\/', user\.uid\)\)/);
    expect(src).not.toMatch(/router\.replace\(\(?(next|await routeAfterAuth)/);
    expect(src).toMatch(/router\.replace\('\/signin' as never\)/);
  });
});

describe('Progress → MOVE', () => {
  for (const os of ['ios', 'android'] as const) {
    it(`${os}: MOVE is pushed over Progress, so closing it comes back here`, async () => {
      ctl.os = os;
      const { default: ActivityScreen } = await import('../app/(tabs)/activity');
      act(() => root.render(<ActivityScreen />));
      await settle();
      press('wsf-activity-start');
      expect(ctl.calls).toEqual([['push', '/move']]);
    });
  }

  it('web: replace, as before', async () => {
    ctl.os = 'web';
    const { default: ActivityScreen } = await import('../app/(tabs)/activity');
    act(() => root.render(<ActivityScreen />));
    await settle();
    press('wsf-activity-start');
    expect(ctl.calls).toEqual([['replace', '/move']]);
  });
});
