import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INT-29 (W12-14) — "Sign in" from the contribution sheet on a phone closes
 * everything above the tabs and pushes /signin as a page (src/ui/SignInLink);
 * a page, a kiosk and the web keep the ButtonLink, an anchor to /signin on
 * the web. The real contribution screen, signed out, as a sheet over the
 * member's tabs (move mode) or as a page; Platform.OS is switchable.
 */

const ctl = vi.hoisted(() => ({
  os: 'ios' as 'ios' | 'android' | 'web',
  calls: [] as string[],
  params: { goalId: 'g1', mode: 'move' } as Record<string, string>,
  overTabs: true,
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
  const navigation = {
    dispatch: () => ctl.calls.push('dispatch'),
    isFocused: () => true,
    addListener: () => () => undefined,
    setOptions: () => undefined,
    getState: () =>
      ctl.overTabs
        ? { index: 1, routes: [{ key: 't', name: '(tabs)' }, { key: 'c', name: 'contribute/[goalId]', params: ctl.params }] }
        : { index: 0, routes: [{ key: 'c', name: 'contribute/[goalId]', params: ctl.params }] },
  };
  const router = {
    back: () => ctl.calls.push('back'),
    canGoBack: () => true,
    replace: (h: string) => ctl.calls.push(`replace ${h}`),
    push: (h: string) => ctl.calls.push(`push ${h}`),
    dismissAll: () => ctl.calls.push('dismissAll'),
    dismissTo: (h: string) => ctl.calls.push(`dismissTo ${h}`),
    navigate: (h: string) => ctl.calls.push(`navigate ${h}`),
  };
  return {
    router,
    useRouter: () => router,
    useNavigation: () => navigation,
    usePathname: () => '/contribute/g1',
    useLocalSearchParams: () => ctl.params,
    useFocusEffect: () => undefined,
    // The anchor a Link renders on the web, carrying its href.
    Link: ({ href, children }: { href: string; children?: ReactNode }) => React.createElement('a', { href, 'data-link': '1' }, children),
  };
});
vi.mock('../src/ui/useReducedMotion', () => ({
  useReducedMotionPreference: () => ({ reduced: true, known: true, failed: false }),
  useReducedMotion: () => true,
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 0, bottom: 0, left: 0, right: 0 }, frame: { x: 0, y: 0, width: 390, height: 844 } },
}));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/ui/useScreenTopInset', () => ({ useScreenTopInset: () => 0, ScreenTopSpacer: () => null, ScreenStatusBar: () => null }));
vi.mock('../src/ui/LivingWeProgress', () => ({ LivingWeProgress: () => null }));
vi.mock('../src/ui/TogetherCompletion', () => ({ TogetherCompletion: () => null }));
vi.mock('../src/firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: null }),
  getFirebaseFirestore: () => ({}),
  getFirebaseFunctions: () => ({}),
  wsfUsingEmulators: false,
  wsfIsStaging: false,
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(), onAuthStateChanged: () => () => undefined }));
// Signed out: the screen's sign-in gate.
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: null, slow: false }) }));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => async () => {
    throw Object.assign(new Error('unauthenticated'), { code: 'functions/unauthenticated' });
  },
}));

import { SignInLink } from '../src/ui/SignInLink';

const { default: ContributeToGoal } = await import('../app/contribute/[goalId]');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await act(async () => undefined);
};

beforeEach(() => {
  ctl.os = 'ios';
  ctl.calls = [];
  ctl.params = { goalId: 'g1', mode: 'move' };
  ctl.overTabs = true;
  localStorage.clear();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const anchorOf = (testID: string) => byId(testID)?.closest('a[data-link]') as HTMLAnchorElement | null;

describe('SignInLink', () => {
  const show = (fromSheet: boolean, testID: string) =>
    act(() => root.render(<SignInLink fromSheet={fromSheet} style={{}} textStyle={{}} testID={testID} label="Sign in" />));

  for (const testID of ['wsf-contribute-signin-link', 'wsf-contribute-back']) {
    it(`iOS and Android, from a sheet (${testID}): dismissAll, then push /signin, in that order`, () => {
      for (const os of ['ios', 'android'] as const) {
        ctl.os = os;
        ctl.calls = [];
        show(true, testID);
        expect(anchorOf(testID)).toBeNull();
        expect(byId(testID)!.textContent).toBe('Sign in');
        act(() => byId(testID)!.click());
        expect(ctl.calls).toEqual(['dismissAll', 'push /signin']);
      }
    });

    it(`a page on a phone, and the web from a sheet (${testID}): the ButtonLink, an anchor to /signin`, () => {
      for (const [os, fromSheet] of [
        ['ios', false],
        ['web', true],
        ['web', false],
      ] as const) {
        ctl.os = os;
        show(fromSheet, testID);
        expect(anchorOf(testID)!.getAttribute('href')).toBe('/signin');
        expect(byId(testID)!.textContent).toBe('Sign in');
      }
      expect(ctl.calls).toEqual([]);
    });
  }
});

describe('the contribution screen, signed out', () => {
  it('iOS, as the sheet over the tabs: Sign in closes the sheet and pushes /signin', async () => {
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(byId('wsf-contribute-signed-out')).not.toBeNull();
    expect(anchorOf('wsf-contribute-signin-link')).toBeNull();
    act(() => byId('wsf-contribute-signin-link')!.click());
    expect(ctl.calls.filter((c) => c === 'dismissAll' || c.startsWith('push'))).toEqual(['dismissAll', 'push /signin']);
  });

  it('iOS, as a page (a cold link, nothing beneath): the anchor to /signin, as before', async () => {
    ctl.params = { goalId: 'g1' };
    ctl.overTabs = false;
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(anchorOf('wsf-contribute-signin-link')!.getAttribute('href')).toBe('/signin');
  });

  it('web, as the sheet: the anchor to /signin, as before', async () => {
    ctl.os = 'web';
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(anchorOf('wsf-contribute-signin-link')!.getAttribute('href')).toBe('/signin');
  });

  it('the signed-out refusal’s Sign in is the same SignInLink, from the sheet only', () => {
    const src = readFileSync(nodePath.resolve(__dirname, '../app/contribute/[goalId].tsx'), 'utf8');
    expect(src.match(/<SignInLink\s+fromSheet=\{asSheet\}/g)?.length).toBe(2);
    expect(src).toMatch(/<SignInLink\s+fromSheet=\{asSheet\}[\s\S]{0,200}testID="wsf-contribute-back"/);
    expect(src).not.toMatch(/presentation:\s*'card'/);
  });
});
