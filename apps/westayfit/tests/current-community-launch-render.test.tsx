import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootNative, createFakeAsyncStorage, type FakeAsyncStorage } from './nativeStorageHarness';
import { assertNoUnhandledRejections, useUnhandledRejectionGuard } from './unhandledRejectionGuard';

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
 * mocked member-read layer, and EVERY way out (router.replace, push,
 * navigate, dismissTo, the navigation object's navigate, a <Redirect>) is
 * recorded into one list, so "nothing navigated yet" means nothing. Every
 * testID and text the page ever adds is recorded too, so a chooser drawn
 * and then replaced still counts. While a read is held, setTimeout is faked,
 * so the 5 s storage bound cannot answer for it on a loaded machine; settling
 * runs on setImmediate. Not a device run.
 */

const h = vi.hoisted(() => ({
  user: { uid: 'member-a', email: null as string | null },
  /** Every navigation, in order, as `<how>:<href>`. */
  navigated: [] as string[],
  goalsAsked: [] as string[],
  /** The member's communities, as the membership read answers. */
  items: [] as unknown[],
  /** The route's search params, as the screen reads them. */
  params: {} as Record<string, string>,
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
  readMyCommunities: async () => ({ items: h.items }),
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
  A hand-built expo-router (the real package cannot load here): every way out
  is recorded into `h.navigated`, focus effects do nothing, and the rest is
  the surface the routes reach for.
*/
vi.mock('expo-router', () => {
  const record = (how: string) => (href: unknown) => {
    h.navigated.push(`${how}:${typeof href === 'string' ? href : JSON.stringify(href)}`);
  };
  const router = {
    push: record('push'),
    replace: record('replace'),
    navigate: record('navigate'),
    back: () => {
      h.navigated.push('back');
    },
    dismissTo: record('dismissTo'),
    canGoBack: () => true,
  };
  const navigation = {
    addListener: () => () => undefined,
    removeListener: () => undefined,
    isFocused: () => true,
    canGoBack: () => true,
    dispatch: record('dispatch'),
    navigate: record('navigation.navigate'),
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
    useLocalSearchParams: () => h.params,
    useSegments: () => [],
    Link: ({ children }: { children?: unknown }) => children ?? null,
    // A <Redirect> navigates when it is drawn: drawing one is recorded.
    Redirect: ({ href }: { href: unknown }) => {
      record('redirect')(href);
      return null;
    },
  };
});

let disk: FakeAsyncStorage;
let cleanup: Array<() => void> = [];
// An unhandled rejection fails the test during which Node reports it, or the
// file's afterAll (tests/unhandledRejectionGuard.ts).
useUnhandledRejectionGuard();

/** A fresh process over `disk`; Firebase is mocked after the harness's own mocks have landed. */
/**
 * A fresh WEB process: the web storage implementations (localStorage, read
 * synchronously, so the remembered community is answered at load), with the
 * same Firebase mocks. Returns its currentCommunity module.
 */
async function bootWeb() {
  vi.resetModules();
  vi.doUnmock('@react-native-async-storage/async-storage');
  vi.doUnmock('../src/storage/kv');
  vi.doUnmock('../src/storage/sessionKv');
  vi.doUnmock('../src/storage/syncRead');
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
  // Every testID and every text the page ever adds, so a frame drawn and then
  // replaced still counts. React reuses an element of the same type in place,
  // so a testID or a text that changes on an existing node counts too.
  const ids = new Set<string>();
  const texts: string[] = [];
  const take = (records: MutationRecord[]) => {
    for (const r of records) {
      for (const n of Array.from(r.addedNodes)) {
        if (n.textContent) texts.push(n.textContent);
        if (!(n instanceof Element)) continue;
        for (const e of [n, ...Array.from(n.querySelectorAll('[data-testid]'))]) {
          const id = e.getAttribute('data-testid');
          if (id) ids.add(id);
        }
      }
      if (r.type === 'attributes' && r.target instanceof Element) {
        const id = r.target.getAttribute('data-testid');
        if (id) ids.add(id);
      }
      if (r.type === 'characterData' && r.target.textContent) texts.push(r.target.textContent);
    }
  };
  const observer = new MutationObserver(take);
  observer.observe(container, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ['data-testid'],
  });
  await React.act(async () => {
    root.render(React.createElement(Screen));
  });
  cleanup.push(() => {
    observer.disconnect();
    React.act(() => root.unmount());
    container.remove();
  });
  return {
    container,
    /** Every testID ever added to the page. */
    testIds: () => {
      take(observer.takeRecords());
      return ids;
    },
    /** Whether `text` was ever on the page. */
    everSaid: (text: string) => {
      take(observer.takeRecords());
      return texts.some((t) => t.includes(text));
    },
    settle: () =>
      React.act(async () => {
        for (let i = 0; i < 10; i += 1) await tick();
      }),
  };
}

beforeAll(async () => {
  disk = createFakeAsyncStorage();
  await boot();
  await import('react');
  await import('react-dom/client');
  await import('../app/move/index');
  await import('../app/(tabs)/(home)/index');
}, 60_000);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  disk = createFakeAsyncStorage();
  disk.map.set(REMEMBERED_KEY, 'g2');
  h.navigated.length = 0;
  h.goalsAsked.length = 0;
  h.items = TWO;
  h.params = {};
});

afterEach(async () => {
  try {
    for (const c of cleanup.splice(0)) c();
    vi.useRealTimers();
    for (let i = 0; i < 20; i += 1) await tick();
  } finally {
    assertNoUnhandledRejections();
  }
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
    expect(h.navigated).toEqual([]);
    expect(h.goalsAsked).toEqual([]);

    release();
    await cc.currentCommunityReady();
    await settle();
    expect(h.goalsAsked).toEqual(['g2']);
    expect(h.navigated).toEqual(['replace:/contribute/goal-g2?groupId=g2&mode=move']);
  }, 20_000);
});

const CHOOSER_LIST = 'wsf-home-my-list';
const CHOOSER_HEADING = 'Choose a community';

describe('Home, with B remembered and the launch read held', () => {
  it('takes its one decision only after the read, and opens B; the chooser is never drawn', async () => {
    const release = holdLaunchRead();
    const cc = await boot();
    const home = await render('home');
    await home.settle();
    expect(cc.isCurrentCommunityReady()).toBe(false);
    // The membership list HAS been read (each card's goals were asked for), so
    // only the remembered community is outstanding.
    expect([...h.goalsAsked].sort()).toEqual(['g1', 'g2']);
    expect(h.navigated).toEqual([]);
    // heads-13 N3: while the read is held, the list is still loading; the
    // chooser (its list, its heading, the stack it sits in) is never drawn.
    expect(home.testIds().has('wsf-home-awaiting-community')).toBe(true);
    expect(home.testIds().has('wsf-home-my-loading')).toBe(true);
    expect(home.testIds().has(CHOOSER_LIST)).toBe(false);
    expect(home.testIds().has('wsf-home-signed-in')).toBe(false);
    expect(home.everSaid(CHOOSER_HEADING)).toBe(false);

    release();
    await cc.currentCommunityReady();
    await home.settle();
    expect(h.navigated).toEqual(['replace:/community/g2']);
    // Decided once: more settling decides nothing more, and the chooser never came.
    await home.settle();
    expect(h.navigated).toEqual(['replace:/community/g2']);
    expect(home.testIds().has('wsf-home-opening-community')).toBe(true);
    expect(home.testIds().has(CHOOSER_LIST)).toBe(false);
    expect(home.everSaid(CHOOSER_HEADING)).toBe(false);
  }, 20_000);

  it('a member of ONE community: no one-card chooser while the read is held, then that community opens', async () => {
    h.items = [TWO[0]];
    const release = holdLaunchRead();
    const cc = await boot();
    const home = await render('home');
    await home.settle();
    expect(cc.isCurrentCommunityReady()).toBe(false);
    expect(h.goalsAsked).toEqual(['g1']);
    expect(h.navigated).toEqual([]);
    expect(home.testIds().has('wsf-home-awaiting-community')).toBe(true);
    expect(home.testIds().has('wsf-home-my-loading')).toBe(true);
    expect(home.testIds().has(CHOOSER_LIST)).toBe(false);
    expect(home.everSaid(CHOOSER_HEADING)).toBe(false);

    release();
    await cc.currentCommunityReady();
    await home.settle();
    expect(h.navigated).toEqual(['replace:/community/g1']);
    expect(home.testIds().has(CHOOSER_LIST)).toBe(false);
  }, 20_000);
});

describe('Home controls: the chooser is still drawn when it is the answer', () => {
  it('two communities and none remembered: once the read lands, the chooser, and no navigation', async () => {
    disk.map.delete(REMEMBERED_KEY);
    const release = holdLaunchRead();
    const cc = await boot();
    const home = await render('home');
    await home.settle();
    expect(home.testIds().has(CHOOSER_LIST)).toBe(false);

    release();
    await cc.currentCommunityReady();
    await home.settle();
    expect(home.testIds().has(CHOOSER_LIST)).toBe(true);
    expect(home.everSaid(CHOOSER_HEADING)).toBe(true);
    expect(h.navigated).toEqual([]);
  }, 20_000);

  it('RV16-639-2: the list was asked for (?view=communities): drawn while the read is held, never held, nothing navigates', async () => {
    h.params = { view: 'communities' };
    const release = holdLaunchRead();
    const cc = await boot();
    const home = await render('home');
    await home.settle();
    expect(cc.isCurrentCommunityReady()).toBe(false);
    expect([...h.goalsAsked].sort()).toEqual(['g1', 'g2']);
    expect(home.testIds().has(CHOOSER_LIST)).toBe(true);
    expect(home.testIds().has('wsf-home-awaiting-community')).toBe(false);
    expect(h.navigated).toEqual([]);

    release();
    await cc.currentCommunityReady();
    await home.settle();
    // Asked for the list: it stays; nothing is decided or opened.
    expect(h.navigated).toEqual([]);
    expect(home.testIds().has('wsf-home-awaiting-community')).toBe(false);
  }, 20_000);

  it('RV16-639-2 web control: the hold is never drawn on web (the remembered community is read synchronously)', async () => {
    localStorage.setItem(REMEMBERED_KEY, 'g2');
    try {
      const cc = await bootWeb();
      expect(cc.isCurrentCommunityReady()).toBe(true);
      const home = await render('home');
      await home.settle();
      expect(home.testIds().has('wsf-home-awaiting-community')).toBe(false);
      // The web's own frames, as before: the signed-in stack while the list loads, then B opens.
      expect(home.testIds().has('wsf-home-signed-in')).toBe(true);
      expect(h.navigated).toEqual(['replace:/community/g2']);
    } finally {
      localStorage.removeItem(REMEMBERED_KEY);
    }
  }, 20_000);
});
