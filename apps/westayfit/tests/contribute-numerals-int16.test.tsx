import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
 *   · On a phone a count-only root Text (the receipt's addition, the next
 *     part, the timer) carries numeralTextProps: capped at 1.3x, one line,
 *     and shrinking to fit (minimumFontScale 0.5 asks for half size; Fabric
 *     ignores it and its floor is 4 pt, RV15-641-1). A line that mixes a
 *     numeral with words, its unit free text up to 40 characters (the closed
 *     total, the own-credit tile, the receipt's shared total, the review
 *     quantity), takes numeralCapProps, the cap only, so it still wraps at
 *     the default size. A nested <Text> span passes only the cap to native
 *     (RV15-641-4), so a span never carries the shrink props. Read from the
 *     Text that rendered each.
 *   · On the web the screens' DOM is byte-identical to a snapshot taken
 *     from the code before the change (the twin's props are {}):
 *     tests/fixtures/contribute-numerals-web-before-int16.json. The snapshot
 *     was recorded once with WSF_RECORD_INT16=1, which writes only a missing
 *     file and never replaces one. Absolute asset paths are held from
 *     `assets/` on, as `<APP_ROOT>/assets/…` (`portable`), so any checkout
 *     compares the same.
 *   · A scan: every style of 24 pt or more in contribute is classified, and
 *     each use is judged where it stands: a count-only root spreads
 *     numeralTextProps, a paragraph with a nested Text or a words line spreads
 *     numeralCapProps, and a nested span never spreads numeralTextProps
 *     (another lane's numeral shows as a todo until it adopts the policy).
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

/*
  Candidate-12 run 1: vitest gives an imported image the absolute path of its
  file in this checkout (…/apps/westayfit/assets/brand/derived/…png), and the
  receipt and closed screens draw such images. So the DOM is compared with
  every absolute path into an assets directory written from `assets/` on, as
  `<APP_ROOT>/assets/…`: the same in any checkout, CI or temporary merge. A
  URL with a scheme (https://…) is left as it is. Nothing else in the DOM is
  touched.

  RV16-641-4 (heads-14): the root is this checkout's own, exactly (APP_ROOT,
  and its real path where that differs, the longer first), not guessed from
  the first '/assets/' in a path: under a directory named `assets`
  (/Users/x/assets/goarrive/…) the guess kept the rest of the checkout path.
*/
const portableFrom = (roots: readonly string[]) => (html: string) =>
  [...roots]
    .sort((a, b) => b.length - a.length)
    .reduce((h, root) => h.split(`${root}/assets/`).join('<APP_ROOT>/assets/'), html);
const portable = portableFrom([...new Set([APP_ROOT, realpathSync(APP_ROOT)])]);

describe('INT-16: the web\'s screens are the DOM they were before', () => {
  const recorded: Record<string, string> = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : {};
  const record = process.env.WSF_RECORD_INT16 === '1' && !existsSync(FIXTURE);
  const fresh: Record<string, string> = {};

  it('portable: this checkout\'s own asset paths become <APP_ROOT>/assets/, and nothing else changes', () => {
    const at = (root: string) => `<div style="background-image: url(&quot;${root}/assets/brand/derived/monogram-fill-green.png&quot;);"></div><img src="${root}/assets/a.png">`;
    expect(portable(at(APP_ROOT))).toBe(at('<APP_ROOT>'));
    expect(portableFrom(['/home/runner/work/goarrive/apps/westayfit'])(at('/home/runner/work/goarrive/apps/westayfit'))).toBe(at('<APP_ROOT>'));
    // RV16-641-4: a checkout under a directory named `assets`.
    const inAssets = '/Users/x/assets/goarrive/apps/westayfit';
    expect(portableFrom([inAssets])(at(inAssets))).toBe(at('<APP_ROOT>'));
    // A root and its real path, one inside the other (macOS /var -> /private/var): the longer is taken first.
    expect(portableFrom(['/var/x/apps/westayfit', '/private/var/x/apps/westayfit'])(at('/private/var/x/apps/westayfit'))).toBe(at('<APP_ROOT>'));
    // Nothing is guessed: a path into another checkout is not this one's.
    expect(portable(at('/elsewhere/apps/westayfit'))).toBe(at('/elsewhere/apps/westayfit'));
    const other = '<img src="https://example.com/assets/a.png"><p>assets/ 1,275 squats</p>';
    expect(portable(other)).toBe(other);
  });

  it('the snapshot holds no path into a checkout', () => {
    for (const html of Object.values(recorded)) {
      expect(portable(html)).toBe(html);
      expect(html).not.toMatch(/apps\/westayfit\//);
    }
  });

  it.each(SNAPSHOT_SCREENS)('%s: identical to the snapshot', async (name) => {
    (Platform as { OS: string }).OS = 'web';
    const el = await SCREENS[name]!();
    expect(el).not.toBeNull();
    if (record) {
      fresh[name] = portable(el.outerHTML);
      if (Object.keys(fresh).length === SNAPSHOT_SCREENS.length) {
        // Written once, before the change, and never over an existing file.
        writeFileSync(FIXTURE, `${JSON.stringify(fresh, null, 2)}\n`, { flag: 'wx' });
      }
      return;
    }
    expect(Object.keys(recorded).sort()).toEqual([...SNAPSHOT_SCREENS].sort());
    expect(portable(el.outerHTML)).toBe(recorded[name]);
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
  /** RV15-641-1: the cap alone, for a line that mixes a numeral with words, and for a nested span. */
  const CAP = { maxFontSizeMultiplier: 1.3 };
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

  it.each(['ios', 'android'] as const)('%s: count-only roots take the policy; lines with words, and nested spans, the cap only', async (platform) => {
    (Platform as { OS: string }).OS = platform;
    const receipt = await kioskReceipt();
    expect(phoneProps(receipt.querySelector('[data-testid="wsf-contribute-result-amount"]')!)).toEqual(POLICY);
    // The receipt's own tile (the anchor above carries an own-credit line of its own): the total and its unit, one paragraph.
    expect(phoneProps(textEl(receipt.querySelector('[data-testid="wsf-contribute-own-credit"]')!, '160'))).toEqual(CAP);
    // The shared total: the words line, and its count, a nested span.
    expect(phoneProps(receipt.querySelector('[data-testid="wsf-contribute-shared-total"]')!)).toEqual(CAP);
    expect(phoneProps(textEl(receipt, '1,275'))).toEqual(CAP);
    nextScreen();
    const closed = await SCREENS.closed!();
    expect(closed).not.toBeNull();
    // RV15-641-1: "N of M <unit>" still wraps at the default size: no one-line or shrink props at all.
    const hero = propsOf(byId('wsf-contribute-shared-total')!, Text);
    expect(phoneProps(byId('wsf-contribute-shared-total')!)).toEqual(CAP);
    expect('numberOfLines' in hero || 'adjustsFontSizeToFit' in hero || 'minimumFontScale' in hero).toBe(false);
    nextScreen();
    await SCREENS.entryWithNextPart!();
    expect(phoneProps(byId('wsf-contribute-your-part-next')!)).toEqual(POLICY);
    nextScreen();
    params.value = { goalId: 'g1' };
    act(() => root.render(<ContributeToGoal />));
    await settle();
    act(() => typeInto(byId('wsf-contribute-entry') as HTMLInputElement, '35'));
    await press('wsf-contribute-review');
    expect(phoneProps(byId('wsf-contribute-review-quantity')!)).toEqual(CAP);
    nextScreen();
    await SCREENS.moveTimer!();
    expect(phoneProps(byId('wsf-contribute-timer-clock')!)).toEqual(POLICY);
  });

  it.each(['ios', 'android'] as const)('%s (RV15-641-4): no nested Text span carries a shrink prop, which native would drop', async (platform) => {
    (Platform as { OS: string }).OS = platform;
    type F = { type: unknown; return: F | null; memoizedProps: Record<string, unknown> };
    const offenders = (scope: Element) => {
      const out: string[] = [];
      for (const el of Array.from(scope.querySelectorAll('*'))) {
        const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
        let f = key ? ((el as unknown as Record<string, F>)[key] ?? null) : null;
        while (f && f.type !== Text) f = f.return;
        if (!f) continue;
        let up = f.return;
        while (up && up.type !== Text) up = up.return;
        if (up && ['numberOfLines', 'adjustsFontSizeToFit', 'minimumFontScale'].some((k) => k in f!.memoizedProps)) out.push(el.textContent ?? '');
      }
      return out;
    };
    const receipt = await kioskReceipt();
    expect(offenders(receipt)).toEqual([]);
    nextScreen();
    expect(offenders(await SCREENS.closed!())).toEqual([]);
    nextScreen();
    expect(offenders(await SCREENS.entryWithNextPart!())).toEqual([]);
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
    | { kind: 'mixed' }
    | { kind: 'words' | 'glyph' };
  /** Every style of 24 pt or more in contribute, and what it draws. A new one fails until it is listed here. */
  const STYLES: Record<string, Kind> = {
    tileValue: { kind: 'numeral', owner: 'integrator' },
    sharedCount: { kind: 'numeral', owner: 'integrator' },
    // RV15-641-1: "N of M <unit>", a words line built by totalOfTargetLabel.
    heroTotal: { kind: 'mixed' },
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
  /** Each use: its style, its spreads, whether it holds a nested <Text>, whether it sits inside one. */
  const uses: Array<{ key: string; spreads: string[]; line: number; holdsText: boolean; inText: boolean }> = [];
  const isTextTag = (n: ts.Node) =>
    (ts.isJsxElement(n) && n.openingElement.tagName.getText() === 'Text') || (ts.isJsxSelfClosingElement(n) && n.tagName.getText() === 'Text');
  const holdsText = (el: ts.Node): boolean => {
    let found = false;
    const look = (c: ts.Node) => {
      if (found) return;
      if (isTextTag(c)) found = true;
      else ts.forEachChild(c, look);
    };
    if (ts.isJsxElement(el)) for (const c of el.children) look(c);
    return found;
  };
  const inText = (el: ts.Node): boolean => {
    for (let p = el.parent; p; p = p.parent) if (isTextTag(p)) return true;
    return false;
  };
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
      const element = ts.isJsxOpeningElement(n) ? n.parent : n;
      for (const m of style?.getText().matchAll(/styles\.(\w+)/g) ?? []) {
        uses.push({
          key: m[1]!,
          spreads,
          line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          holdsText: holdsText(element),
          inText: inText(element),
        });
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

  it('each use of an integrator numeral is judged where it stands; the entry field spreads numeralInputProps', () => {
    const integrator = uses.filter((u) => (STYLES[u.key]?.kind === 'numeral' && (STYLES[u.key] as { owner: string }).owner === 'integrator') || STYLES[u.key]?.kind === 'mixed');
    // A count-only root: the policy.
    const roots = integrator.filter((u) => STYLES[u.key]!.kind === 'numeral' && !u.holdsText && !u.inText);
    expect(roots.filter((u) => !u.spreads.includes('numeralTextProps')).map((u) => `${u.key}@${u.line}`)).toEqual([]);
    // RV15-641-1: a paragraph holding a nested Text (a unit), or a words line, takes the cap only.
    const lines = integrator.filter((u) => STYLES[u.key]!.kind === 'mixed' || (u.holdsText && !u.inText));
    expect(lines.filter((u) => !u.spreads.includes('numeralCapProps') || u.spreads.includes('numeralTextProps')).map((u) => `${u.key}@${u.line}`)).toEqual([]);
    // RV15-641-4: a nested span never carries the shrink props (native would drop them).
    const spans = integrator.filter((u) => u.inText);
    expect(spans.filter((u) => u.spreads.includes('numeralTextProps')).map((u) => `${u.key}@${u.line}`)).toEqual([]);
    // Each case is really met in contribute today.
    expect(roots.length).toBeGreaterThanOrEqual(3);
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(spans.length).toBeGreaterThanOrEqual(1);
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
