import { act, forwardRef, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AccessibilityInfo, AppState, Dimensions, Platform } from 'react-native';
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
 *
 * NATIVE-MEMBER-1 W16-14 (INT-12, member half): the freshness line under the
 * figure ("Confirmed …") names the day when it is not today and says "Last
 * confirmed" while the figure is the kept one, against a fixed now (fake
 * timers) in a pinned zone (UTC) and the en-US clock.
 */

// The freshness line is in the reader's zone: pinned so the strings are exact.
process.env.TZ = 'UTC';

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
// The announce helper of the platform rendering (fixed for each test): the
// web's polite region, or the native announcement.
vi.mock('../src/ui/announce', async (importOriginal) => {
  const web = await importOriginal<typeof import('../src/ui/announce')>();
  const native = await import('../src/ui/announce.native');
  const { Platform: P } = await import('react-native');
  return {
    get liveRegion() {
      return P.OS === 'web' ? web.liveRegion : native.liveRegion;
    },
    useAnnounce: (...a: Parameters<typeof web.useAnnounce>) => (P.OS === 'web' ? web.useAnnounce(...a) : native.useAnnounce(...a)),
  };
});
vi.mock('../src/ui/useReducedMotion', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useReducedMotion: () => true,
  useReducedMotionPreference: () => ({ reduced: true, known: true, failed: false }),
}));
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), navigate: vi.fn() };
// Every live focus effect, so a test can leave and come back to the screen
// (refocus(): each one's blur cleanup, then the callback again).
const focusEntries = new Set<{ refire: () => void }>();
vi.mock('expo-router', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  useLocalSearchParams: () => ({ groupId: 'oak' }),
  useRouter: () => router,
  router,
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => {
      let cleanup = cb();
      const entry = {
        refire: () => {
          if (typeof cleanup === 'function') cleanup();
          cleanup = cb();
        },
      };
      focusEntries.add(entry);
      return () => {
        focusEntries.delete(entry);
        if (typeof cleanup === 'function') cleanup();
      };
    }, [cb]);
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
const net: { down: boolean; pulseDownFor: string | null } = { down: false, pulseDownFor: null };
const offline = () => Promise.reject(Object.assign(new Error('offline'), { code: 'functions/unavailable' }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => (req?: { goalId?: string }) =>
    net.down || (name === 'wsfGoalPulse' && req?.goalId === net.pulseDownFor)
      ? offline()
      : name === 'wsfGoalPulse'
        ? Promise.resolve({ data: PULSE })
        : offline(),
}));
vi.mock('../src/firebase', () => ({ getFirebaseFirestore: () => ({}), getFirebaseFunctions: () => ({}) }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
const AUTH = { ready: true, user: { uid: 'u1', email: 'm@example.com', displayName: 'M' } };
vi.mock('../src/auth', () => ({ useWsfAuth: () => AUTH }));
vi.mock('../src/currentCommunity', () => ({ rememberCurrentCommunity: vi.fn(), resolveCurrentCommunity: () => null }));
const goals = { two: false };
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
  readGoals: () =>
    net.down ? offline() : Promise.resolve({ goals: goals.two ? [GOAL, { ...GOAL, goalId: 'g2', title: 'Winter squats' }] : [GOAL] }),
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
let spoken: string[];
beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  net.down = false;
  net.pulseDownFor = null;
  goals.two = false;
  spoken = [];
  const say = (m: string) => {
    spoken.push(m);
  };
  vi.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(say);
  if ((AccessibilityInfo as { announceForAccessibilityWithOptions?: unknown }).announceForAccessibilityWithOptions) {
    vi.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation(say);
  }
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

/** A return to the app after 30 s. */
async function returnToApp(): Promise<void> {
  emit('background');
  act(() => vi.advanceTimersByTime(RESUME_MIN_AWAY_MS + 1_000));
  emit('active');
  act(() => vi.advanceTimersByTime(RESUME_SETTLE_MS));
  await flush();
  await flush();
}

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

describe('heads-9 N-3: one announcement per failure wave, for the whole page', () => {
  it('iOS: an outage that fails both open goals speaks the sentence once; after all recover, a new failure speaks again', async () => {
    goals.two = true;
    await failARefresh('ios');
    expect(byId('wsf-community-goal-stale-g2')).not.toBeNull();
    expect(spoken).toEqual([SENTENCE]);
    // Another failed return while both are still stale: nothing new.
    await returnToApp();
    expect(spoken).toEqual([SENTENCE]);
    // Recovered: both figures fresh, no sentence.
    net.down = false;
    await returnToApp();
    expect(byId('wsf-community-goal-stale-g1')).toBeNull();
    expect(byId('wsf-community-goal-stale-g2')).toBeNull();
    // A later outage is a new wave.
    net.down = true;
    await returnToApp();
    expect(byId('wsf-community-goal-stale-g1')).not.toBeNull();
    expect(spoken).toEqual([SENTENCE, SENTENCE]);
  });

  // The focus settle read (2.6 s after each focus) failing on figures that are
  // already stale is the same wave, not a new one.
  it('iOS: coming back to the page during the outage (its settle read fails again) says nothing new', async () => {
    goals.two = true;
    await failARefresh('ios');
    expect(spoken).toEqual([SENTENCE]);
    act(() => focusEntries.forEach((e) => e.refire()));
    act(() => vi.advanceTimersByTime(3_000));
    await flush();
    await flush();
    expect(byId('wsf-community-goal-stale-g1')).not.toBeNull();
    expect(spoken).toEqual([SENTENCE]);
  });

  // heads-11 NB-2: the page-wide latch missed this; the wave key does not.
  it('iOS: after a partial recovery (one goal still stale), a second outage that fails the recovered goal speaks again', async () => {
    goals.two = true;
    await failARefresh('ios');
    expect(byId('wsf-community-goal-stale-g2')).not.toBeNull();
    expect(spoken).toEqual([SENTENCE]);
    // Partial recovery: g1 reads fresh, g2's pulse still fails.
    net.down = false;
    net.pulseDownFor = 'g2';
    await returnToApp();
    expect(byId('wsf-community-goal-stale-g1')).toBeNull();
    expect(byId('wsf-community-goal-stale-g2')).not.toBeNull();
    expect(spoken).toEqual([SENTENCE]);
    // A second outage fails g1 again while g2 never recovered.
    net.down = true;
    await returnToApp();
    expect(byId('wsf-community-goal-stale-g1')).not.toBeNull();
    expect(spoken).toEqual([SENTENCE, SENTENCE]);
  });

  it('iOS: a failure of the second goal alone is announced too (any figure, not the hero only)', async () => {
    goals.two = true;
    (Platform as { OS: string }).OS = 'ios';
    act(() => root.render(<CommunityPage />));
    await flush();
    expect(byId('wsf-community-goal-total-g2')).not.toBeNull();
    net.pulseDownFor = 'g2';
    await returnToApp();
    expect(byId('wsf-community-goal-stale-g1')).toBeNull();
    expect(byId('wsf-community-goal-stale-g2')).not.toBeNull();
    expect(spoken).toEqual([SENTENCE]);
  });

  it('web: nothing is announced (the polite regions speak, one per figure, as before)', async () => {
    goals.two = true;
    await failARefresh('web');
    expect(spoken).toEqual([]);
    expect(byId('wsf-community-goal-stale-status-g2')!.getAttribute('aria-live')).toBe('polite');
  });
});

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

describe('W16-14 / INT-12: the freshness line names the day, and says when the figure is the kept one', () => {
  const line = () => byId('wsf-community-progress-updated')!.textContent;
  const DAY = 86_400_000;

  it.each(['ios', 'web'] as const)('%s: the same day reads as before ("Confirmed 3:00 PM")', async (os) => {
    (Platform as { OS: string }).OS = os;
    act(() => root.render(<CommunityPage />));
    await flush();
    expect(line()).toBe('Confirmed 3:00 PM');
  });

  it.each(['ios', 'web'] as const)('%s: a figure confirmed on another day names the day ("Confirmed Oct 21, 3:00 PM")', async (os) => {
    (Platform as { OS: string }).OS = os;
    act(() => root.render(<CommunityPage />));
    await flush();
    expect(line()).toBe('Confirmed 3:00 PM');
    // The next day, before any read lands: the page draws again and the same figure names its day.
    vi.setSystemTime(NOW + DAY + 41 * 60_000);
    act(() => root.render(<CommunityPage />));
    expect(line()).toBe('Confirmed Oct 21, 3:00 PM');
  });

  it.each(['ios', 'web'] as const)('%s: a refresh that failed reads "Last confirmed" with the kept time', async (os) => {
    await failARefresh(os);
    expect(line()).toBe('Last confirmed 3:00 PM');
  });

  it('iOS: failed and from another day: "Last confirmed Oct 21, 3:00 PM"', async () => {
    await failARefresh('ios');
    vi.setSystemTime(NOW + DAY);
    act(() => root.render(<CommunityPage />));
    expect(line()).toBe('Last confirmed Oct 21, 3:00 PM');
  });

  it('iOS: once a read lands again, the line is "Confirmed" with the new time', async () => {
    await failARefresh('ios');
    expect(line()).toBe('Last confirmed 3:00 PM');
    net.down = false;
    await returnToApp();
    expect(byId('wsf-community-goal-stale-g1')).toBeNull();
    expect(line()).toMatch(/^Confirmed 3:01 PM$/);
  });
});
