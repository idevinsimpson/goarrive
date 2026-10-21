import { act, StrictMode, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Dimensions } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * W12-9 part 2 (INT-17). The two integrator controls a flow returns focus to
 * on a phone: the tab bar's MOVE button (MOVE's opener) and the top bar's
 * menu button (Settings, opened from the menu). They register through
 * src/ui/focusTarget.ts, whose native twin is focusReturn.native's own
 * registry. Rendered here with the native twins (Metro's resolution), the
 * screen reader's focus recorded at react-native's boundary, the shell's
 * navigation events driven by hand. No device.
 *
 * W12-20 (INT-17): and MOVE's own Close (app/move/index.tsx), the sheet's
 * first stop and the target its focus return falls back to. focusTarget and
 * focusReturn are the twin Metro would pick for Platform.OS here, with every
 * focusTarget call counted, so the web's twin is the one the web case runs.
 */
const fx = vi.hoisted(() => ({
  os: 'android' as 'android' | 'ios' | 'web',
  focused: [] as unknown[],
  registered: [] as string[],
  focusSoonCalls: 0,
}));
vi.mock('react-native', async () => {
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return fx.os;
      },
      select: (o: Record<string, unknown>) => (fx.os in o ? o[fx.os] : o.default),
    },
    AccessibilityInfo: { ...actual.AccessibilityInfo, setAccessibilityFocus: (node: unknown) => fx.focused.push(node) },
    InteractionManager: { runAfterInteractions: (cb: () => void) => (cb(), { cancel: () => undefined }) },
    findNodeHandle: (x: unknown) => x,
  };
});
vi.mock('../src/ui/focusTarget', async () => {
  const native = await import('../src/ui/focusTarget.native');
  const web = await vi.importActual<typeof import('../src/ui/focusTarget')>('../src/ui/focusTarget');
  const pick = () => (fx.os === 'web' ? web : native);
  return {
    registerFocusTarget: (testId: string, ref: { readonly current: unknown }) => {
      fx.registered.push(testId);
      return pick().registerFocusTarget(testId, ref);
    },
    focusSoon: (ref: { readonly current: unknown }) => {
      fx.focusSoonCalls += 1;
      return pick().focusSoon(ref);
    },
  };
});
// MOVE's import of the focus return, by platform (the shell below calls the native twin directly).
vi.mock('../src/ui/focusReturn', async () => {
  const native = await import('../src/ui/focusReturn.native');
  const web = await vi.importActual<typeof import('../src/ui/focusReturn')>('../src/ui/focusReturn');
  return {
    ...web,
    armTabsFocusReturn: () => (fx.os === 'web' ? web : native).armTabsFocusReturn(),
    useSheetFocusReturn: (c: RefObject<unknown>) => (fx.os === 'web' ? web : native).useSheetFocusReturn(c),
  };
});
type Route = { key: string; name: string };
const nav = { routes: [] as Route[], listeners: {} as Record<string, Array<() => void>> };
// One navigation object, as react-navigation gives a screen: the shell's focus-return effect depends on it.
const navigation = vi.hoisted(() => ({
  getState: () => ({ index: nav.routes.length - 1, routes: nav.routes }),
  addListener: (event: string, cb: () => void) => {
    (nav.listeners[event] ??= []).push(cb);
    return () => {
      nav.listeners[event] = (nav.listeners[event] ?? []).filter((x) => x !== cb);
    };
  },
  isFocused: () => true,
  dispatch: () => undefined,
}));
const router = vi.hoisted(() => ({
  replace: vi.fn(),
  back: vi.fn(),
  canGoBack: () => true,
  dismissTo: vi.fn(),
  push: vi.fn(),
}));
vi.mock('expo-router', () => ({
  router,
  useRouter: () => router,
  useNavigation: () => navigation,
  useFocusEffect: () => undefined,
  Link: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
// MOVE's reads, at the module boundary (as tests/move-retry.test.tsx has them).
const reads = vi.hoisted(() => ({
  mine: null as unknown,
  goals: null as unknown,
  peekMine: undefined as unknown,
  peekGoals: undefined as unknown,
}));
vi.mock('../src/featureFlags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/featureFlags')>()),
  wsfAuthEnabled: true,
}));
// One signed-in account object, as the provider gives (MOVE's resolver re-reads when it changes).
const auth = vi.hoisted(() => ({ ready: true, user: { uid: 'u1', email: 'm@example.com' } }));
vi.mock('../src/auth', () => ({ useWsfAuth: () => auth }));
vi.mock('../src/currentCommunity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/currentCommunity')>()),
  resolveCurrentCommunity: () => 'oak',
  currentCommunityReady: () => Promise.resolve(),
}));
vi.mock('../src/memberReads', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/memberReads')>()),
  peekMyCommunities: () => reads.peekMine,
  peekGoals: () => reads.peekGoals,
  readMyCommunities: async () => reads.mine,
  readGoals: async () => reads.goals,
}));
vi.mock('../src/ui/useReducedMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/useReducedMotion')>()),
  useReducedMotion: () => true,
  useReducedMotionPreference: () => ({ known: true, reduced: true, failed: false }),
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
vi.mock('../src/firebase', () => ({
  wsfIsStaging: false,
  wsfUsingEmulators: false,
  getFirebaseAuth: () => ({}),
  getFirebaseFunctions: () => ({}),
  getFirebaseFirestore: () => ({}),
}));

const { MemberTabBar } = await import('../src/ui/MemberTabBar');
const { MemberTopBar } = await import('../src/ui/MemberTopBar');
const native = await import('../src/ui/focusReturn.native');
const { default: MoveResolver } = await import('../app/move/index');

const TAB_STATE = {
  index: 0,
  routes: [
    { key: 'h', name: '(home)' },
    { key: 'c', name: 'community' },
    { key: 'a', name: 'activity' },
    { key: 'y', name: 'you' },
  ],
};

/** The menu's rows, per case (the shell's own menu is built in app/(tabs)/_layout.tsx). */
const menuItems = { value: [] as import('../src/ui/MemberTopBar').MemberMenuItem[] };
/** The shell: the native focus return over both bars, as app/(tabs)/_layout.tsx wires it. */
function Shell() {
  const ref = useRef(null);
  native.useTabsFocusReturn(ref);
  const [open, setOpen] = useState(false);
  return (
    <>
      <MemberTopBar onHome={() => undefined} menu={menuItems.value} menuOpen={open} onMenuToggle={setOpen} />
      <MemberTabBar
        state={TAB_STATE as never}
        navigation={{ emit: () => ({ defaultPrevented: false }), navigate: () => undefined } as never}
        descriptors={{} as never}
        insets={{ top: 0, bottom: 0, left: 0, right: 0 }}
        onMove={() => undefined}
      />
    </>
  );
}

let container: HTMLDivElement;
let root: Root;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const emit = (event: string) => act(() => (nav.listeners[event] ?? []).slice().forEach((cb) => cb()));
const cover = (name: string) => {
  nav.routes = [{ key: 't', name: '(tabs)' }, { key: 'f', name }];
  emit('blur');
};
const uncover = () => {
  nav.routes = [{ key: 't', name: '(tabs)' }];
  emit('focus');
};
const lastFocused = () => fx.focused[fx.focused.length - 1];

beforeEach(() => {
  fx.os = 'android';
  fx.focused.length = 0;
  fx.registered.length = 0;
  fx.focusSoonCalls = 0;
  reads.mine = null;
  reads.goals = null;
  reads.peekMine = undefined;
  reads.peekGoals = undefined;
  router.replace.mockReset();
  menuItems.value = [];
  nav.routes = [{ key: 't', name: '(tabs)' }];
  nav.listeners = {};
  // A phone's width: the MOVE button is drawn (below 260 px the bar wraps without it).
  vi.spyOn(Dimensions, 'get').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
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

describe('W12-9 part 2: the MOVE and menu buttons take the screen reader\'s focus back', () => {
  it('MOVE closes → focus returns to the tab bar\'s MOVE button (its implied opener)', () => {
    act(() => root.render(<Shell />));
    cover('move/index');
    uncover();
    expect(lastFocused()).toBe(byId('wsf-member-tab-move'));
  });

  it('Settings opened from the menu closes → focus returns to the menu button, its own opener', () => {
    act(() => root.render(<Shell />));
    native.armTabsFocusReturnTo('wsf-member-topbar-menu-button');
    cover('settings');
    uncover();
    expect(lastFocused()).toBe(byId('wsf-member-topbar-menu-button'));
    // ... and the next MOVE still returns to MOVE, not to the last opener.
    cover('move/index');
    uncover();
    expect(lastFocused()).toBe(byId('wsf-member-tab-move'));
    expect(fx.focused).toHaveLength(2);
  });

  it('closing the menu moves the screen reader to the menu button on a phone', () => {
    act(() => root.render(<Shell />));
    act(() => byId('wsf-member-topbar-menu-button')!.click());
    expect(fx.focused).toHaveLength(0);
    act(() => byId('wsf-member-topbar-menu-button')!.click());
    expect(lastFocused()).toBe(byId('wsf-member-topbar-menu-button'));
  });

  it('web: closing the menu moves keyboard focus to the button, and nothing touches the screen reader', () => {
    fx.os = 'web';
    act(() => root.render(<Shell />));
    act(() => byId('wsf-member-topbar-menu-button')!.click());
    act(() => byId('wsf-member-topbar-menu-button')!.click());
    expect(document.activeElement).toBe(byId('wsf-member-topbar-menu-button'));
    expect(fx.focused).toHaveLength(0);
  });

  it('unmounted, the bars are no longer targets: a return finds nothing and does nothing', () => {
    act(() => root.render(<Shell />));
    act(() => root.render(<div />));
    native.returnFocusSoon(() => null, { node: null, testId: 'wsf-member-tab-move' }, []);
    native.returnFocusSoon(() => null, { node: null, testId: 'wsf-member-topbar-menu-button' }, []);
    expect(fx.focused).toHaveLength(0);
  });
});

describe('RV12-641-A1: a menu row that opens another surface does not pull the screen reader back to the menu button', () => {
  // Settings as the shell opens it: the return armed to the menu button, then the panel over the tabs.
  const settingsRow = {
    kind: 'link' as const,
    key: 'settings',
    label: 'Settings',
    href: '/settings',
    onNavigate: () => {
      native.armTabsFocusReturnTo('wsf-member-topbar-menu-button');
      cover('settings');
    },
  };
  // Manage community: an RN Modal over the shell, no navigation.
  const manageRow = { kind: 'action' as const, key: 'manage', label: 'Manage community', onPress: () => undefined };
  const open = () => act(() => byId('wsf-member-topbar-menu-button')!.click());

  it('Android: Settings from the menu: nothing focused behind the panel; its close returns to the menu button', () => {
    menuItems.value = [settingsRow];
    act(() => root.render(<Shell />));
    open();
    act(() => byId('wsf-member-topbar-menu-settings')!.click());
    expect(fx.focused).toHaveLength(0);
    uncover();
    expect(fx.focused).toEqual([byId('wsf-member-topbar-menu-button')]);
  });

  it('iOS (after the 400 ms wait): the Manage sheet from the menu: nothing focused behind it', () => {
    fx.os = 'ios';
    vi.useFakeTimers();
    menuItems.value = [manageRow];
    act(() => root.render(<Shell />));
    open();
    act(() => byId('wsf-member-topbar-menu-manage')!.click());
    act(() => vi.advanceTimersByTime(450));
    expect(fx.focused).toHaveLength(0);
  });

  it('dismissed without a choice (the layer, the button), after a row closed it once: the button takes the focus back', () => {
    menuItems.value = [manageRow];
    act(() => root.render(<Shell />));
    open();
    act(() => byId('wsf-member-topbar-menu-manage')!.click());
    expect(fx.focused).toHaveLength(0);
    open();
    act(() => byId('wsf-member-topbar-menu-dismiss')!.click());
    expect(fx.focused).toEqual([byId('wsf-member-topbar-menu-button')]);
    open();
    open();
    expect(fx.focused).toHaveLength(2);
  });

  it('web: a row still hands keyboard focus to the button, as before; the screen reader is never touched', () => {
    fx.os = 'web';
    menuItems.value = [manageRow];
    act(() => root.render(<Shell />));
    open();
    act(() => byId('wsf-member-topbar-menu-manage')!.click());
    expect(document.activeElement).toBe(byId('wsf-member-topbar-menu-button'));
    expect(fx.focused).toHaveLength(0);
  });
});

describe('W12-20 (INT-17): MOVE\'s Close is where the screen reader starts, and where it comes back to', () => {
  const MINE = { items: [{ groupId: 'oak', displayName: 'Oak Grove Together' }] };
  const goal = (goalId: string, endsAt: string) => ({
    goalId,
    title: goalId,
    target: 100,
    unit: 'squats',
    status: 'active',
    endsAt,
    sharedTotal: 10,
  });
  const TWO_GOALS = { goals: [goal('g1', '2030-01-01'), goal('g2', '2030-02-01')] };
  const settle = async () => {
    for (let i = 0; i < 6; i += 1) await act(async () => undefined);
  };
  /** MOVE opened from the tabs: "working" on its first frame, then the chooser (two open goals). */
  const openMove = async () => {
    reads.mine = MINE;
    reads.goals = TWO_GOALS;
    act(() => root.render(<MoveResolver />));
    await settle();
    expect(byId('wsf-move-choose')).not.toBeNull();
  };
  const close = () => byId('wsf-move-close');

  it('Android: MOVE opens and its Close takes the focus once, on settle; the chooser arriving does not take it again', async () => {
    await openMove();
    expect(close()).not.toBeNull();
    expect(fx.focused).toEqual([close()]);
    expect(fx.registered).toEqual(['wsf-move-close']);
  });

  it('iOS: Close takes the focus once, 400 ms after the presentation settles', async () => {
    fx.os = 'ios';
    vi.useFakeTimers();
    await openMove();
    expect(fx.focused).toHaveLength(0);
    act(() => vi.advanceTimersByTime(399));
    expect(fx.focused).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));
    expect(fx.focused).toEqual([close()]);
    act(() => vi.advanceTimersByTime(5_000));
    expect(fx.focused).toEqual([close()]);
  });

  it('back from a goal\'s flow lands on Close (the sheet\'s fallback, now registered)', async () => {
    await openMove();
    // A goal's "Move" opens its flow over the sheet; its Back uncovers the sheet.
    emit('blur');
    emit('focus');
    expect(fx.focused).toEqual([close(), close()]);
  });

  it('iOS: a goal\'s flow opening inside the 400 ms wait cancels the first focus; Back still lands on Close, once', async () => {
    fx.os = 'ios';
    vi.useFakeTimers();
    await openMove();
    emit('blur');
    act(() => vi.advanceTimersByTime(1_000));
    expect(fx.focused).toHaveLength(0);
    emit('focus');
    act(() => vi.advanceTimersByTime(400));
    expect(fx.focused).toEqual([close()]);
  });

  it('iOS: the sheet going inside the wait cancels the focus', async () => {
    fx.os = 'ios';
    vi.useFakeTimers();
    await openMove();
    act(() => root.render(<div />));
    act(() => vi.advanceTimersByTime(1_000));
    expect(fx.focused).toHaveLength(0);
  });

  it('a sheet decided as a hand-off on its first frame is replaced at once and focuses nothing (the flow\'s Close does)', async () => {
    reads.peekMine = MINE;
    reads.peekGoals = { goals: [goal('g1', '2030-01-01')] };
    act(() => root.render(<MoveResolver />));
    await settle();
    expect(router.replace).toHaveBeenCalledWith('/contribute/g1?groupId=oak&mode=move');
    expect(fx.focusSoonCalls).toBe(0);
    expect(fx.focused).toHaveLength(0);
  });

  it('RV17-641-F2, Android: a cold read that hands off focuses nothing on MOVE, then or later', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    reads.mine = MINE;
    reads.goals = { goals: [goal('g1', '2030-01-01')] };
    act(() => root.render(<MoveResolver />));
    await settle();
    expect(router.replace).toHaveBeenCalledWith('/contribute/g1?groupId=oak&mode=move');
    act(() => vi.advanceTimersByTime(5_000));
    expect(fx.focusSoonCalls).toBe(0);
    expect(fx.focused).toHaveLength(0);
  });

  it('RV17-641-F2, Android: a read still out after 1 s focuses Close anyway, once; its later answer does not focus it again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let answer!: (v: unknown) => void;
    reads.mine = new Promise((r) => (answer = r));
    reads.goals = TWO_GOALS;
    act(() => root.render(<MoveResolver />));
    await settle();
    act(() => vi.advanceTimersByTime(999));
    expect(fx.focused).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));
    expect(fx.focused).toEqual([close()]);
    await act(async () => answer(MINE));
    await settle();
    expect(byId('wsf-move-choose')).not.toBeNull();
    expect(fx.focused).toEqual([close()]);
  });

  it('RV17-641-F2, Android under StrictMode: a chooser decided from the record focuses Close once (the rehearsal remount does not repeat it)', async () => {
    reads.peekMine = MINE;
    reads.peekGoals = TWO_GOALS;
    reads.mine = MINE;
    reads.goals = TWO_GOALS;
    act(() =>
      root.render(
        <StrictMode>
          <MoveResolver />
        </StrictMode>,
      ),
    );
    await settle();
    expect(byId('wsf-move-choose')).not.toBeNull();
    expect(fx.focused).toEqual([close()]);
  });

  it('web: MOVE makes no registry or focus call, and the screen reader is never touched', async () => {
    fx.os = 'web';
    await openMove();
    emit('blur');
    emit('focus');
    expect(fx.registered).toEqual([]);
    expect(fx.focusSoonCalls).toBe(0);
    expect(fx.focused).toHaveLength(0);
  });
});
