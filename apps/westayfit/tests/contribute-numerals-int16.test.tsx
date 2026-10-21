import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Platform, Text, TextInput } from 'react-native';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * INT-16, the W12-8 remainder: contribute's large numerals take the numeral
 * policy (src/ui/textScale(.native).ts): the receipt's two tiles and its
 * shared count, the closed goal's total, the member's next part and the
 * timer, beside the review quantity and the entry field done in W12-8.
 *
 *   · On a phone each carries numeralTextProps (capped at 1.3x, one line,
 *     shrinking to fit), read from the Text that rendered it.
 *   · On the web the screens' DOM is byte-identical to a snapshot taken
 *     from the code before the change (the twin's props are {}):
 *     tests/fixtures/contribute-numerals-web-before-int16.json. The snapshot
 *     was recorded once with WSF_RECORD_INT16=1, which writes only a missing
 *     file and never replaces one.
 *   · A scan: every style of 24 pt or more in contribute is classified, and
 *     every use of a numeral style spreads the policy (another lane's numeral
 *     shows as a todo until it does).
 * The route renders in jsdom with the callables mocked at the network
 * boundary; textScale is the twin Metro would pick for Platform.OS. No device.
 */
vi.mock('../src/ui/textScale', async () => {
  const { Platform: P } = await import('react-native');
  const web = await vi.importActual<typeof import('../src/ui/textScale')>('../src/ui/textScale');
  const native = await import('../src/ui/textScale.native');
  const twin = () => (P.OS === 'web' ? web : native);
  return {
    get TEXT_SCALE_CAPS() {
      return twin().TEXT_SCALE_CAPS;
    },
    get chromeTextProps() {
      return twin().chromeTextProps;
    },
    get numeralTextProps() {
      return twin().numeralTextProps;
    },
    get numeralInputProps() {
      return twin().numeralInputProps;
    },
    effectiveWidth: (width: number, fontScale: number) => twin().effectiveWidth(width, fontScale),
  };
});
const params = { value: { goalId: 'g1' } as Record<string, string> };
const router = { replace: vi.fn(), push: vi.fn(), back: vi.fn(), canGoBack: () => true, dismissTo: vi.fn(), navigate: vi.fn() };
vi.mock('expo-router', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  router,
  useRouter: () => router,
  useNavigation: () => ({
    dispatch: vi.fn(),
    isFocused: () => true,
    addListener: () => () => undefined,
    setOptions: vi.fn(),
    getState: () => ({ index: 1, routes: [{ key: 't', name: '(tabs)' }, { key: 'c', name: 'contribute/[goalId]' }] }),
  }),
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
vi.mock('../src/ui/useReducedMotion', () => ({
  useReducedMotion: () => true,
  useReducedMotionPreference: () => ({ known: true, reduced: true, failed: false }),
}));
vi.mock('../src/firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: { uid: 'u1', getIdToken: async () => 't' } }),
  getFirebaseFirestore: () => ({}),
  getFirebaseFunctions: () => ({}),
  wsfUsingEmulators: false,
  wsfIsStaging: false,
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(), onAuthStateChanged: () => () => undefined }));
const USER = { uid: 'u1', email: 'member@example.com', displayName: 'Member', emailVerified: true };
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: USER, slow: false }) }));
const answers: Record<string, () => Promise<unknown>> = {};
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => async () => {
    const answer = answers[name];
    if (!answer) throw Object.assign(new Error('internal'), { code: 'functions/internal' });
    return { data: await answer() };
  },
}));

const { clearMemberReads } = await import('../src/memberReads');
const { default: ContributeToGoal } = await import('../app/contribute/[goalId]');

const APP_ROOT = join(__dirname, '..');
const FIXTURE = join(__dirname, 'fixtures', 'contribute-numerals-web-before-int16.json');
const PULSE = { sharedTotal: 1240, target: 5000, unit: 'squats', status: 'active' };
const MINE = { ownCredit: 125, unit: 'squats', repeatPolicy: 'multiple' };
const RESULT = { addedCount: 35, ownCredit: 160, sharedTotal: 1275, target: 5000, unit: 'squats', status: 'active', alreadyRecorded: false };

let container: HTMLDivElement;
let root: Root;
let os: string;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await act(async () => undefined);
};
const press = async (id: string) => {
  await act(async () => byId(id)!.click());
  await settle();
};
/** A new screen from a clean start: unmounted, the account's record and the stored attempts cleared, the goal open again. */
const nextScreen = () => {
  act(() => root.unmount());
  clearMemberReads();
  localStorage.clear();
  answers.wsfGoalPulse = async () => PULSE;
  root = createRoot(container);
};
const typeInto = (el: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() => {
  os = Platform.OS;
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 21, 15, 41), toFake: ['Date'] });
  params.value = { goalId: 'g1' };
  clearMemberReads();
  localStorage.clear();
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
  (Platform as { OS: string }).OS = os;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Each screen with a large numeral, reached as a member reaches it; returns the element that holds it. */
const SCREENS: Record<string, () => Promise<HTMLElement>> = {
  async entryWithNextPart() {
    params.value = { goalId: 'g1' };
    act(() => root.render(<ContributeToGoal />));
    await settle();
    act(() => typeInto(byId('wsf-contribute-entry') as HTMLInputElement, '35'));
    await settle();
    return byId('wsf-contribute-entry-screen')!;
  },
  async receipt() {
    params.value = { goalId: 'g1' };
    act(() => root.render(<ContributeToGoal />));
    await settle();
    act(() => typeInto(byId('wsf-contribute-entry') as HTMLInputElement, '35'));
    await press('wsf-contribute-review');
    await press('wsf-contribute-submit');
    return byId('wsf-contribute-receipt')!;
  },
  async closed() {
    params.value = { goalId: 'g1' };
    answers.wsfGoalPulse = async () => ({ ...PULSE, status: 'closed' });
    act(() => root.render(<ContributeToGoal />));
    await settle();
    return byId('wsf-contribute-closed')!;
  },
  async moveTimer() {
    params.value = { goalId: 'g1', mode: 'move' };
    act(() => root.render(<ContributeToGoal />));
    await settle();
    return byId('wsf-contribute-move-screen')!;
  },
};
/** The screens the web snapshot holds (recorded before the change). */
const SNAPSHOT_SCREENS = ['entryWithNextPart', 'receipt', 'closed', 'moveTimer'];
/*
  The receipt with the tiles is a kiosk session's (a member's own receipt is
  the motion lane's Together completion, whose numerals are its own).
*/
async function kioskReceipt(): Promise<HTMLElement> {
  params.value = { goalId: 'g1', kiosk: '1' };
  act(() => root.render(<ContributeToGoal />));
  await settle();
  act(() => typeInto(byId('wsf-contribute-entry') as HTMLInputElement, '35'));
  await press('wsf-contribute-review');
  await press('wsf-contribute-submit');
  return byId('wsf-contribute-receipt')!;
}

describe('INT-16: the web\'s screens are the DOM they were before', () => {
  const recorded: Record<string, string> = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : {};
  const record = process.env.WSF_RECORD_INT16 === '1' && !existsSync(FIXTURE);
  const fresh: Record<string, string> = {};

  it.each(SNAPSHOT_SCREENS)('%s: identical to the snapshot', async (name) => {
    (Platform as { OS: string }).OS = 'web';
    const el = await SCREENS[name]!();
    expect(el).not.toBeNull();
    if (record) {
      fresh[name] = el.outerHTML;
      if (Object.keys(fresh).length === SNAPSHOT_SCREENS.length) {
        // Written once, before the change, and never over an existing file.
        writeFileSync(FIXTURE, `${JSON.stringify(fresh, null, 2)}\n`, { flag: 'wx' });
      }
      return;
    }
    expect(Object.keys(recorded).sort()).toEqual([...SNAPSHOT_SCREENS].sort());
    expect(el.outerHTML).toBe(recorded[name]);
  });
});

describe('INT-16: on a phone each large numeral takes the numeral policy', () => {
  type Fiber = { type: unknown; return: Fiber | null; alternate: Fiber | null; memoizedProps: Record<string, unknown> };
  /** The props of the nearest component of `type` above `el`. */
  function propsOf(el: Element, type: unknown): Record<string, unknown> {
    const own = el as unknown as Record<string, unknown>;
    const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))!;
    let fiber = own[fiberKey] as Fiber;
    while (fiber && fiber.type !== type) fiber = fiber.return as Fiber;
    if (!fiber) throw new Error('no such component above the element');
    return fiber.memoizedProps;
  }
  const POLICY = { maxFontSizeMultiplier: 1.3, numberOfLines: 1, adjustsFontSizeToFit: true, minimumFontScale: 0.5 };
  const phoneProps = (el: Element) => {
    const p = propsOf(el, Text);
    return Object.fromEntries(Object.keys(POLICY).filter((k) => k in p).map((k) => [k, p[k]]));
  };
  /** The innermost element whose own text starts with `text`. */
  const textEl = (scope: Element, text: string) => {
    const found = Array.from(scope.querySelectorAll('*'))
      .filter((el) => Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').startsWith(text)))
      .pop();
    if (!found) throw new Error(`no element with text "${text}"`);
    return found;
  };

  it.each(['ios', 'android'] as const)('%s: the kiosk receipt\'s tiles and shared count, the closed total, the next part and the timer', async (platform) => {
    (Platform as { OS: string }).OS = platform;
    const receipt = await kioskReceipt();
    expect(phoneProps(receipt.querySelector('[data-testid="wsf-contribute-result-amount"]')!)).toEqual(POLICY);
    // The receipt's own tile (the anchor above carries an own-credit line of its own).
    expect(phoneProps(textEl(receipt.querySelector('[data-testid="wsf-contribute-own-credit"]')!, '160'))).toEqual(POLICY);
    expect(phoneProps(textEl(receipt, '1,275'))).toEqual(POLICY);
    nextScreen();
    const closed = await SCREENS.closed!();
    expect(phoneProps(byId('wsf-contribute-shared-total')!)).toEqual(POLICY);
    expect(closed).not.toBeNull();
    nextScreen();
    await SCREENS.entryWithNextPart!();
    expect(phoneProps(byId('wsf-contribute-your-part-next')!)).toEqual(POLICY);
    nextScreen();
    await SCREENS.moveTimer!();
    expect(phoneProps(byId('wsf-contribute-timer-clock')!)).toEqual(POLICY);
  });

  it('web: the kiosk receipt\'s tiles and shared count take none of it (the twin is empty)', async () => {
    (Platform as { OS: string }).OS = 'web';
    const receipt = await kioskReceipt();
    expect(phoneProps(receipt.querySelector('[data-testid="wsf-contribute-result-amount"]')!)).toEqual({});
    expect(phoneProps(textEl(receipt.querySelector('[data-testid="wsf-contribute-own-credit"]')!, '160'))).toEqual({});
    expect(phoneProps(textEl(receipt, '1,275'))).toEqual({});
  });

  it('the review quantity and the entry field keep W12-8\'s props', async () => {
    (Platform as { OS: string }).OS = 'ios';
    await SCREENS.entryWithNextPart!();
    const entry = propsOf(byId('wsf-contribute-entry')!, TextInput);
    expect(entry.maxFontSizeMultiplier).toBe(1.3);
  });
});

describe('INT-16: every large numeral in contribute uses the policy (scan)', () => {
  type Kind =
    | { kind: 'numeral'; owner: 'integrator' }
    | { kind: 'numeral'; owner: string; ticket: string }
    | { kind: 'input' }
    | { kind: 'words' | 'glyph' };
  /** Every style of 24 pt or more in contribute, and what it draws. A new one fails until it is listed here. */
  const STYLES: Record<string, Kind> = {
    tileValue: { kind: 'numeral', owner: 'integrator' },
    sharedCount: { kind: 'numeral', owner: 'integrator' },
    heroTotal: { kind: 'numeral', owner: 'integrator' },
    reviewQuantity: { kind: 'numeral', owner: 'integrator' },
    yoursNext: { kind: 'numeral', owner: 'integrator' },
    timerClock: { kind: 'numeral', owner: 'integrator' },
    timerClockShort: { kind: 'numeral', owner: 'integrator' },
    adjustValue: { kind: 'numeral', owner: 'camera', ticket: 'W15' },
    entryInput: { kind: 'input' },
    entryInputShort: { kind: 'input' },
    stepHeading: { kind: 'words' },
    heading: { kind: 'words' },
    heroHeadline: { kind: 'words' },
    adjustButtonText: { kind: 'glyph' },
    stepButtonText: { kind: 'glyph' },
  };
  const source = readFileSync(join(APP_ROOT, 'app/contribute/[goalId].tsx'), 'utf8');
  const sf = ts.createSourceFile('c.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const big = new Map<string, number>();
  const uses: Array<{ key: string; spreads: string[]; line: number }> = [];
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && n.expression.getText() === 'StyleSheet.create' && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) {
      for (const p of n.arguments[0].properties) {
        if (!ts.isPropertyAssignment(p) || !ts.isObjectLiteralExpression(p.initializer)) continue;
        for (const q of p.initializer.properties) {
          if (ts.isPropertyAssignment(q) && q.name.getText() === 'fontSize' && ts.isNumericLiteral(q.initializer) && Number(q.initializer.text) >= 24) {
            big.set(p.name.getText(), Number(q.initializer.text));
          }
        }
      }
    }
    if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
      const style = n.attributes.properties.find((a) => ts.isJsxAttribute(a) && a.name.getText() === 'style');
      const spreads = n.attributes.properties.filter(ts.isJsxSpreadAttribute).map((a) => a.expression.getText());
      for (const m of style?.getText().matchAll(/styles\.(\w+)/g) ?? []) {
        uses.push({ key: m[1]!, spreads, line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);

  it('every style of 24 pt or more is listed (the scan found them)', () => {
    expect(big.size).toBeGreaterThan(10);
    expect([...big.keys()].filter((k) => !(k in STYLES))).toEqual([]);
    expect(Object.keys(STYLES).filter((k) => !big.has(k))).toEqual([]);
  });

  it('each use of an integrator numeral spreads numeralTextProps; the entry field numeralInputProps', () => {
    const missing = uses
      .filter((u) => STYLES[u.key]?.kind === 'numeral' && (STYLES[u.key] as { owner: string }).owner === 'integrator')
      .filter((u) => !u.spreads.includes('numeralTextProps'))
      .map((u) => `${u.key}@${u.line}`);
    expect(missing).toEqual([]);
    const inputs = uses.filter((u) => STYLES[u.key]?.kind === 'input');
    expect(inputs.length).toBeGreaterThan(0);
    // The entry's spread sits on a line of its own inside the element (W12-8); the source pins it.
    expect(source).toMatch(/testID="wsf-contribute-entry"[\s\S]{0,200}\{\.\.\.numeralInputProps\}/);
  });

  for (const [key, kind] of Object.entries(STYLES)) {
    if (kind.kind !== 'numeral' || kind.owner === 'integrator') continue;
    const adopted = uses.filter((u) => u.key === key).every((u) => u.spreads.includes('numeralTextProps'));
    const { owner, ticket } = kind as { owner: string; ticket: string };
    if (adopted) it(`${ticket} (${owner}): ${key} spreads numeralTextProps`, () => expect(adopted).toBe(true));
    else it.todo(`${ticket} (${owner}): ${key} adopts numeralTextProps`);
  }
});
