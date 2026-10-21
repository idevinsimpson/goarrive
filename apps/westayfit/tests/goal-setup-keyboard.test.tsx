import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Keyboard, Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-INTEGRATOR-1 (INT-06 cases 2 and 4, #641 SH-2): Goal setup's page
 * keeps a field focused after scrolling above the Android IME, the same way
 * Home does, and web and iOS render its scroll view exactly as before (no
 * wrapper). The route is rendered into jsdom on its gated-off branch, which
 * goes through the same `Page`. The keyboard module is the real native one
 * (vitest otherwise resolves the inert web stub). No device.
 */

vi.mock('expo-router', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  useLocalSearchParams: () => ({ groupId: 'oak' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: vi.fn() }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => vi.fn() }));
vi.mock('../src/firebase', () => ({
  getFirebaseFirestore: () => ({}),
  getFirebaseFunctions: () => ({}),
  // A production build: the screen renders its gated-off card inside Page.
  wsfIsStaging: false,
  wsfUsingEmulators: false,
}));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: null }) }));
vi.mock('../src/ui/keyboardAvoidance', async () => import('../src/ui/keyboardAvoidance.native'));

const { default: NewGoalPage } = await import('../app/goals/new');

let container: HTMLDivElement;
let root: Root;
let os: string;
const card = () => container.querySelector('[data-testid="wsf-new-goal-gated-off"]') as HTMLElement | null;

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

/** The element the route renders at the top: the scroll view, or a frame around it. */
const top = () => container.firstElementChild as HTMLElement;

describe('Goal setup and the keyboard (INT-06)', () => {
  it('web: the scroll view is the page itself, with no frame around it', () => {
    act(() => root.render(<NewGoalPage />));
    expect(card()).not.toBeNull();
    const web = top().outerHTML;
    // The same tree with the platform set to iOS: also no frame.
    act(() => root.unmount());
    root = createRoot(container);
    (Platform as { OS: string }).OS = 'ios';
    act(() => root.render(<NewGoalPage />));
    expect(card()).not.toBeNull();
    expect(top().outerHTML).toBe(web);
  });

  it('Android: a frame pads the page by the IME, so the focused field stays above it', async () => {
    act(() => root.render(<NewGoalPage />));
    const scrollOnWeb = top().outerHTML;
    act(() => root.unmount());
    root = createRoot(container);

    const handlers: Record<string, (e: unknown) => void> = {};
    vi.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, h: (e: unknown) => void) => {
      handlers[name] = h;
      return { remove: () => delete handlers[name] };
    }) as never);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, width: 390, height: 844, right: 390, bottom: 844, toJSON: () => ({}),
    } as DOMRect);
    (Platform as { OS: string }).OS = 'android';
    act(() => root.render(<NewGoalPage />));
    const frame = top();
    // The frame wraps exactly the scroll view web renders.
    expect(frame.children).toHaveLength(1);
    expect((frame.firstElementChild as HTMLElement).outerHTML).toBe(scrollOnWeb);
    expect(frame.style.paddingBottom).toBe('');
    expect(Object.keys(handlers).sort()).toEqual(['keyboardDidHide', 'keyboardDidShow']);
    await act(async () => {
      handlers.keyboardDidShow!({ endCoordinates: { screenY: 500, screenX: 0, width: 390, height: 344 } });
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(frame.style.paddingBottom).toBe('344px');
    act(() => handlers.keyboardDidHide!({ endCoordinates: { screenY: 844, screenX: 0, width: 390, height: 0 } }));
    expect(frame.style.paddingBottom).toBe('');
  });
});
