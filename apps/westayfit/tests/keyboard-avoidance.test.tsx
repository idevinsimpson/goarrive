import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Keyboard, Text, TextInput } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('expo-router', () => ({
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));

import { FormShell, QuietShell } from '../src/AuthFormPrimitives';
import { AndroidKeyboardInsetView, imeOverlap, keyboardScrollProps } from '../src/ui/keyboardAvoidance';

/**
 * NATIVE-INTEGRATOR-1 (INT-06): the entry forms keep the focused field above
 * the software keyboard. No device here (the visual cases are Appendix C item
 * 4): what is proved is the platform split, the Android padding arithmetic and
 * lifecycle, and that web renders exactly what it did.
 */

const APP_ROOT = join(__dirname, '..');
const read = (p: string) => readFileSync(join(APP_ROOT, p), 'utf8');

let container: HTMLDivElement;
let root: Root;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('the platform split', () => {
  it('iOS insets the scroll view for the keyboard; Android and web add no prop', () => {
    expect(keyboardScrollProps('ios')).toEqual({ automaticallyAdjustKeyboardInsets: true });
    expect(keyboardScrollProps('android')).toEqual({});
    expect(keyboardScrollProps('web')).toEqual({});
  });

  it('the form frame is the keyboard-aware view on Android and a plain View elsewhere', async () => {
    const { Platform, View } = await import('react-native');
    const os = Platform.OS;
    try {
      vi.resetModules();
      (Platform as { OS: string }).OS = 'android';
      const android = await import('../src/ui/keyboardAvoidance');
      expect(android.KeyboardInsetView).toBe(android.AndroidKeyboardInsetView);
      vi.resetModules();
      (Platform as { OS: string }).OS = 'ios';
      const ios = await import('../src/ui/keyboardAvoidance');
      expect(ios.KeyboardInsetView).toBe(View);
      expect(ios.KEYBOARD_SCROLL_PROPS).toEqual({ automaticallyAdjustKeyboardInsets: true });
    } finally {
      (Platform as { OS: string }).OS = os;
      vi.resetModules();
    }
  });

  it('the overlap is how far the IME top sits above the frame bottom, never negative', () => {
    expect(imeOverlap({ y: 0, height: 844 }, 500)).toBe(344);
    // A staging strip above the frame: the frame starts lower, the overlap is still exact.
    expect(imeOverlap({ y: 24, height: 820 }, 500)).toBe(344);
    // A frame that ends above the keyboard (a tab bar below it, or a window that resized).
    expect(imeOverlap({ y: 0, height: 480 }, 500)).toBe(0);
  });
});

describe('Android: the frame pads by the IME while it is up', () => {
  function setup() {
    const handlers: Record<string, (e: unknown) => void> = {};
    const removed: string[] = [];
    vi.spyOn(Keyboard, 'addListener').mockImplementation(((name: string, h: (e: unknown) => void) => {
      handlers[name] = h;
      return { remove: () => removed.push(name) };
    }) as never);
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, width: 390, height: 844, right: 390, bottom: 844, toJSON: () => ({}),
    } as DOMRect);
    return { handlers, removed };
  }

  it('shows: pads by the overlap; hides: the padding goes; unmount: listeners go', async () => {
    const { handlers, removed } = setup();
    act(() =>
      root.render(
        <AndroidKeyboardInsetView style={{ flex: 1 }} testID="frame">
          <TextInput testID="field" />
        </AndroidKeyboardInsetView>,
      ),
    );
    expect(byId('frame')!.style.paddingBottom).toBe('');
    await act(async () => {
      handlers.keyboardDidShow!({ endCoordinates: { screenY: 500, screenX: 0, width: 390, height: 300 } });
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(byId('frame')!.style.paddingBottom).toBe('344px');
    act(() => handlers.keyboardDidHide!({ endCoordinates: { screenY: 844, screenX: 0, width: 390, height: 0 } }));
    expect(byId('frame')!.style.paddingBottom).toBe('');
    act(() => root.unmount());
    expect(removed.sort()).toEqual(['keyboardDidHide', 'keyboardDidShow']);
    root = createRoot(container);
  });

  it('a keyboard that hides while the frame is being measured leaves no padding', async () => {
    const { handlers } = setup();
    act(() => root.render(<AndroidKeyboardInsetView testID="frame"><Text>x</Text></AndroidKeyboardInsetView>));
    await act(async () => {
      handlers.keyboardDidShow!({ endCoordinates: { screenY: 500, screenX: 0, width: 390, height: 300 } });
      handlers.keyboardDidHide!({ endCoordinates: { screenY: 844, screenX: 0, width: 390, height: 0 } });
      await new Promise((r) => setTimeout(r, 5));
    });
    expect(byId('frame')!.style.paddingBottom).toBe('');
  });
});

describe('web renders the form shells exactly as before', () => {
  it('FormShell and QuietShell: the same frame, no keyboard prop in the DOM, no padding', () => {
    act(() =>
      root.render(
        <FormShell heading="Start moving together." testID="wsf-signup">
          <TextInput testID="wsf-signup-password" />
        </FormShell>,
      ),
    );
    const frame = byId('wsf-signup')!;
    expect(frame.querySelector('[data-testid="wsf-signup-password"]')).not.toBeNull();
    expect(frame.style.paddingBottom).toBe('');
    expect(container.innerHTML.toLowerCase()).not.toContain('keyboardinsets');
    act(() => root.render(<QuietShell heading="Check your email" body="Sent." testID="wsf-quiet" />));
    expect(byId('wsf-quiet')).not.toBeNull();
    expect(container.innerHTML.toLowerCase()).not.toContain('keyboardinsets');
  });
});

describe('where it is applied', () => {
  it('both identity shells frame their scroll view and pass the iOS prop', () => {
    const src = read('src/AuthFormPrimitives.tsx');
    expect(src.match(/<KeyboardInsetView style=\{(shell|quiet)\.screen\} onLayout=\{onLayout\} testID=\{testID\}>/g)).toHaveLength(2);
    expect(src.match(/\{\.\.\.KEYBOARD_SCROLL_PROPS\}/g)).toHaveLength(2);
    expect(src).not.toMatch(/<View style=\{(shell|quiet)\.screen\}/);
  });

  it('Home (the join field) and Goal setup carry it too', () => {
    const home = read('app/(tabs)/(home)/index.tsx');
    expect(home).toContain('{...KEYBOARD_SCROLL_PROPS}');
    expect(home).toMatch(/Platform\.OS === 'android' \? \(\s*<AndroidKeyboardInsetView/);
    expect(read('app/goals/new.tsx')).toContain('{...KEYBOARD_SCROLL_PROPS}');
  });

  it('sign in, sign up, reset and profile setup all render through FormShell', () => {
    for (const f of ['app/signin.tsx', 'app/signup.tsx', 'app/reset-password.tsx', 'app/profile-setup.tsx', 'app/start-community.tsx']) {
      expect(read(f), f).toMatch(/<FormShell\b/);
    }
  });
});
