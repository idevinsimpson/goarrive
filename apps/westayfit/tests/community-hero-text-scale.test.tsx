import { Children, act, cloneElement, forwardRef, isValidElement, useEffect, type ReactElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Dimensions, Platform, StyleSheet } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-4. Community Home at the system text size.
 *
 * MF-11: the hero's narrow steps read the screen's width, so at the largest
 * text sizes a 390 pt phone kept the wide layout: the pill beside the kicker,
 * the 23 pt title, the one-line total. They now read the width divided by
 * the text size (src/ui/textScale, W12-8); the We mark stays on the physical
 * width. The initials discs take the chrome policy (capped, one line).
 * INT-22: natively the challenge card is a Pressable the Link drives, with
 * the link role and one joined name; the web keeps its anchor.
 *
 * The route is rendered whole (react-native-web, jsdom) as a member with one
 * open goal, a roster, momentum and a running challenge. "Native" swaps in
 * textScale.native and sets Platform.OS to ios; the window (and its text
 * size) comes from Dimensions.get. Text, View and Pressable are wrapped to
 * read the props React Native acts on. No device.
 */

const mode = { native: false };
vi.mock('../src/ui/textScale', async () => {
  const web = await vi.importActual<typeof import('../src/ui/textScale')>('../src/ui/textScale');
  const native = await import('../src/ui/textScale.native');
  const pick = () => (mode.native ? native : web);
  return {
    get TEXT_SCALE_CAPS() {
      return pick().TEXT_SCALE_CAPS;
    },
    get chromeTextProps() {
      return pick().chromeTextProps;
    },
    get numeralTextProps() {
      return pick().numeralTextProps;
    },
    get numeralInputProps() {
      return pick().numeralInputProps;
    },
    effectiveWidth: (w: number, s: number) => pick().effectiveWidth(w, s),
  };
});

type Props = Record<string, unknown>;
const textByTestId = new Map<string, Props>();
const textByContent = new Map<string, Props>();
const pressByTestId = new Map<string, Props>();
const topRowStyles: unknown[] = [];
const isPill = (c: unknown) =>
  isValidElement(c) && String((c.props as Props).testID ?? '').startsWith('wsf-community-goal-period-');
vi.mock('react-native', async (importOriginal) => {
  const rn = await importOriginal<typeof import('react-native')>();
  const wrap = (Real: unknown, record: (p: Props) => void) =>
    forwardRef<unknown, Props>((props, ref) => {
      record(props);
      const C = Real as (p: Props) => ReactNode;
      return <C ref={ref} {...props} />;
    });
  const Text = wrap(rn.Text, (p) => {
    if (typeof p.testID === 'string') textByTestId.set(p.testID, p);
    if (typeof p.children === 'string') textByContent.set(p.children, p);
  });
  // heroTopRow is the View whose own child is the state pill.
  const View = wrap(rn.View, (p) => {
    if (Children.toArray(p.children as ReactNode).some(isPill)) topRowStyles.push(p.style);
  });
  const Pressable = wrap(rn.Pressable, (p) => {
    if (typeof p.testID === 'string') pressByTestId.set(p.testID, p);
  });
  return { ...rn, Text, View, Pressable };
});

const weWidths: number[] = [];
vi.mock('../src/ui/LivingWeProgress', () => ({
  LivingWeProgress: ({ width, testID }: { width: number; testID?: string }) => {
    weWidths.push(width);
    return <div data-testid={testID} />;
  },
}));

// expo-router's Link, as it behaves: without asChild an anchor (web) for its
// children; with asChild its press is merged onto the one child (Slot), the
// child's own onPress first.
const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), navigate: vi.fn() };
const links: Props[] = [];
vi.mock('expo-router', () => ({
  Link: ({ href, asChild, children, ...rest }: Props & { href: string; asChild?: boolean; children: ReactNode }) => {
    links.push({ href, asChild, ...rest });
    if (asChild) {
      const child = Children.only(children) as ReactElement<Props>;
      const own = child.props.onPress as ((e: unknown) => void) | undefined;
      return cloneElement(child, {
        href,
        onPress: (e: unknown) => {
          own?.(e);
          router.push(href);
        },
      });
    }
    return (
      <a href={href} data-testid={rest.testID as string}>
        {children}
      </a>
    );
  },
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
    SafeAreaInsetsContext: createContext(null),
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
vi.mock('../src/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../src/ui/memberShellActions', () => ({ useMemberShellAction: () => undefined }));
const getDoc = vi.fn();
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => `${col}/${id}`,
  getDoc: (path: string) => getDoc(path),
}));
const NOW = Date.now();
const PULSE = {
  sharedTotal: 1847,
  target: 5000,
  unit: 'squats',
  status: 'active',
  communityDisplayName: 'Oak Grove Together',
  goalTitle: 'Challenge squats',
  startsAt: new Date(NOW - 86_400_000).toISOString(),
  endsAt: new Date(NOW + 5 * 86_400_000).toISOString(),
  timezone: 'UTC',
};
const CALLABLES: Record<string, unknown> = {
  wsfGoalPulse: PULSE,
  wsfCommunityMembers: {
    members: [
      { displayName: 'Ana Bell', role: 'member' },
      { displayName: 'Cy Dunn', role: 'member' },
      { displayName: 'Eve Fox', role: 'member' },
      { displayName: 'Gus Hale', role: 'member' },
    ],
    nextCursor: null,
  },
  wsfCommunityActivity: {
    entries: [{ displayName: 'Ira Jones', amount: 20, unit: 'squats', at: new Date(NOW - 60_000).toISOString() }],
    contributorsToday: 1,
    nextCursor: null,
  },
};
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => () =>
    name in CALLABLES
      ? Promise.resolve({ data: CALLABLES[name] })
      : Promise.reject(Object.assign(new Error('internal'), { code: 'functions/internal' })),
}));
vi.mock('../src/firebase', () => ({ getFirebaseFirestore: () => ({}), getFirebaseFunctions: () => ({}) }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
const AUTH = { ready: true, user: { uid: 'u1', email: 'm@example.com', displayName: 'M' } };
vi.mock('../src/auth', () => ({ useWsfAuth: () => AUTH }));
vi.mock('../src/currentCommunity', () => ({ rememberCurrentCommunity: vi.fn(), resolveCurrentCommunity: () => null }));
const CHALLENGE = { id: 'c1', title: 'Spring steps', participantCount: 4, completedCount: 2, goalTarget: null };
const GOAL = {
  goalId: 'g1',
  title: 'Challenge squats',
  target: 5000,
  unit: 'squats',
  status: 'active',
  startsAt: PULSE.startsAt,
  endsAt: PULSE.endsAt,
  aggregateDisplayAuthorized: false,
  reachedAt: null,
};
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  forgetCommunity: vi.fn(),
  peekMyCommunities: () => undefined,
  readGoals: () => Promise.resolve({ goals: [GOAL] }),
  readMyCommunities: () =>
    Promise.resolve({
      items: [{ groupId: 'oak', displayName: 'Oak Grove Together', memberCount: 4, isSample: false, activeChallenge: CHALLENGE }],
    }),
  readOwnCredit: () => Promise.resolve({ ownCredit: 20, unit: 'squats' }),
}));

const { default: CommunityPage } = await import('../app/(tabs)/(home)/community/[groupId]/index');

const snap = (data: Record<string, unknown> | null) => ({ exists: () => data !== null, data: () => data ?? undefined });
const MEMBER = snap({ role: 'member', membershipStatus: 'active', userId: 'u1' });
const GROUP = snap({ displayName: 'Oak Grove Together', groupType: 'custom', joinPolicy: 'private', lifecycleStatus: 'active', isSample: false });

const OS = Platform.OS;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  getDoc.mockReset();
  getDoc.mockImplementation(async (path: string) => (path.startsWith('wsfMemberships/') ? MEMBER : GROUP));
  router.push.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (Platform as { OS: string }).OS = OS;
  mode.native = false;
  vi.restoreAllMocks();
});

const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flat = (style: unknown) => (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

/** Renders the page on `platform` with a 390 x 844 window at `fontScale`. */
async function render(platform: 'ios' | 'web', fontScale: number): Promise<void> {
  mode.native = platform !== 'web';
  (Platform as { OS: string }).OS = platform;
  vi.spyOn(Dimensions, 'get').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale });
  for (const m of [textByTestId, textByContent, pressByTestId]) m.clear();
  topRowStyles.length = 0;
  weWidths.length = 0;
  links.length = 0;
  act(() => root.render(<CommunityPage />));
  await act(async () => {
    for (let i = 0; i < 30; i++) await Promise.resolve();
  });
  expect(byId('wsf-community-goal-total-g1')).not.toBeNull();
}

/** What the hero's four width rules chose, read from the props given. */
function heroLayout() {
  const topRow = flat(topRowStyles[topRowStyles.length - 1]);
  const pill = flat(textByTestId.get('wsf-community-goal-period-g1')!.style);
  const title = flat(textByTestId.get('wsf-community-goal-title-g1')!.style);
  const label = flat(textByTestId.get('wsf-community-goal-label')!.style);
  const total = byId('wsf-community-goal-total-g1')!.textContent!;
  return {
    pillBeside: { rowPaddingRight: topRow.paddingRight, pillPosition: pill.position },
    title: { fontSize: title.fontSize, lineHeight: title.lineHeight },
    label: { lineHeight: label.lineHeight, letterSpacing: label.letterSpacing },
    totalBreak: total.includes('\n') ? 'newline' : total.includes('1,847 of') ? 'space' : total,
    weWidth: weWidths[weWidths.length - 1],
  };
}
// Today's choices on a 390 pt window: the pill beside the kicker, the 23/25
// title, the 15/1.2 label, the count and its target on one line, a 152 mark.
const TODAY = {
  pillBeside: { rowPaddingRight: 0, pillPosition: 'absolute' },
  title: { fontSize: 23, lineHeight: 25 },
  label: { lineHeight: 15, letterSpacing: 1.2 },
  totalBreak: 'space',
  weWidth: 152,
};

describe('W16-4 / MF-11: the hero reads the width its text has', () => {
  it('at {390, 2.5} on iOS: no pill beside, the 18 pt title step, the narrow label, the count on its own line; the mark keeps its size', async () => {
    await render('ios', 2.5);
    expect(heroLayout()).toEqual({
      pillBeside: { rowPaddingRight: undefined, pillPosition: undefined },
      title: { fontSize: 18, lineHeight: 23 },
      label: { lineHeight: 13, letterSpacing: 0.8 },
      totalBreak: 'newline',
      weWidth: 152,
    });
    expect(byId('wsf-community-goal-total-g1')!.textContent).toBe('1,847\nof 5,000 squats');
  });

  it('at {390, 1.4} on iOS: the 20 pt step (a 279 pt text width), the pill already below', async () => {
    await render('ios', 1.4);
    const layout = heroLayout();
    expect(layout.title).toEqual({ fontSize: 20, lineHeight: 25 });
    expect(layout.pillBeside).toEqual({ rowPaddingRight: undefined, pillPosition: undefined });
    expect(layout.label).toEqual(TODAY.label);
    expect(layout.totalBreak).toBe('space');
  });

  it("at {390, 1} on iOS, and below 1, the hero is today's", async () => {
    await render('ios', 1);
    expect(heroLayout()).toEqual(TODAY);
    await render('ios', 0.85);
    expect(heroLayout()).toEqual(TODAY);
  });

  it("the web ignores the text size (its zoom already narrows the width): today's hero at any fontScale", async () => {
    await render('web', 1);
    expect(heroLayout()).toEqual(TODAY);
    await render('web', 2.5);
    expect(heroLayout()).toEqual(TODAY);
    expect(byId('wsf-community-goal-total-g1')!.textContent).toBe('1,847 of 5,000 squats');
  });
});

describe('W16-4 / MF-11: the initials discs take the chrome policy', () => {
  it('natively each disc (roster stack, "+N", momentum avatar) is capped at 1.3x on one line', async () => {
    await render('ios', 2.5);
    for (const letters of ['AB', 'CD', 'IJ', '+1']) {
      const props = textByContent.get(letters);
      expect(props, letters).toBeDefined();
      expect(props!.maxFontSizeMultiplier).toBe(1.3);
      expect(props!.numberOfLines).toBe(1);
    }
  });

  // react-native-web adds its one-line clamp CSS only for numberOfLines.
  it('on the web the discs get no policy props, so no line clamp reaches the DOM', async () => {
    await render('web', 2.5);
    for (const letters of ['AB', 'CD', 'IJ', '+1']) {
      const props = textByContent.get(letters)!;
      expect(props).toBeDefined();
      expect(props.maxFontSizeMultiplier).toBeUndefined();
      expect(props.numberOfLines).toBeUndefined();
    }
  });
});

describe('W16-4 / INT-22: the challenge card', () => {
  const LABEL = 'Community challenge, Spring steps, 4 moving · 2 check-ins';

  it("on the web it is today's anchor: the same Link props and children, no Pressable", async () => {
    await render('web', 1);
    const link = links.find((l) => l.testID === 'wsf-community-challenge-link')!;
    expect(link.href).toBe('/community/oak/challenge');
    expect(link.asChild).toBeUndefined();
    expect(Array.isArray(link.style)).toBe(false);
    const a = byId('wsf-community-challenge-link')!;
    expect(a.tagName).toBe('A');
    expect(a.getAttribute('href')).toBe('/community/oak/challenge');
    expect(a.textContent).toBe('Community challengeSpring steps4 moving · 2 check-ins');
    expect(pressByTestId.has('wsf-community-challenge-link')).toBe(false);
  });

  it('natively it is a Pressable the Link drives: link role, the joined name, one push per press', async () => {
    await render('web', 1);
    const webCard = flat(links.find((l) => l.testID === 'wsf-community-challenge-link')!.style);
    await render('ios', 1);
    const link = links.find((l) => l.href === '/community/oak/challenge')!;
    expect(link.asChild).toBe(true);
    const press = pressByTestId.get('wsf-community-challenge-link')!;
    expect(press.accessibilityRole).toBe('link');
    expect(press.accessibilityLabel).toBe(LABEL);
    // One flat style object: Slot does not merge style arrays.
    expect(Array.isArray(press.style)).toBe(false);
    expect(press.style).toEqual(webCard);
    expect(Object.keys(webCard).length).toBeGreaterThan(0);
    const card = byId('wsf-community-challenge-link')!;
    expect(card.textContent).toBe('Community challengeSpring steps4 moving · 2 check-ins');
    act(() => card.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(router.push).toHaveBeenCalledTimes(1);
    expect(router.push).toHaveBeenCalledWith('/community/oak/challenge');
  });
});
