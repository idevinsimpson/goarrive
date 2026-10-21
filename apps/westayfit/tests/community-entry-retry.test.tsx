import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppState } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-INTEGRATOR-1 (INT-04 case 3, INT-12 cases 1 and 3): Community Home's
 * entry error offers Try again, which re-runs the entry read on this same
 * screen (no navigation, so one Home stack entry), and a return to the app
 * re-reads quietly. The route is rendered into jsdom with Firestore and the
 * member reads mocked at the module boundary. No device.
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
const getDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => `${col}/${id}`,
  getDoc: (path: string) => getDoc(path),
}));
// Every other callable on the page is enrichment: it fails here, as offline.
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => Promise.reject(Object.assign(new Error('internal'), { code: 'functions/internal' })),
}));
vi.mock('../src/firebase', () => ({ getFirebaseFirestore: () => ({}), getFirebaseFunctions: () => ({}) }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
const USER = { uid: 'u1', email: 'member@example.com', displayName: 'Member' };
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: USER }) }));
vi.mock('../src/currentCommunity', () => ({
  rememberCurrentCommunity: vi.fn(),
  resolveCurrentCommunity: () => null,
}));
const readGoals = vi.fn();
const readMyCommunities = vi.fn();
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  forgetCommunity: vi.fn(),
  peekMyCommunities: () => undefined,
  readGoals: (...a: unknown[]) => readGoals(...a),
  readMyCommunities: (...a: unknown[]) => readMyCommunities(...a),
  readOwnCredit: () => Promise.reject(new Error('offline')),
}));

const { default: CommunityPage } = await import('../app/(tabs)/(home)/community/[groupId]/index');

const OFFLINE = Object.assign(new Error('Failed to get document because the client is offline.'), { code: 'unavailable' });
const snap = (data: Record<string, unknown> | null) => ({ exists: () => data !== null, data: () => data ?? undefined });
const MEMBERSHIP = snap({ role: 'member', membershipStatus: 'active', userId: 'u1' });
const GROUP = snap({ displayName: 'Oak Grove Together', groupType: 'custom', joinPolicy: 'private', joinCode: 'k'.repeat(22), isSample: false });

let container: HTMLDivElement;
let root: Root;
let appStateHandlers: Array<(s: string) => void>;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await act(async () => undefined);
};

beforeEach(() => {
  getDoc.mockReset();
  readGoals.mockReset();
  readGoals.mockResolvedValue({ goals: [] });
  readMyCommunities.mockReset();
  readMyCommunities.mockResolvedValue({
    items: [{ groupId: 'oak', displayName: 'Oak Grove Together', memberCount: 3, isSample: false, activeChallenge: null }],
  });
  Object.values(router).forEach((f) => f.mockReset());
  appStateHandlers = [];
  vi.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, h: (s: string) => void) => {
    appStateHandlers.push(h);
    return { remove: () => (appStateHandlers = appStateHandlers.filter((x) => x !== h)) };
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

describe('Community Home entry (INT-04)', () => {
  it('the entry error offers Try again, and keeps Back to home', async () => {
    getDoc.mockRejectedValue(OFFLINE);
    act(() => root.render(<CommunityPage />));
    await settle();
    expect(byId('wsf-community-error')).not.toBeNull();
    expect(byId('wsf-community-error-retry')!.textContent).toBe('Try again');
    expect(byId('wsf-community-error-home')).not.toBeNull();
  });

  it('case 3: Try again re-runs the entry read in place and the page loads, with no navigation', async () => {
    getDoc.mockRejectedValueOnce(OFFLINE);
    act(() => root.render(<CommunityPage />));
    await settle();
    expect(byId('wsf-community-error')).not.toBeNull();
    getDoc.mockImplementation(async (path: string) => (path.startsWith('wsfMemberships/') ? MEMBERSHIP : GROUP));
    await act(async () => byId('wsf-community-error-retry')!.click());
    await settle();
    expect(byId('wsf-community-error')).toBeNull();
    expect(container.textContent).toContain('Oak Grove Together');
    // The same screen loaded where it stood: nothing was pushed or replaced.
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(getDoc.mock.calls.map((c) => c[0])).toEqual(['wsfMemberships/oak_u1', 'wsfMemberships/oak_u1', 'wsfCommunityGroups/oak']);
  });

  it('case 3 with the goal list blocked too: one Try again loads the goals as well (SH-1)', async () => {
    // firestore.googleapis.com AND cloudfunctions.net blocked: the entry read
    // and the goal list both fail on the first load, then the network returns.
    getDoc.mockRejectedValueOnce(OFFLINE);
    readGoals.mockRejectedValueOnce(Object.assign(new Error('internal'), { code: 'functions/unavailable' }));
    act(() => root.render(<CommunityPage />));
    await settle();
    expect(byId('wsf-community-error')).not.toBeNull();
    expect(readGoals).toHaveBeenCalledTimes(1);
    getDoc.mockImplementation(async (path: string) => (path.startsWith('wsfMemberships/') ? MEMBERSHIP : GROUP));
    await act(async () => byId('wsf-community-error-retry')!.click());
    await settle();
    expect(byId('wsf-community-error')).toBeNull();
    expect(container.textContent).toContain('Oak Grove Together');
    expect(byId('wsf-community-goals-error')).toBeNull();
    // The goal list was read again, fresh (reuse 0), on the same tap.
    expect(readGoals).toHaveBeenCalledTimes(2);
    expect(readGoals.mock.calls[1][2]).toBe(0);
  });

  it('INT-26: the retried entry read is fresh, never joining a read that may hang (SH-5)', async () => {
    getDoc.mockRejectedValueOnce(OFFLINE);
    act(() => root.render(<CommunityPage />));
    await settle();
    getDoc.mockImplementation(async (path: string) => (path.startsWith('wsfMemberships/') ? MEMBERSHIP : GROUP));
    await act(async () => byId('wsf-community-error-retry')!.click());
    await settle();
    expect(container.textContent).toContain('Oak Grove Together');
    // The first load never reached it (the membership read failed); the retry asks fresh.
    expect(readMyCommunities.mock.calls.map((c) => c[1])).toEqual([0]);
  });

  it('a first load shares the same-load answer (reuse SAME_LOAD_MS)', async () => {
    getDoc.mockImplementation(async (path: string) => (path.startsWith('wsfMemberships/') ? MEMBERSHIP : GROUP));
    act(() => root.render(<CommunityPage />));
    await settle();
    expect(container.textContent).toContain('Oak Grove Together');
    expect(readMyCommunities.mock.calls.map((c) => c[1])).toEqual([10_000]);
    expect(readGoals.mock.calls.map((c) => c[2])).toEqual([10_000]);
  });

  it('still offline: Try again tries again and says so again', async () => {
    getDoc.mockRejectedValue(OFFLINE);
    act(() => root.render(<CommunityPage />));
    await settle();
    await act(async () => byId('wsf-community-error-retry')!.click());
    await settle();
    expect(byId('wsf-community-error')).not.toBeNull();
    expect(getDoc).toHaveBeenCalledTimes(2);
  });

  it('INT-12 case 3: back in the app after removal from the community, the page moves to not-member', async () => {
    getDoc.mockImplementation(async (path: string) => (path.startsWith('wsfMemberships/') ? MEMBERSHIP : GROUP));
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    act(() => root.render(<CommunityPage />));
    await settle();
    expect(container.textContent).toContain('Oak Grove Together');
    // Removed while the app was in the background.
    getDoc.mockImplementation(async (path: string) =>
      path.startsWith('wsfMemberships/') ? snap({ role: 'member', membershipStatus: 'removed', userId: 'u1' }) : GROUP,
    );
    act(() => appStateHandlers.forEach((h) => h('background')));
    act(() => vi.advanceTimersByTime(90_000));
    act(() => appStateHandlers.forEach((h) => h('active')));
    await act(async () => vi.advanceTimersByTime(1_000));
    vi.useRealTimers();
    await settle();
    expect(byId('wsf-community-not-member')).not.toBeNull();
  });

  it('an entry stuck loading (a read hung under packet loss) is retried on any return to the app (#641 SH-5c)', async () => {
    getDoc.mockReturnValueOnce(new Promise(() => undefined));
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    act(() => root.render(<CommunityPage />));
    await settle();
    expect(container.textContent).not.toContain('Oak Grove Together');
    getDoc.mockImplementation(async (path: string) => (path.startsWith('wsfMemberships/') ? MEMBERSHIP : GROUP));
    act(() => appStateHandlers.forEach((h) => h('background')));
    act(() => vi.advanceTimersByTime(2_000));
    act(() => appStateHandlers.forEach((h) => h('active')));
    await act(async () => vi.advanceTimersByTime(1_000));
    vi.useRealTimers();
    await settle();
    expect(byId('wsf-community-error')).toBeNull();
    expect(container.textContent).toContain('Oak Grove Together');
  });

  it('INT-04 with INT-12: an entry error is retried when the member comes back to the app', async () => {
    getDoc.mockRejectedValueOnce(OFFLINE);
    readGoals.mockRejectedValueOnce(Object.assign(new Error('internal'), { code: 'functions/unavailable' }));
    vi.useFakeTimers({ now: 1_000_000, toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    act(() => root.render(<CommunityPage />));
    await settle();
    expect(byId('wsf-community-error')).not.toBeNull();
    getDoc.mockImplementation(async (path: string) => (path.startsWith('wsfMemberships/') ? MEMBERSHIP : GROUP));
    act(() => appStateHandlers.forEach((h) => h('background')));
    act(() => vi.advanceTimersByTime(2_000));
    act(() => appStateHandlers.forEach((h) => h('active')));
    await act(async () => vi.advanceTimersByTime(1_000));
    vi.useRealTimers();
    await settle();
    expect(byId('wsf-community-error')).toBeNull();
    expect(container.textContent).toContain('Oak Grove Together');
    // The goal list that failed with it is read again on the same return.
    expect(byId('wsf-community-goals-error')).toBeNull();
    expect(readGoals).toHaveBeenCalledTimes(2);
  });
});
