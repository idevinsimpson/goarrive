import { act, forwardRef, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StyleSheet } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-12: the member halves of the integrator's P3 helpers.
 *
 * INT-33 (here now): the privacy switch's knob takes kit-base's lift.knob
 * (W12-15). Android draws no shadow from shadow* props, so the knob lifts by
 * elevation 2 there; iOS keeps the knob's own shadow; the web's style is
 * today's. INT-30/31/36 wait for W12-16/17/18 (tabContentBottomReserve,
 * pressableStyle, the en-US count format), which have not landed.
 *
 * lift.ts picks its tokens at import (Platform.select), so each platform
 * imports the view afresh with the platform set first, and Platform.select
 * honours it (react-native-web's always picks web; the same override as
 * tests/lift-tokens.test.ts). View is wrapped to read the knob's style
 * (react-native-web turns it into classes). No device.
 */

const platform = vi.hoisted(() => ({ os: 'web' as 'ios' | 'android' | 'web' }));

type Props = Record<string, unknown>;
const knobStyles: unknown[] = [];
vi.mock('react-native', async (importOriginal) => {
  const rn = await importOriginal<typeof import('react-native')>();
  const View = forwardRef<unknown, Props>((props, ref) => {
    const flat = (rn.StyleSheet.flatten(props.style as never) ?? {}) as Record<string, unknown>;
    // The knob: the switch's 20 pt disc.
    if (flat.width === 20 && flat.height === 20 && flat.borderRadius === 10) knobStyles.push(props.style);
    const Real = rn.View as unknown as (p: Props) => ReactNode;
    return <Real ref={ref} {...props} />;
  });
  const Platform = {
    ...rn.Platform,
    get OS() {
      return platform.os;
    },
    select: (o: Record<string, unknown>) =>
      platform.os in o ? o[platform.os] : platform.os !== 'web' && 'native' in o ? o.native : o.default,
  };
  return { ...rn, View, Platform };
});

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  knobStyles.length = 0;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  platform.os = 'web';
});

const COMMUNITY = {
  groupId: 'oak',
  displayName: 'Oak Grove',
  stored: { name: 'visible' as const, activity: 'private' as const },
  saving: null,
  saveError: null,
};

/** The knobs' flattened styles, the view imported for `os`. */
async function knobsOn(os: 'ios' | 'android' | 'web'): Promise<Record<string, unknown>[]> {
  platform.os = os;
  vi.resetModules();
  const { CommunityPrivacyPanelView } = await import('../src/ui/CommunityPrivacyPanelView');
  act(() =>
    root.render(
      <CommunityPrivacyPanelView load="ready" communities={[COMMUNITY]} onChange={vi.fn()} onRetrySave={vi.fn()} onRetryLoad={vi.fn()} />,
    ),
  );
  expect(knobStyles.length).toBeGreaterThanOrEqual(2);
  return knobStyles.slice(-2).map((st) => (StyleSheet.flatten(st as never) ?? {}) as Record<string, unknown>);
}

// Today's knob, as the stylesheet defines it (on adds marginLeft 24).
const KNOB = {
  width: 20,
  height: 20,
  borderRadius: 10,
  marginLeft: 4,
  backgroundColor: expect.any(String),
  shadowColor: expect.any(String),
  shadowOpacity: 0.2,
  shadowRadius: 5,
  shadowOffset: { width: 0, height: 2 },
};

describe('W16-12 / INT-33: the privacy switch knob lifts on every platform', () => {
  it('Android: elevation 2 (lift.knob) on both knobs, on and off', async () => {
    const [on, off] = await knobsOn('android');
    expect(on).toEqual({ ...KNOB, elevation: 2, marginLeft: 24 });
    expect(off).toEqual({ ...KNOB, elevation: 2 });
  });

  it("iOS: the knob's own shadow, no elevation", async () => {
    const [on, off] = await knobsOn('ios');
    expect(on).toEqual({ ...KNOB, marginLeft: 24 });
    expect(off).toEqual(KNOB);
  });

  it("web: today's style exactly (lift.knob is {})", async () => {
    const [on, off] = await knobsOn('web');
    expect(on).toEqual({ ...KNOB, marginLeft: 24 });
    expect(off).toEqual(KNOB);
    expect('elevation' in on || 'elevation' in off).toBe(false);
  });
});
