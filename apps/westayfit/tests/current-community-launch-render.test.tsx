import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootNative, createFakeAsyncStorage, type FakeAsyncStorage } from './nativeStorageHarness';

/**
 * ST-03 — MOVE AND HOME DECIDE ON THE REMEMBERED COMMUNITY, NOT ON "NOT READ YET".
 *
 * On a phone the community this account last opened (B) is read from
 * AsyncStorage at launch (src/currentCommunity.ts). A member of two
 * communities with B remembered must:
 *   - MOVE (app/move/index.tsx): resolve only after that read, and within B.
 *     Never send the member to Home's community chooser for want of an answer;
 *   - Home (app/(tabs)/(home)/index.tsx): take its one auto-open decision
 *     only once the read has answered, and open B.
 *
 * Both routes are rendered into jsdom through react-native-web over the
 * NATIVE storage implementations with the launch read held
 * (tests/nativeStorageHarness.ts). The callables' answers come through a
 * mocked member-read layer, and navigation through a recorded router. While
 * a read is held, setTimeout is faked, so the 5 s storage bound cannot answer
 * for it on a loaded machine; settling runs on setImmediate. Not a device run.
 */

const h = vi.hoisted(() => ({
  user: { uid: 'member-a', email: null as string | null },
  replaced: [] as string[],
  goalsAsked: [] as string[],
}));

const A = 'member-a';
const REMEMBERED_KEY = `wsf.currentCommunity.${A}`;
const TWO = [
  { groupId: 'g1', displayName: 'One', memberCount: 3, role: 'member' },
  { groupId: 'g2', displayName: 'Two', memberCount: 5, role: 'member' },
];
const OPEN_IN = (groupId: string) => [
  { goalId: `goal-${groupId}`, title: `Goal in ${groupId}`, target: 100, unit: 'squats', status: 'active', endsAt: '2026-12-31T00:00:00Z', sharedTotal: 10 },
];

vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  // No record: both routes take their read-then-decide path.
  peekMyCommunities: () => undefined,
  peekGoals: () => undefined,
  peekMemberProfile: () => undefined,
  peekOwnCredit: () => undefined,
  readMyCommunities: async () => ({ items: TWO }),
  readGoals: async (_uid: string, groupId: string) => {
    h.goalsAsked.push(groupId);
    return { goals: OPEN_IN(groupId) };
  },
  readMemberProfile: async () => ({ displayName: 'Ann', createdAt: null }),
  readOwnCredit: async () => ({ ownCredit: 0, unit: 'squats' }),
  wasRefused: () => false,
}));
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: h.user }) }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
// Reduced motion on, and no subscription to tear down (react-native-web's
// AccessibilityInfo has no listener handle). Forward-compatible: every real export.
vi.mock('../src/ui/useReducedMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/useReducedMotion')>()),
  useReducedMotion: () => true,
  useReducedMotionPreference: () => ({ known: true, reduced: true, failed: false }),
}));
vi.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: {} }) }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
/*
  A hand-built expo-router (the real package cannot load here): navigation is
  recorded, focus effects do nothing, and the rest is the surface the routes
  reach for.
*/
vi.mock('expo-router', () => {
  const router = {
    push: () => undefined,
    replace: (href: string) => {
      h.replaced.push(href);
    },
    navigate: () => undefined,
    back: () => undefined,
    dismissTo: () => undefined,
    canGoBack: () => true,
  };
  const navigation = {
    addListener: () => () => undefined,
    removeListener: () => undefined,
    isFocused: () => true,
    canGoBack: () => true,
    dispatch: () => undefined,
    navigate: () => undefined,
    goBack: () => undefined,
    setOptions: () => undefined,
    setParams: () => undefined,
    getParent: () => undefined,
    getState: () => ({ index: 0, routes: [] }),
  };
  return {
    router,
    useRouter: () => router,
    useNavigation: () => navigation,
    useFocusEffect: () => undefined,
    usePathname: () => '/',
    useLocalSearchParams: () => ({}),
    useSegments: () => [],
    Link: ({ children }: { children?: unknown }) => children ?? null,
    Redirect: () => null,
  };
});

let disk: FakeAsyncStorage;
let cleanup: Array<() => void> = [];
const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => {
  unhandled.push(reason);
};

/** A fresh process over `disk`; Firebase is mocked after the harness's own mocks have landed. */
async function boot() {
  bootNative(disk);
  await import('../src/storage/syncRead');
  vi.doMock('../src/firebase', () => ({
    getFirebaseApp: () => ({}),
    getFirebaseAuth: () => ({ currentUser: null }),
    getFirebaseFirestore: () => ({}),
    getFirebaseFunctions: () => ({}),
    wsfUsingEmulators: false,
    wsfIsStaging: false,
  }));
  vi.doMock('firebase/auth', () => ({ signOut: async () => undefined, onAuthStateChanged: () => () => undefined }));
  return import('../src/currentCommunity');
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

async function render(route: 'move' | 'home') {
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const Screen =
    route === 'move' ? (await import('../app/move/index')).default : (await import('../app/(tabs)/(home)/index')).default;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await React.act(async () => {
    root.render(React.createElement(Screen));
  });
  cleanup.push(() => {
    React.act(() => root.unmount());
    container.remove();
  });
  return {
    container,
    settle: () =>
      React.act(async () => {
        for (let i = 0; i < 10; i += 1) await tick();
      }),
  };
}

beforeAll(async () => {
  process.on('unhandledRejection', onUnhandled);
  disk = createFakeAsyncStorage();
  await boot();
  await import('react');
  await import('react-dom/client');
  await import('../app/move/index');
  await import('../app/(tabs)/(home)/index');
}, 60_000);

afterAll(() => {
  process.off('unhandledRejection', onUnhandled);
});

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  disk = createFakeAsyncStorage();
  disk.map.set(REMEMBERED_KEY, 'g2');
  h.replaced.length = 0;
  h.goalsAsked.length = 0;
});

afterEach(async () => {
  for (const c of cleanup.splice(0)) c();
  vi.useRealTimers();
  for (let i = 0; i < 20; i += 1) await tick();
  const seen = unhandled.splice(0).map((r) => (r instanceof Error ? r.message : String(r)));
  expect(seen, 'unhandled rejections raised during this test').toEqual([]);
});

/** Hold the launch read; setTimeout is faked meanwhile (see the header). */
function holdLaunchRead(): () => void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  return disk.holdReads();
}

describe('MOVE, with B remembered and the launch read held', () => {
  it('decides nothing until the read lands, then resolves within B: never Home’s chooser', async () => {
    const release = holdLaunchRead();
    const cc = await boot();
    const { settle } = await render('move');
    await settle();
    expect(cc.isCurrentCommunityReady()).toBe(false);
    // Not sent to Home (its community chooser) for want of an answer, and no goals read for a guess.
    expect(h.replaced).toEqual([]);
    expect(h.goalsAsked).toEqual([]);

    release();
    await cc.currentCommunityReady();
    await settle();
    expect(h.goalsAsked).toEqual(['g2']);
    expect(h.replaced).toEqual(['/contribute/goal-g2?groupId=g2&mode=move']);
  }, 20_000);
});

describe('Home, with B remembered and the launch read held', () => {
  it('takes its one decision only after the read, and opens B', async () => {
    const release = holdLaunchRead();
    const cc = await boot();
    const { settle } = await render('home');
    await settle();
    expect(cc.isCurrentCommunityReady()).toBe(false);
    expect(h.replaced).toEqual([]);

    release();
    await cc.currentCommunityReady();
    await settle();
    expect(h.replaced).toEqual(['/community/g2']);
    // Decided once: more settling decides nothing more.
    await settle();
    expect(h.replaced).toEqual(['/community/g2']);
  }, 20_000);
});
