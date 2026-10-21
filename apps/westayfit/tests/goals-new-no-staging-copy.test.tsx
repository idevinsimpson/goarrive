import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-24 (owner UI-copy request, member part). NOTHING A
 * MEMBER SEES ON GOAL SETUP NAMES "STAGING", to match the Lovable reference,
 * which has none. Internal names (wsfIsStaging, the gate, config, docs, tests)
 * stay.
 *
 * Goal setup is rendered whole (react-native-web, jsdom) as a STAGING build
 * (the mocked firebase module says wsfIsStaging), on its synthetic path: the
 * form for a community, and the no-community card. The page's text must not
 * mention staging; nor may its DOM (attributes included), because the form
 * used to carry `data-environment="STAGING SYNTHETIC TEST"` (82746cd9's
 * label), which is now the neutral "SYNTHETIC TEST". A static check pins the
 * double gate exactly as it is (it is not copy) and scans the screen's own
 * string literals and JSX text.
 */

const params: { groupId?: string } = {};
vi.mock('expo-router', () => ({
  router: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), canGoBack: () => false },
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
  useLocalSearchParams: () => params,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
// The community document never answers: the form shows its fallback name.
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), getDoc: () => new Promise(() => {}) }));
vi.mock('firebase/functions', () => ({ httpsCallable: () => () => new Promise(() => {}) }));
// A staging build (not the emulator): the gate admits the form.
vi.mock('../src/firebase', () => ({
  getFirebaseAuth: () => ({}),
  getFirebaseFirestore: () => ({}),
  getFirebaseFunctions: () => ({}),
  wsfIsStaging: true,
  wsfUsingEmulators: false,
}));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
vi.mock('../src/auth', () => ({ useWsfAuth: () => ({ ready: true, user: { uid: 'u1', email: 'champion@example.com', emailVerified: true } }) }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const { default: NewGoal } = await import('../app/goals/new');

const SRC = readFileSync(resolve(__dirname, '../app/goals/new.tsx'), 'utf8');
const OS = Platform.OS;
let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  for (const k of Object.keys(params)) delete (params as Record<string, unknown>)[k];
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (Platform as { OS: string }).OS = OS;
});
const flush = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

/** The page's words, its DOM with every attribute, and the form's environment mark. */
function expectNoStaging(formId: string): void {
  const form = byId(formId);
  expect(form, formId).not.toBeNull();
  expect(document.body.textContent ?? '').not.toMatch(/staging/i);
  expect(container.innerHTML).not.toMatch(/staging/i);
  const mark = byId('wsf-new-goal-form')!.getAttribute('data-environment');
  expect(mark, 'the form still carries its machine-readable synthetic mark').toBeTruthy();
  expect(mark).not.toMatch(/staging|local|emulator|production/i);
  expect(mark).toBe('SYNTHETIC TEST');
}

describe.each(['web', 'ios', 'android'] as const)('W16-24 on %s: a staging build of Goal setup never shows or carries "staging"', (os) => {
  beforeEach(() => {
    (Platform as { OS: string }).OS = os;
  });

  it('the form for a community (the synthetic path): no "staging" in the page text, the DOM or the form mark', async () => {
    params.groupId = 'oak';
    act(() => root.render(<NewGoal />));
    await flush();
    expect(byId('wsf-new-goal-gated-off')).toBeNull();
    expect(byId('wsf-new-goal-community')!.textContent).toBe('Your community');
    expectNoStaging('wsf-new-goal-form');
    expect(byId('wsf-new-goal-form')!.getAttribute('data-group-id')).toBe('oak');
  });

  it('opened without a community: the same', async () => {
    act(() => root.render(<NewGoal />));
    await flush();
    expect(byId('wsf-new-goal-no-community')).not.toBeNull();
    expectNoStaging('wsf-new-goal-no-community');
  });
});

describe('W16-24: the screen itself (static)', () => {
  it('the double gate is exactly as it was (it is not copy)', () => {
    expect(SRC.match(/if \(!wsfUsingEmulators && !wsfIsStaging\) return;/g)).toHaveLength(1);
    expect(SRC.match(/if \(!wsfUsingEmulators && !wsfIsStaging\) \{/g)).toHaveLength(1);
  });

  it('the synthetic mark is one neutral label with no environment word', () => {
    const line = SRC.match(/^const SYNTHETIC_LABEL = (.*);$/m);
    expect(line).not.toBeNull();
    expect(line![1]).toBe("'SYNTHETIC TEST'");
    expect(line![1]).not.toMatch(/wsfIsStaging|wsfUsingEmulators|staging|local|emulator|production/i);
  });

  it('no string literal and no JSX text in the screen says "staging" (comments and identifiers may)', () => {
    const code = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '').replace(/([^:])\/\/.*$/gm, '$1');
    const literals = code.match(/(['"`])(?:(?!\1)[^\\\n]|\\.)*staging(?:(?!\1)[^\\\n]|\\.)*\1/gi) ?? [];
    expect(literals).toEqual([]);
    const jsxText = code.match(/>[^<>{}]*staging[^<>{}]*</gi) ?? [];
    expect(jsxText).toEqual([]);
  });
});
