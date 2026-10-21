import { act, forwardRef, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppState, Dimensions, Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 heads-9 B-1 (W16-3, INT-18). When a progress refresh fails,
 * Community Home keeps the last confirmed figure and says so: "Couldn’t
 * refresh. This is the last confirmed figure." W16-3 hid the VISIBLE sentence
 * from a phone's screen reader. The only other copy sits in a one-pixel,
 * opacity-0 region that is not live on a phone, and VoiceOver and TalkBack
 * skip it, so a member who interrupted the one announcement could no longer
 * browse to the sentence. Natively it is now the region's copy that is
 * hidden, and the visible sentence stays readable. The web is as before: the
 * polite region reads the sentence, and the visible copy is aria-hidden.
 *
 * The route is rendered whole (react-native-web, jsdom) as a member with one
 * open goal. The figure loads, then a return to the app after 30 s finds the
 * network down, which is the RETURN-CONTINUITY-1 path. Text is wrapped to read
 * the props a phone acts on. No device.
 */

const SENTENCE = 'Couldn’t refresh. This is the last confirmed figure.';
// The props each copy of the sentence was last rendered with: the region's
// Text has no style; the visible one does.
const copies: { region?: Record<string, unknown>; visible?: Record<string, unknown> } = {};
vi.mock('react-native', async (importOriginal) => {
  const rn = await importOriginal<typeof import('react-native')>();
  const Text = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
    if (props.children === SENTENCE) copies[props.style ? 'visible' : 'region'] = props;
    const Real = rn.Text as unknown as (p: Record<string, unknown>) => ReactNode;
    return <Real ref={ref} {...props} />;
  });
  return { ...rn, Text };
});
vi.mock('../src/ui/LivingWeProgress', () => ({ LivingWeProgress: () => null }));
vi.mock('../src/ui/useReducedMotion', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useReducedMotion: () => true,
  useReducedMotionPreference: () => ({ reduced: true, known: true, failed: false }),
}));
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
vi.mock('react-native-safe-area-context', async () => {
  const { createContext } = await import('react');
  return { SafeAreaInsetsContext: createContext(null), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
vi.mock('../src/ui/memberShellActions', () => ({ useMemberShellAction: () => undefined }));
const getDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => `${col}/${id}`,
  getDoc: (path: string) => getDoc(path),
}));
const NOW = Date.UTC(2026, 9, 21, 15, 0, 0);
const PULSE = {
  sharedTotal: 1847,
  target: 5000,
  unit: 'squats',
  status: 'active',
  communityDisplayName: 'Oak Grove Together',
  goalTitle: 'Autumn squats',
  startsAt: new Date(NOW - 86_400_000).toISOString(),
  endsAt: new Date(NOW + 5 * 86_400_000).toISOString(),
  timezone: 'UTC',
};
const net = { down: false };
const offline = () => Promise.reject(Object.assign(new Error('offline'), { code: 'functions/unavailable' }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => () =>
    net.down ? offline() : name === 'wsfGoalPulse' ? Promise.resolve({ data: PULSE }) : offline(),
}));
vi.mock('../src/firebase', () => ({ getFirebaseFirestore: () => ({}), getFirebaseFunctions: () => ({}) }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
const AUTH = { ready: true, user: { uid: 'u1', email: 'm@example.com', displayName: 'M' } };
vi.mock('../src/auth', () => ({ useWsfAuth: () => AUTH }));
vi.mock('../src/currentCommunity', () => ({ rememberCurrentCommunity: vi.fn(), resolveCurrentCommunity: () => null }));
const GOAL = {
  goalId: 'g1',
  title: 'Autumn squats',
  target: 5000,
  unit: 'squats',
  status: 'active',
  startsAt: PULSE.startsAt,
  endsAt: PULSE.endsAt,
  aggregateDisplayAuthorized: false,
  reachedAt: null,
};
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  forgetCommunity: vi.fn(),
  peekMyCommunities: () => undefined,
  readGoals: () => (net.down ? offline() : Promise.resolve({ goals: [GOAL] })),
  readMyCommunities: () =>
    Promise.resolve({ items: [{ groupId: 'oak', displayName: 'Oak Grove Together', memberCount: 4, isSample: false, activeChallenge: null }] }),
  readOwnCredit: () => (net.down ? offline() : Promise.resolve({ ownCredit: 20, unit: 'squats' })),
}));

const { default: CommunityPage } = await import('../app/(tabs)/(home)/community/[groupId]/index');
const { RESUME_MIN_AWAY_MS, RESUME_SETTLE_MS } = await import('../src/useResumeRefresh');

const snap = (data: Record<string, unknown> | null) => ({ exists: () => data !== null, data: () => data ?? undefined });
const MEMBER = snap({ role: 'member', membershipStatus: 'active', userId: 'u1' });
const GROUP = snap({ displayName: 'Oak Grove Together', groupType: 'custom', joinPolicy: 'private', lifecycleStatus: 'active', isSample: false });

const OS = Platform.OS;
let container: HTMLDivElement;
let root: Root;
let appState: Array<(s: string) => void>;
beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  net.down = false;
  delete copies.region;
  delete copies.visible;
  getDoc.mockReset();
  getDoc.mockImplementation(async (path: string) => (path.startsWith('wsfMemberships/') ? MEMBER : GROUP));
  appState = [];
  vi.spyOn(AppState, 'addEventListener').mockImplementation(((_t: string, h: (s: string) => void) => {
    appState.push(h);
    return { remove: () => (appState = appState.filter((x) => x !== h)) };
  }) as never);
  vi.spyOn(Dimensions, 'get').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (Platform as { OS: string }).OS = OS;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
const emit = (s: string) => act(() => appState.forEach((h) => h(s)));

/** Loads the figure, then returns to the app after 30 s with the network down. */
async function failARefresh(platform: 'ios' | 'web'): Promise<void> {
  (Platform as { OS: string }).OS = platform;
  act(() => root.render(<CommunityPage />));
  await flush();
  expect(byId('wsf-community-goal-total-g1')!.textContent).toBe('1,847 of 5,000 squats');
  expect(byId('wsf-community-goal-stale-g1')).toBeNull();
  net.down = true;
  emit('background');
  act(() => vi.advanceTimersByTime(RESUME_MIN_AWAY_MS + 1_000));
  emit('active');
  act(() => vi.advanceTimersByTime(RESUME_SETTLE_MS));
  await flush();
  await flush();
  // The figure is kept and marked as the last confirmed one.
  expect(byId('wsf-community-goal-stale-g1')).not.toBeNull();
  expect(byId('wsf-community-goal-total-g1')!.textContent).toBe('1,847 of 5,000 squats');
}

describe('heads-9 B-1: the stale-figure sentence stays browsable on a phone', () => {
  it('iOS: the visible sentence has no accessible:false; the hidden region’s copy is the one hidden', async () => {
    await failARefresh('ios');
    expect(copies.visible).toBeDefined();
    expect(copies.visible!.accessible).toBeUndefined();
    expect(copies.visible!.importantForAccessibility).toBeUndefined();
    expect(copies.region).toBeDefined();
    expect(copies.region!.accessible).toBe(false);
    expect(copies.region!.importantForAccessibility).toBe('no');
  });

  it('Android: the same', async () => {
    await failARefresh('android' as 'ios');
    expect(copies.visible!.accessible).toBeUndefined();
    expect(copies.visible!.importantForAccessibility).toBeUndefined();
    expect(copies.region!.accessible).toBe(false);
    expect(copies.region!.importantForAccessibility).toBe('no');
  });

  it('web, as before: the polite region reads the sentence; the visible copy is aria-hidden; no native props', async () => {
    await failARefresh('web');
    const region = byId('wsf-community-goal-stale-status-g1')!;
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe(SENTENCE);
    const visible = byId('wsf-community-goal-stale-g1')!.firstElementChild as HTMLElement;
    expect(visible.textContent).toBe(SENTENCE);
    expect(visible.getAttribute('aria-hidden')).toBe('true');
    expect(copies.region!.accessible).toBeUndefined();
    expect(copies.region!.importantForAccessibility).toBeUndefined();
    expect(copies.visible!.accessible).toBeUndefined();
    // For the before/after web DOM comparison (heads-9 B-1): the whole page.
    const dump = process.env.WSF_DUMP_STALE_DOM;
    if (dump) (await import('node:fs')).writeFileSync(dump, container.innerHTML);
  });
});
