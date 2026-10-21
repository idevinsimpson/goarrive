import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppState, Dimensions, Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { formatConfirmedAt } from '../src/ui/dates';

/**
 * RV15-641-2 (W12-6, INT-12): contribute's "Confirmed <time>" line. With the
 * screen left open it is re-read every minute (the shared tick), so it names
 * the day once midnight has passed; once the 2 s poll has landed nothing for
 * a while (failing or hung) it reads "Last confirmed"; a return to the app
 * does not read as stale before its first tick could land. On iOS and on the
 * web. The route renders in jsdom with the callables mocked at the network
 * boundary; fake Date and intervals drive the clock. No device.
 */
const params = { value: { goalId: 'g1' } as Record<string, string> };
const router = { replace: vi.fn(), push: vi.fn(), back: vi.fn(), canGoBack: () => true, dismissTo: vi.fn(), navigate: vi.fn() };
vi.mock('expo-router', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  router,
  useRouter: () => router,
  useNavigation: () => ({
    dispatch: vi.fn(),
    isFocused: () => true,
    addListener: () => () => undefined,
    setOptions: vi.fn(),
    getState: () => ({ index: 1, routes: [{ key: 't', name: '(tabs)' }, { key: 'c', name: 'contribute/[goalId]' }] }),
  }),
  usePathname: () => '/contribute/g1',
  useLocalSearchParams: () => params.value,
  useFocusEffect: () => undefined,
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 0, bottom: 0, left: 0, right: 0 }, frame: { x: 0, y: 0, width: 390, height: 844 } },
}));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/ui/useScreenTopInset', () => ({ useScreenTopInset: () => 0, ScreenTopSpacer: () => null, ScreenStatusBar: () => null }));
vi.mock('../src/ui/useReducedMotion', () => ({
  useReducedMotion: () => true,
  useReducedMotionPreference: () => ({ known: true, reduced: true, failed: false }),
}));
vi.mock('../src/firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: { uid: 'u1', getIdToken: async () => 't' } }),
  getFirebaseFirestore: () => ({}),
  getFirebaseFunctions: () => ({}),
  wsfUsingEmulators: false,
  wsfIsStaging: false,
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(), onAuthStateChanged: () => () => undefined }));
const USER = { uid: 'u1', email: 'member@example.com', displayName: 'Member', emailVerified: true };
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: USER, slow: false }) }));
const answers: Record<string, () => Promise<unknown>> = {};
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => async () => {
    const answer = answers[name];
    if (!answer) throw Object.assign(new Error('internal'), { code: 'functions/internal' });
    return { data: await answer() };
  },
}));

const { clearMemberReads } = await import('../src/memberReads');
const { default: ContributeToGoal } = await import('../app/contribute/[goalId]');

const PULSE = { sharedTotal: 1240, target: 5000, unit: 'squats', status: 'active' };
const MINE = { ownCredit: 125, unit: 'squats', repeatPolicy: 'multiple' };
const OFFLINE = () => Promise.reject(Object.assign(new Error('internal'), { code: 'functions/internal' }));
/** 11:58 PM on Oct 20 in the reader's own zone: eight minutes later it is another day. */
const LATE = new Date(2026, 9, 20, 23, 58, 0).getTime();

let container: HTMLDivElement;
let root: Root;
let os: string;
let appHandlers: Array<(s: string) => void>;
const line = () => container.querySelector('[data-testid="wsf-contribute-context-updated"]')?.textContent ?? null;
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await act(async () => undefined);
};
const pass = async (ms: number) => {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
  await settle();
};
const typeInto = (el: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const setApp = async (state: string) => {
  Object.defineProperty(AppState, 'currentState', { value: state, configurable: true });
  act(() => appHandlers.slice().forEach((h) => h(state)));
  await settle();
};

beforeEach(() => {
  os = Platform.OS;
  vi.useFakeTimers({ now: LATE, toFake: ['Date', 'setInterval', 'clearInterval'] });
  params.value = { goalId: 'g1' };
  clearMemberReads();
  localStorage.clear();
  for (const k of Object.keys(answers)) delete answers[k];
  answers.wsfGoalPulse = async () => PULSE;
  answers.wsfMyContribution = async () => MINE;
  appHandlers = [];
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  vi.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, h: (s: string) => void) => {
    appHandlers.push(h);
    return { remove: () => (appHandlers = appHandlers.filter((x) => x !== h)) };
  }) as never);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  // A phone-height window: the line is left out on a short screen (anchorShort).
  vi.spyOn(Dimensions, 'get').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (Platform as { OS: string }).OS = os;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

for (const platform of ['ios', 'web'] as const) {
  describe(`RV15-641-2 (${platform}): the confirmed line keeps time and says when it is behind`, () => {
    beforeEach(() => {
      (Platform as { OS: string }).OS = platform;
    });

    it('ticks that land: "Confirmed", the time of the last one', async () => {
      act(() => root.render(<ContributeToGoal />));
      await settle();
      const loadedAt = new Date(Date.now());
      expect(line()).toBe(formatConfirmedAt(loadedAt, loadedAt));
      await pass(60_000);
      expect(line()!.startsWith('Confirmed ')).toBe(true);
      expect(line()).toBe(formatConfirmedAt(new Date(Date.now()), new Date(Date.now())));
    });

    it('ticks that fail across midnight: "Last confirmed", naming the day, without any state change', async () => {
      act(() => root.render(<ContributeToGoal />));
      await settle();
      const loadedAt = new Date(Date.now());
      answers.wsfGoalPulse = OFFLINE;
      await pass(8 * 60_000);
      const now = new Date(Date.now());
      expect(line()).toBe(formatConfirmedAt(loadedAt, now, { failed: true }));
      expect(line()!.startsWith('Last confirmed ')).toBe(true);
      // It names the day: the same time read on its own day is shorter.
      expect(line()).not.toBe(formatConfirmedAt(loadedAt, loadedAt, { failed: true }));
      // A tick that lands again: "Confirmed", now.
      answers.wsfGoalPulse = async () => PULSE;
      await pass(2_000);
      expect(line()!.startsWith('Confirmed ')).toBe(true);
    });

    it('ticks that hang: "Last confirmed" too', async () => {
      act(() => root.render(<ContributeToGoal />));
      await settle();
      answers.wsfGoalPulse = () => new Promise(() => undefined);
      await pass(60_000);
      expect(line()!.startsWith('Last confirmed ')).toBe(true);
    });

    it('back in the app: no "Last confirmed" before the first tick could land; then it says so if the ticks fail', async () => {
      act(() => root.render(<ContributeToGoal />));
      await settle();
      await setApp('background');
      await pass(5 * 60_000);
      // Every text the line shows from here on, including one that a later commit replaced.
      const shown: string[] = [];
      const observer = new MutationObserver((records) => {
        for (const r of records) {
          if (r.type === 'characterData' && r.oldValue) shown.push(r.oldValue);
          for (const n of Array.from(r.removedNodes)) if (n.textContent) shown.push(n.textContent);
        }
      });
      observer.observe(container, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });
      await setApp('active');
      // The screen renders again before the first tick could land (typing a count): still not "Last confirmed".
      act(() => typeInto(container.querySelector('[data-testid="wsf-contribute-entry"]') as HTMLInputElement, '3'));
      await settle();
      await pass(2_000);
      observer.disconnect();
      shown.push(line()!);
      expect(shown.filter((t) => t.includes('onfirmed'))).not.toEqual([]);
      expect(shown.filter((t) => t.startsWith('Last confirmed'))).toEqual([]);
      expect(line()!.startsWith('Confirmed ')).toBe(true);
      answers.wsfGoalPulse = OFFLINE;
      await pass(60_000);
      expect(line()!.startsWith('Last confirmed ')).toBe(true);
    });
  });
}
