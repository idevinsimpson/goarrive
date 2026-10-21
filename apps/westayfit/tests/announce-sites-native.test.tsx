import { FirebaseError } from 'firebase/app';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AccessibilityInfo, AppState, Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * W12-7 (INT-18) on a phone. The integrator's three announcing sites speak
 * their visible sentence through the shared helper's native twin
 * (src/ui/announce.native.ts, Metro's resolution): contribute's refusal and
 * entry error, and Progress's partial note. AccessibilityInfo is spied at
 * react-native's boundary; the routes render in jsdom with the callables
 * mocked at the network boundary. No device.
 */
vi.mock('../src/ui/announce', async () => import('../src/ui/announce.native'));

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

const { clearMemberReads } = await import('../src/memberReads');
const { default: ContributeToGoal } = await import('../app/contribute/[goalId]');
const { ProgressParityView, PARTIAL_SENTENCE } = await import('../src/ui/ProgressParityView');

let container: HTMLDivElement;
let root: Root;
let os: string;
let spoken: string[];
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await act(async () => undefined);
};
const press = async (id: string) => {
  await act(async () => byId(id)!.click());
  await settle();
};
const typeInto = (el: HTMLInputElement, value: string) => {
  Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() => {
  os = Platform.OS;
  (Platform as { OS: string }).OS = 'ios';
  params.value = { goalId: 'g1' };
  clearMemberReads();
  localStorage.clear();
  for (const k of Object.keys(answers)) delete answers[k];
  answers.wsfGoalPulse = async () => ({ sharedTotal: 40, target: 100, unit: 'squats', status: 'active' });
  answers.wsfMyContribution = async () => ({ ownCredit: 5, unit: 'squats', repeatPolicy: 'multiple' });
  spoken = [];
  Object.defineProperty(AppState, 'currentState', { value: 'active', configurable: true });
  (AccessibilityInfo as unknown as { announceForAccessibilityWithOptions: unknown }).announceForAccessibilityWithOptions = (m: string) => spoken.push(m);
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

describe('W12-7: contribute speaks its refusal and its entry error on a phone', () => {
  it('the entry error: its visible sentence, once per appearance (again after it was cleared)', async () => {
    act(() => root.render(<ContributeToGoal />));
    await settle();
    await press('wsf-contribute-review');
    expect(byId('wsf-contribute-error')!.textContent).toBe('Enter how many you completed.');
    expect(spoken).toEqual(['Enter how many you completed.']);
    // A re-render does not speak it again.
    act(() => root.render(<ContributeToGoal />));
    await settle();
    expect(spoken).toHaveLength(1);
    // Typing clears it; the same mistake again is a new appearance.
    act(() => typeInto(byId('wsf-contribute-entry') as HTMLInputElement, '3'));
    act(() => typeInto(byId('wsf-contribute-entry') as HTMLInputElement, ''));
    await press('wsf-contribute-review');
    expect(spoken).toEqual(['Enter how many you completed.', 'Enter how many you completed.']);
  });

  it('a definitive refusal (the goal closed meanwhile): "Not recorded." and its headline and body, once', async () => {
    answers.wsfContribute = () => Promise.reject(new FirebaseError('functions/failed-precondition', 'goal is closed'));
    act(() => root.render(<ContributeToGoal />));
    await settle();
    act(() => typeInto(byId('wsf-contribute-entry') as HTMLInputElement, '35'));
    await press('wsf-contribute-review');
    await press('wsf-contribute-submit');
    expect(byId('wsf-contribute-refused')).not.toBeNull();
    const headline = byId('wsf-contribute-refused-headline')!.textContent;
    const body = byId('wsf-contribute-refused-body')!.textContent;
    expect(headline).toBe('This goal is no longer accepting contributions.');
    expect(spoken).toEqual([`Not recorded. ${headline} ${body}`]);
  });

  it('the refusal carries no live region of its own on a phone (it would speak twice beside the announcement)', async () => {
    answers.wsfContribute = () => Promise.reject(new FirebaseError('functions/failed-precondition', 'goal is closed'));
    act(() => root.render(<ContributeToGoal />));
    await settle();
    act(() => typeInto(byId('wsf-contribute-entry') as HTMLInputElement, '35'));
    await press('wsf-contribute-review');
    await press('wsf-contribute-submit');
    expect(byId('wsf-contribute-refused')!.hasAttribute('aria-live')).toBe(false);
  });
});

describe('W12-7: Progress speaks its partial note on a phone', () => {
  const state = {
    kind: 'ready' as const,
    memberName: 'Alex M.',
    open: [],
    finished: [],
    partial: true,
    canStart: true,
    receipts: null,
  };
  const actions = { onRetry: vi.fn(), onStartMoving: vi.fn(), onOpenCommunity: vi.fn(), onOpenReceipt: vi.fn() };

  it('its visible sentence, once per appearance', () => {
    act(() => root.render(<ProgressParityView state={state} actions={actions} />));
    expect(byId('wsf-activity-partial')!.textContent).toContain(PARTIAL_SENTENCE.slice(0, 40));
    expect(spoken).toEqual([PARTIAL_SENTENCE]);
    act(() => root.render(<ProgressParityView state={{ ...state }} actions={actions} />));
    expect(spoken).toHaveLength(1);
    act(() => root.render(<ProgressParityView state={{ ...state, partial: false }} actions={actions} />));
    act(() => root.render(<ProgressParityView state={{ ...state, partial: true }} actions={actions} />));
    expect(spoken).toEqual([PARTIAL_SENTENCE, PARTIAL_SENTENCE]);
  });
});
