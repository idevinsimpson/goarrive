import { act, createElement, type ReactNode, type Ref } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

/**
 * W15-1 (INT-16, INT-17) — the camera's Adjust step adopts the shared native
 * accessibility policies, through the REAL contribute screen:
 *   · the adjusted number (`adjustValue`) spreads `numeralTextProps`
 *     (src/ui/textScale(.native).ts): on a phone it is capped at 1.3x, kept on
 *     one line and shrinks to fit; on the web the props are empty;
 *   · the Adjust heading takes `useStepHeadingFocus`
 *     (src/ui/stepHeadingFocus(.native).ts): on a phone the screen reader moves
 *     to it when the step changes to Adjust (camera Finish, or Edit from the
 *     review), never on the first mount; on the web it is a no-op.
 *
 * vitest applies no platform extensions, so the native run swaps in the
 * `.native` twins of those two modules and sets `Platform.OS` to 'ios'; the
 * web run keeps the web twins. The camera itself is a stub whose Finish hands
 * the screen 12 squats, exactly as `CameraRepCounter`'s `onFinish` does. The
 * camera gate is not touched here (its property test is in
 * move-camera-native-adapter.test.ts).
 */

const rn = vi.hoisted(() => ({
  os: 'web' as 'ios' | 'web',
  focused: [] as unknown[],
  textProps: new Map<string, Record<string, unknown>>(),
}));

vi.mock('react-native', async () => {
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  const { createElement: h, forwardRef: fwd } = await import('react');
  // Text, recording the props each testID'd Text was given (react-native-web drops the native ones).
  const Text = fwd((props: Record<string, unknown>, ref: Ref<unknown>) => {
    if (typeof props.testID === 'string') rn.textProps.set(props.testID, props);
    return h(actual.Text, { ...props, ref });
  });
  return {
    ...actual,
    Text,
    Platform: {
      ...actual.Platform,
      get OS() {
        return rn.os;
      },
      select: (o: Record<string, unknown>) => (rn.os in o ? o[rn.os] : rn.os !== 'web' && 'native' in o ? o.native : o.default),
    },
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      setAccessibilityFocus: (node: unknown) => {
        rn.focused.push(node);
      },
    },
    // The host node itself stands in for the native tag.
    findNodeHandle: (instance: unknown) => instance ?? null,
    InteractionManager: { runAfterInteractions: (run: () => void) => (queueMicrotask(run), { cancel: () => undefined }) },
  };
});

// The two shared modules, as Metro would resolve them on a phone (rn.os 'ios') or on the web.
vi.mock('../src/ui/textScale', async () => {
  const web = await vi.importActual<typeof import('../src/ui/textScale')>('../src/ui/textScale');
  const native = await vi.importActual<typeof import('../src/ui/textScale.native')>('../src/ui/textScale.native');
  return {
    get numeralTextProps() {
      return rn.os === 'web' ? web.numeralTextProps : native.numeralTextProps;
    },
  };
});
vi.mock('../src/ui/stepHeadingFocus', async () => {
  const web = await vi.importActual<typeof import('../src/ui/stepHeadingFocus')>('../src/ui/stepHeadingFocus');
  const native = await vi.importActual<typeof import('../src/ui/stepHeadingFocus.native')>('../src/ui/stepHeadingFocus.native');
  return {
    useStepHeadingFocus: (key: string | number | null | undefined, ref: { current: unknown }) =>
      (rn.os === 'web' ? web.useStepHeadingFocus : native.useStepHeadingFocus)(key, ref as never),
  };
});

const UID = 'member-1';
const GOAL = 'goal-1';
vi.mock('../src/featureFlags', async (importOriginal) => ({ ...(await importOriginal<object>()), wsfAuthEnabled: true }));
vi.mock('../src/firebase', () => ({
  getFirebaseFunctions: () => ({}),
  getFirebaseFirestore: () => ({}),
  getFirebaseAuth: () => ({ currentUser: { uid: UID } }),
  wsfUsingEmulators: false,
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(), onAuthStateChanged: () => () => undefined }));
const pulse = { sharedTotal: 100, target: 1000, unit: 'squats', status: 'active' };
vi.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => async () => {
    if (name === 'wsfGoalPulse') return { data: pulse };
    throw new Error(`unexpected callable ${name}`);
  },
}));
vi.mock('../src/memberReads', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  peekGoals: () => undefined,
  peekOwnCredit: () => undefined,
  readOwnCredit: async () => ({ ownCredit: 0 }),
  readGoals: async () => ({ goals: [] }),
  readMyCommunities: async () => ({ items: [] }),
}));
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: { uid: UID, emailVerified: true } }) }));
vi.mock('expo-router', () => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), canGoBack: () => false, dismissTo: vi.fn() },
  useLocalSearchParams: () => ({ goalId: GOAL, mode: 'move' }),
  usePathname: () => `/contribute/${GOAL}`,
  useNavigation: () => ({
    getState: () => ({ index: 0, routes: [{ key: 'c', name: 'contribute/[goalId]', params: { goalId: GOAL, mode: 'move' } }] }),
    isFocused: () => true,
    addListener: () => () => undefined,
    dispatch: vi.fn(),
    canGoBack: () => false,
  }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => createElement('a', { href }, children),
}));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
vi.mock('../src/movement-camera/support', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  cameraCounterSupported: () => true,
}));
// The camera: Finish hands the screen 12 squats.
vi.mock('../src/ui/CameraRepCounter', async () => {
  const { createElement: h } = await import('react');
  return {
    CameraRepCounter: ({ onFinish }: { onFinish: (n: number) => void }) =>
      h('button', { 'data-testid': 'stub-camera-finish', onClick: () => onFinish(12) }, 'Finish'),
  };
});

const { default: ContributeToGoal } = await import('../app/contribute/[goalId]');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no matchMedia; the screen's reduced-motion hook reads it on the web. Reduced motion is
// on, so no animation runs during a test.
window.matchMedia ??= ((query: string) =>
  ({ matches: query.includes('reduce'), media: query, addEventListener: () => undefined, removeEventListener: () => undefined }) as unknown as MediaQueryList);

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  rn.os = 'web';
  rn.focused = [];
  rn.textProps.clear();
  localStorage.clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  rn.os = 'web';
});

const byTestId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
/**
 * Lets loads, lazy chunks and timers settle in real time, then flushes React. It waits outside act():
 * an async act() around this whole screen did not return.
 */
const settle = async (ms = 0) => {
  await new Promise<void>((r) => setTimeout(r, ms));
  act(() => undefined);
};
async function until(id: string): Promise<HTMLElement> {
  for (let i = 0; i < 50 && !byTestId(id); i += 1) await settle(10);
  const el = byTestId(id);
  if (!el) throw new Error(`${id} never rendered: ${container.innerHTML.slice(0, 400)}`);
  return el;
}
const press = (id: string) => act(() => byTestId(id)!.click());

/** Opens the screen in move mode and finishes the (stub) camera: the Adjust step. */
async function toAdjust(): Promise<void> {
  act(() => root.render(createElement(ContributeToGoal)));
  await until('stub-camera-finish');
  press('stub-camera-finish');
  await until('wsf-contribute-adjust-heading');
}

const NUMERAL = { maxFontSizeMultiplier: 1.3, numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.5 };
const NUMERAL_KEYS = Object.keys(NUMERAL);

describe('native (Platform.OS ios, .native twins)', () => {
  it('the adjusted number is capped at 1.3x, on one line, shrinking to fit', async () => {
    rn.os = 'ios';
    await toAdjust();
    expect(byTestId('wsf-contribute-adjust-value')!.textContent).toBe('12');
    expect(rn.textProps.get('wsf-contribute-adjust-value')).toMatchObject(NUMERAL);
    // Only the number: the heading and the note stay as they were.
    for (const id of ['wsf-contribute-adjust-heading', 'wsf-contribute-adjust-note']) {
      for (const k of NUMERAL_KEYS) expect(rn.textProps.get(id), `${id} ${k}`).not.toHaveProperty(k);
    }
  }, 20_000);

  it('the Adjust heading takes the screen reader on each step change to it, never on the first mount', async () => {
    rn.os = 'ios';
    act(() => root.render(createElement(ContributeToGoal)));
    await until('stub-camera-finish');
    await settle(450);
    expect(rn.focused).toEqual([]); // the first mount and the camera step: nothing moved
    press('stub-camera-finish');
    await until('wsf-contribute-adjust-heading');
    await settle(450); // iOS moves the focus ~400 ms after the change settles (timed in focus-return-native)
    expect(rn.focused).toHaveLength(1);
    expect(rn.focused[0]).toBe(byTestId('wsf-contribute-adjust-heading'));
    expect((rn.focused[0] as HTMLElement).textContent).toBe('We counted 12 squats');
    // Continue to the review (not this hook's heading), then Edit back to Adjust: focused again.
    press('wsf-contribute-adjust-continue');
    await until('wsf-contribute-review-screen');
    await settle(450);
    expect(rn.focused).toHaveLength(1);
    press('wsf-contribute-edit');
    await until('wsf-contribute-adjust-heading');
    await settle(450);
    expect(rn.focused).toHaveLength(2);
    expect(rn.focused[1]).toBe(byTestId('wsf-contribute-adjust-heading'));
    expect((rn.focused[1] as HTMLElement).textContent).toBe('We counted 12 squats');
  }, 20_000);
});

describe('web (the web twins): nothing changes', () => {
  it('the adjusted number gets no numeral props (no line clamp), and focus is never moved', async () => {
    await toAdjust();
    const props = rn.textProps.get('wsf-contribute-adjust-value')!;
    for (const k of NUMERAL_KEYS) expect(props, k).not.toHaveProperty(k);
    const value = byTestId('wsf-contribute-adjust-value')!;
    expect(value.getAttribute('style') ?? '').not.toMatch(/line-clamp|text-overflow|ellipsis/);
    press('wsf-contribute-adjust-continue');
    await until('wsf-contribute-review-screen');
    press('wsf-contribute-edit');
    await until('wsf-contribute-adjust-heading');
    await settle(450);
    expect(rn.focused).toEqual([]);
  }, 20_000);
});

describe('the adoption sites in the source', () => {
  const code = readFileSync(nodePath.resolve(__dirname, '..', 'app/contribute/[goalId].tsx'), 'utf8');
  it('adjustValue spreads numeralTextProps; the Adjust heading carries the ref useStepHeadingFocus moves to', () => {
    expect(code).toContain("import { useStepHeadingFocus } from '../../src/ui/stepHeadingFocus';");
    expect(code).toContain("import { numeralTextProps } from '../../src/ui/textScale';");
    expect(code.match(/<Text style=\{styles\.adjustValue\}[^>]*>/g)).toEqual([
      '<Text style={styles.adjustValue} {...numeralTextProps} testID="wsf-contribute-adjust-value" aria-live="polite">',
    ]);
    expect(code).toContain('<Text ref={adjustHeadingRef} style={styles.stepHeading} {...HEADING_1} testID="wsf-contribute-adjust-heading">');
    // One call, at the top level with the other hooks (before the first early return), keyed to the Adjust step.
    expect(code.match(/useStepHeadingFocus\(/g)).toHaveLength(1);
    expect(code).toContain("useStepHeadingFocus(step === 'adjust' ? 'adjust' : null, adjustHeadingRef);");
    expect(code.indexOf('useStepHeadingFocus(step')).toBeLessThan(code.indexOf('return screen('));
  });
});
