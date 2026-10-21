import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, forwardRef, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AccessibilityInfo, Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-3 (MF-18, INT-18): native accessibility polish on the
 * community surfaces and DeviceChoice. ST-04 (the device note gated on
 * deviceModeMayBeRemembered) waits for W13-3 and is not here.
 *
 * Rendered with Platform.OS set per case and react-native's Pressable and Text
 * wrapped to read the props a phone acts on (react-native-web drops hitSlop,
 * accessibilityHint and accessibilityState from the DOM). The announce helper
 * is the native one (kit-base-1), with AccessibilityInfo spied. No device.
 */

const pressProps = new Map<string, Record<string, unknown>>();
const textProps: Record<string, unknown>[] = [];
vi.mock('react-native', async (importOriginal) => {
  const rn = await importOriginal<typeof import('react-native')>();
  const Pressable = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
    if (typeof props.testID === 'string') pressProps.set(props.testID, props);
    const Real = rn.Pressable as unknown as (p: Record<string, unknown>) => ReactNode;
    return <Real ref={ref} {...props} />;
  });
  const Text = forwardRef<unknown, Record<string, unknown>>((props, ref) => {
    textProps.push(props);
    const Real = rn.Text as unknown as (p: Record<string, unknown>) => ReactNode;
    return <Real ref={ref} {...props} />;
  });
  return { ...rn, Pressable, Text };
});
vi.mock('../src/ui/announce', async () => import('../src/ui/announce.native'));
vi.mock('../src/ui/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const AUTH = { ready: true, user: { uid: 'u1' } };
vi.mock('../src/auth', () => ({ useWsfAuth: () => AUTH }));
vi.mock('../src/firebase', () => ({ getFirebaseFunctions: () => ({}) }));
vi.mock('../src/ui/CommunityPrivacyControls', () => ({ onPrivacySettled: () => () => {} }));
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) =>
    name === 'wsfGoalRecentAdditions'
      ? () => Promise.resolve({ data: { additions: [] } })
      : name === 'wsfCommunityMembers'
        ? () => Promise.resolve({ data: { members: [], nextCursor: null } })
        : () => new Promise(() => {}),
}));
const OAK = { groupId: 'oak', displayName: 'Oak Grove', memberCount: 23, role: 'member' };
const HARBOR = { groupId: 'harbor', displayName: 'Harbor', memberCount: 9, role: 'member' };
vi.mock('../src/memberReads', () => ({
  peekMyCommunities: () => undefined,
  peekGoals: () => undefined,
  wasRefused: () => false,
  readMyCommunities: () => Promise.resolve({ items: [OAK, HARBOR] }),
  readGoals: () => Promise.resolve({ goals: [] }),
}));
vi.mock('expo-router', () => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), canGoBack: () => true },
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  useLocalSearchParams: () => ({ groupId: 'oak' }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    useEffect(() => cb(), [cb]);
  },
}));

const { default: Members } = await import('../app/(tabs)/(home)/community/[groupId]/members');
const { default: CommunityTab } = await import('../app/(tabs)/community/index');
const { CommunityPrivacyPanelView } = await import('../src/ui/CommunityPrivacyPanelView');
const { DeviceChoice } = await import('../src/ui/DeviceChoice');
const { StaleAnnouncer, STALE_FIGURE_SENTENCE, nativeA11yHidden } = await import('../src/ui/staleFigure');
const { DEVICE_CHOICE_PERSONAL_DESCRIPTION, DEVICE_CHOICE_PERSONAL_LABEL } = await import('../src/deviceMode');
const webAnnounce = await vi.importActual<typeof import('../src/ui/announce')>('../src/ui/announce');

const OS = Platform.OS;
let container: HTMLDivElement;
let root: Root;
let spoken: string[];
beforeEach(() => {
  pressProps.clear();
  textProps.length = 0;
  spoken = [];
  vi.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation((m: string) => {
    spoken.push(m);
  });
  window.localStorage.clear();
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
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const flush = () =>
  act(async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  });
async function render(node: ReactNode): Promise<void> {
  act(() => {
    root.render(node);
  });
  await flush();
}
const ios = () => ((Platform as { OS: string }).OS = 'ios');

describe('W16-3 (a): Members back reaches 44 pt', () => {
  it('hitSlop is BACK_GLYPH_HIT_SLOP {8, 8, 17, 17}', async () => {
    ios();
    await render(<Members />);
    expect(pressProps.get('wsf-members-back')?.hitSlop).toEqual({ top: 8, bottom: 8, left: 17, right: 17 });
  });
});

describe('W16-3 (d): a community chip is announced once, on every platform-native screen reader', () => {
  it('ios: choosing a chip speaks "Now showing …" once; another choice speaks again; no live region on native', async () => {
    ios();
    window.localStorage.setItem('wsf.currentCommunity.u1', 'oak');
    await render(<CommunityTab />);
    expect(byId('wsf-parity-chip-harbor')).not.toBeNull();
    act(() => byId('wsf-parity-chip-harbor')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    expect(spoken).toEqual(['Now showing Harbor.']);
    // A re-render is not a new announcement.
    await render(<CommunityTab />);
    expect(spoken).toEqual(['Now showing Harbor.']);
    act(() => byId('wsf-parity-chip-oak')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    await flush();
    expect(spoken).toEqual(['Now showing Harbor.', 'Now showing Oak Grove.']);
    expect(byId('wsf-community-index-announce')!.getAttribute('aria-live')).toBeNull();
  });

  it('the web keeps its polite live region (and speaks through it, not announce)', () => {
    expect(webAnnounce.liveRegion).toEqual({ 'aria-live': 'polite' });
    const src = readFileSync(resolve(__dirname, '../app/(tabs)/community/index.tsx'), 'utf8');
    const at = src.indexOf('testID="wsf-community-index-announce"');
    expect(src.slice(at, at + 80)).toContain('{...liveRegion}');
  });
});

describe('W16-3 (e): the privacy switch carries its hint natively', () => {
  const community = (saving: 'name' | null) => ({
    groupId: 'oak',
    displayName: 'Oak Grove',
    stored: { name: 'visible' as const, activity: 'visible' as const },
    saving,
    saveError: null,
  });
  const panel = (saving: 'name' | null) => (
    <CommunityPrivacyPanelView load="ready" communities={[community(saving)]} onChange={vi.fn()} onRetrySave={vi.fn()} onRetryLoad={vi.fn()} />
  );
  it('ios: "Saving…" while saving, the hint otherwise', async () => {
    ios();
    await render(panel('name'));
    expect(pressProps.get('wsf-privacy-panel-name-oak')?.accessibilityHint).toBe('Saving…');
    await render(panel(null));
    const hint = pressProps.get('wsf-privacy-panel-name-oak')?.accessibilityHint;
    expect(typeof hint).toBe('string');
    expect(hint).not.toBe('Saving…');
    expect(byId('wsf-privacy-panel-name-oak-hint')!.textContent).toBe(hint);
  });
  it('web: no accessibilityHint (aria-describedby carries it, as before)', async () => {
    await render(panel('name'));
    expect(pressProps.get('wsf-privacy-panel-name-oak')?.accessibilityHint).toBeUndefined();
  });
});

describe('W16-3 (f): DeviceChoice reads as its buttons say, natively', () => {
  const choice = (variant?: 'sheet') => (
    <DeviceChoice variant={variant} onChoosePersonal={vi.fn()} onChooseShared={vi.fn()} testID="wsf-dc" />
  );
  it('ios, sheet: the label is the visible "This is my phone", the hint is the description, the body is hidden', async () => {
    ios();
    await render(choice('sheet'));
    const p = pressProps.get('wsf-dc-personal')!;
    expect(p.accessibilityLabel).toBe('This is my phone');
    expect(p.accessibilityHint).toBe(DEVICE_CHOICE_PERSONAL_DESCRIPTION);
    const body = textProps.find((t) => t.children === DEVICE_CHOICE_PERSONAL_DESCRIPTION);
    expect(body?.accessible).toBe(false);
    expect(body?.importantForAccessibility).toBe('no');
  });
  it('ios, cards: the label is the card title, the hint its description', async () => {
    ios();
    await render(choice());
    const p = pressProps.get('wsf-dc-personal')!;
    expect(p.accessibilityLabel).toBe(DEVICE_CHOICE_PERSONAL_LABEL);
    expect(p.accessibilityHint).toBe(DEVICE_CHOICE_PERSONAL_DESCRIPTION);
  });
  it("web keeps today's single aria-label", async () => {
    await render(choice('sheet'));
    expect(pressProps.get('wsf-dc-personal')!.accessibilityLabel).toBe(`${DEVICE_CHOICE_PERSONAL_LABEL}. ${DEVICE_CHOICE_PERSONAL_DESCRIPTION}`);
    expect(pressProps.get('wsf-dc-personal')!.accessibilityHint).toBeUndefined();
    expect(byId('wsf-dc-note')).not.toBeNull();
  });
});

describe('W16-3 (INT-18): the stale-figure sentence is spoken once per failure, natively', () => {
  it('a failure speaks once; a re-render does not repeat it; recovering and failing again speaks again', async () => {
    await render(<StaleAnnouncer failed={false} />);
    expect(spoken).toEqual([]);
    await render(<StaleAnnouncer failed />);
    expect(spoken).toEqual([STALE_FIGURE_SENTENCE]);
    await render(<StaleAnnouncer failed />);
    expect(spoken).toEqual([STALE_FIGURE_SENTENCE]);
    await render(<StaleAnnouncer failed={false} />);
    await render(<StaleAnnouncer failed />);
    expect(spoken).toEqual([STALE_FIGURE_SENTENCE, STALE_FIGURE_SENTENCE]);
  });

  // heads-9 N-3: a failure that predates the mount is not a new one.
  it('mounting already failed says nothing; recovering and failing again then speaks', async () => {
    await render(<StaleAnnouncer failed />);
    await render(<StaleAnnouncer failed />);
    expect(spoken).toEqual([]);
    await render(<StaleAnnouncer failed={false} />);
    await render(<StaleAnnouncer failed />);
    expect(spoken).toEqual([STALE_FIGURE_SENTENCE]);
  });
});

describe('W16-3 (b), (c), INT-18 in Community Home (wiring)', () => {
  const src = readFileSync(resolve(__dirname, '../app/(tabs)/(home)/community/[groupId]/index.tsx'), 'utf8');
  it('(b) the station slot is announced as selected natively, beside aria-pressed', () => {
    const at = src.indexOf('aria-pressed={chosen}');
    expect(src.slice(at, at + 400)).toContain("{...(Platform.OS !== 'web' ? { accessibilityState: { selected: chosen } } : {})}");
  });
  // heads-9 B-1: natively the region is neither live nor visible, so its copy
  // is the one hidden; the visible sentence stays browsable. Rendered on iOS
  // and the web in tests/stale-figure-browse.test.tsx.
  it('(c) the stale region\'s copy and the held nbsp slot are hidden natively; the visible stale sentence is not', () => {
    expect(src.match(/\{\.\.\.nativeA11yHidden\(\)\}/g)).toHaveLength(2);
    const region = src.indexOf('testID={`wsf-community-goal-stale-status-${goal.goalId}`}');
    expect(src.slice(region, region + 500)).toContain('<Text {...nativeA11yHidden()}>{STALE_FIGURE_SENTENCE}</Text>');
    const stale = src.indexOf('testID={`wsf-community-goal-stale-${goal.goalId}`}');
    const visible = src.slice(stale, src.indexOf('</Text>', stale));
    expect(visible).toContain('{STALE_FIGURE_SENTENCE}');
    expect(visible).not.toContain('nativeA11yHidden');
    expect(visible).toContain("{...({ 'aria-hidden': true } as Record<string, unknown>)}");
    const nbsp = src.indexOf("{'\\u00A0'}");
    expect(src.slice(nbsp - 400, nbsp)).toContain('{...nativeA11yHidden()}');
  });
  it('INT-18: the stale status region spreads liveRegion; the page has ONE StaleAnnouncer, fed any stale figure (heads-9 N-3)', () => {
    const at = src.indexOf('testID={`wsf-community-goal-stale-status-${goal.goalId}`}');
    const block = src.slice(at, at + 500);
    expect(block).toContain('{...liveRegion}');
    expect(block).not.toContain('<StaleAnnouncer');
    expect(src.match(/<StaleAnnouncer /g)).toHaveLength(1);
    expect(src).toContain('<StaleAnnouncer failed={anyStaleFigure} />');
    expect(src).not.toMatch(/'aria-live': 'polite' \} as Record<string, unknown>\)\}\s*>\s*\{p\.refreshFailed/);
  });
  it('nativeA11yHidden is empty on the web and hides on a phone', () => {
    expect(nativeA11yHidden()).toEqual({});
    ios();
    expect(nativeA11yHidden()).toEqual({ accessible: false, importantForAccessibility: 'no' });
  });
});
