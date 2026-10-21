import { act, forwardRef, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-8 (INT-09). Five member-owned root-stack screens started
 * under the status bar on a phone: Settings (page), Privacy, the join
 * skeleton, the marker screen and Goal setup. Each now begins with
 * <ScreenTopSpacer />, and the two text-glyph Backs reach 44 pt through
 * BACK_GLYPH_HIT_SLOP.
 *
 * "native" renders the spacer the way src/ui/useScreenTopInset.native.tsx
 * does with a 59 pt inset; "web" uses the real web module, which draws
 * nothing. Pressable is wrapped to read the props each Back was given
 * (react-native-web does not put hitSlop in the DOM). No device.
 */

const mode = { native: true };
vi.mock('../src/ui/useScreenTopInset', async (importOriginal) => {
  const web = await importOriginal<typeof import('../src/ui/useScreenTopInset')>();
  const { View } = await import('react-native');
  return {
    ...web,
    useScreenTopInset: () => (mode.native ? 59 : web.useScreenTopInset()),
    ScreenTopSpacer: () =>
      mode.native ? <View pointerEvents="none" style={{ height: 59 }} testID="wsf-screen-top-spacer" /> : web.ScreenTopSpacer(),
  };
});
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

const params: Record<string, string> = {};
vi.mock('expo-router', () => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), canGoBack: () => false },
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  useLocalSearchParams: () => params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  // Settings opened cold, as a page (not the panel over the member tabs).
  useNavigation: () => ({
    getState: () => ({ index: 0, routes: [{ key: 'settings-1', name: 'settings' }] }),
    setParams: vi.fn(),
    addListener: () => () => {},
  }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
}));
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: { uid: 'u1', email: 'a@example.com', emailVerified: true } }) }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getFirebaseFirestore: () => ({}),
  getFirebaseFunctions: () => ({}),
  wsfIsStaging: false,
  wsfUsingEmulators: false,
}));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: () => new Promise(() => {}) }));
// Every callable stays pending: the join route shows its skeleton.
vi.mock('firebase/functions', () => ({ httpsCallable: () => () => new Promise(() => {}) }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
vi.mock('../src/ui/CommunityPrivacyControls', () => ({ CommunityPrivacyControls: () => null }));
vi.mock('../src/movement-camera/MoveCameraSettingsSection', () => ({ MoveCameraSettingsSection: () => null }));
vi.mock('../src/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../src/ui/WsfWordmark', () => ({ WsfWordmark: () => null }));

const { default: Settings } = await import('../app/settings');
const { default: Privacy } = await import('../app/settings/privacy');
const { default: Join } = await import('../app/join/[joinCode]');
const { MarkerEntryScreen } = await import('../src/ui/MarkerEntryScreen');
const { default: NewGoal } = await import('../app/goals/new');
const { BACK_GLYPH_HIT_SLOP } = await import('../src/ui/kit');

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  mode.native = true;
  pressProps.clear();
  for (const k of Object.keys(params)) delete params[k];
  window.sessionStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
async function render(node: ReactNode): Promise<void> {
  act(() => {
    root.render(node);
  });
  await flush();
}
const SPACER = '[data-testid="wsf-screen-top-spacer"]';
/** The first element carrying a testID, in document order. */
const firstTagged = () => container.querySelector('[data-testid]') as HTMLElement | null;

const never = { resolve: () => new Promise<never>(() => {}), join: vi.fn() };
const SCREENS: [string, () => ReactNode, string, () => void][] = [
  ['Settings (page)', () => <Settings />, 'wsf-settings-screen', () => {}],
  ['Privacy', () => <Privacy />, 'wsf-privacy-screen', () => {}],
  ['the join skeleton', () => <Join />, 'wsf-join-loading', () => (params.joinCode = 'Ab3_dE-fGh1JkLmN0pQrSt')],
  ['the marker screen', () => <MarkerEntryScreen slug="flag-01" resolver={never as never} />, 'wsf-marker-loading', () => {}],
  ['Goal setup', () => <NewGoal />, 'wsf-new-goal-gated-off', () => (params.groupId = 'oak')],
];

describe('W16-8 / INT-09: member screens clear the top inset on a phone', () => {
  it.each(SCREENS)('%s begins with the top spacer', async (_l, node, screenId, setup) => {
    setup();
    await render(node());
    const screen = container.querySelector(`[data-testid="${screenId}"]`);
    expect(screen, screenId).not.toBeNull();
    const spacers = container.querySelectorAll(SPACER);
    expect(spacers).toHaveLength(1);
    const spacer = spacers[0]!;
    // The screen's first thing: either the first tagged element of all (the
    // spacer above a scroll column), or the screen's own first child.
    const first = firstTagged();
    expect(first === spacer || (first === screen && screen!.firstElementChild === spacer)).toBe(true);
    expect((spacer as HTMLElement).style.height).toBe('59px');
  });

  it.each(SCREENS)('web: %s draws no spacer', async (_l, node, screenId, setup) => {
    mode.native = false;
    setup();
    await render(node());
    expect(container.querySelector(`[data-testid="${screenId}"]`), screenId).not.toBeNull();
    expect(container.querySelector(SPACER)).toBeNull();
    // The hit slop is a native press target only: nothing of it reaches the web DOM.
    expect(container.innerHTML).not.toMatch(/hit-?slop/i);
  });

  it.each([
    ['Settings', () => <Settings />, 'wsf-settings-back'],
    ['Privacy', () => <Privacy />, 'wsf-privacy-back'],
  ])("%s's Back reaches 44 pt through BACK_GLYPH_HIT_SLOP", async (_l, node, backId) => {
    await render(node());
    expect(pressProps.get(backId)?.hitSlop).toEqual({ top: 8, bottom: 8, left: 17, right: 17 });
    expect(pressProps.get(backId)?.hitSlop).toBe(BACK_GLYPH_HIT_SLOP);
  });
});
