import { act, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { BackHandler, Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { contributeBackAction, type ContributeBackSnapshot } from '../src/contributeBack';
import type { PendingContribution } from '../src/pendingContribution';

/**
 * W12-3 (INT-19). Android's hardware Back on the contribution flow. The pure
 * decision (src/contributeBack.ts) as a truth table, then the real route in
 * jsdom with Platform.OS 'android', BackHandler spied at its boundary, and
 * the callables mocked at the network boundary. No device.
 */
const params = { value: { goalId: 'g1' } as Record<string, string> };
const nav = { sheet: false };
const router = { replace: vi.fn(), push: vi.fn(), back: vi.fn(), canGoBack: () => true, dismissTo: vi.fn(), navigate: vi.fn(), dismissAll: vi.fn() };
const navigation = {
  dispatch: vi.fn(),
  isFocused: () => true,
  addListener: () => () => undefined,
  setOptions: vi.fn(),
  getState: () =>
    nav.sheet
      ? { index: 1, routes: [{ key: 't', name: '(tabs)' }, { key: 'c', name: 'contribute/[goalId]', params: params.value }] }
      : { index: 1, routes: [{ key: 't', name: '(tabs)' }, { key: 'c', name: 'contribute/[goalId]' }] },
};
vi.mock('expo-router', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  router,
  useRouter: () => router,
  useNavigation: () => navigation,
  usePathname: () => '/contribute/g1',
  useLocalSearchParams: () => params.value,
  // Focused for the life of the screen: the callback runs on mount, its cleanup on unmount.
  useFocusEffect: (cb: () => void | (() => void)) => useEffect(() => cb(), [cb]),
}));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 0, bottom: 0, left: 0, right: 0 }, frame: { x: 0, y: 0, width: 390, height: 844 } },
}));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/ui/useScreenTopInset', () => ({
  useScreenTopInset: () => 0,
  ScreenTopSpacer: () => null,
  ScreenStatusBar: () => null,
}));
vi.mock('../src/ui/useReducedMotion', () => ({
  useReducedMotion: () => true,
  useReducedMotionPreference: () => ({ known: true, reduced: true, failed: false }),
}));
vi.mock('../src/firebase', () => ({
  getFirebaseAuth: () => ({ currentUser: { uid: 'u1' } }),
  getFirebaseFirestore: () => ({}),
  getFirebaseFunctions: () => ({}),
  wsfUsingEmulators: false,
  wsfIsStaging: false,
}));
vi.mock('firebase/auth', () => ({ signOut: vi.fn(), onAuthStateChanged: () => () => undefined }));
const USER = { uid: 'u1', email: 'member@example.com', displayName: 'Member', emailVerified: true };
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: USER }) }));
const answers: Record<string, () => Promise<unknown>> = {};
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => async () => {
    const answer = answers[name];
    if (!answer) throw Object.assign(new Error('internal'), { code: 'functions/internal' });
    return { data: await answer() };
  },
}));
// The device's answer to "keep this attempt": kept, unless a case says it refused.
const storage = { refuses: false };
vi.mock('../src/pendingContribution', async () => {
  const actual = await vi.importActual<typeof import('../src/pendingContribution')>('../src/pendingContribution');
  return {
    ...actual,
    openAttempt: (...args: Parameters<typeof actual.openAttempt>) =>
      storage.refuses ? Promise.resolve({ fire: args[2](), durable: false }) : actual.openAttempt(...args),
  };
});

const { clearMemberReads } = await import('../src/memberReads');
const { default: ContributeToGoal } = await import('../app/contribute/[goalId]');

const PULSE = { sharedTotal: 40, target: 100, unit: 'squats', status: 'active' };
const MINE = { ownCredit: 5, unit: 'squats', repeatPolicy: 'multiple' };
const RESULT = { addedCount: 35, ownCredit: 40, sharedTotal: 75, target: 100, unit: 'squats', status: 'active', alreadyRecorded: false };
const OFFLINE = () => Promise.reject(Object.assign(new Error('unavailable'), { code: 'functions/unavailable' }));

let container: HTMLDivElement;
let root: Root;
let os: string;
let handlers: Array<() => boolean | null | undefined>;
let removed: Set<unknown>;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await act(async () => undefined);
};
const typeInto = (el: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const live = () => handlers.filter((h) => !removed.has(h));
/** Press Android's Back: the latest registered handler answers, as BackHandler would. */
const back = async () => {
  const h = live()[live().length - 1];
  expect(h, 'a Back handler is registered').toBeDefined();
  let consumed: boolean | null | undefined;
  await act(async () => {
    consumed = h!();
  });
  await settle();
  return consumed;
};
const press = async (id: string) => {
  await act(async () => byId(id)!.click());
  await settle();
};

beforeEach(() => {
  os = Platform.OS;
  (Platform as { OS: string }).OS = 'android';
  params.value = { goalId: 'g1' };
  nav.sheet = false;
  storage.refuses = false;
  clearMemberReads();
  localStorage.clear();
  for (const k of Object.keys(answers)) delete answers[k];
  answers.wsfGoalPulse = async () => PULSE;
  answers.wsfMyContribution = async () => MINE;
  Object.values(router).forEach((f) => typeof f === 'function' && 'mockClear' in f && (f as { mockClear: () => void }).mockClear());
  handlers = [];
  removed = new Set();
  vi.spyOn(BackHandler, 'addEventListener').mockImplementation(((_e: string, h: () => boolean) => {
    handlers.push(h);
    return { remove: () => removed.add(h) };
  }) as never);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
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

describe('W12-3: contributeBackAction, the decision', () => {
  const row = (state: PendingContribution['state']): PendingContribution => ({ goalId: 'g1', attemptId: 'a1', count: 35, ts: 1, state });
  const base: ContributeBackSnapshot = {
    submitting: false,
    pending: null,
    pendingDurable: true,
    restoreFailed: false,
    hasResult: false,
    hasRefusal: false,
    step: 'enter',
    initialStep: 'enter',
    asSheet: true,
    stepShown: true,
  };
  const cases: Array<[string, Partial<ContributeBackSnapshot>, ReturnType<typeof contributeBackAction>]> = [
    ['(a) submitting', { submitting: true, step: 'review' }, 'consume'],
    ['(a) sending, even with a receipt shown', { pending: row('sending'), hasResult: true }, 'consume'],
    ["(b') unknown and not kept", { pending: row('unknown'), pendingDurable: false }, 'consume'],
    ["(b') the stored attempt could not be read", { restoreFailed: true, step: 'review' }, 'consume'],
    ['(b) unknown and kept, in a sheet', { pending: row('unknown') }, 'close'],
    ['(b) unknown and kept, on a page', { pending: row('unknown'), asSheet: false }, 'pass'],
    ['(b) a receipt, in a sheet', { hasResult: true, step: 'review' }, 'close'],
    ['(b) a refusal, on a page', { hasRefusal: true, asSheet: false }, 'pass'],
    ['(c) review', { step: 'review' }, 'edit'],
    ['(c) review on a page', { step: 'review', asSheet: false }, 'edit'],
    ['(d) adjust', { step: 'adjust' }, 'consume'],
    ['(e) entry reached from the movement step', { step: 'enter', initialStep: 'move' }, 'toMove'],
    ['(e) entry opened directly, in a sheet', { step: 'enter', initialStep: 'enter' }, 'close'],
    ['(e) entry opened directly, on a page', { step: 'enter', initialStep: 'enter', asSheet: false }, 'pass'],
    ['(f) the movement step, in a sheet', { step: 'move', initialStep: 'move' }, 'close'],
    ['(f) the movement step, on a page', { step: 'move', initialStep: 'move', asSheet: false }, 'pass'],
    ['(b2) review hidden behind another screen (the goal closed), in a sheet', { step: 'review', stepShown: false }, 'close'],
    ['(b2) the move-reached entry hidden, on a page', { step: 'enter', initialStep: 'move', stepShown: false, asSheet: false }, 'pass'],
    ['(b2) does not outrank sending', { step: 'review', stepShown: false, submitting: true }, 'consume'],
    ["(b2) does not outrank (b')", { stepShown: false, pending: row('unknown'), pendingDurable: false }, 'consume'],
  ];
  it.each(cases)('%s → %s', (_name, over, expected) => {
    expect(contributeBackAction({ ...base, ...over })).toBe(expected);
  });
});

describe('W12-3: Android Back on the route', () => {
  it('review (35) → Back → the entry, still 35, and the screen stays', async () => {
    act(() => root.render(<ContributeToGoal />));
    await settle();
    act(() => typeInto(byId('wsf-contribute-entry') as HTMLInputElement, '35'));
    await press('wsf-contribute-review');
    expect(byId('wsf-contribute-review-screen')).not.toBeNull();
    expect(await back()).toBe(true);
    expect(byId('wsf-contribute-entry-screen')).not.toBeNull();
    expect((byId('wsf-contribute-entry') as HTMLInputElement).value).toBe('35');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('the movement step\'s entry → Back → the movement step, its timer still paused, the count kept', async () => {
    params.value = { goalId: 'g1', mode: 'move' };
    nav.sheet = true;
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(byId('wsf-contribute-move-screen')).not.toBeNull();
    await press('wsf-contribute-timer-start');
    expect(byId('wsf-contribute-timer-pause')).not.toBeNull();
    await press('wsf-contribute-done');
    act(() => typeInto(byId('wsf-contribute-entry') as HTMLInputElement, '35'));
    expect(await back()).toBe(true);
    expect(byId('wsf-contribute-move-screen')).not.toBeNull();
    expect(byId('wsf-contribute-timer-start')).not.toBeNull();
    expect(byId('wsf-contribute-timer-pause')).toBeNull();
    expect(router.back).not.toHaveBeenCalled();
    await press('wsf-contribute-done');
    expect((byId('wsf-contribute-entry') as HTMLInputElement).value).toBe('35');
  });

  it('sending → Back is consumed and nothing leaves', async () => {
    nav.sheet = true;
    params.value = { goalId: 'g1', mode: 'move' };
    answers.wsfContribute = () => new Promise(() => undefined);
    act(() => root.render(<ContributeToGoal />));
    await settle();
    await press('wsf-contribute-done');
    act(() => typeInto(byId('wsf-contribute-entry') as HTMLInputElement, '35'));
    await press('wsf-contribute-review');
    await press('wsf-contribute-submit');
    expect(byId('wsf-contribute-recording') ?? byId('wsf-contribute-pending')).not.toBeNull();
    expect(await back()).toBe(true);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('a receipt in the sheet → Back closes it like Close', async () => {
    nav.sheet = true;
    params.value = { goalId: 'g1', mode: 'move' };
    answers.wsfContribute = async () => RESULT;
    act(() => root.render(<ContributeToGoal />));
    await settle();
    await press('wsf-contribute-done');
    act(() => typeInto(byId('wsf-contribute-entry') as HTMLInputElement, '35'));
    await press('wsf-contribute-review');
    await press('wsf-contribute-submit');
    expect(byId('wsf-contribute-receipt')).not.toBeNull();
    expect(await back()).toBe(true);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('unknown and NOT kept by the device → Back is consumed; the not-saved notice stays; nothing pops', async () => {
    nav.sheet = true;
    params.value = { goalId: 'g1', mode: 'move' };
    storage.refuses = true;
    answers.wsfContribute = OFFLINE;
    act(() => root.render(<ContributeToGoal />));
    await settle();
    await press('wsf-contribute-done');
    act(() => typeInto(byId('wsf-contribute-entry') as HTMLInputElement, '35'));
    await press('wsf-contribute-review');
    await press('wsf-contribute-submit');
    expect(byId('wsf-contribute-not-saved')).not.toBeNull();
    // RV11-641-3: pressed again and again, Back never leaves the only copy.
    for (let i = 0; i < 3; i += 1) expect(await back()).toBe(true);
    expect(byId('wsf-contribute-not-saved')).not.toBeNull();
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('RV11-641-3: unknown and NOT kept, on a page opened at the entry: Back twice, still consumed, never handed to the navigator', async () => {
    storage.refuses = true;
    answers.wsfContribute = OFFLINE;
    act(() => root.render(<ContributeToGoal />));
    await settle();
    act(() => typeInto(byId('wsf-contribute-entry') as HTMLInputElement, '35'));
    await press('wsf-contribute-review');
    await press('wsf-contribute-submit');
    expect(byId('wsf-contribute-not-saved')).not.toBeNull();
    // Without (b') the second press would return false and the navigator would pop the only copy.
    expect(await back()).toBe(true);
    expect(await back()).toBe(true);
    expect(byId('wsf-contribute-not-saved')).not.toBeNull();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('unknown and kept → Back closes the sheet (the attempt waits on the device)', async () => {
    nav.sheet = true;
    params.value = { goalId: 'g1', mode: 'move' };
    answers.wsfContribute = OFFLINE;
    act(() => root.render(<ContributeToGoal />));
    await settle();
    await press('wsf-contribute-done');
    act(() => typeInto(byId('wsf-contribute-entry') as HTMLInputElement, '35'));
    await press('wsf-contribute-review');
    await press('wsf-contribute-submit');
    expect(byId('wsf-contribute-pending')).not.toBeNull();
    expect(byId('wsf-contribute-not-saved')).toBeNull();
    expect(await back()).toBe(true);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('RV11-641-2: the goal closes mid-review in the sheet → one Back leaves (no walking the hidden steps)', async () => {
    nav.sheet = true;
    params.value = { goalId: 'g1', mode: 'move' };
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    act(() => root.render(<ContributeToGoal />));
    await settle();
    await press('wsf-contribute-done');
    act(() => typeInto(byId('wsf-contribute-entry') as HTMLInputElement, '35'));
    await press('wsf-contribute-review');
    expect(byId('wsf-contribute-review-screen')).not.toBeNull();
    // The goal closes; the next poll tick says so.
    answers.wsfGoalPulse = async () => ({ ...PULSE, status: 'closed' });
    await act(async () => vi.advanceTimersByTime(2_000));
    await settle();
    expect(byId('wsf-contribute-closed')).not.toBeNull();
    expect(await back()).toBe(true);
    expect(router.back).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('a kiosk registers no Back listener (Finish is the way out)', async () => {
    params.value = { goalId: 'g1', kiosk: '1' };
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(handlers).toHaveLength(0);
  });

  it('web and iOS register no Back listener', async () => {
    for (const platform of ['web', 'ios']) {
      (Platform as { OS: string }).OS = platform;
      act(() => root.render(<ContributeToGoal key={platform} />));
      await settle();
      expect(handlers, platform).toHaveLength(0);
    }
  });

  it('the listener goes when the screen does', async () => {
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(live()).toHaveLength(1);
    act(() => root.render(<div />));
    expect(live()).toHaveLength(0);
  });
});
