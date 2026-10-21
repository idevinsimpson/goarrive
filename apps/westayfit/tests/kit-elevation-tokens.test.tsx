import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * W12-15 (INT-21, INT-31): kit's depth tokens per platform, and the tab bar's
 * lift on Android.
 *
 *   · iOS clips `shadow*` under `overflow: hidden`, so each elevation.* token
 *     is one `boxShadow` there (blur = shadowRadius), with no shadow props.
 *   · Android and the web keep today's tokens exactly: compared with a
 *     snapshot captured from the unchanged kit before the edit
 *     (tests/fixtures/kit-elevation-before-w12-15.json).
 *   · kit re-exports kit-base's lift tokens, and the tab bar spreads
 *     lift.tabBar: an upward boxShadow on Android, nothing elsewhere.
 *
 * kit and the tab bar read Platform.select once, at load, so each platform
 * loads them afresh under a mocked Platform (as tests/lift-tokens.test.ts
 * does). No device.
 */
// Each case loads kit, lift and the tab bar afresh (vi.resetModules), which takes seconds on a loaded machine.
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
vi.mock('../src/firebase', () => ({ wsfIsStaging: false, getFirebaseAuth: () => ({}) }));

const FIXTURE = readFileSync(join(__dirname, 'fixtures', 'kit-elevation-before-w12-15.json'), 'utf8');
type Shadow = {
  shadowColor: string;
  shadowOpacity: number;
  shadowRadius: number;
  shadowOffset: { width: number; height: number };
  elevation: number;
};
const BEFORE = JSON.parse(FIXTURE) as Record<'card' | 'hero' | 'action', Shadow>;

async function on(os: 'ios' | 'android' | 'web') {
  rn.os = os;
  vi.resetModules();
  const kit = await import('../src/ui/kit');
  const liftModule = await import('../src/ui/lift');
  const { MemberTabBar } = await import('../src/ui/MemberTabBar');
  const { Dimensions, StyleSheet } = await import('react-native');
  return { kit, liftModule, MemberTabBar, Dimensions, StyleSheet };
}
afterEach(() => {
  rn.os = 'web';
  vi.restoreAllMocks();
});

describe('W12-15: elevation.* per platform', () => {
  it('web: today\'s tokens, byte for byte (the snapshot taken before the edit)', async () => {
    const { kit } = await on('web');
    expect(`${JSON.stringify(kit.elevation, null, 2)}\n`).toBe(FIXTURE);
  });

  it('Android: today\'s tokens (elevation 3, 8, 6 and the shadow props)', async () => {
    const { kit } = await on('android');
    expect(kit.elevation).toEqual(BEFORE);
    expect([kit.elevation.card.elevation, kit.elevation.hero.elevation, kit.elevation.action.elevation]).toEqual([3, 8, 6]);
    for (const token of Object.values(kit.elevation)) expect(token).not.toHaveProperty('boxShadow');
  });

  it('iOS: one boxShadow per token, the same colour, offset and opacity, blur = shadowRadius; no shadow props', async () => {
    const { kit } = await on('ios');
    expect(kit.elevation).toEqual({
      card: { boxShadow: '0px 6px 16px rgba(11,31,58,0.08)' },
      hero: { boxShadow: '0px 14px 28px rgba(11,31,58,0.22)' },
      action: { boxShadow: '0px 8px 18px rgba(21,128,61,0.32)' },
    });
    // The same numbers as the snapshot, token by token.
    const hex = (c: string, i: number) => parseInt(c.slice(i, i + 2), 16);
    for (const key of ['card', 'hero', 'action'] as const) {
      const s = BEFORE[key];
      expect(kit.elevation[key].boxShadow).toBe(
        `${s.shadowOffset.width}px ${s.shadowOffset.height}px ${s.shadowRadius}px rgba(${hex(s.shadowColor, 1)},${hex(s.shadowColor, 3)},${hex(s.shadowColor, 5)},${s.shadowOpacity})`,
      );
      for (const prop of ['shadowColor', 'shadowOpacity', 'shadowRadius', 'shadowOffset']) {
        expect(kit.elevation[key]).not.toHaveProperty(prop);
      }
    }
  });
});

describe('RV13-641-N2: turning a token\'s lift off', () => {
  it('web and Android: exactly the bare key the off states had ({ shadowOpacity: 0 })', async () => {
    for (const os of ['web', 'android'] as const) {
      const { kit } = await on(os);
      expect(kit.ELEVATION_OFF).toEqual({ shadowOpacity: 0 });
      expect(Object.keys(kit.ELEVATION_OFF)).toEqual(['shadowOpacity']);
    }
  });

  it('iOS: the boxShadow is cancelled too, so a token followed by it draws no lift', async () => {
    const { kit, StyleSheet } = await on('ios');
    expect(kit.ELEVATION_OFF).toEqual({ shadowOpacity: 0, boxShadow: 'none' });
    for (const token of Object.values(kit.elevation)) {
      expect(StyleSheet.flatten([token, kit.ELEVATION_OFF] as never)).toMatchObject({ boxShadow: 'none' });
    }
  });

  it('no bare `shadowOpacity: 0` is left to cancel a token (app/ and src/, kit.ts aside); the off states spread ELEVATION_OFF', () => {
    const root = join(__dirname, '..');
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
      }
      return out;
    };
    const files = [...walk(join(root, 'app')), ...walk(join(root, 'src'))].filter((f) => !f.endsWith(join('src', 'ui', 'kit.ts')));
    const bare = files.filter((f) => /shadowOpacity: *0([^.0-9]|$)/m.test(readFileSync(f, 'utf8')));
    expect(bare).toEqual([]);
    const spreads = files
      .map((f) => [f.slice(root.length + 1), (readFileSync(f, 'utf8').match(/\.\.\.ELEVATION_OFF\b/g) ?? []).length] as const)
      .filter(([, n]) => n > 0);
    expect(Object.fromEntries(spreads)).toEqual({
      'src/ui/designTarget/ChallengeHomeTargets.tsx': 3,
      'src/ui/designTarget/EventQueueTargets.tsx': 1,
      'src/ui/designTarget/FollowAlongTargets.tsx': 2,
      'src/ui/designTarget/JoinSetupTargets.tsx': 1,
      'src/ui/designTarget/RoomScreenTargets.tsx': 1,
    });
  });
});

describe('W12-15: kit re-exports the lift tokens', () => {
  it.each(['ios', 'android', 'web'] as const)('%s: kit.lift is kit-base\'s lift, with its two shadow strings', async (os) => {
    const { kit, liftModule } = await on(os);
    expect(kit.lift).toBe(liftModule.lift);
    expect(kit.PANEL_BOX_SHADOW_IOS).toBe(liftModule.PANEL_BOX_SHADOW_IOS);
    expect(kit.TAB_BAR_BOX_SHADOW_ANDROID).toBe('0px -4px 14px rgba(11,31,53,0.06)');
  });
});

describe('W12-15: the tab bar\'s lift', () => {
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
  async function renderBarOn(os: 'ios' | 'android' | 'web') {
    const { MemberTabBar, Dimensions, StyleSheet } = await on(os);
    // A 390 pt phone at 1x: the one-row bar with MOVE in its slot (jsdom's window is 0 wide).
    vi.spyOn(Dimensions, 'get').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1 });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() =>
      root.render(
        <MemberTabBar
          state={{ index: 0, routes: [{ key: 'h', name: '(home)' }, { key: 'c', name: 'community' }, { key: 'a', name: 'activity' }, { key: 'y', name: 'you' }] } as never}
          navigation={{ emit: () => ({ defaultPrevented: false }), navigate: () => undefined } as never}
          descriptors={{} as never}
          insets={{ top: 0, bottom: 0, left: 0, right: 0 }}
          onMove={() => undefined}
        />,
      ),
    );
    const flatten = (s: unknown) => StyleSheet.flatten(s as never);
    const bar = styleOf(host.querySelector('[data-testid="wsf-member-tabs"]')!, flatten);
    const move = styleOf(host.querySelector('[data-testid="wsf-member-tab-move"]')!, flatten);
    act(() => root.unmount());
    host.remove();
    return { bar, move };
  }

  it('Android: an upward boxShadow, because elevation cannot cast up; MOVE keeps elevation 6', async () => {
    const { bar, move } = await renderBarOn('android');
    expect(bar.boxShadow).toBe('0px -4px 14px rgba(11,31,53,0.06)');
    expect(bar).not.toHaveProperty('elevation');
    expect(move.elevation).toBe(6);
    expect(move).not.toHaveProperty('boxShadow');
  });

  it('iOS: the bar keeps its own upward shadow props and no boxShadow; MOVE lifts with a boxShadow', async () => {
    const { bar, move } = await renderBarOn('ios');
    expect(bar).not.toHaveProperty('boxShadow');
    expect(bar).toMatchObject({ shadowColor: '#0B1F35', shadowOpacity: 0.06, shadowRadius: 14, shadowOffset: { width: 0, height: -4 } });
    expect(move.boxShadow).toBe('0px 8px 18px rgba(21,128,61,0.32)');
    expect(move).not.toHaveProperty('shadowOpacity');
  });

  it('web: neither gains a boxShadow; MOVE keeps today\'s action token', async () => {
    const { bar, move } = await renderBarOn('web');
    expect(bar).not.toHaveProperty('boxShadow');
    expect(move).not.toHaveProperty('boxShadow');
    expect(move).toMatchObject(BEFORE.action);
  });
});
