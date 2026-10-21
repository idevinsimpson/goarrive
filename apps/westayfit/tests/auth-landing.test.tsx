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
 *
 * RV12-641-F1: never the Home reset for a kiosk destination. A visitor signing
 * in at a kiosk returns to /contribute/<goal>?kiosk=1 with the kiosk's start
 * screen kept beneath: popped back to it and the contribution pushed when the
 * caller can see the stack (RV13-641-N2), replaced otherwise; proved below
 * against React Navigation's own StackRouter, the one the root Stack runs.
 */

const ctl = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'android' | 'web',
  calls: [] as Array<[string, unknown]>,
  next: '/join/AbCdEf',
  profileExists: true,
  verifiedAfterReload: true,
  /** The root stack's state as the screen's navigation object reports it. */
  rootState: undefined as undefined | { routes: Array<{ name: string; params?: object }> },
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
  const navigation = { dispatch: (a: unknown) => ctl.calls.push(['dispatch', a]), getState: () => ctl.rootState };
  return {
    router: {
      replace: (href: string) => ctl.calls.push(['replace', href]),
      push: (href: string) => ctl.calls.push(['push', href]),
      dismissTo: (href: string) => ctl.calls.push(['dismissTo', href]),
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

import { CommonActions, StackActions, StackRouter } from '@react-navigation/routers';

import { kioskContributeRoute, kioskStartRoute } from '../src/kioskSession';
import { HOME_ONLY_RESET, isKioskDestination, landAfterAuth } from '../src/ui/authLanding';
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
  ctl.rootState = undefined;
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

describe('RV12-641-F1: a kiosk destination is never reset to Home', () => {
  const deps = () => ({
    dispatch: (a: unknown) => ctl.calls.push(['dispatch', a]),
    push: (h: string) => ctl.calls.push(['push', h]),
    replace: (h: string) => ctl.calls.push(['replace', h]),
  });
  const KIOSK = kioskContributeRoute('g1');

  it('the kiosk routes, and the kiosk flag by the one rule (isKioskFlag), are kiosk destinations', () => {
    for (const next of [
      KIOSK,
      kioskStartRoute('g1'),
      '/kiosk/g1?x=1',
      '/contribute/g1?mode=move&kiosk=1',
      '/contribute/g1?kiosk=1&mode=move',
      '/contribute/g1?kiosk=true',
      '/contribute/g1?kiosk=0&kiosk=1',
      '/contribute/g1?kiosk=1#top',
      '/contribute/g1?%6Biosk=1',
    ]) {
      expect([next, isKioskDestination(next)]).toEqual([next, true]);
    }
    for (const next of [
      '/',
      '/join/AbCdEf',
      '/contribute/g1',
      '/contribute/g1?kiosk=0',
      '/contribute/g1?kiosk=10',
      '/contribute/g1?kiosk=',
      '/contribute/g1?kiosk',
      '/contribute/g1?notkiosk=1',
      '/contribute/g1?mode=kiosk',
      '/contribute/kiosk=1',
      '/contribute/g1#kiosk=1',
      '/kioskish',
      '/community/kiosk',
    ]) {
      expect([next, isKioskDestination(next)]).toEqual([next, false]);
    }
  });

  it('native: a kiosk destination is replaced, exactly as on the web; HOME_ONLY_RESET is never dispatched', () => {
    for (const platform of ['ios', 'android', 'web']) {
      for (const next of [KIOSK, '/contribute/g1?mode=move&kiosk=1', kioskStartRoute('g1')]) {
        ctl.calls = [];
        landAfterAuth(next, { ...deps(), platform });
        expect([platform, ctl.calls]).toEqual([platform, [['replace', next]]]);
      }
    }
  });

  it('RV13-641-N2, native: the kiosk’s start screen nearest beneath → dismissTo it, then push the contribution; never a reset', () => {
    const beneath = (routes: Array<{ name: string; params?: object }>) => () => routes;
    const withStack = (routes: Array<{ name: string; params?: object }>) => ({
      ...deps(),
      routes: beneath(routes),
      dismissTo: (h: string) => ctl.calls.push(['dismissTo', h]),
    });
    const ACCOUNT_CREATION = [{ name: '(tabs)' }, { name: 'kiosk/[goalId]', params: { goalId: 'g1' } }, { name: 'signin' }, { name: 'verify-email' }];
    for (const platform of ['ios', 'android']) {
      ctl.calls = [];
      landAfterAuth(KIOSK, { ...withStack(ACCOUNT_CREATION), platform });
      expect([platform, ctl.calls]).toEqual([platform, [['dismissTo', '/kiosk/g1'], ['push', KIOSK]]]);
      // The start screen itself is only dismissed to.
      ctl.calls = [];
      landAfterAuth(kioskStartRoute('g1'), { ...withStack(ACCOUNT_CREATION), platform });
      expect(ctl.calls).toEqual([['dismissTo', '/kiosk/g1']]);
    }
    // Replaced, as before: no kiosk beneath; another goal's kiosk nearer; a caller without the stack; the web.
    const cases: Array<[string, Parameters<typeof landAfterAuth>[1]]> = [
      ['no kiosk beneath', { ...withStack([{ name: '(tabs)' }, { name: 'signin' }, { name: 'verify-email' }]), platform: 'ios' }],
      [
        'another goal’s kiosk nearer',
        { ...withStack([{ name: 'kiosk/[goalId]', params: { goalId: 'g1' } }, { name: 'kiosk/[goalId]', params: { goalId: 'g2' } }, { name: 'signin' }]), platform: 'android' },
      ],
      ['no dismissTo', { ...deps(), routes: beneath(ACCOUNT_CREATION), platform: 'ios' }],
      ['no routes', { ...deps(), dismissTo: (h: string) => ctl.calls.push(['dismissTo', h]), platform: 'ios' }],
      ['the web', { ...withStack(ACCOUNT_CREATION), platform: 'web' }],
    ];
    for (const [name, d] of cases) {
      ctl.calls = [];
      landAfterAuth(KIOSK, d);
      expect([name, ctl.calls]).toEqual([name, [['replace', KIOSK]]]);
    }
  });

  // The root Stack, run by React Navigation's own StackRouter. `replace`,
  // `push` and `dismissTo` are what expo-router dispatches to it for these
  // hrefs: REPLACE, PUSH and POP_TO addressed to the root Stack, with the
  // route's name and params.
  const ROOT_ROUTES = ['(tabs)', 'kiosk/[goalId]', 'contribute/[goalId]', 'join/[joinCode]', 'signin', 'signup', 'verify-email', 'profile-setup'];
  const opts = { routeNames: ROOT_ROUTES, routeParamList: {}, routeGetIdList: {} };
  type R = { name: string; params?: Record<string, string> };
  const routeFor = (href: string): R => {
    const [path, query = ''] = href.split('?');
    const params = Object.fromEntries(new URLSearchParams(query));
    const m = /^\/(kiosk|contribute|join)\/([^/]+)$/.exec(path!);
    if (m) {
      const [, base, id] = m;
      const key = base === 'join' ? 'joinCode' : 'goalId';
      return { name: `${base}/[${key}]`, params: { [key]: id!, ...params } };
    }
    throw new Error(`no root route for ${href}`);
  };
  const stackAfterLanding = (start: R[], next: string, platform: string, callerSeesStack = true) => {
    const router = StackRouter({});
    let state = router.getRehydratedState({ routes: start, index: start.length - 1 } as never, opts);
    const apply = (action: unknown) => {
      const after = router.getStateForAction(state, action as never, opts);
      expect(after).not.toBeNull();
      // RESET hands back a partial state; the stack rehydrates it, as useNavigationBuilder does.
      state = router.getRehydratedState(after as never, opts);
    };
    landAfterAuth(next, {
      dispatch: apply,
      push: (href) => {
        const r = routeFor(href);
        apply(StackActions.push(r.name, r.params));
      },
      replace: (href) => {
        const r = routeFor(href);
        apply(StackActions.replace(r.name, r.params));
      },
      platform,
      ...(callerSeesStack
        ? {
            routes: () => state.routes,
            dismissTo: (href: string) => {
              const r = routeFor(href);
              apply(StackActions.popTo(r.name, r.params));
            },
          }
        : {}),
    });
    return { router, state };
  };
  const top = (state: { routes: Array<{ name: string; params?: object }>; index: number }) => state.routes[state.index]!;
  /** Back, again and again, until the kiosk's start screen or nothing: every screen shown on the way. */
  const backUntilKiosk = (router: ReturnType<typeof StackRouter>, from: ReturnType<typeof stackAfterLanding>['state']) => {
    const shown: string[] = [];
    let state = from;
    for (;;) {
      const after = router.getStateForAction(state, CommonActions.goBack() as never, opts);
      if (!after) return shown;
      state = router.getRehydratedState(after as never, opts);
      shown.push(top(state).name);
      if (top(state).name === 'kiosk/[goalId]') return shown;
    }
  };
  const KIOSK_START: R = { name: 'kiosk/[goalId]', params: { goalId: 'g1' } };

  for (const platform of ['ios', 'android']) {
    it(`${platform}: account creation at a kiosk, [(tabs), kiosk, signin, verify-email] → [(tabs), kiosk, contribute?kiosk=1]; one Back is the kiosk (RV13-641-N2)`, () => {
      const start: R[] = [{ name: '(tabs)' }, KIOSK_START, { name: 'signin' }, { name: 'verify-email' }];
      const { router, state } = stackAfterLanding(start, KIOSK, platform);
      expect(top(state)).toMatchObject({ name: 'contribute/[goalId]', params: { goalId: 'g1', kiosk: '1' } });
      expect(state.routes.map((r) => r.name)).toEqual(['(tabs)', 'kiosk/[goalId]', 'contribute/[goalId]']);
      expect(state.routes[1]!.params).toEqual({ goalId: 'g1' });
      // The stale signin is gone: one Back reaches the kiosk, never (tabs).
      const shown = backUntilKiosk(router, state);
      expect(shown).toEqual(['kiosk/[goalId]']);
      expect(shown).not.toContain('(tabs)');
    });

    it(`${platform}: a caller that cannot see the stack (replace only, as before): the reviewer's probe keeps the kiosk beneath; Back never reaches (tabs) first`, () => {
      const start: R[] = [{ name: '(tabs)' }, KIOSK_START, { name: 'signin' }, { name: 'verify-email' }];
      const { router, state } = stackAfterLanding(start, KIOSK, platform, false);
      expect(state.routes.map((r) => r.name)).toEqual(['(tabs)', 'kiosk/[goalId]', 'signin', 'contribute/[goalId]']);
      const shown = backUntilKiosk(router, state);
      expect(shown).toEqual(['signin', 'kiosk/[goalId]']);
      expect(shown).not.toContain('(tabs)');
    });

    it(`${platform}: no kiosk in the stack, or another goal’s nearer → replaced; never reset, never member Home`, () => {
      {
        const { state } = stackAfterLanding([{ name: '(tabs)' }, { name: 'signin' }, { name: 'verify-email' }], KIOSK, platform);
        expect(state.routes.map((r) => r.name)).toEqual(['(tabs)', 'signin', 'contribute/[goalId]']);
      }
      {
        const other: R = { name: 'kiosk/[goalId]', params: { goalId: 'g2' } };
        const { state } = stackAfterLanding([{ name: '(tabs)' }, KIOSK_START, other, { name: 'signin' }, { name: 'verify-email' }], KIOSK, platform);
        expect(state.routes.map((r) => r.name)).toEqual(['(tabs)', 'kiosk/[goalId]', 'kiosk/[goalId]', 'signin', 'contribute/[goalId]']);
        expect(state.routes[2]!.params).toEqual({ goalId: 'g2' });
      }
    });

    it(`${platform}: the kiosk gate's own path (gate replaced by signin, then verify-email or profile-setup): one Back is the kiosk`, () => {
      for (const gate of ['verify-email', 'profile-setup', 'signin']) {
        const start: R[] = [{ name: '(tabs)' }, KIOSK_START, { name: gate }];
        const { router, state } = stackAfterLanding(start, KIOSK, platform);
        expect(state.routes.map((r) => r.name)).toEqual(['(tabs)', 'kiosk/[goalId]', 'contribute/[goalId]']);
        expect(backUntilKiosk(router, state)).toEqual(['kiosk/[goalId]']);
      }
    });

    it(`${platform}: a kiosk launched cold (nothing beneath it) keeps its start screen too`, () => {
      const { router, state } = stackAfterLanding([KIOSK_START, { name: 'verify-email' }], KIOSK, platform);
      expect(state.routes.map((r) => r.name)).toEqual(['kiosk/[goalId]', 'contribute/[goalId]']);
      expect(backUntilKiosk(router, state)).toEqual(['kiosk/[goalId]']);
    });

    it(`${platform}: control — a member destination still gets Home only beneath it (the probe sees the reset)`, () => {
      const start: R[] = [{ name: '(tabs)' }, { name: 'signin' }, { name: 'verify-email' }];
      const { router, state } = stackAfterLanding(start, '/join/AbCdEf', platform);
      expect(state.routes.map((r) => r.name)).toEqual(['(tabs)', 'join/[joinCode]']);
      expect(backUntilKiosk(router, state)).toEqual(['(tabs)']);
    });
  }
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

describe('RV12-641-F1: the kiosk return through the screens, on a phone', () => {
  const ACCOUNT_CREATION = {
    routes: [{ name: '(tabs)' }, { name: 'kiosk/[goalId]', params: { goalId: 'g1' } }, { name: 'signin' }, { name: 'verify-email' }],
  };
  for (const os of ['ios', 'android'] as const) {
    it(`${os}: verify-email, the kiosk beneath (account creation): dismissTo the kiosk, then push the contribution (RV13-641-N2)`, async () => {
      ctl.os = os;
      ctl.next = kioskContributeRoute('g1');
      ctl.rootState = ACCOUNT_CREATION;
      const { default: VerifyEmail } = await import('../app/verify-email');
      act(() => root.render(<VerifyEmail />));
      await settle();
      press('wsf-verify-check');
      await settle();
      expect(ctl.calls).toEqual([
        ['dismissTo', '/kiosk/g1'],
        ['push', '/contribute/g1?kiosk=1'],
      ]);
    });

    it(`${os}: profile-setup, the kiosk beneath: dismissTo the kiosk, then push the contribution (RV13-641-N2)`, async () => {
      ctl.os = os;
      USER.emailVerified = true;
      ctl.next = kioskContributeRoute('g1');
      ctl.rootState = { routes: [...ACCOUNT_CREATION.routes.slice(0, 3), { name: 'profile-setup' }] };
      const { default: ProfileSetup } = await import('../app/profile-setup');
      act(() => root.render(<ProfileSetup />));
      await settle();
      expect(ctl.calls).toEqual([
        ['dismissTo', '/kiosk/g1'],
        ['push', '/contribute/g1?kiosk=1'],
      ]);
    });

    it(`${os}: verify-email replaces itself with the kiosk contribution; no Home reset`, async () => {
      ctl.os = os;
      ctl.next = kioskContributeRoute('g1');
      const { default: VerifyEmail } = await import('../app/verify-email');
      act(() => root.render(<VerifyEmail />));
      await settle();
      press('wsf-verify-check');
      await settle();
      expect(ctl.calls).toEqual([['replace', '/contribute/g1?kiosk=1']]);
    });

    it(`${os}: profile-setup (an existing profile) replaces itself with the kiosk contribution; no Home reset`, async () => {
      ctl.os = os;
      USER.emailVerified = true;
      ctl.next = kioskContributeRoute('g1');
      const { default: ProfileSetup } = await import('../app/profile-setup');
      act(() => root.render(<ProfileSetup />));
      await settle();
      expect(ctl.calls).toEqual([['replace', '/contribute/g1?kiosk=1']]);
    });
  }
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
