import { describe, expect, it, vi } from 'vitest';

/**
 * INT-21 / INT-31 (W12-15) — the lift tokens (src/ui/lift.ts), per platform.
 * The module reads Platform.select once, at load, so each platform loads it
 * afresh.
 */

const rn = vi.hoisted(() => ({ os: 'ios' as 'ios' | 'android' | 'web' }));

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

async function liftOn(os: 'ios' | 'android' | 'web') {
  rn.os = os;
  vi.resetModules();
  return import('../src/ui/lift');
}

/** The Settings panel's shadow props today (app/settings.tsx st.panel), as one CSS shadow: blur = shadowRadius. */
const SETTINGS_PANEL = { color: '#081D36', opacity: 0.3, radius: 30, offset: { width: 0, height: 20 } };
const rgba = (hex: string, a: number) =>
  `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${a})`;

describe('lift', () => {
  it('iOS: the panel lifts with a boxShadow (drawn outside the clip), the Settings panel’s own shadow; nothing else', async () => {
    const { lift, PANEL_BOX_SHADOW_IOS } = await liftOn('ios');
    expect(PANEL_BOX_SHADOW_IOS).toBe(
      `${SETTINGS_PANEL.offset.width}px ${SETTINGS_PANEL.offset.height}px ${SETTINGS_PANEL.radius}px ${rgba(SETTINGS_PANEL.color, SETTINGS_PANEL.opacity)}`,
    );
    expect(lift.panel).toEqual({ boxShadow: '0px 20px 30px rgba(8,29,54,0.3)' });
    expect(lift.panel).not.toHaveProperty('shadowOpacity');
    expect(lift.tabBar).toEqual({});
    expect(lift.knob).toEqual({});
  });

  it('Android: panel elevation 12, an upward boxShadow on the tab bar (elevation cannot cast up), knob elevation 2', async () => {
    const { lift } = await liftOn('android');
    expect(lift.panel).toEqual({ elevation: 12 });
    expect(lift.tabBar).toEqual({ boxShadow: '0px -4px 14px rgba(11,31,53,0.06)' });
    expect(lift.knob).toEqual({ elevation: 2 });
  });

  it('web: {} for each, so every surface keeps its own style', async () => {
    const { lift } = await liftOn('web');
    expect(lift).toEqual({ panel: {}, tabBar: {}, knob: {} });
  });

  it('frozen, on every platform', async () => {
    for (const os of ['ios', 'android', 'web'] as const) {
      const { lift } = await liftOn(os);
      expect(Object.isFrozen(lift)).toBe(true);
      for (const token of [lift.panel, lift.tabBar, lift.knob]) expect(Object.isFrozen(token)).toBe(true);
    }
  });
});
