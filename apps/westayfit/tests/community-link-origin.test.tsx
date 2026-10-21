import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AppState, Dimensions, Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-16 (ST-01, W12-13). Community Home builds every link it
 * offers (the invite and its QR, the display, kiosk, station and combined
 * setup addresses) on `currentOrigin()`, the one origin helper. On the web
 * that is the page's own origin, as before. On a phone it is the origin the
 * build names in EXPO_PUBLIC_WSF_PUBLIC_ORIGIN, or none while it is unset
 * (today), so the invite and its QR stay hidden, fail-closed. It never reads
 * `window.location` there: jsdom has one (as a development build has Metro's),
 * and it must not show up.
 *
 * Metro picks `currentOrigin.native.ts` on a phone; vitest resolves the web
 * twin, so the helper is the twin of the platform rendering (set per case).
 * The route is rendered whole (react-native-web, jsdom) for the community's
 * founding Champion, who always has the invite card; the card carries the
 * link it would share as `data-invite-url`. No device.
 */

vi.mock('../src/ui/currentOrigin', async (importOriginal) => {
  const web = await importOriginal<typeof import('../src/ui/currentOrigin')>();
  const native = await import('../src/ui/currentOrigin.native');
  const { Platform: P } = await import('react-native');
  return { currentOrigin: () => (P.OS === 'web' ? web.currentOrigin() : native.currentOrigin()) };
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
const offline = () => Promise.reject(Object.assign(new Error('offline'), { code: 'functions/unavailable' }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => () => (name === 'wsfGoalPulse' ? Promise.resolve({ data: PULSE }) : offline()),
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
  readGoals: () => Promise.resolve({ goals: [GOAL] }),
  readMyCommunities: () =>
    Promise.resolve({ items: [{ groupId: 'oak', displayName: 'Oak Grove Together', memberCount: 4, isSample: false, activeChallenge: null }] }),
  readOwnCredit: () => Promise.resolve({ ownCredit: 20, unit: 'squats' }),
}));

const { default: CommunityPage } = await import('../app/(tabs)/(home)/community/[groupId]/index');

const CODE = 'Ab3_dE-fGh1JkLmN0pQrSt';
const NAMED = 'https://westayfit.app';
const snap = (data: Record<string, unknown> | null) => ({ exists: () => data !== null, data: () => data ?? undefined });
const CHAMPION = snap({ role: 'foundingChampion', membershipStatus: 'active', userId: 'u1' });
const GROUP = snap({
  displayName: 'Oak Grove Together',
  groupType: 'custom',
  joinPolicy: 'public',
  joinCode: CODE,
  lifecycleStatus: 'active',
  isSample: false,
});

const OS = Platform.OS;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  getDoc.mockReset();
  getDoc.mockImplementation(async (path: string) => (path.startsWith('wsfMemberships/') ? CHAMPION : GROUP));
  vi.spyOn(AppState, 'addEventListener').mockImplementation((() => ({ remove: () => undefined })) as never);
  vi.spyOn(Dimensions, 'get').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (Platform as { OS: string }).OS = OS;
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
async function renderAs(os: 'ios' | 'android' | 'web'): Promise<HTMLElement> {
  (Platform as { OS: string }).OS = os;
  act(() => root.render(<CommunityPage />));
  await flush();
  const card = byId('wsf-community-invite');
  expect(card, 'the Champion always has the invite card').not.toBeNull();
  return card!;
}

describe('W16-16 / ST-01: Community Home builds its links on currentOrigin', () => {
  it('jsdom has a page address, as a development build has Metro’s', () => {
    expect(window.location.origin).toMatch(/^https?:\/\//);
  });

  it.each(['ios', 'android'] as const)('%s, no origin named (today): no invite link and no QR, never the page address', async (os) => {
    const card = await renderAs(os);
    expect(card.getAttribute('data-invite-url')).toBeNull();
    expect(container.innerHTML).not.toContain(window.location.origin);
    expect(byId('wsf-community-invite-pending')).not.toBeNull();
    expect(byId('wsf-community-invite-qr')).toBeNull();
  });

  it.each(['ios', 'android'] as const)('%s, an origin named by the build: the invite is built on it', async (os) => {
    vi.stubEnv('EXPO_PUBLIC_WSF_PUBLIC_ORIGIN', NAMED);
    const card = await renderAs(os);
    expect(card.getAttribute('data-invite-url')).toBe(`${NAMED}/join/${CODE}`);
    expect(container.innerHTML).not.toContain(window.location.origin);
  });

  it('web: the page’s own origin, as before, whatever the build names', async () => {
    vi.stubEnv('EXPO_PUBLIC_WSF_PUBLIC_ORIGIN', NAMED);
    const card = await renderAs('web');
    expect(card.getAttribute('data-invite-url')).toBe(`${window.location.origin}/join/${CODE}`);
  });
});
