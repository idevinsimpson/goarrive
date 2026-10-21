import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AccessibilityInfo } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  RECORDING_HEADING,
  REPLAY_SIGN_IN_NOTICE,
  RESTORE_FAILED_HEADING,
  UNKNOWN_OUTCOME_HEADING,
} from '../src/contributionFlow';

/**
 * W13-4 (INT-18): the state outcome screens tell a phone's screen reader what
 * happened. Recording, the unknown outcome and the couldn't-read-the-saved-
 * attempt screen used to say so only through `aria-live`, which iOS ignores.
 * Each sheet now spreads `liveRegion` (`aria-live="polite"` on web, nothing on
 * native) and holds a `SpokenOnce` that speaks its heading once per attempt
 * and state through the shared helper (src/ui/announce.native.ts). The
 * Together receipt's live region spreads `liveRegion` too.
 *
 * The route is rendered into jsdom through react-native-web with the
 * callables mocked at the network boundary. `mode.native` switches the
 * announce module between its native and web twins; what the native twin
 * posts is read off `AccessibilityInfo`. No device.
 *
 * The site scan for these screens lives here (W12-7 owns the shared one).
 */

const mode = vi.hoisted(() => ({
  native: true,
  /** Every key `useAnnounce` was called with, in order (each render). */
  keys: [] as unknown[],
}));
vi.mock('../src/ui/announce', async () => {
  const native = await vi.importActual<typeof import('../src/ui/announce.native')>('../src/ui/announce.native');
  const web = await vi.importActual<typeof import('../src/ui/announce')>('../src/ui/announce');
  return {
    get liveRegion() {
      return mode.native ? native.liveRegion : web.liveRegion;
    },
    useAnnounce: (...args: Parameters<typeof web.useAnnounce>) => {
      mode.keys.push(args[1]);
      return (mode.native ? native.useAnnounce : web.useAnnounce)(...args);
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
const { signOut } = await import('firebase/auth');
const { default: ContributeToGoal } = await import('../app/contribute/[goalId]');
const { SpokenOnce } = await import('../src/ui/SpokenOnce');

const PULSE = { sharedTotal: 40, target: 100, unit: 'squats', status: 'active' };
const MINE = { ownCredit: 5, unit: 'squats', repeatPolicy: 'multiple' };
const PENDING_KEY = `wsf.pendingContribution.g1.${USER.uid}`;
const ROUTE = readFileSync(join(__dirname, '../app/contribute/[goalId].tsx'), 'utf8');

let container: HTMLDivElement;
let root: Root;
/** Everything the native twin posted to the screen reader, in order. */
let spoken: string[];
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 8; i += 1) await act(async () => undefined);
};
const render = () =>
  act(() => {
    root.render(<ContributeToGoal />);
  });
/** The contribute call, answered when the test says. */
let contribute: { resolve: (v: unknown) => void; reject: (e: unknown) => void } | null;

beforeEach(() => {
  mode.native = true;
  mode.keys.length = 0;
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
  spoken = [];
  const post = (message: string) => {
    spoken.push(message);
  };
  vi.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(post);
  const withOptions = (AccessibilityInfo as { announceForAccessibilityWithOptions?: unknown })
    .announceForAccessibilityWithOptions;
  if (typeof withOptions === 'function') {
    vi.spyOn(AccessibilityInfo, 'announceForAccessibilityWithOptions').mockImplementation((m: string) => post(m));
  }
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
  localStorage.setItem(
    PENDING_KEY,
    JSON.stringify({ goalId: 'g1', attemptId, count: 6, ts: Date.now(), state: 'unknown' }),
  );
}

describe('W13-4 on a phone: each state screen is said once', () => {
  it('the unknown outcome is said once, and a re-render does not say it again', async () => {
    seedUnknown();
    render();
    await settle();
    expect(byId('wsf-contribute-pending')).not.toBeNull();
    expect(spoken).toEqual([UNKNOWN_OUTCOME_HEADING]);
    render();
    await settle();
    expect(spoken).toEqual([UNKNOWN_OUTCOME_HEADING]);
  });

  it('Confirm says "Recording…" once; an answer that leaves it unknown says so again, with the reason', async () => {
    seedUnknown();
    render();
    await settle();
    spoken.length = 0;
    await act(async () => byId('wsf-contribute-reconcile')!.click());
    await settle();
    expect(byId('wsf-contribute-recording')).not.toBeNull();
    expect(spoken).toEqual([RECORDING_HEADING]);
    render();
    await settle();
    expect(spoken).toEqual([RECORDING_HEADING]);
    // The replay answers "not signed in": still unknown, and the screen says why.
    await act(async () => contribute!.reject(Object.assign(new Error('unauthenticated'), { code: 'functions/unauthenticated' })));
    await settle();
    expect(byId('wsf-contribute-pending')).not.toBeNull();
    expect(spoken).toEqual([RECORDING_HEADING, `${UNKNOWN_OUTCOME_HEADING} ${REPLAY_SIGN_IN_NOTICE}`]);
  });

  it('a later screen for another attempt is said again', async () => {
    seedUnknown('att-a');
    render();
    await settle();
    act(() => root.unmount());
    root = createRoot(container);
    localStorage.clear();
    seedUnknown('att-b');
    render();
    await settle();
    expect(spoken).toEqual([UNKNOWN_OUTCOME_HEADING, UNKNOWN_OUTCOME_HEADING]);
  });

  it('the couldn’t-read screen is said once while it stays up', async () => {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ goalId: 'g1', attemptId: 'att-old', count: 3, ts: Date.now(), state: 'unknown' }));
    const realGet = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key.startsWith('wsf.pendingContribution.')) throw new DOMException('refused', 'SecurityError');
      return realGet.call(this, key);
    });
    render();
    await settle();
    expect(byId('wsf-contribute-restore-failed')).not.toBeNull();
    expect(spoken).toEqual([RESTORE_FAILED_HEADING]);
    // Try again: the screen stays up while it reads, and fails again.
    await act(async () => byId('wsf-contribute-restore-retry')!.click());
    await settle();
    expect(byId('wsf-contribute-restore-failed')).not.toBeNull();
    expect(spoken).toEqual([RESTORE_FAILED_HEADING]);
  });

  it('no live region on a phone: the sheets carry no aria-live there', async () => {
    seedUnknown();
    render();
    await settle();
    expect(byId('wsf-contribute-pending')!.getAttribute('aria-live')).toBeNull();
  });
});

describe('W13-4 on the web: the live regions are as they were, and nothing is posted', () => {
  it('pending, recording, couldn’t-read and the receipt keep aria-live="polite"', async () => {
    mode.native = false;
    seedUnknown();
    render();
    await settle();
    expect(byId('wsf-contribute-pending')!.getAttribute('aria-live')).toBe('polite');
    await act(async () => byId('wsf-contribute-reconcile')!.click());
    await settle();
    expect(byId('wsf-contribute-recording')!.getAttribute('aria-live')).toBe('polite');
    await act(async () => contribute!.resolve({ alreadyRecorded: false, sharedTotal: 46, addedCount: 6, ownCredit: 11 }));
    await settle();
    expect(byId('wsf-contribute-receipt')!.getAttribute('aria-live')).toBe('polite');
    expect(spoken).toEqual([]);
  });

  it('the couldn’t-read screen keeps aria-live="polite"', async () => {
    mode.native = false;
    localStorage.setItem(PENDING_KEY, JSON.stringify({ goalId: 'g1', attemptId: 'att-old', count: 3, ts: Date.now(), state: 'unknown' }));
    const realGet = Storage.prototype.getItem;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, key: string) {
      if (key.startsWith('wsf.pendingContribution.')) throw new DOMException('refused', 'SecurityError');
      return realGet.call(this, key);
    });
    render();
    await settle();
    expect(byId('wsf-contribute-restore-failed')!.getAttribute('aria-live')).toBe('polite');
    expect(spoken).toEqual([]);
  });
});

describe('W13-4b on a phone: the kiosk countdown and the Finish error', () => {
  const COUNTDOWN = /^Finishing in \d+ seconds?$/;
  const FINISH_ERROR = 'We couldn’t sign you out. Don’t leave this device signed in — try Finish again.';
  const said = (re: RegExp | string) => spoken.filter((m) => (typeof re === 'string' ? m === re : re.test(m)));

  it('the countdown is said once per clock start, never per tick; Stay starts it again', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      params.value = { goalId: 'g1', kiosk: '1' };
      seedUnknown();
      render();
      await settle();
      expect(byId('wsf-kiosk-countdown')).not.toBeNull();
      expect(said(COUNTDOWN)).toHaveLength(1);
      const first = byId('wsf-kiosk-countdown')!.textContent;
      // Three ticks: the visible text moves, nothing more is said.
      await act(async () => vi.advanceTimersByTime(3_000));
      await settle();
      expect(byId('wsf-kiosk-countdown')!.textContent).not.toBe(first);
      expect(said(COUNTDOWN)).toHaveLength(1);
      // Stay: a new deadline, said once.
      await act(async () => byId('wsf-kiosk-stay')!.click());
      await settle();
      await act(async () => vi.advanceTimersByTime(1_000));
      await settle();
      expect(said(COUNTDOWN)).toHaveLength(2);
      await act(async () => vi.advanceTimersByTime(2_000));
      await settle();
      expect(said(COUNTDOWN)).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a Finish whose sign-out fails is said, once per failure', async () => {
    params.value = { goalId: 'g1', kiosk: '1' };
    vi.mocked(signOut).mockRejectedValue(new Error('network'));
    seedUnknown();
    render();
    await settle();
    await act(async () => byId('wsf-kiosk-finish')!.click());
    await settle();
    expect(byId('wsf-kiosk-finish-error')).not.toBeNull();
    expect(said(FINISH_ERROR)).toHaveLength(1);
    render();
    await settle();
    expect(said(FINISH_ERROR)).toHaveLength(1);
    await act(async () => byId('wsf-kiosk-finish')!.click());
    await settle();
    expect(said(FINISH_ERROR)).toHaveLength(2);
    expect(byId('wsf-kiosk-finish-error')!.getAttribute('aria-live')).toBeNull();
    expect(byId('wsf-kiosk-countdown')!.getAttribute('aria-live')).toBeNull();
  });

  it('web: both keep aria-live="polite", and nothing is posted', async () => {
    mode.native = false;
    params.value = { goalId: 'g1', kiosk: '1' };
    vi.mocked(signOut).mockRejectedValue(new Error('network'));
    seedUnknown();
    render();
    await settle();
    expect(byId('wsf-kiosk-countdown')!.getAttribute('aria-live')).toBe('polite');
    await act(async () => byId('wsf-kiosk-finish')!.click());
    await settle();
    expect(byId('wsf-kiosk-finish-error')!.getAttribute('aria-live')).toBe('polite');
    expect(spoken).toEqual([]);
  });

  it('site scan: liveRegion and SpokenOnce at both, keyed on the clock start and the failure', () => {
    const countdown = ROUTE.slice(ROUTE.indexOf('<View style={styles.kioskCountdownRow}>'), ROUTE.indexOf('testID="wsf-kiosk-stay"'));
    expect(countdown).toContain('<SpokenOnce message={kioskCountdown} announceKey={`kiosk-countdown:${kioskStartedAt}`} />');
    expect(countdown).toContain('{...liveRegion}');
    expect(countdown).not.toContain('aria-live');
    const error = ROUTE.slice(ROUTE.indexOf('testID="wsf-kiosk-finish-error"'), ROUTE.indexOf('{kioskError}\n'));
    expect(error).toContain('{...liveRegion}');
    expect(error).not.toContain('aria-live');
    expect(error).toContain('<SpokenOnce message={kioskError} announceKey="kiosk-finish-error" />');
  });
});

describe('W13-8 (INT-18): the kiosk receipt is said once per attempt on a phone', () => {
  const RECEIPT = {
    alreadyRecorded: false,
    sharedTotal: 46,
    target: 100,
    unit: 'squats',
    status: 'active',
    addedCount: 6,
    ownCredit: 11,
  };
  /** The receipt announcements' keys, each once, in the order first asked for. */
  const receiptKeys = () => [
    ...new Set(mode.keys.filter((k): k is string => typeof k === 'string' && /:(recorded|already)$/.test(k))),
  ];
  /** The receipt's own two sentences, as drawn. */
  const drawnSentence = () =>
    `${byId('wsf-contribute-result-headline')!.textContent} ${byId('wsf-contribute-result-subline')!.textContent}`;
  it('said once, and not again on a re-render or as the kiosk clock ticks', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    try {
      params.value = { goalId: 'g1', kiosk: '1' };
      seedUnknown();
      render();
      await settle();
      await act(async () => byId('wsf-contribute-reconcile')!.click());
      await settle();
      await act(async () => contribute!.resolve(RECEIPT));
      await settle();
      expect(byId('wsf-contribute-receipt')).not.toBeNull();
      // The kiosk keeps the ordinary receipt (no Together completion here, and
      // no Record more: Finish ends a kiosk visit).
      expect(container.querySelector('[data-together-phase]')).toBeNull();
      const sentence = drawnSentence();
      expect(spoken.filter((m) => m === sentence)).toHaveLength(1);
      render();
      await settle();
      await act(async () => vi.advanceTimersByTime(3_000));
      await settle();
      expect(spoken.filter((m) => m === sentence)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('another attempt’s receipt is its own announcement', async () => {
    params.value = { goalId: 'g1', kiosk: '1' };
    seedUnknown('att-a');
    render();
    await settle();
    await act(async () => byId('wsf-contribute-reconcile')!.click());
    await settle();
    await act(async () => contribute!.resolve(RECEIPT));
    await settle();
    const first = drawnSentence();
    act(() => root.unmount());
    root = createRoot(container);
    localStorage.clear();
    seedUnknown('att-b');
    render();
    await settle();
    await act(async () => byId('wsf-contribute-reconcile')!.click());
    await settle();
    await act(async () => contribute!.resolve({ ...RECEIPT, alreadyRecorded: true }));
    await settle();
    const second = drawnSentence();
    expect(second).not.toBe(first);
    expect(spoken.filter((m) => m === first)).toHaveLength(1);
    expect(spoken.filter((m) => m === second)).toHaveLength(1);
  });

  it('two attempts in the SAME route instance (no unmount): each receipt is keyed by its own attempt and said once', async () => {
    params.value = { goalId: 'g1', kiosk: '1' };
    seedUnknown('att-a');
    render();
    await settle();
    await act(async () => byId('wsf-contribute-reconcile')!.click());
    await settle();
    await act(async () => contribute!.resolve(RECEIPT));
    await settle();
    const first = drawnSentence();
    expect(receiptKeys()).toEqual(['att-a:recorded']);

    // The same mounted route moves to another goal (an Expo Router params
    // update, not a new screen): the receipt is cleared with the old context,
    // that goal's unconfirmed attempt is restored and confirmed. The ref that
    // keys the receipt lives across both attempts here; nothing remounts it.
    localStorage.setItem(
      `wsf.pendingContribution.g2.${USER.uid}`,
      JSON.stringify({ goalId: 'g2', attemptId: 'att-b', count: 6, ts: Date.now(), state: 'unknown' }),
    );
    params.value = { goalId: 'g2', kiosk: '1' };
    render();
    await settle();
    await act(async () => byId('wsf-contribute-reconcile')!.click());
    await settle();
    // The same outcome and the same figures: the same two sentences. Only the
    // attempt tells the two announcements apart.
    await act(async () => contribute!.resolve(RECEIPT));
    await settle();
    expect(drawnSentence()).toBe(first);
    expect(receiptKeys()).toEqual(['att-a:recorded', 'att-b:recorded']);
    expect(spoken.filter((m) => m === first)).toHaveLength(2);
  });

  it('one SpokenOnce kept mounted across two attempts with the same sentence says it for each attempt, once', () => {
    const sentence = 'You added 6 squats. Thanks for adding to the shared total.';
    const draw = (attemptId: string) =>
      act(() => {
        root.render(<SpokenOnce message={sentence} announceKey={`${attemptId}:recorded`} />);
      });
    draw('att-a');
    draw('att-a');
    expect(spoken.filter((m) => m === sentence)).toHaveLength(1);
    draw('att-b');
    draw('att-b');
    expect(spoken.filter((m) => m === sentence)).toHaveLength(2);
  });

  it('the member’s own (Together) receipt is never doubled by it', async () => {
    seedUnknown();
    render();
    await settle();
    await act(async () => byId('wsf-contribute-reconcile')!.click());
    await settle();
    spoken.length = 0;
    await act(async () => contribute!.resolve(RECEIPT));
    await settle();
    expect(container.querySelector('[data-together-phase]')).not.toBeNull();
    // Nothing from the kiosk receipt's announcement: the Together receipt speaks for itself.
    expect(spoken.filter((m) => /^You added|^This contribution was already recorded/.test(m))).toEqual([]);
  });

  it('web: aria-live="polite" as before, and nothing posted', async () => {
    mode.native = false;
    params.value = { goalId: 'g1', kiosk: '1' };
    seedUnknown();
    render();
    await settle();
    await act(async () => byId('wsf-contribute-reconcile')!.click());
    await settle();
    await act(async () => contribute!.resolve(RECEIPT));
    await settle();
    expect(byId('wsf-contribute-receipt')!.getAttribute('aria-live')).toBe('polite');
    expect(spoken).toEqual([]);
  });

  it('site scan: liveRegion, no raw aria-live, and the announcement keyed by attempt and outcome', () => {
    const at = ROUTE.indexOf('style={[styles.sheetBody, windowHeight < 700 ? styles.sheetBodyShort : null]}');
    expect(at).toBeGreaterThan(-1);
    const tag = ROUTE.slice(at, ROUTE.indexOf('<View style={styles.badge}>', at));
    expect(tag).toContain('testID="wsf-contribute-receipt"');
    expect(tag).toContain('{...liveRegion}');
    expect(tag).not.toMatch(/aria-live=/);
    expect(tag).toContain('message={`${copy.headline} ${copy.subline}`}');
    expect(tag).toContain("announceKey={`${receiptAttemptRef.current}:${r.alreadyRecorded ? 'already' : 'recorded'}`}");
    expect(ROUTE).toContain('      receiptAttemptRef.current = attemptId;\n      setLastResult(data);');
  });
});

describe('W13-4 site scan (app/contribute/[goalId].tsx)', () => {
  /** The opening tag and first children of the sheet with this testID. */
  const sheet = (testId: string) => {
    const at = ROUTE.indexOf(`testID="${testId}"`);
    expect(at).toBeGreaterThan(-1);
    return ROUTE.slice(ROUTE.lastIndexOf('<View', at), ROUTE.indexOf('{renderSheetHead(', at));
  };

  it('recording: liveRegion, and its heading said once per attempt', () => {
    const s = sheet('wsf-contribute-recording');
    expect(s).toContain('{...liveRegion}');
    expect(s).not.toContain('aria-live');
    expect(s).toContain('<SpokenOnce message={RECORDING_HEADING} announceKey={`${pending.attemptId}:sending`} />');
    expect(ROUTE).toContain('<Text ref={stateHeadingRef} style={styles.stepHeading} {...HEADING_1}>{RECORDING_HEADING}</Text>');
  });

  it('unknown: liveRegion, and its heading (with the notice) said once per attempt', () => {
    const s = sheet('wsf-contribute-pending');
    expect(s).toContain('{...liveRegion}');
    expect(s).not.toContain('aria-live');
    expect(s).toContain('message={attemptNotice ? `${UNKNOWN_OUTCOME_HEADING} ${attemptNotice}` : UNKNOWN_OUTCOME_HEADING}');
    expect(s).toContain('announceKey={`${pending.attemptId}:unknown`}');
    expect(ROUTE).toContain('<Text ref={stateHeadingRef} style={styles.stepHeading} {...HEADING_1}>{UNKNOWN_OUTCOME_HEADING}</Text>');
  });

  it('couldn’t read: liveRegion, and its heading said once', () => {
    const s = sheet('wsf-contribute-restore-failed');
    expect(s).toContain('{...liveRegion}');
    expect(s).not.toContain('aria-live');
    expect(s).toContain('<SpokenOnce message={RESTORE_FAILED_HEADING} announceKey="restore-failed" />');
  });

  it('the Together receipt spreads liveRegion (its own announcement is the receipt’s, src/ui/TogetherCompletion.tsx)', () => {
    const at = ROUTE.indexOf('style={styles.togetherBody}');
    expect(at).toBeGreaterThan(-1);
    const tag = ROUTE.slice(at, ROUTE.indexOf('>', ROUTE.indexOf('dataSet', at)));
    expect(tag).toContain('testID="wsf-contribute-receipt"');
    expect(tag).toContain('{...liveRegion}');
    expect(tag).not.toContain('aria-live');
  });

  it('the headings are the shared sentences, unchanged', () => {
    expect(RECORDING_HEADING).toBe('Recording your contribution…');
    expect(UNKNOWN_OUTCOME_HEADING).toBe('We couldn’t confirm your contribution yet.');
  });
});

describe('SpokenOnce', () => {
  it('is a thin wrapper over useAnnounce: same message and key, nothing rendered', () => {
    const src = readFileSync(join(__dirname, '../src/ui/SpokenOnce.tsx'), 'utf8');
    expect(src).toContain('useAnnounce(message, announceKey);');
    expect(src).toContain('return null;');
  });
});
