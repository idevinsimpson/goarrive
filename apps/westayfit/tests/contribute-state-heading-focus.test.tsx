import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RECORDING_HEADING, UNKNOWN_OUTCOME_HEADING } from '../src/contributionFlow';

/**
 * W13-5 (INT-17): when the in-flight or unknown-outcome screen replaces what
 * was on screen, its heading takes the screen reader's focus on a phone
 * (src/ui/stepHeadingFocus.native.ts, through the kit's
 * src/ui/accessibilityFocus.ts). The route is rendered into jsdom through
 * react-native-web; `mode.native` switches stepHeadingFocus between its twins,
 * and the focus calls are read off `AccessibilityInfo.setAccessibilityFocus`
 * (react-native-web has no `findNodeHandle`, so the node is the ref's own
 * element here). No device.
 */

const mode = vi.hoisted(() => ({ native: true }));
const focusCalls = vi.hoisted(() => [] as unknown[]);
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return {
    ...actual,
    AccessibilityInfo: {
      ...actual.AccessibilityInfo,
      setAccessibilityFocus: (node: unknown) => {
        focusCalls.push(node);
      },
    },
    findNodeHandle: (instance: unknown) => instance ?? null,
    InteractionManager: {
      runAfterInteractions: (task: () => void) => {
        task();
        return { cancel: () => undefined };
      },
    },
  };
});
vi.mock('../src/ui/stepHeadingFocus', async () => {
  const native = await vi.importActual<typeof import('../src/ui/stepHeadingFocus.native')>('../src/ui/stepHeadingFocus.native');
  const web = await vi.importActual<typeof import('../src/ui/stepHeadingFocus')>('../src/ui/stepHeadingFocus');
  return {
    useStepHeadingFocus: (...args: Parameters<typeof web.useStepHeadingFocus>) =>
      (mode.native ? native.useStepHeadingFocus : web.useStepHeadingFocus)(...args),
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
  getState: () => ({ index: 1, routes: [{ name: '(tabs)' }, { name: 'contribute/[goalId]' }] }),
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
// Forward-compatible: every real export, with reduced motion on (the integrated
// screen also reads the preference with its known/failed state).
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
const { default: ContributeToGoal } = await import('../app/contribute/[goalId]');

const PULSE = { sharedTotal: 40, target: 100, unit: 'squats', status: 'active' };
const MINE = { ownCredit: 5, unit: 'squats', repeatPolicy: 'multiple' };
const PENDING_KEY = `wsf.pendingContribution.g1.${USER.uid}`;
const ROUTE = readFileSync(join(__dirname, '../app/contribute/[goalId].tsx'), 'utf8');

let container: HTMLDivElement;
let root: Root;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await act(async () => undefined);
};
const render = () =>
  act(() => {
    root.render(<ContributeToGoal />);
  });
let contribute: { resolve: (v: unknown) => void; reject: (e: unknown) => void } | null;
/** The headings the screen reader was moved to, by their text. */
const focusedTexts = () => focusCalls.map((n) => (n as HTMLElement | null)?.textContent ?? String(n));

beforeEach(() => {
  mode.native = true;
  focusCalls.length = 0;
  params.value = { goalId: 'g1' };
  clearMemberReads();
  localStorage.clear();
  sessionStorage.clear();
  answers.wsfGoalPulse = async () => PULSE;
  answers.wsfMyContribution = async () => MINE;
  contribute = null;
  answers.wsfContribute = () =>
    new Promise((resolve, reject) => {
      contribute = { resolve, reject };
    });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  localStorage.clear();
});

function seedUnknown(attemptId = 'att-7'): void {
  localStorage.setItem(PENDING_KEY, JSON.stringify({ goalId: 'g1', attemptId, count: 6, ts: Date.now(), state: 'unknown' }));
}

describe('W13-5 on a phone: the state screen that replaces the last one takes the focus', () => {
  it('restored unknown, then Confirm (recording), then its unknown answer: each heading focused once', async () => {
    seedUnknown();
    render();
    await settle();
    expect(byId('wsf-contribute-pending')).not.toBeNull();
    // The restore replaced the screen in place: the unknown heading.
    expect(focusedTexts()).toEqual([UNKNOWN_OUTCOME_HEADING]);
    render();
    await settle();
    expect(focusedTexts()).toEqual([UNKNOWN_OUTCOME_HEADING]);

    await act(async () => byId('wsf-contribute-reconcile')!.click());
    await settle();
    expect(byId('wsf-contribute-recording')).not.toBeNull();
    expect(focusedTexts()).toEqual([UNKNOWN_OUTCOME_HEADING, RECORDING_HEADING]);

    await act(async () => contribute!.reject(Object.assign(new Error('unavailable'), { code: 'functions/unavailable' })));
    await settle();
    expect(byId('wsf-contribute-pending')).not.toBeNull();
    expect(focusedTexts()).toEqual([UNKNOWN_OUTCOME_HEADING, RECORDING_HEADING, UNKNOWN_OUTCOME_HEADING]);
  });

  it('a confirmed answer leaves these screens: no state heading is focused for it', async () => {
    seedUnknown();
    render();
    await settle();
    await act(async () => byId('wsf-contribute-reconcile')!.click());
    await settle();
    focusCalls.length = 0;
    await act(async () => contribute!.resolve({ alreadyRecorded: false, sharedTotal: 46, addedCount: 6, ownCredit: 11 }));
    await settle();
    expect(byId('wsf-contribute-receipt')).not.toBeNull();
    expect(focusedTexts()).toEqual([]);
  });
});

describe('W13-5 on the web: no call (the sheet containment does it)', () => {
  it('the same walk makes no focus call', async () => {
    mode.native = false;
    seedUnknown();
    render();
    await settle();
    await act(async () => byId('wsf-contribute-reconcile')!.click());
    await settle();
    await act(async () => contribute!.reject(Object.assign(new Error('unavailable'), { code: 'functions/unavailable' })));
    await settle();
    expect(byId('wsf-contribute-pending')).not.toBeNull();
    expect(focusCalls).toEqual([]);
  });
});

describe('W13-5 site scan', () => {
  it('one ref on both state headings, keyed on the attempt and its state', () => {
    expect(ROUTE).toContain('useStepHeadingFocus(pending ? `${pending.attemptId}:${pending.state}` : null, stateHeadingRef);');
    expect(ROUTE).toContain('<Text ref={stateHeadingRef} style={styles.stepHeading} {...HEADING_1}>{RECORDING_HEADING}</Text>');
    expect(ROUTE).toContain('<Text ref={stateHeadingRef} style={styles.stepHeading} {...HEADING_1}>{UNKNOWN_OUTCOME_HEADING}</Text>');
    expect(ROUTE.match(/ref=\{stateHeadingRef\}/g)).toHaveLength(2);
  });
});
