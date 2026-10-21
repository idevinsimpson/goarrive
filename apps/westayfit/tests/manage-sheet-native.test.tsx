import { act, forwardRef, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Dimensions, Keyboard, Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-9 (MF-09). Community Home's Manage sheet on a phone: the
 * scrim did nothing (a click handler, and phones have no clicks), the panel
 * sat under the home indicator, and the keyboard covered the pairing code and
 * the combined-goal fields. Natively the scrim now closes the sheet, the panel
 * pads by the home indicator or the keyboard (sheetBottomPadding, INT-07) and
 * may grow to just below the top inset while the keyboard is up. The web is
 * untouched: the onClick scrim (no tabindex, no role) and a padding of 24.
 *
 * The route is rendered whole (react-native-web, jsdom) as a Champion; the
 * sheet is opened through the shell action it registers. The keyboard module
 * is the native one, with sheetBottomPadding spied; Keyboard events are
 * driven by hand. No device.
 */

// The props each Pressable is given, by testID: what React Native acts on
// natively (react-native-web always renders a Pressable with tabindex 0).
const pressProps = new Map<string, Record<string, unknown>>();
vi.mock('react-native', async (importOriginal) => {
  const rn = await importOriginal<typeof import('react-native')>();
  const Pressable = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
    if (typeof props.testID === 'string') pressProps.set(props.testID, props);
    const Real = rn.Pressable as unknown as (p: Record<string, unknown>) => ReactNode;
    return <Real ref={ref} {...props} />;
  });
  return { ...rn, Pressable };
});
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
  return {
    SafeAreaInsetsContext: createContext<null | { top: number; bottom: number; left: number; right: number }>(null),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
vi.mock('../src/ui/keyboardAvoidance', async () => {
  const native = await import('../src/ui/keyboardAvoidance.native');
  return { ...native, sheetBottomPadding: vi.fn(native.sheetBottomPadding) };
});
const shell: { action: null | { onPress: () => void } } = { action: null };
vi.mock('../src/ui/memberShellActions', () => ({
  useMemberShellAction: (action: null | { onPress: () => void }) => {
    shell.action = action;
  },
}));
const getDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => `${col}/${id}`,
  getDoc: (path: string) => getDoc(path),
}));
vi.mock('firebase/functions', () => ({
  httpsCallable: () => () => Promise.reject(Object.assign(new Error('internal'), { code: 'functions/internal' })),
}));
vi.mock('../src/firebase', () => ({ getFirebaseFirestore: () => ({}), getFirebaseFunctions: () => ({}) }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
const AUTH = { ready: true, user: { uid: 'u1', email: 'champ@example.com', displayName: 'Champ' } };
vi.mock('../src/auth', () => ({ useWsfAuth: () => AUTH }));
vi.mock('../src/currentCommunity', () => ({ rememberCurrentCommunity: vi.fn(), resolveCurrentCommunity: () => null }));
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  forgetCommunity: vi.fn(),
  peekMyCommunities: () => undefined,
  readGoals: () => Promise.resolve({ goals: [] }),
  readMyCommunities: () =>
    Promise.resolve({ items: [{ groupId: 'oak', displayName: 'Oak Grove Together', memberCount: 3, isSample: false, activeChallenge: null }] }),
  readOwnCredit: () => Promise.reject(new Error('offline')),
}));

const { default: CommunityPage } = await import('../app/(tabs)/(home)/community/[groupId]/index');
const { SafeAreaInsetsContext } = await import('react-native-safe-area-context');
const { sheetBottomPadding } = await import('../src/ui/keyboardAvoidance');

const snap = (data: Record<string, unknown> | null) => ({ exists: () => data !== null, data: () => data ?? undefined });
const CHAMPION = snap({ role: 'foundingChampion', membershipStatus: 'active', userId: 'u1' });
const GROUP = snap({ displayName: 'Oak Grove Together', groupType: 'custom', joinPolicy: 'private', joinCode: 'k'.repeat(22), isSample: false });
const INSETS = { top: 47, bottom: 34, left: 0, right: 0 };

const OS = Platform.OS;
let container: HTMLDivElement;
let root: Root;
let keyboard: Record<string, (e: unknown) => void>;
beforeEach(() => {
  getDoc.mockReset();
  getDoc.mockImplementation(async (path: string) => (path.startsWith('wsfMemberships/') ? CHAMPION : GROUP));
  shell.action = null;
  (sheetBottomPadding as unknown as { mockClear: () => void }).mockClear();
  keyboard = {};
  vi.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, h: (e: unknown) => void) => {
    keyboard[name] = h;
    return { remove: () => delete keyboard[name] };
  }) as never);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  // jsdom has no layout: give the window an iPhone 14's size (390 x 844).
  vi.spyOn(Dimensions, 'get').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (Platform as { OS: string }).OS = OS;
  vi.restoreAllMocks();
});

/** The sheet is a Modal: react-native-web portals it to document.body. */
const byId = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await act(async () => undefined);
};
async function openSheet(platform: string): Promise<void> {
  (Platform as { OS: string }).OS = platform;
  act(() =>
    root.render(
      <SafeAreaInsetsContext.Provider value={INSETS}>
        <CommunityPage />
      </SafeAreaInsetsContext.Provider>,
    ),
  );
  await settle();
  expect(shell.action, 'the Champion registers Manage community').not.toBeNull();
  act(() => shell.action!.onPress());
  await settle();
  expect(byId('wsf-community-manage-panel')).not.toBeNull();
}
const panel = () => byId('wsf-community-manage-panel')!;
const px = (v: string) => Number.parseFloat(v);

describe('W16-9 / MF-09: the Manage sheet on a phone', () => {
  it.each(['ios', 'android'])('%s: pressing the scrim closes the sheet', async (platform) => {
    await openSheet(platform);
    const scrim = byId('wsf-community-manage-scrim')!;
    act(() => scrim.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();
    expect(byId('wsf-community-manage-panel')).toBeNull();
  });

  it('ios: the panel pads by the home indicator, then by the keyboard while it is up', async () => {
    await openSheet('ios');
    // 24 + the 34 pt home indicator with the keyboard down.
    expect(px(panel().style.paddingBottom)).toBe(58);
    expect(px(panel().style.maxHeight)).toBeCloseTo(Math.min(844 * 0.88, 760));
    expect(keyboard.keyboardWillShow, 'iOS listens for keyboardWillShow').toBeTypeOf('function');
    act(() => keyboard.keyboardWillShow!({ endCoordinates: { height: 336 } }));
    // max(inset, keyboard) + 24.
    expect(px(panel().style.paddingBottom)).toBe(360);
    // Up to just below the top inset (the keyboard is already in the padding).
    expect(px(panel().style.maxHeight)).toBe(844 - 47 - 12);
    act(() => keyboard.keyboardWillHide!({}));
    expect(px(panel().style.paddingBottom)).toBe(58);
  });

  it('android: the IME adds to the navigation-bar inset', async () => {
    await openSheet('android');
    expect(px(panel().style.paddingBottom)).toBe(58);
    act(() => keyboard.keyboardDidShow!({ endCoordinates: { height: 300 } }));
    expect(px(panel().style.paddingBottom)).toBe(34 + 300 + 24);
  });

  it('native: the scrim is a press target only, neither focusable nor announced', async () => {
    pressProps.clear();
    await openSheet('ios');
    const props = pressProps.get('wsf-community-manage-scrim');
    expect(props, 'the native scrim is a Pressable').toBeDefined();
    expect(props!.accessible).toBe(false);
    expect(props!.focusable).toBe(false);
    expect(props!.importantForAccessibility).toBe('no-hide-descendants');
    expect(props!.accessibilityRole).toBeUndefined();
    expect(typeof props!.onPress).toBe('function');
  });
});

describe('W16-9: the web is untouched', () => {
  it('the scrim is the onClick view (no tabindex, no role) and still closes the sheet', async () => {
    pressProps.clear();
    await openSheet('web');
    expect(pressProps.has('wsf-community-manage-scrim')).toBe(false);
    const scrim = byId('wsf-community-manage-scrim')!;
    expect(scrim.getAttribute('tabindex')).toBeNull();
    expect(scrim.getAttribute('role')).toBeNull();
    act(() => scrim.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await settle();
    expect(byId('wsf-community-manage-panel')).toBeNull();
  });

  it('sheetBottomPadding is never called and the padding stays the stylesheet 24 (no inline override)', async () => {
    await openSheet('web');
    expect(sheetBottomPadding).not.toHaveBeenCalled();
    expect(panel().style.paddingBottom).toBe('');
    expect(px(panel().style.maxHeight)).toBeCloseTo(Math.min(844 * 0.88, 760));
    expect(Keyboard.addListener).not.toHaveBeenCalled();
  });
});

describe('W16-9: the sheet scroll view keeps the keyboard out of the way (wiring)', () => {
  it('spreads KEYBOARD_SCROLL_PROPS and SHEET_DISMISS_PROPS, and persists taps natively only', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const src = readFileSync(resolve(__dirname, '../app/(tabs)/(home)/community/[groupId]/index.tsx'), 'utf8');
    const at = src.indexOf('contentContainerStyle={styles.sheetContent}');
    expect(at).toBeGreaterThan(0);
    const tag = src.slice(src.lastIndexOf('<ScrollView', at), src.indexOf('>', src.indexOf('keyboardShouldPersistTaps', at)) + 1);
    expect(tag).toContain('{...KEYBOARD_SCROLL_PROPS}');
    expect(tag).toContain('{...SHEET_DISMISS_PROPS}');
    expect(tag).toContain("{...(nativeSheet ? { keyboardShouldPersistTaps: 'handled' as const } : {})}");
  });
});
