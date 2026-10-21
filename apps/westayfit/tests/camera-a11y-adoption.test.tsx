import { act, createElement, useEffect, type ReactNode, type Ref } from 'react';
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
 *
 * W15-3 (MF-18, INT-31) — the MOVE settings switches (MoveCameraSettingsSection):
 * on iOS and Android each switch carries its hint as accessibilityHint (the web
 * keeps aria-describedby, unchanged), and the knob spreads lift.knob (elevation
 * 2 on Android, nothing on iOS or the web). This is LATENT: on a phone the
 * section is drawn only where the counter can run, which support.native.ts
 * refuses while the telemetry gate is off. The support check is mocked as
 * supported in this file only.
 */

const rn = vi.hoisted(() => ({
  os: 'web' as 'ios' | 'android' | 'web',
  /** Each screen-reader focus move, with what the node was when focus moved (React may reuse a node across steps). */
  focused: [] as Array<{ node: unknown; testID: string | null; text: string | null }>,
  textProps: new Map<string, Record<string, unknown>>(),
  /** The props each testID'd Pressable was given (react-native-web drops accessibilityHint). */
  pressProps: new Map<string, Record<string, unknown>>(),
  /** Each switch knob's flattened style, in render order (react-native-web turns styles into classes). */
  knobStyles: [] as Record<string, unknown>[],
}));

vi.mock('react-native', async () => {
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  const { createElement: h, forwardRef: fwd } = await import('react');
  // Text, recording the props each testID'd Text was given (react-native-web drops the native ones).
  const Text = fwd((props: Record<string, unknown>, ref: Ref<unknown>) => {
    if (typeof props.testID === 'string') rn.textProps.set(props.testID, props);
    return h(actual.Text, { ...props, ref });
  });
  const Pressable = fwd((props: Record<string, unknown>, ref: Ref<unknown>) => {
    if (typeof props.testID === 'string') rn.pressProps.set(props.testID, props);
    return h(actual.Pressable, { ...props, ref });
  });
  const View = fwd((props: Record<string, unknown>, ref: Ref<unknown>) => {
    const flat = (actual.StyleSheet.flatten(props.style) ?? {}) as Record<string, unknown>;
    // The knob: the switch's 20 pt disc.
    if (flat.width === 20 && flat.height === 20 && flat.borderRadius === 10) rn.knobStyles.push(flat);
    return h(actual.View, { ...props, ref });
  });
  return {
    ...actual,
    Text,
    Pressable,
    View,
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
        const el = node as HTMLElement | null;
        rn.focused.push({ node, testID: el?.getAttribute?.('data-testid') ?? null, text: el?.textContent ?? null });
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
  // Every export, read from the twin for rn.os (kit re-exports them all on integrated trees).
  return Object.defineProperties(
    {},
    Object.fromEntries(Object.keys(web).map((k) => [k, { enumerable: true, get: () => (rn.os === 'web' ? web : native)[k as keyof typeof web] }])),
  );
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
  // The screen is always focused here: the effect runs on mount and again when it changes, and its
  // cleanup runs before a re-run and on unmount (integrated trees register Android Back with it).
  useFocusEffect: (effect: () => void | (() => void)) => useEffect(() => effect(), [effect]),
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
  rn.pressProps.clear();
  rn.knobStyles.length = 0;
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
    // Only moves to the Adjust heading count: other steps' headings may take focus with calls of their own.
    const toAdjustHeading = () => rn.focused.filter((f) => f.testID === 'wsf-contribute-adjust-heading');
    expect(toAdjustHeading()).toHaveLength(1);
    expect(toAdjustHeading()[0].node).toBe(byTestId('wsf-contribute-adjust-heading'));
    expect(toAdjustHeading()[0].text).toBe('We counted 12 squats');
    // Continue to the review: no move to the Adjust heading. Edit back to Adjust: it takes focus again.
    press('wsf-contribute-adjust-continue');
    await until('wsf-contribute-review-screen');
    await settle(450);
    expect(toAdjustHeading()).toHaveLength(1);
    press('wsf-contribute-edit');
    await until('wsf-contribute-adjust-heading');
    await settle(450);
    expect(toAdjustHeading()).toHaveLength(2);
    expect(toAdjustHeading()[1].node).toBe(byTestId('wsf-contribute-adjust-heading'));
    expect(toAdjustHeading()[1].text).toBe('We counted 12 squats');
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
    // numeralTextProps is imported once: from textScale, or from kit, which re-exports it (integrated
    // trees, W12-8). Never from a platform twin directly.
    const numeralImports = code.match(/^import \{[^}]*\bnumeralTextProps\b[^}]*\} from '[^']+';$/gm) ?? [];
    expect(numeralImports).toHaveLength(1);
    expect(numeralImports[0]).toMatch(/ from '\.\.\/\.\.\/src\/ui\/(?:textScale|kit)';$/);
    expect(code.match(/<Text style=\{styles\.adjustValue\}[^>]*>/g)).toEqual([
      '<Text style={styles.adjustValue} {...numeralTextProps} testID="wsf-contribute-adjust-value" aria-live="polite">',
    ]);
    expect(code).toContain('<Text ref={adjustHeadingRef} style={styles.stepHeading} {...HEADING_1} testID="wsf-contribute-adjust-heading">');
    // The Adjust call exactly once, at the top level with the other hooks (before the first early
    // return), keyed to the Adjust step. Other steps' headings may have calls of their own.
    const ADJUST_CALL = "useStepHeadingFocus(step === 'adjust' ? 'adjust' : null, adjustHeadingRef);";
    expect(code.split(ADJUST_CALL)).toHaveLength(2);
    expect(code.indexOf(ADJUST_CALL)).toBeLessThan(code.indexOf('return screen('));
  });
});

describe('W15-3: the MOVE settings switches (MF-18, INT-31), latent while the section is hidden on a phone', () => {
  const SWITCHES = [
    ['wsf-settings-camera-counter', 'Automatically count squats with your camera.'],
    ['wsf-settings-stick-figure', 'Show the body guide while you move.'],
  ] as const;
  /** The section, imported afresh with the platform set first: lift.ts picks its tokens at import. */
  async function renderSection(os: 'ios' | 'android' | 'web'): Promise<void> {
    rn.os = os;
    vi.resetModules();
    const { MoveCameraSettingsSection } = await import('../src/movement-camera/MoveCameraSettingsSection');
    act(() => root.render(createElement(MoveCameraSettingsSection)));
    expect(byTestId('wsf-settings-move'), os).not.toBeNull(); // supported (mocked in this file only)
  }

  for (const os of ['ios', 'android'] as const) {
    it(`${os}: each switch carries its hint for VoiceOver / TalkBack, beside the unchanged aria-describedby`, async () => {
      await renderSection(os);
      for (const [id, hint] of SWITCHES) {
        expect(rn.pressProps.get(id), id).toMatchObject({ accessibilityHint: hint, 'aria-describedby': `${id}-hint`, accessibilityLabel: expect.any(String) });
      }
    });
  }

  it('web: no accessibilityHint; aria-describedby still names the visible hint', async () => {
    await renderSection('web');
    for (const [id, hint] of SWITCHES) {
      expect(rn.pressProps.get(id), id).not.toHaveProperty('accessibilityHint');
      expect(rn.pressProps.get(id)?.['aria-describedby'], id).toBe(`${id}-hint`);
      expect(byTestId(id)!.getAttribute('aria-describedby'), id).toBe(`${id}-hint`);
      expect(container.querySelector(`[id="${id}-hint"]`)?.textContent, id).toBe(hint);
    }
  });

  // Today's knob, as the stylesheet defines it (on adds marginLeft 24).
  const KNOB = {
    width: 20,
    height: 20,
    borderRadius: 10,
    marginLeft: 4,
    backgroundColor: expect.any(String),
    shadowColor: expect.any(String),
    shadowOpacity: 0.2,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  };
  /** The last render's two knobs: the counter's (on) and, after one press, the stick figure's (off). */
  async function knobsOn(os: 'ios' | 'android' | 'web'): Promise<[Record<string, unknown>, Record<string, unknown>]> {
    await renderSection(os);
    press('wsf-settings-stick-figure');
    expect(rn.pressProps.get('wsf-settings-stick-figure')?.['aria-checked']).toBe(false);
    const [on, off] = rn.knobStyles.slice(-2);
    return [on, off];
  }

  it('Android: lift.knob, elevation 2, on both knobs, on and off', async () => {
    const [on, off] = await knobsOn('android');
    expect(on).toEqual({ ...KNOB, elevation: 2, marginLeft: 24 });
    expect(off).toEqual({ ...KNOB, elevation: 2 });
  });

  it("iOS: the knob's own shadow, no elevation", async () => {
    const [on, off] = await knobsOn('ios');
    expect(on).toEqual({ ...KNOB, marginLeft: 24 });
    expect(off).toEqual(KNOB);
  });

  it("web: today's knob exactly (lift.knob is {})", async () => {
    const [on, off] = await knobsOn('web');
    expect(on).toEqual({ ...KNOB, marginLeft: 24 });
    expect(off).toEqual(KNOB);
    expect('elevation' in on || 'elevation' in off).toBe(false);
  });
});
