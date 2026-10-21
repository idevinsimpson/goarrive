import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootNative, createFakeAsyncStorage, type FakeAsyncStorage } from './nativeStorageHarness';
import { assertNoUnhandledRejections, useUnhandledRejectionGuard } from './unhandledRejectionGuard';

/**
 * ST-03 — THE WARM FIRST FRAME WAITS FOR THE REMEMBERED COMMUNITY.
 *
 * Community and You both paint their first frame from this account's
 * in-memory record (src/memberReads.ts) when it already holds what they need
 * (`warmState`, `youFromRecord`). The remembered community is part of that
 * frame, and on a phone it is read from AsyncStorage at launch
 * (src/currentCommunity.ts). Until that read answers, the resolver says
 * "none chosen" for a member of several communities, so a warm frame painted
 * then would show Community's chooser or You's "Which community?" for a
 * member who HAS chosen. Both warm paths now fall to loading until the read
 * has answered; the fresh load (which awaits `currentCommunityReady`) decides.
 *
 * The two ROUTES are rendered here, through react-native-web, over the
 * native storage implementations with the launch read held
 * (tests/nativeStorageHarness.ts, `holdReads` on `getAllKeys`). The record,
 * the callables and the two parity views are fakes; the views record what
 * they were asked to draw. Not a device run.
 */

const h = vi.hoisted(() => ({
  uid: 'member-a',
  /** One object, as the real auth context keeps it: both routes' effects depend on its identity. */
  user: { uid: 'member-a', email: null as string | null },
  /** Every `state.kind` YouParityView was rendered with, in order (`member:<groupId>` for a member). */
  youFrames: [] as string[],
  /** Every current community CommunityParityView was rendered for, in order. */
  parityFrames: [] as string[],
  record: {
    mine: undefined as undefined | { items: unknown[] },
    goals: {} as Record<string, { goals: unknown[] }>,
    profile: undefined as undefined | { displayName: string | null; createdAt: unknown },
  },
  fresh: {
    mine: null as null | Promise<{ items: unknown[] }>,
    land: (_v: { items: unknown[] }) => {},
    fail: (_e: Error) => {},
  },
  /** You's Retry, as the view was handed it. */
  youRetry: null as null | (() => void),
  /** Whether You last said its figures are stale. */
  youStale: null as null | boolean,
  /** The state You last drew (a failed page carries the community it failed in). */
  youState: null as null | { kind: string; community?: { groupId: string } },
  /** Communities whose goals read fails (RV15-639-N2). */
  goalsFail: new Set<string>(),
}));

vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  peekMyCommunities: (uid: string | null) => (uid === h.uid ? h.record.mine : undefined),
  peekGoals: (uid: string | null, groupId: string) => (uid === h.uid ? h.record.goals[groupId] : undefined),
  peekMemberProfile: (uid: string | null) => (uid === h.uid ? h.record.profile : undefined),
  peekOwnCredit: () => undefined,
  readMyCommunities: () => h.fresh.mine,
  readGoals: async (_uid: string, groupId: string) => {
    if (h.goalsFail.has(groupId)) throw new Error('offline');
    return { goals: [] };
  },
  readMemberProfile: async () => ({ displayName: 'Ann', createdAt: null }),
  readOwnCredit: async () => ({ ownCredit: 0, unit: 'reps' }),
  wasRefused: () => false,
}));
vi.mock('../src/auth', () => ({
  useWsfAuth: () => ({ ready: true, user: h.user }),
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => async () => ({ data: { members: [], nextCursor: null, additions: [] } }),
}));
/*
  A hand-built `expo-router`: the real package ships untranspiled JSX that
  jsdom's loader refuses (tests/start-community-outcomes.test.tsx), so
  `importOriginal` is not an option. Focus effects are not part of the first
  frame, so they do nothing here. The rest is the minimal surface screens
  reach for (the integrated You signs out through `useNavigation`), so a
  screen that grows a navigation call does not break this file.
*/
vi.mock('expo-router', () => {
  const router = {
    push: () => undefined,
    replace: () => undefined,
    navigate: () => undefined,
    back: () => undefined,
    dismissTo: () => undefined,
    canGoBack: () => false,
  };
  const navigation = {
    addListener: () => () => undefined,
    removeListener: () => undefined,
    isFocused: () => true,
    canGoBack: () => false,
    dispatch: () => undefined,
    navigate: () => undefined,
    goBack: () => undefined,
    setOptions: () => undefined,
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
    Link: () => null,
    Redirect: () => null,
  };
});
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
// The shell's measurements and routes, as the tabs import them (the real
// module draws the bar). Kept to the shell's surface so a tab that starts
// using another of its exports does not throw here: on the integrated tree
// Community reserves its bottom space through tabContentBottomReserve.
vi.mock('../src/ui/MemberTabBar', () => ({
  MEMBER_TAB_BAR_BODY: 56,
  MEMBER_TAB_MOVE_OVERHANG: 16,
  MOVE_HREF: '/move',
  MEMBER_TABS: [],
  tabContentBottomReserve: (safeBottom: number) => 56 + 16 + safeBottom,
  shellAppliesTo: () => false,
  MemberTabBar: () => null,
}));
vi.mock('../src/ui/CommunityPrivacyControls', () => ({
  onPrivacySettled: () => () => undefined,
}));
vi.mock('../src/ui/CommunityParityView', () => ({
  CommunityParityView: (props: { groupId: string }) => {
    h.parityFrames.push(props.groupId);
    return null;
  },
}));
vi.mock('../src/ui/YouParityView', () => ({
  YouParityView: (props: {
    state: { kind: string; community?: { groupId: string } };
    actions?: { onRetry?: () => void };
    refresh?: { stale?: boolean };
  }) => {
    h.youRetry = props.actions?.onRetry ?? null;
    h.youStale = props.refresh?.stale ?? null;
    const s = props.state;
    h.youState = s;
    h.youFrames.push(s.kind === 'member' ? `member:${s.community?.groupId}` : s.kind);
    return null;
  },
}));

const REMEMBERED_KEY = `wsf.currentCommunity.${h.uid}`;
const TWO = [
  { groupId: 'g1', displayName: 'One', memberCount: 3, role: 'member' },
  { groupId: 'g2', displayName: 'Two', memberCount: 5, role: 'member' },
];
const CHOOSER = 'wsf-community-index-choose';
const LOADING = 'wsf-community-index-loading';

let disk: FakeAsyncStorage;
let cleanup: Array<() => void> = [];

/** A new membership read for the screens to wait on; the test lands or fails it. */
function freshRead(): void {
  h.fresh.mine = new Promise((resolve, reject) => {
    h.fresh.land = resolve;
    h.fresh.fail = reject;
  });
  // A failure the test causes is the screen's to handle, not an unhandled rejection here.
  h.fresh.mine.catch(() => undefined);
}

/*
  TIMING. The repo's vitest config keeps the default 5 s per test. Each test
  boots a fresh process (vi.resetModules), so the first one used to pay the
  cold transform and import of both route graphs (react-native-web and all)
  inside its own time, and inside its held launch read. That is moved out:
  `beforeAll` imports everything once, so each test only re-evaluates. Each
  test also has an explicit budget, and `until` gives up well inside it with
  a message, so a slow test can never leave an act loop running into the
  next one.
*/
const TEST_MS = 20_000;
const UNTIL_MS = 8_000;
const itTimed = (name: string, fn: () => Promise<void>) => it(name, fn, TEST_MS);

/*
  NO UNHANDLED REJECTION PASSES UNSEEN (tests/unhandledRejectionGuard.ts). A
  rejection nobody handles (a screen's load bound to a mock without the call
  it makes, say) used to surface only as a run-level "Unhandled Rejection"
  after every test had passed, naming no test. Each one Node reports while
  this file runs fails the test DURING WHICH NODE REPORTS IT (usually the one
  that raised it; one that surfaces after a test's drain fails the next), or
  the file's afterAll, naming that test.
*/
useUnhandledRejectionGuard();

beforeAll(async () => {
  disk = createFakeAsyncStorage();
  await boot();
  await import('react');
  await import('react-dom/client');
  await import('../app/(tabs)/community/index');
  await import('../app/(tabs)/you');
}, 60_000);

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  disk = createFakeAsyncStorage();
  h.youFrames.length = 0;
  h.parityFrames.length = 0;
  h.record.mine = { items: TWO };
  h.record.goals = { g1: { goals: [] }, g2: { goals: [] } };
  h.record.profile = { displayName: 'Ann', createdAt: null };
  freshRead();
  h.youRetry = null;
  h.youStale = null;
  h.youState = null;
  h.goalsFail.clear();
});

afterEach(async () => {
  try {
    for (const c of cleanup.splice(0)) c();
    vi.useRealTimers();
    // Let whatever this test started run out (with every screen unmounted)
    // before the next test boots a fresh process and re-mocks its modules: no
    // late continuation from this test may run against the next test's mocks.
    for (let i = 0; i < 20; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    assertNoUnhandledRejections();
  }
});

/**
 * Hold the launch read (`getAllKeys`) until the returned release is called.
 * Every storage call is bounded at 5 s on `setTimeout` (src/storage/keyQueue.ts),
 * and on a loaded machine the boot and first render alone can take that long,
 * so the bound would answer "nothing remembered" before the test releases the
 * read. `setTimeout` is therefore faked while a read is held: the read has
 * simply not answered yet. Settling runs on `setImmediate`, which stays real.
 */
function holdLaunchRead(): () => void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  return disk.holdReads();
}

/** One turn of the event loop that fake `setTimeout` does not stop. */
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/**
 * A fresh process over `disk`: the app was opened. Returns its currentCommunity
 * module. Firebase is mocked AFTER the boot, because a harness boot may mock
 * it for its own needs (the session watch's `getFirebaseAuth` only).
 */
async function boot() {
  bootNative(disk);
  // Let the harness's own mocks land first. Queued mocks are resolved
  // concurrently at the next import, so a harness mock of the same module
  // (its narrower Firebase one) could otherwise land after the one below.
  await import('../src/storage/syncRead');
  vi.doMock('../src/firebase', () => ({
    getFirebaseApp: () => ({}),
    getFirebaseAuth: () => ({ currentUser: null }),
    getFirebaseFirestore: () => ({}),
    getFirebaseFunctions: () => ({}),
    wsfUsingEmulators: false,
    wsfIsStaging: false,
  }));
  vi.doMock('firebase/auth', () => ({
    signOut: async () => undefined,
    onAuthStateChanged: () => () => undefined,
  }));
  return import('../src/currentCommunity');
}

/**
 * The route rendered into jsdom in the process booted last. React and the
 * renderer are imported after the boot, so they share the route's module
 * instances. `testIds()` is every testID ever added to the page, so a frame
 * that was painted and then replaced still counts.
 */
async function render(route: 'community' | 'you') {
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const Screen =
    route === 'community'
      ? (await import('../app/(tabs)/community/index')).default
      : (await import('../app/(tabs)/you')).default;
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const seen = new Set<string>();
  const take = (records: MutationRecord[]) => {
    for (const r of records) {
      for (const n of Array.from(r.addedNodes)) {
        if (!(n instanceof Element)) continue;
        for (const e of [n, ...Array.from(n.querySelectorAll('[data-testid]'))]) {
          const id = e.getAttribute('data-testid');
          if (id) seen.add(id);
        }
      }
      // React reuses an element of the same type in place: a testID that
      // changes on an existing node counts too.
      if (r.type === 'attributes' && r.target instanceof Element) {
        const id = r.target.getAttribute('data-testid');
        if (id) seen.add(id);
      }
    }
  };
  const observer = new MutationObserver(take);
  observer.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-testid'] });
  await React.act(async () => {
    root.render(React.createElement(Screen));
  });
  cleanup.push(() => {
    observer.disconnect();
    React.act(() => root.unmount());
    container.remove();
  });
  return {
    testIds: () => {
      take(observer.takeRecords());
      return seen;
    },
    /** Let queued work land, inside act. */
    settle: () =>
      React.act(async () => {
        for (let i = 0; i < 10; i += 1) await tick();
      }),
    /**
     * Settle until `done()` holds. A loaded worker can need more than one
     * settle for the fresh load to land. Gives up after `UNTIL_MS`, well
     * inside the test's own budget, with a message: an outcome that never
     * arrives fails here and leaves nothing running.
     */
    async until(done: () => boolean, what: string): Promise<void> {
      const end = Date.now() + UNTIL_MS;
      while (!done()) {
        if (Date.now() >= end) throw new Error(`never happened within ${UNTIL_MS} ms: ${what}`);
        await React.act(async () => {
          for (let i = 0; i < 10; i += 1) await tick();
        });
      }
    },
  };
}

describe('ST-03: before the launch read answers, no warm frame says "none chosen"', () => {
  itTimed('Community: loading, never the chooser, then the remembered community', async () => {
    disk.map.set(REMEMBERED_KEY, 'g2');
    const releaseReads = holdLaunchRead();
    const cc = await boot();
    const { testIds, settle, until } = await render('community');

    expect(cc.isCurrentCommunityReady()).toBe(false);
    expect(testIds().has(LOADING)).toBe(true);
    expect(testIds().has(CHOOSER)).toBe(false);
    expect(h.parityFrames).toEqual([]);

    releaseReads();
    await cc.currentCommunityReady();
    // heads-9 N2: once the read lands, the warm frame is painted, before the
    // fresh membership read has landed, on the remembered community.
    await until(() => h.parityFrames.length > 0, 'the warm Community view was drawn');
    expect(h.parityFrames).toEqual(['g2']);
    expect(testIds().has(CHOOSER)).toBe(false);

    h.fresh.land({ items: TWO });
    await settle();
    expect(h.parityFrames.at(-1)).toBe('g2');
    expect(testIds().has(CHOOSER)).toBe(false);
  });

  itTimed('You: loading, never "Which community?", then the remembered community', async () => {
    disk.map.set(REMEMBERED_KEY, 'g2');
    const releaseReads = holdLaunchRead();
    const cc = await boot();
    const { settle, until } = await render('you');

    expect(cc.isCurrentCommunityReady()).toBe(false);
    expect(h.youFrames.length).toBeGreaterThan(0);
    expect(new Set(h.youFrames)).toEqual(new Set(['loading']));

    releaseReads();
    await cc.currentCommunityReady();
    // heads-9 N2: the warm frame is given once the read lands, before the fresh load.
    await until(() => h.youFrames.at(-1) !== 'loading', 'You left loading');
    expect(h.youFrames.at(-1)).toBe('member:g2');
    expect(h.youFrames).not.toContain('pickCommunity');

    h.fresh.land({ items: TWO });
    await settle();
    expect(h.youFrames.at(-1)).toBe('member:g2');
    expect(h.youFrames).not.toContain('pickCommunity');
  });

  itTimed('You: a member of no community is still told so at once (the guard comes after that answer)', async () => {
    h.record.mine = { items: [] };
    holdLaunchRead();
    const cc = await boot();
    await render('you');
    expect(cc.isCurrentCommunityReady()).toBe(false);
    expect(h.youFrames[0]).toBe('noCommunity');
  });

  itTimed('heads-9 N1: a member of ONE community is painted warm at once, read or not (the read cannot change it)', async () => {
    h.record.mine = { items: [TWO[0]] };
    disk.map.set(REMEMBERED_KEY, 'g1');
    holdLaunchRead();
    const cc = await boot();
    const community = await render('community');
    expect(cc.isCurrentCommunityReady()).toBe(false);
    expect(h.parityFrames[0]).toBe('g1');
    expect(community.testIds().has(LOADING)).toBe(false);
    await render('you');
    expect(h.youFrames[0]).toBe('member:g1');
  });

  itTimed('heads-9 N2: after a Retry, the read landing does not bring back a warm frame (Community)', async () => {
    disk.map.set(REMEMBERED_KEY, 'g2');
    const releaseReads = holdLaunchRead();
    const cc = await boot();
    const { testIds, settle, until } = await render('community');
    h.fresh.fail(new Error('offline'));
    await until(() => testIds().has('wsf-community-index-retry'), 'the error screen');
    freshRead();
    const retry = document.querySelector('[data-testid="wsf-community-index-retry"]') as HTMLElement;
    await settleAfter(retry, settle);
    releaseReads();
    await cc.currentCommunityReady();
    await settle();
    expect(h.parityFrames).toEqual([]);
    h.fresh.land({ items: TWO });
    await until(() => h.parityFrames.length > 0, 'the fresh Community view');
    expect(h.parityFrames.at(-1)).toBe('g2');
  });

  itTimed('heads-9 N2: after a Retry, the read landing does not bring back a warm frame (You)', async () => {
    disk.map.set(REMEMBERED_KEY, 'g2');
    const releaseReads = holdLaunchRead();
    const cc = await boot();
    const { settle, until } = await render('you');
    h.fresh.fail(new Error('offline'));
    await until(() => h.youFrames.at(-1) === 'failed', 'the failed page');
    freshRead();
    const before = h.youFrames.length;
    h.youRetry!();
    await until(() => h.youFrames.length > before && h.youFrames.at(-1) === 'loading', 'loading again');
    releaseReads();
    await cc.currentCommunityReady();
    await settle();
    expect(h.youFrames.at(-1)).toBe('loading');
    h.fresh.land({ items: TWO });
    await until(() => h.youFrames.at(-1) !== 'loading', 'the fresh page');
    expect(h.youFrames.at(-1)).toBe('member:g2');
  });
});

describe('heads-9 N2: the read landing replaces only a loading frame', () => {
  itTimed('an error already on screen stays (Community and You)', async () => {
    disk.map.set(REMEMBERED_KEY, 'g2');
    const releaseReads = holdLaunchRead();
    const cc = await boot();
    const community = await render('community');
    const you = await render('you');
    h.fresh.fail(new Error('offline'));
    await community.until(() => community.testIds().has('wsf-community-index-retry'), 'the error screen');
    await you.until(() => h.youFrames.at(-1) === 'failed', 'the failed page');
    releaseReads();
    await cc.currentCommunityReady();
    await community.settle();
    await you.settle();
    expect(h.parityFrames).toEqual([]);
    expect(document.querySelector('[data-testid="wsf-community-index-retry"]')).not.toBeNull();
    expect(h.youFrames.at(-1)).toBe('failed');
  });
});

describe('heads-11 F2: a page the repaint drew survives the failed load it appeared during', () => {
  itTimed('You keeps member:g2 and says it is stale; a Retry that fails is the failed page', async () => {
    disk.map.set(REMEMBERED_KEY, 'g2');
    const releaseReads = holdLaunchRead();
    const cc = await boot();
    const { settle, until } = await render('you');
    expect(h.youFrames.at(-1)).toBe('loading');
    releaseReads();
    await cc.currentCommunityReady();
    await until(() => h.youFrames.at(-1) === 'member:g2', 'the repainted member page');

    // The launch's own fresh read fails: the repainted page stays, marked stale.
    h.fresh.fail(new Error('offline'));
    await until(() => h.youStale === true, 'the stale note');
    expect(h.youFrames.at(-1)).toBe('member:g2');
    expect(h.youFrames).not.toContain('failed');

    // A Retry reads everything fresh: when that fails, nothing is carried over.
    freshRead();
    h.youRetry!();
    await until(() => h.youFrames.at(-1) === 'loading', 'loading for the Retry');
    h.fresh.fail(new Error('offline'));
    await until(() => h.youFrames.at(-1) === 'failed', 'the failed page');
    await settle();
    expect(h.youFrames.at(-1)).toBe('failed');
  });
});

/*
  RV15-639-N2. A page kept on a failed load is one the fresh read still shows.
  When the membership list WAS read (its current community's goals then
  failed), a member page for a community that list no longer holds, or for
  another community than the one it resolved, is not kept: the failed page
  for the resolved community is drawn instead. Both kept pages are covered:
  the one the readiness repaint drew, and the one drawn at mount from the
  record.
*/
describe('RV15-639-N2: a page is kept on a failed load only while the fresh read still shows it', () => {
  const ONE = [TWO[0]];

  /** You on loading under a held launch read with g2 remembered, then repainted on member:g2. */
  async function repaintedOnG2() {
    disk.map.set(REMEMBERED_KEY, 'g2');
    const releaseReads = holdLaunchRead();
    const cc = await boot();
    const you = await render('you');
    expect(h.youFrames.at(-1)).toBe('loading');
    releaseReads();
    await cc.currentCommunityReady();
    await you.until(() => h.youFrames.at(-1) === 'member:g2', 'the repainted member page');
    return { cc, you };
  }

  /** You drawn at mount from the record on member:g2 (the launch read already answered). */
  async function drawnOnG2AtMount() {
    disk.map.set(REMEMBERED_KEY, 'g2');
    const cc = await boot();
    await cc.currentCommunityReady();
    const you = await render('you');
    expect(h.youFrames[0]).toBe('member:g2');
    return { cc, you };
  }

  async function expectFailedIn(you: Awaited<ReturnType<typeof render>>, groupId: string) {
    await you.until(() => h.youFrames.at(-1) === 'failed', 'the failed page');
    await you.settle();
    expect(h.youFrames.at(-1)).toBe('failed');
    expect(h.youState?.community?.groupId).toBe(groupId);
    expect(h.youStale).not.toBe(true);
  }

  itTimed('repainted member:g2; the fresh list is [g1] and g1’s goals fail: the failed page for g1, member:g2 not kept', async () => {
    h.goalsFail.add('g1');
    const { you } = await repaintedOnG2();
    h.fresh.land({ items: ONE });
    await expectFailedIn(you, 'g1');
  });

  itTimed('drawn at mount on member:g2; the fresh list is [g1] and g1’s goals fail: the failed page for g1', async () => {
    h.goalsFail.add('g1');
    const { you } = await drawnOnG2AtMount();
    h.fresh.land({ items: ONE });
    await expectFailedIn(you, 'g1');
  });

  itTimed('repainted member:g2, then g1 is chosen; the fresh list holds both and g1’s goals fail: the failed page for g1', async () => {
    h.goalsFail.add('g1');
    const { cc, you } = await repaintedOnG2();
    // The list still holds g2, but the load resolved g1: the page for g2 is not what it read.
    expect(await cc.rememberCurrentCommunity(h.uid, 'g1')).toBe(true);
    h.fresh.land({ items: TWO });
    await expectFailedIn(you, 'g1');
  });

  itTimed('control: repainted member:g2; the fresh list holds g2 and g2’s goals fail: member:g2 kept, marked stale', async () => {
    h.goalsFail.add('g2');
    const { you } = await repaintedOnG2();
    h.fresh.land({ items: TWO });
    await you.until(() => h.youStale === true, 'the stale note');
    await you.settle();
    expect(h.youFrames.at(-1)).toBe('member:g2');
    expect(h.youFrames).not.toContain('failed');
  });

  itTimed('a page that is not a member page (pickCommunity, drawn at mount) is never kept: the failed page', async () => {
    // Several communities, none remembered, the launch read answered.
    const cc = await boot();
    await cc.currentCommunityReady();
    const you = await render('you');
    expect(h.youFrames[0]).toBe('pickCommunity');
    h.fresh.fail(new Error('offline'));
    await you.until(() => h.youFrames.at(-1) === 'failed', 'the failed page');
    await you.settle();
    expect(h.youFrames.at(-1)).toBe('failed');
    expect(h.youStale).not.toBe(true);
  });

  itTimed('control: drawn at mount on member:g2; the fresh list holds g2 and g2’s goals fail: member:g2 kept, marked stale', async () => {
    h.goalsFail.add('g2');
    const { you } = await drawnOnG2AtMount();
    h.fresh.land({ items: TWO });
    await you.until(() => h.youStale === true, 'the stale note');
    await you.settle();
    expect(h.youFrames.at(-1)).toBe('member:g2');
    expect(h.youFrames).not.toContain('failed');
  });
});

/** Click a react-native-web control and let what it starts land. */
async function settleAfter(el: HTMLElement, settle: () => Promise<void>): Promise<void> {
  el.click();
  await settle();
}

describe('ST-03 controls: once the read has answered, the warm frame is painted at once', () => {
  itTimed('Community and You open on the remembered community before any fresh read lands', async () => {
    disk.map.set(REMEMBERED_KEY, 'g2');
    const cc = await boot();
    await cc.currentCommunityReady();
    const { testIds } = await render('community');
    expect(h.parityFrames[0]).toBe('g2');
    expect(testIds().has(LOADING)).toBe(false);

    await render('you');
    expect(h.youFrames[0]).toBe('member:g2');
  });

  itTimed('several communities and none remembered: the honest chooser is still painted warm', async () => {
    const cc = await boot();
    await cc.currentCommunityReady();
    const { testIds } = await render('community');
    expect(testIds().has(CHOOSER)).toBe(true);

    await render('you');
    expect(h.youFrames[0]).toBe('pickCommunity');
  });
});
