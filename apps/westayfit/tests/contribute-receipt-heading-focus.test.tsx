import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * W12-20 (INT-17, the receipt and the sheet's Close). On a phone:
 *   · the member's receipt replaces the review step it was confirmed from, so
 *     its headline (TogetherCompletion's level-1 heading) takes the screen
 *     reader's focus, exactly once per receipt (src/ui/stepHeadingFocus
 *     .native.ts, keyed on the attempt), while the receipt's own announcement
 *     still happens exactly once (INT-18, unchanged);
 *   · a kiosk's plain receipt is not moved to;
 *   · presented as the MOVE sheet, the flow's Close is a registered focus
 *     target and takes the focus once, when the sheet first appears.
 * The web makes no focus call (its sheet containment does that work).
 *
 * The route renders into jsdom through react-native-web. stepHeadingFocus,
 * focusTarget and announce are the twins Metro would pick for Platform.OS;
 * the focus moves and announcements are read off AccessibilityInfo
 * (react-native-web has no `findNodeHandle`, so the node is the ref's own
 * element). The callables are mocked at the network boundary. No device.
 */

const fx = vi.hoisted(() => ({
  os: 'android' as 'ios' | 'android' | 'web',
  focused: [] as unknown[],
  spoken: [] as string[],
  registered: [] as string[],
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
      select: (o: Record<string, unknown>) =>
        fx.os in o ? o[fx.os] : fx.os !== 'web' && 'native' in o ? o.native : o.default,
    },
    // In front, so an announcement is posted at once (src/ui/announce.native.ts).
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      setAccessibilityFocus: (node: unknown) => fx.focused.push(node),
      announceForAccessibility: (message: string) => fx.spoken.push(message),
      announceForAccessibilityWithOptions: (message: string) => fx.spoken.push(message),
    },
    InteractionManager: { runAfterInteractions: (cb: () => void) => (cb(), { cancel: () => undefined }) },
    findNodeHandle: (x: unknown) => x,
  };
});
// The twins, as Metro resolves them for Platform.OS (vitest applies no platform extensions).
vi.mock('../src/ui/stepHeadingFocus', async () => {
  const native = await import('../src/ui/stepHeadingFocus.native');
  const web = await vi.importActual<typeof import('../src/ui/stepHeadingFocus')>('../src/ui/stepHeadingFocus');
  return {
    useStepHeadingFocus: (...a: Parameters<typeof web.useStepHeadingFocus>) =>
      (fx.os === 'web' ? web : native).useStepHeadingFocus(...a),
  };
});
vi.mock('../src/ui/focusTarget', async () => {
  const native = await import('../src/ui/focusTarget.native');
  const web = await vi.importActual<typeof import('../src/ui/focusTarget')>('../src/ui/focusTarget');
  return {
    registerFocusTarget: (testId: string, ref: { readonly current: unknown }) => {
      fx.registered.push(testId);
      return (fx.os === 'web' ? web : native).registerFocusTarget(testId, ref);
    },
    focusSoon: (ref: { readonly current: unknown }) => (fx.os === 'web' ? web : native).focusSoon(ref),
  };
});
vi.mock('../src/ui/announce', async () => {
  const native = await import('../src/ui/announce.native');
  const web = await vi.importActual<typeof import('../src/ui/announce')>('../src/ui/announce');
  return {
    get liveRegion() {
      return fx.os === 'web' ? web.liveRegion : native.liveRegion;
    },
    get useAnnounce() {
      return fx.os === 'web' ? web.useAnnounce : native.useAnnounce;
    },
  };
});

const params = { value: { goalId: 'g1' } as Record<string, string> };
const router = { replace: vi.fn(), push: vi.fn(), back: vi.fn(), canGoBack: () => true, dismissTo: vi.fn(), navigate: vi.fn() };
const navigation = {
  dispatch: vi.fn(),
  isFocused: () => true,
  addListener: () => () => undefined,
  setOptions: vi.fn(),
  getParent: () => undefined,
  // Over the member's tabs: with mode=move this is MOVE's sheet, without it the page.
  getState: () => ({
    index: 1,
    routes: [
      { key: 't', name: '(tabs)' },
      { key: 'c', name: 'contribute/[goalId]', params: params.value },
    ],
  }),
};
vi.mock('expo-router', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  router,
  useRouter: () => router,
  useNavigation: () => navigation,
  usePathname: () => '/contribute/g1',
  useLocalSearchParams: () => params.value,
  useFocusEffect: () => undefined,
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 0, bottom: 0, left: 0, right: 0 }, frame: { x: 0, y: 0, width: 390, height: 844 } },
}));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/ui/useScreenTopInset', () => ({ useScreenTopInset: () => 0, ScreenTopSpacer: () => null, ScreenStatusBar: () => null }));
// Reduced motion: the receipt settles at once and the sheet has no travel.
vi.mock('../src/ui/useReducedMotion', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/ui/useReducedMotion')>()),
  useReducedMotion: () => true,
  useReducedMotionPreference: () => ({ known: true, reduced: true, failed: false }),
}));
const USER = { uid: 'u1', email: 'member@example.com', displayName: 'Member', emailVerified: true };
vi.mock('../src/firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: { uid: USER.uid } }),
  getFirebaseFirestore: () => ({}),
  getFirebaseFunctions: () => ({}),
  wsfUsingEmulators: false,
  wsfIsStaging: false,
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(), onAuthStateChanged: () => () => undefined }));
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: USER }) }));
const answers: Record<string, () => Promise<unknown>> = {};
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => async () => {
    const answer = answers[name];
    if (!answer) throw Object.assign(new Error('internal'), { code: 'functions/internal' });
    return { data: await answer() };
  },
}));

const { clearMemberReads } = await import('../src/memberReads');
const { IOS_FOCUS_DELAY_MS } = await import('../src/ui/accessibilityFocus');
const { default: ContributeToGoal } = await import('../app/contribute/[goalId]');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PULSE = { sharedTotal: 1240, target: 5000, unit: 'squats', status: 'active' };
const MINE = { ownCredit: 125, unit: 'squats', repeatPolicy: 'multiple' };
const RESULT = { addedCount: 35, ownCredit: 160, sharedTotal: 1275, target: 5000, unit: 'squats', status: 'active', alreadyRecorded: false };
const ROUTE = readFileSync(join(__dirname, '../app/contribute/[goalId].tsx'), 'utf8');

let container: HTMLDivElement;
let root: Root;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
/** Settles the screen; on iOS, also the 400 ms the focus waits there. */
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await act(async () => undefined);
  if (fx.os === 'ios') act(() => vi.advanceTimersByTime(IOS_FOCUS_DELAY_MS));
};
const press = async (id: string) => {
  await act(async () => byId(id)!.click());
  await settle();
};
const typeInto = (el: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const render = async () => {
  act(() => root.render(<ContributeToGoal />));
  await settle();
};
/** Entry, then review, then Record: the walk to a confirmed receipt. */
const recordFromEntry = async (amount = '35') => {
  act(() => typeInto(byId('wsf-contribute-entry') as HTMLInputElement, amount));
  await press('wsf-contribute-review');
  expect(byId('wsf-contribute-review-screen') ?? byId('wsf-contribute-submit')).not.toBeNull();
  await press('wsf-contribute-submit');
};
const headline = () => byId('wsf-contribute-result-headline');
const receiptSpoken = () => fx.spoken.filter((m) => m.startsWith('Recorded:'));
const texts = () => fx.focused.map((n) => (n as HTMLElement | null)?.textContent ?? String(n));

beforeEach(() => {
  fx.os = 'android';
  fx.focused.length = 0;
  fx.spoken.length = 0;
  fx.registered.length = 0;
  params.value = { goalId: 'g1' };
  clearMemberReads();
  localStorage.clear();
  sessionStorage.clear();
  for (const k of Object.keys(answers)) delete answers[k];
  answers.wsfGoalPulse = async () => PULSE;
  answers.wsfMyContribution = async () => MINE;
  answers.wsfContribute = async () => RESULT;
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('W12-20 on a phone: the member\'s receipt takes the focus on its headline, once', () => {
  it.each(['ios', 'android'] as const)('%s: review, then Record, then the Together headline is focused exactly once; the receipt is announced once', async (os) => {
    fx.os = os;
    if (os === 'ios') vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await render();
    expect(byId('wsf-contribute-entry')).not.toBeNull();
    // The screen's own arrival is the platform's: nothing moved on mount.
    expect(fx.focused).toHaveLength(0);
    await recordFromEntry();
    expect(byId('wsf-contribute-receipt')).not.toBeNull();
    expect(headline()).not.toBeNull();
    // Review's heading first; the headline last and once (composed with the
    // state lane, its in-flight heading may be focused in between on Android).
    expect(texts()[0]).toBe('Review your contribution');
    expect(fx.focused[fx.focused.length - 1]).toBe(headline());
    expect(fx.focused.filter((n) => n === headline())).toHaveLength(1);
    expect(fx.focused.filter((n) => byId('wsf-contribute-receipt')!.contains(n as Node))).toEqual([headline()]);
    const count = fx.focused.length;
    // Re-rendered, and the screen's later answers landing: no second focus, no second announcement.
    await render();
    await settle();
    expect(fx.focused.filter((n) => n === headline())).toHaveLength(1);
    expect(fx.focused).toHaveLength(count);
    expect(receiptSpoken()).toEqual(['Recorded: +35 squats. Shared total: 1,275 of 5,000 squats.']);
  });

  it('iOS: the headline waits the 400 ms like every other focus move, then lands once', async () => {
    fx.os = 'ios';
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    await render();
    act(() => typeInto(byId('wsf-contribute-entry') as HTMLInputElement, '35'));
    await press('wsf-contribute-review');
    fx.focused.length = 0;
    await act(async () => byId('wsf-contribute-submit')!.click());
    for (let i = 0; i < 10; i += 1) await act(async () => undefined);
    expect(headline()).not.toBeNull();
    act(() => vi.advanceTimersByTime(IOS_FOCUS_DELAY_MS - 1));
    expect(fx.focused).toHaveLength(0);
    act(() => vi.advanceTimersByTime(1));
    expect(fx.focused).toEqual([headline()]);
    act(() => vi.advanceTimersByTime(10_000));
    expect(fx.focused).toEqual([headline()]);
  });

  it('Android: Record more, then a second receipt: its own headline takes the focus once more (one per attempt)', async () => {
    await render();
    await recordFromEntry();
    const first = headline();
    expect(fx.focused.filter((n) => n === first)).toHaveLength(1);
    await press('wsf-contribute-record-more');
    expect(headline()).toBeNull();
    answers.wsfContribute = async () => ({ ...RESULT, addedCount: 10, ownCredit: 170, sharedTotal: 1285 });
    await recordFromEntry('10');
    expect(fx.focused[fx.focused.length - 1]).toBe(headline());
    expect(fx.focused.filter((n) => (n as HTMLElement).getAttribute?.('data-testid') === 'wsf-contribute-result-headline')).toHaveLength(2);
    expect(receiptSpoken()).toHaveLength(2);
  });

  it('Android: a kiosk\'s plain receipt is not moved to (and has no Together headline)', async () => {
    params.value = { goalId: 'g1', kiosk: '1' };
    await render();
    await recordFromEntry();
    const receipt = byId('wsf-contribute-receipt');
    expect(receipt).not.toBeNull();
    expect(byId('wsf-together')).toBeNull();
    expect(texts()[0]).toBe('Review your contribution');
    expect(fx.focused).not.toContain(headline());
    expect(fx.focused.some((n) => receipt!.contains(n as Node))).toBe(false);
  });
});

describe('W12-20 on a phone: presented as the MOVE sheet, Close takes the focus once', () => {
  it('Android: Close on the first mount, then each step\'s heading, then the receipt\'s headline; Close never again', async () => {
    params.value = { goalId: 'g1', mode: 'move' };
    await render();
    const close = byId('wsf-contribute-close');
    expect(close).not.toBeNull();
    expect(fx.focused).toEqual([close]);
    expect(fx.registered).toContain('wsf-contribute-close');
    await press('wsf-contribute-done');
    await recordFromEntry();
    expect(texts().slice(0, 3)).toEqual(['Close', 'How many squats did you complete?', 'Review your contribution']);
    expect(fx.focused[fx.focused.length - 1]).toBe(headline());
    expect(fx.focused.filter((n) => n === headline())).toHaveLength(1);
    expect(fx.focused.filter((n) => n === close)).toHaveLength(1);
  });

  it('iOS: Close after the 400 ms wait, once', async () => {
    fx.os = 'ios';
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    params.value = { goalId: 'g1', mode: 'move' };
    act(() => root.render(<ContributeToGoal />));
    for (let i = 0; i < 10; i += 1) await act(async () => undefined);
    expect(fx.focused).toHaveLength(0);
    act(() => vi.advanceTimersByTime(IOS_FOCUS_DELAY_MS));
    expect(fx.focused).toEqual([byId('wsf-contribute-close')]);
    act(() => vi.advanceTimersByTime(10_000));
    expect(fx.focused).toHaveLength(1);
  });

  it('the page (no sheet) has no Close: nothing registered, nothing focused on mount', async () => {
    await render();
    expect(byId('wsf-contribute-close')).toBeNull();
    expect(fx.registered).not.toContain('wsf-contribute-close');
    expect(fx.focused).toHaveLength(0);
  });
});

describe('W12-20 on the web: no focus call (the sheet containment does it)', () => {
  it('the sheet and the receipt walk make no screen-reader call and register nothing', async () => {
    fx.os = 'web';
    params.value = { goalId: 'g1', mode: 'move' };
    await render();
    await press('wsf-contribute-done');
    await recordFromEntry();
    expect(headline()).not.toBeNull();
    expect(fx.focused).toEqual([]);
    expect(fx.registered).toEqual([]);
    // The web's polite live region speaks the receipt; the native helper is not used.
    expect(fx.spoken).toEqual([]);
  });
});

describe('W12-20 site scan', () => {
  it('the receipt focus is keyed on the attempt the receipt confirms, member receipts only, on the headline TogetherCompletion is given', () => {
    expect(ROUTE).toContain('useStepHeadingFocus(lastResult && !kiosk ? `receipt:${receiptAttemptId}` : null, togetherHeadingRef);');
    expect(ROUTE.match(/headingRef=\{togetherHeadingRef\}/g)).toHaveLength(1);
    expect(ROUTE.match(/setReceiptAttemptId\(/g)).toHaveLength(1);
  });
});
