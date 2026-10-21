import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Dimensions, Platform, StyleSheet, Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * W12-8 (INT-15, INT-16, MF-17): the integrator's sites of the one text-scale
 * policy (src/ui/textScale(.native).ts, re-exported from kit).
 *
 *   · The tab bar decides "narrow" by the width its text has on a phone
 *     (effectiveWidth: width / fontScale), and the phone's wrapped bar keeps
 *     MOVE as a raised row above the two rows of two. Its labels are capped
 *     (chromeTextProps) and the MOVE label in its fixed circle more tightly.
 *   · The web bar is the DOM it was before W12-8, at every width and text
 *     size: compared with a snapshot captured from the unchanged component
 *     (tests/fixtures/member-tab-bar-web-before-w12-8.json).
 *   · Contribute's entry and review numerals and Progress's totals spread the
 *     numeral policy.
 *
 * vitest resolves the web twin of textScale; the mock below hands each render
 * the twin Metro would pick for the Platform.OS it runs under. Both twins'
 * values and effectiveWidth are pinned in tests/text-scale.test.ts. No device.
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
vi.mock('../src/firebase', () => ({ wsfIsStaging: false, getFirebaseAuth: () => ({}) }));

const { MemberTabBar, MEMBER_TAB_BAR_BODY, MEMBER_TAB_MOVE_OVERHANG } = await import('../src/ui/MemberTabBar');
const { ProgressParityView } = await import('../src/ui/ProgressParityView');
const { knownShared } = await import('../src/goalTruth');

const BEFORE = JSON.parse(
  readFileSync(join(__dirname, 'fixtures', 'member-tab-bar-web-before-w12-8.json'), 'utf8'),
) as Record<string, string>;

// The state, routes and insets the snapshot was captured with.
const STATE = {
  index: 1,
  routes: [
    { key: 'h', name: '(home)' },
    { key: 'c', name: 'community' },
    { key: 'a', name: 'activity' },
    { key: 'y', name: 'you' },
  ],
};
const NAVIGATION = { emit: () => ({ defaultPrevented: false }), navigate: () => undefined };
const INSETS = { top: 0, bottom: 34, left: 0, right: 0 };

let container: HTMLDivElement;
let root: Root;
let os: string;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const all = (id: string) => container.querySelectorAll(`[data-testid="${id}"]`);

function renderBar(width: number, fontScale: number) {
  vi.spyOn(Dimensions, 'get').mockReturnValue({ width, height: 844, scale: 3, fontScale });
  act(() =>
    root.render(
      <MemberTabBar
        state={STATE as never}
        navigation={NAVIGATION as never}
        descriptors={{} as never}
        insets={INSETS}
        onMove={() => undefined}
      />,
    ),
  );
}

/*
  A component's own props. react-native-web does not render the phone's text
  props (maxFontSizeMultiplier, adjustsFontSizeToFit) to the DOM, so they are
  read from the component that rendered the element: the first non-host fiber
  above it, taken from the committed side of the pair.
*/
type Fiber = { type: unknown; return: Fiber | null; alternate: Fiber | null; memoizedProps: Record<string, unknown> };
function propsOf(el: Element, component?: unknown): Record<string, unknown> {
  const own = el as unknown as Record<string, unknown>;
  const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))!;
  const propsKey = Object.keys(el).find((k) => k.startsWith('__reactProps$'))!;
  let fiber = own[fiberKey] as Fiber;
  if (fiber.memoizedProps !== own[propsKey] && fiber.alternate) fiber = fiber.alternate;
  // A Text wraps its element in a context provider, so it is found by its type.
  const isIt = (f: Fiber) => (component ? f.type === component : typeof f.type !== 'string');
  while (fiber && !isIt(fiber)) fiber = fiber.return as Fiber;
  if (!fiber) throw new Error('no such component above the element');
  return fiber.memoizedProps;
}
const styleOf = (el: Element) => StyleSheet.flatten(propsOf(el).style as never) as Record<string, unknown>;
/** The element whose own text is `label` (a Text renders its string as its only child). */
function textElement(scope: Element, label: string): Element {
  const found = Array.from(scope.querySelectorAll('*')).find(
    (el) => el.childNodes.length === 1 && el.firstChild?.nodeType === Node.TEXT_NODE && el.textContent === label,
  );
  if (!found) throw new Error(`no text element "${label}"`);
  return found;
}
const PHONE_TEXT_KEYS = ['maxFontSizeMultiplier', 'numberOfLines', 'adjustsFontSizeToFit', 'minimumFontScale'];
/** The phone's text props a Text was given (its children prove the right Text was read). */
function phoneTextProps(el: Element): Record<string, unknown> {
  const props = propsOf(el, Text);
  expect(props.children).toBe(el.textContent);
  return Object.fromEntries(PHONE_TEXT_KEYS.filter((k) => k in props).map((k) => [k, props[k]]));
}

beforeEach(() => {
  os = Platform.OS;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (Platform as { OS: string }).OS = os;
  vi.restoreAllMocks();
});

describe('W12-8 web: the tab bar is the DOM it was before, at every width and text size', () => {
  beforeEach(() => {
    (Platform as { OS: string }).OS = 'web';
  });

  it('the snapshot holds the four cases (390 and 240 px, at 1x and a large text size)', () => {
    expect(Object.keys(BEFORE).sort()).toEqual(['240@1', '240@2', '390@1', '390@1.65']);
    // The web never decided by text size: 390 px is one layout at 1x and 1.65x.
    expect(BEFORE['390@1.65']).toBe(BEFORE['390@1']);
    // Below 260 px the web bar wraps without MOVE (unchanged by W12-8).
    expect(BEFORE['240@1']).not.toContain('wsf-member-tab-move');
  });

  it.each(Object.keys(BEFORE))('%s: identical to the snapshot', (key) => {
    const [width, fontScale] = key.split('@').map(Number);
    renderBar(width, fontScale);
    expect(container.innerHTML).toBe(BEFORE[key]);
  });

  it('no phone text prop reaches a label or MOVE on the web', () => {
    renderBar(390, 1.65);
    for (const label of ['Home', 'Community', 'Progress', 'You', 'MOVE']) {
      expect(phoneTextProps(textElement(byId('wsf-member-tabs')!, label))).toEqual({});
    }
  });
});

describe.each(['ios', 'android'] as const)('W12-8 %s: the tab bar decides by the width its text has', (platform) => {
  beforeEach(() => {
    (Platform as { OS: string }).OS = platform;
  });

  it('390 pt at 1.65x is narrow: two rows of two, and MOVE is kept, once, in a raised row above them', () => {
    renderBar(390, 1.65);
    const bar = byId('wsf-member-tabs')!;
    expect(styleOf(bar).flexWrap).toBe('wrap');
    for (const key of ['home', 'community', 'activity', 'you']) {
      expect(styleOf(byId(`wsf-member-tab-${key}`)!).flexBasis).toBe('50%');
    }
    const row = byId('wsf-member-tab-move-row')!;
    expect(row).not.toBeNull();
    expect(all('wsf-member-tab-move')).toHaveLength(1);
    expect(row.contains(byId('wsf-member-tab-move'))).toBe(true);
    // The row comes first: MOVE sits above the destinations, full width.
    expect(bar.firstElementChild).toBe(row);
    expect(styleOf(row).flexBasis).toBe('100%');
    // Still the product's one action, raised by the same overhang.
    expect(styleOf(byId('wsf-member-tab-move')!).marginTop).toBe(-MEMBER_TAB_MOVE_OVERHANG);
    expect(byId('wsf-member-tab-move')!.getAttribute('aria-label')).toBe('Move: record what you did');
  });

  it('390 pt at 1x keeps the default geometry: one row, MOVE in its slot, BAR_BODY 64, overhang 24', () => {
    renderBar(390, 1);
    const bar = byId('wsf-member-tabs')!;
    expect(styleOf(bar).flexWrap).toBeUndefined();
    expect(byId('wsf-member-tab-move-row')).toBeNull();
    expect(all('wsf-member-tab-move')).toHaveLength(1);
    // MOVE's slot sits between Community and Progress.
    const slot = byId('wsf-member-tab-move')!.parentElement!;
    expect(slot.previousElementSibling).toBe(byId('wsf-member-tab-community'));
    expect(slot.nextElementSibling).toBe(byId('wsf-member-tab-activity'));
    expect(styleOf(byId('wsf-member-tab-home')!).flexBasis).toBeUndefined();
    expect(MEMBER_TAB_BAR_BODY).toBe(64);
    expect(MEMBER_TAB_MOVE_OVERHANG).toBe(24);
    expect(styleOf(bar).paddingTop).toBe(6);
    expect(styleOf(byId('wsf-member-tab-home')!).minHeight).toBe(48);
    expect(styleOf(byId('wsf-member-tab-move')!).marginTop).toBe(-24);
  });

  it('the boundary: 390 pt at 1.3x (300) stays one row; 1.5x (260) too; just past it wraps', () => {
    renderBar(390, 1.3);
    expect(byId('wsf-member-tab-move-row')).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    vi.restoreAllMocks();
    renderBar(390, 1.5);
    expect(byId('wsf-member-tab-move-row')).toBeNull();
    act(() => root.unmount());
    root = createRoot(container);
    vi.restoreAllMocks();
    renderBar(390, 1.51);
    expect(byId('wsf-member-tab-move-row')).not.toBeNull();
  });

  it('a narrow phone at 1x wraps too, and keeps MOVE (the web\'s narrow bar has none)', () => {
    renderBar(240, 1);
    expect(byId('wsf-member-tab-move-row')).not.toBeNull();
    expect(all('wsf-member-tab-move')).toHaveLength(1);
  });

  it('labels are capped at 1.3x on one line; MOVE in its fixed circle at 1.1x', () => {
    renderBar(390, 1.65);
    const bar = byId('wsf-member-tabs')!;
    for (const label of ['Home', 'Community', 'Progress', 'You']) {
      expect(phoneTextProps(textElement(bar, label))).toEqual({ maxFontSizeMultiplier: 1.3, numberOfLines: 1 });
    }
    expect(phoneTextProps(textElement(bar, 'MOVE'))).toEqual({ maxFontSizeMultiplier: 1.1, numberOfLines: 1 });
  });
});

describe('W12-8: the numerals spread the numeral policy', () => {
  const goal = {
    goalId: 'oak-500',
    title: '500 squats together',
    communityId: 'oak',
    community: 'Oak Grove Together',
    unit: 'squats',
    yourPart: 1250,
    target: 5000,
    shared: knownShared(2410),
    open: true,
    periodLabel: null,
  };
  const ready = {
    kind: 'ready' as const,
    memberName: 'Alex M.',
    open: [goal],
    finished: [],
    partial: false,
    canStart: true,
    receipts: null,
  };
  const actions = { onRetry: vi.fn(), onStartMoving: vi.fn(), onOpenCommunity: vi.fn(), onOpenReceipt: vi.fn() };

  it.each(['ios', 'android'] as const)('%s: Progress\'s total is capped, on one line, shrinking to fit', (platform) => {
    (Platform as { OS: string }).OS = platform;
    act(() => root.render(<ProgressParityView state={ready} actions={actions} />));
    expect(phoneTextProps(textElement(byId('wsf-activity-total-0')!, '1,250'))).toEqual({
      maxFontSizeMultiplier: 1.3,
      numberOfLines: 1,
      adjustsFontSizeToFit: true,
      minimumFontScale: 0.5,
    });
  });

  it('web: Progress\'s total gets none of it', () => {
    (Platform as { OS: string }).OS = 'web';
    act(() => root.render(<ProgressParityView state={ready} actions={actions} />));
    expect(phoneTextProps(textElement(byId('wsf-activity-total-0')!, '1,250'))).toEqual({});
  });

  /*
    Contribute's two numeral sites, by source (the route's rendered harness
    lives in the contribute tests; this pins the spread at each site). The
    policy comes from kit, never a local copy.
  */
  const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8');
  const contribute = read('app/contribute/[goalId].tsx');
  const progress = read('src/ui/ProgressParityView.tsx');
  const elementAt = (text: string, marker: string, tag: string) => {
    const at = text.indexOf(marker);
    expect(at).toBeGreaterThan(-1);
    return text.slice(text.lastIndexOf(`<${tag}`, at), text.indexOf('>', at) + 1);
  };

  it('contribute: the entry field spreads numeralInputProps; the review quantity spreads numeralTextProps', () => {
    const entry = contribute.slice(
      contribute.lastIndexOf('<TextInput', contribute.indexOf('testID="wsf-contribute-entry"')),
      contribute.indexOf('/>', contribute.indexOf('testID="wsf-contribute-entry"')) + 2,
    );
    expect(entry).toContain('{...numeralInputProps}');
    expect(elementAt(contribute, 'testID="wsf-contribute-review-quantity"', 'Text')).toContain('{...numeralTextProps}');
  });

  it('Progress: the total number spreads numeralTextProps', () => {
    expect(progress).toContain('<Text style={s.totalNumber} {...numeralTextProps}>');
  });

  it('one policy: from kit, and no second cap written into these sites', () => {
    expect(contribute).toMatch(/import \{[^}]*\bnumeralInputProps\b[^}]*\bnumeralTextProps\b[^}]*\} from '..\/..\/src\/ui\/kit';/);
    expect(progress).toMatch(/import \{[^}]*\bnumeralTextProps\b[^}]*\} from '.\/kit';/);
    for (const text of [contribute, progress]) {
      expect(text).not.toMatch(/maxFontSizeMultiplier|adjustsFontSizeToFit|minimumFontScale|allowFontScaling/);
    }
  });
});
