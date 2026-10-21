import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { bootNative, createFakeAsyncStorage, type FakeAsyncStorage } from './nativeStorageHarness';

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
  },
}));

vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  peekMyCommunities: (uid: string | null) => (uid === h.uid ? h.record.mine : undefined),
  peekGoals: (uid: string | null, groupId: string) => (uid === h.uid ? h.record.goals[groupId] : undefined),
  peekMemberProfile: (uid: string | null) => (uid === h.uid ? h.record.profile : undefined),
  peekOwnCredit: () => undefined,
  readMyCommunities: () => h.fresh.mine,
  readGoals: async () => ({ goals: [] }),
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
  jsdom's loader refuses (tests/start-community-outcomes.test.tsx). Focus
  effects are not part of the first frame, so they do nothing here.
*/
vi.mock('expo-router', () => ({
  router: { push: () => undefined, replace: () => undefined },
  useFocusEffect: () => undefined,
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('../src/ui/MemberTabBar', () => ({
  MEMBER_TAB_BAR_BODY: 56,
  MEMBER_TAB_MOVE_OVERHANG: 16,
  MOVE_HREF: '/move',
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
  YouParityView: (props: { state: { kind: string; community?: { groupId: string } } }) => {
    const s = props.state;
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

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  disk = createFakeAsyncStorage();
  h.youFrames.length = 0;
  h.parityFrames.length = 0;
  h.record.mine = { items: TWO };
  h.record.goals = { g1: { goals: [] }, g2: { goals: [] } };
  h.record.profile = { displayName: 'Ann', createdAt: null };
  h.fresh.mine = new Promise((resolve) => {
    h.fresh.land = resolve;
  });
});

afterEach(() => {
  for (const c of cleanup.splice(0)) c();
  vi.useRealTimers();
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
  vi.doMock('../src/firebase', () => ({
    getFirebaseFunctions: () => ({}),
    getFirebaseAuth: () => ({ currentUser: null }),
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
    }
  };
  const observer = new MutationObserver(take);
  observer.observe(container, { childList: true, subtree: true });
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
     * Settle until `done()` holds, up to ~10 s. A loaded worker can need more
     * than one settle for the fresh load to land; only an outcome that never
     * arrives fails.
     */
    async until(done: () => boolean): Promise<void> {
      const end = Date.now() + 10_000;
      while (!done() && Date.now() < end) {
        await React.act(async () => {
          for (let i = 0; i < 10; i += 1) await tick();
        });
      }
    },
  };
}

describe('ST-03: before the launch read answers, no warm frame says "none chosen"', () => {
  it('Community: loading, never the chooser, then the remembered community', async () => {
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
    await settle();
    // The fresh membership read has not landed: still no chooser, no view.
    expect(testIds().has(CHOOSER)).toBe(false);
    expect(h.parityFrames).toEqual([]);

    h.fresh.land({ items: TWO });
    await until(() => h.parityFrames.length > 0);
    expect(h.parityFrames.at(-1)).toBe('g2');
    expect(testIds().has(CHOOSER)).toBe(false);
  });

  it('You: loading, never "Which community?", then the remembered community', async () => {
    disk.map.set(REMEMBERED_KEY, 'g2');
    const releaseReads = holdLaunchRead();
    const cc = await boot();
    const { settle, until } = await render('you');

    expect(cc.isCurrentCommunityReady()).toBe(false);
    expect(h.youFrames.length).toBeGreaterThan(0);
    expect(new Set(h.youFrames)).toEqual(new Set(['loading']));

    releaseReads();
    await cc.currentCommunityReady();
    await settle();
    expect(h.youFrames).not.toContain('pickCommunity');

    h.fresh.land({ items: TWO });
    await until(() => h.youFrames.at(-1) !== 'loading');
    expect(h.youFrames.at(-1)).toBe('member:g2');
    expect(h.youFrames).not.toContain('pickCommunity');
  });

  it('You: a member of no community is still told so at once (the guard comes after that answer)', async () => {
    h.record.mine = { items: [] };
    holdLaunchRead();
    const cc = await boot();
    await render('you');
    expect(cc.isCurrentCommunityReady()).toBe(false);
    expect(h.youFrames[0]).toBe('noCommunity');
  });
});

describe('ST-03 controls: once the read has answered, the warm frame is painted at once', () => {
  it('Community and You open on the remembered community before any fresh read lands', async () => {
    disk.map.set(REMEMBERED_KEY, 'g2');
    const cc = await boot();
    await cc.currentCommunityReady();
    const { testIds } = await render('community');
    expect(h.parityFrames[0]).toBe('g2');
    expect(testIds().has(LOADING)).toBe(false);

    await render('you');
    expect(h.youFrames[0]).toBe('member:g2');
  });

  it('several communities and none remembered: the honest chooser is still painted warm', async () => {
    const cc = await boot();
    await cc.currentCommunityReady();
    const { testIds } = await render('community');
    expect(testIds().has(CHOOSER)).toBe(true);

    await render('you');
    expect(h.youFrames[0]).toBe('pickCommunity');
  });
});
