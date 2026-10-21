import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppState } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * RV15-641-3 (W12-6, INT-12): the momentum rows a member actually sees are
 * Community Home's (HomeMomentumRow), and their "3m ago" now moves on with
 * the shared 60 s tick (useNowTick) while the page is open, and catches up
 * on the return to the app. The route renders in jsdom with Firestore, the
 * member reads and the callables mocked at the module boundary, as in
 * community-entry-retry; fake timers drive the clock. No device.
 */
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), navigate: vi.fn() };
vi.mock('expo-router', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  useLocalSearchParams: () => ({ groupId: 'oak' }),
  useRouter: () => router,
  router,
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
}));
const snap = (data: Record<string, unknown> | null) => ({ exists: () => data !== null, data: () => data ?? undefined });
const MEMBERSHIP = snap({ role: 'member', membershipStatus: 'active', userId: 'u1' });
const GROUP = snap({ displayName: 'Oak Grove Together', groupType: 'custom', joinPolicy: 'private', joinCode: 'k'.repeat(22), isSample: false });
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => `${col}/${id}`,
  getDoc: async (path: string) => (path.startsWith('wsfMemberships/') ? MEMBERSHIP : GROUP),
}));
const T0 = Date.UTC(2026, 9, 21, 12, 0, 0);
const ROW = { displayName: 'Sam Lee', amount: 25, unit: 'squats', at: new Date(T0 - 10_000).toISOString() };
// The activity read answers; every other callable is enrichment and fails here, as offline.
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => () =>
    name === 'wsfCommunityActivity'
      ? Promise.resolve({ data: { entries: [ROW], contributorsToday: 1, nextCursor: null } })
      : Promise.reject(Object.assign(new Error('internal'), { code: 'functions/internal' })),
}));
vi.mock('../src/firebase', () => ({ getFirebaseFirestore: () => ({}), getFirebaseFunctions: () => ({}) }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
const USER = { uid: 'u1', email: 'member@example.com', displayName: 'Member' };
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: USER }) }));
vi.mock('../src/currentCommunity', () => ({
  rememberCurrentCommunity: vi.fn(),
  resolveCurrentCommunity: () => null,
}));
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  forgetCommunity: vi.fn(),
  peekMyCommunities: () => undefined,
  readGoals: async () => ({ goals: [] }),
  readMyCommunities: async () => ({
    items: [{ groupId: 'oak', displayName: 'Oak Grove Together', memberCount: 3, isSample: false, activeChallenge: null }],
  }),
  readOwnCredit: () => Promise.reject(new Error('offline')),
}));

const { default: CommunityPage } = await import('../app/(tabs)/(home)/community/[groupId]/index');

let container: HTMLDivElement;
let root: Root;
let appHandlers: Array<(s: string) => void>;
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await act(async () => undefined);
};
const rows = () => Array.from(container.querySelectorAll('[data-testid="wsf-momentum-row"]')).map((r) => r.textContent ?? '');
const setApp = (state: string) => act(() => appHandlers.slice().forEach((h) => h(state)));

beforeEach(() => {
  vi.useFakeTimers({ now: T0, toFake: ['Date', 'setInterval', 'clearInterval'] });
  appHandlers = [];
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  vi.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, h: (s: string) => void) => {
    appHandlers.push(h);
    return { remove: () => (appHandlers = appHandlers.filter((x) => x !== h)) };
  }) as never);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('RV15-641-3: Community Home\'s momentum rows move on while the page is open', () => {
  it('"just now", then "1m ago" and "3m ago" as the minutes pass, with nothing re-read', async () => {
    act(() => root.render(<CommunityPage />));
    await settle();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toContain('added 25 squats · just now');
    act(() => vi.advanceTimersByTime(60_000));
    expect(rows()[0]).toContain('· 1m ago');
    act(() => vi.advanceTimersByTime(2 * 60_000));
    expect(rows()[0]).toContain('· 3m ago');
  });

  it('in the background the label holds; on the return it catches up at once', async () => {
    act(() => root.render(<CommunityPage />));
    await settle();
    setApp('background');
    act(() => vi.advanceTimersByTime(10 * 60_000));
    expect(rows()[0]).toContain('· just now');
    setApp('active');
    expect(rows()[0]).toContain('· 10m ago');
  });
});
