import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * INT-31 (W14-L, parity re-audit at candidate-14): THE OPEN MEMBER MENU'S LIFT
 * ON ANDROID. src/ui/MemberTopBar.tsx gives the menu sheet `elevation: 8` on
 * Android, which draws no shadow* props; iOS and the web keep the shadow props
 * alone. Nothing pinned it (tests/iphone-top.test.tsx checks the sheet's
 * position, order and dismiss only).
 *
 * The sheet's style is built once, at load (StyleSheet.create reads
 * Platform.OS), so each platform loads MemberTopBar afresh under a mocked
 * Platform, as tests/kit-elevation-tokens.test.tsx does on integrator-1 (its
 * harness: mocked Platform, vi.resetModules, the View's own style read from
 * the committed fiber). A new file here: that one is not on this branch.
 */
// Each case loads the bar afresh (vi.resetModules), which takes seconds on a loaded machine.
vi.setConfig({ testTimeout: 30_000 });
const rn = vi.hoisted(() => ({ os: 'web' as 'ios' | 'android' | 'web' }));

vi.mock('react-native', async () => {
  const actual = (await vi.importActual('react-native-web')) as Record<string, any>;
  return {
    ...actual,
    Platform: {
      ...actual.Platform,
      get OS() {
        return rn.os;
      },
      select: (o: Record<string, unknown>) =>
        rn.os in o ? o[rn.os] : rn.os !== 'web' && 'native' in o ? o.native : o.default,
    },
  };
});
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
vi.mock('../src/ui/WsfWordmark', () => ({ WsfWordmark: () => null }));
vi.mock('../src/firebase', () => ({ wsfIsStaging: false, getFirebaseAuth: () => ({}) }));

/** The sheet's shadow props, as MemberTopBar.tsx draws them on every platform. */
const SHEET_SHADOW = { shadowColor: '#0B1F35', shadowOpacity: 0.14, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } };

type Fiber = { type: unknown; return: Fiber | null; alternate: Fiber | null; memoizedProps: Record<string, unknown> };
/** The View's own style: the first component above the element, from the committed side of the pair. */
function styleOf(el: Element, flatten: (s: unknown) => unknown): Record<string, unknown> {
  const own = el as unknown as Record<string, unknown>;
  const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'))!;
  const propsKey = Object.keys(el).find((k) => k.startsWith('__reactProps$'))!;
  let fiber = own[fiberKey] as Fiber;
  if (fiber.memoizedProps !== own[propsKey] && fiber.alternate) fiber = fiber.alternate;
  while (fiber && typeof fiber.type === 'string') fiber = fiber.return as Fiber;
  return flatten(fiber.memoizedProps.style) as Record<string, unknown>;
}

/** MemberTopBar loaded for `os`, rendered with its menu open: the sheet's flattened style. */
async function openMenuOn(os: 'ios' | 'android' | 'web') {
  rn.os = os;
  vi.resetModules();
  const { MemberTopBar } = await import('../src/ui/MemberTopBar');
  const { StyleSheet } = await import('react-native');
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <MemberTopBar
        onHome={() => undefined}
        menu={[{ kind: 'action', key: 'signout', label: 'Sign out', onPress: () => undefined }]}
        menuOpen
        onMenuToggle={() => undefined}
      />,
    ),
  );
  const sheet = host.querySelector('[data-testid="wsf-member-topbar-menu"]');
  expect(sheet, 'the menu is open').not.toBeNull();
  const style = styleOf(sheet!, (s) => StyleSheet.flatten(s as never));
  act(() => root.unmount());
  host.remove();
  return style;
}

afterEach(() => {
  rn.os = 'web';
});

describe('INT-31: the open member menu’s lift', () => {
  it('Android: the sheet lifts with elevation 8, its shadow props unchanged', async () => {
    const sheet = await openMenuOn('android');
    expect(sheet.elevation).toBe(8);
    expect(sheet).toMatchObject(SHEET_SHADOW);
  });

  it.each(['ios', 'web'] as const)('%s: no elevation; the shadow props alone', async (os) => {
    const sheet = await openMenuOn(os);
    expect(sheet).not.toHaveProperty('elevation');
    expect(sheet).toMatchObject(SHEET_SHADOW);
  });
});
