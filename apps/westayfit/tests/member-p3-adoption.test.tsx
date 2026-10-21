import { act, forwardRef, useEffect, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { StyleSheet } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * NATIVE-MEMBER-1 W16-12: the member halves of the integrator's P3 helpers.
 *
 * INT-33 (here now): the privacy switch's knob takes kit-base's lift.knob
 * (W12-15). Android draws no shadow from shadow* props, so the knob lifts by
 * elevation 2 there; iOS keeps the knob's own shadow; the web's style is
 * today's.
 *
 * INT-36: Community Home's momentum amounts go through formatCount (W12-18):
 * en-US on a phone ("4,999"; a German phone printed "4.999", which reads as
 * four point nine), and the browser's own locale on the web, as before. The
 * device locale is stubbed to de-DE. INT-30 and INT-31 wait for W12-16 and
 * W12-17, which have not landed.
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

// ---- INT-36: Community Home with one momentum row, under a German device ----
// The count locale of the platform rendering: countLocale.native's en-US, or
// the web's undefined (the browser's own).
vi.mock('../src/ui/countLocale', async (importOriginal) => {
  const web = await importOriginal<typeof import('../src/ui/countLocale')>();
  const native = await import('../src/ui/countLocale.native');
  return {
    get COUNT_LOCALE() {
      return platform.os === 'web' ? web.COUNT_LOCALE : native.COUNT_LOCALE;
    },
  };
});
vi.mock('../src/ui/LivingWeProgress', () => ({ LivingWeProgress: () => null }));
vi.mock('../src/ui/useReducedMotion', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useReducedMotion: () => true,
  useReducedMotionPreference: () => ({ reduced: true, known: true, failed: false }),
}));
vi.mock('expo-router', () => {
  const router = { push: vi.fn(), replace: vi.fn(), back: vi.fn(), navigate: vi.fn(), dismissTo: vi.fn() };
  return {
    Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
    useLocalSearchParams: () => ({ groupId: 'oak' }),
    useRouter: () => router,
    router,
    useFocusEffect: (cb: () => void | (() => void)) => {
      useEffect(() => cb(), [cb]);
    },
  };
});
vi.mock('react-native-safe-area-context', async () => {
  const { createContext } = await import('react');
  return { SafeAreaInsetsContext: createContext(null), useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
vi.mock('../src/ui/memberShellActions', () => ({ useMemberShellAction: () => undefined }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, col: string, id: string) => `${col}/${id}`,
  getDoc: (path: string) =>
    Promise.resolve(
      path.startsWith('wsfMemberships/')
        ? { exists: () => true, data: () => ({ role: 'member', membershipStatus: 'active', userId: 'u1' }) }
        : { exists: () => true, data: () => ({ displayName: 'Oak Grove', groupType: 'custom', joinPolicy: 'private', lifecycleStatus: 'active', isSample: false }) },
    ),
}));
const AMOUNT = 4999;
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => () =>
    name === 'wsfCommunityActivity'
      ? Promise.resolve({ data: { entries: [{ displayName: 'Ira Jones', amount: AMOUNT, unit: 'squats', at: null }], contributorsToday: 1, nextCursor: null } })
      : Promise.reject(Object.assign(new Error('x'), { code: 'functions/internal' })),
}));
vi.mock('../src/firebase', () => ({ getFirebaseFirestore: () => ({}), getFirebaseFunctions: () => ({}) }));
vi.mock('../src/featureFlags', () => ({ wsfAuthEnabled: true }));
const AUTH = { ready: true, user: { uid: 'u1', email: 'm@example.com' } };
vi.mock('../src/auth', () => ({ useWsfAuth: () => AUTH }));
vi.mock('../src/currentCommunity', () => ({ rememberCurrentCommunity: vi.fn(), resolveCurrentCommunity: () => null }));
vi.mock('../src/memberReads', () => ({
  SAME_LOAD_MS: 10_000,
  forgetCommunity: vi.fn(),
  peekMyCommunities: () => undefined,
  readGoals: () => Promise.resolve({ goals: [] }),
  readMyCommunities: () =>
    Promise.resolve({ items: [{ groupId: 'oak', displayName: 'Oak Grove', memberCount: 3, isSample: false, activeChallenge: null }] }),
  readOwnCredit: () => Promise.reject(new Error('offline')),
}));

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

describe('W16-12 / INT-36: Community Home counts in one format', () => {
  const RealNumberFormat = Intl.NumberFormat;
  beforeEach(() => {
    // A German device: a format asked for no locale gets de-DE.
    function DeviceNumberFormat(locales?: string | string[], options?: Intl.NumberFormatOptions) {
      return new RealNumberFormat(locales ?? 'de-DE', options);
    }
    vi.stubGlobal('Intl', { ...Intl, NumberFormat: DeviceNumberFormat });
    const realToLocale = Number.prototype.toLocaleString;
    vi.spyOn(Number.prototype, 'toLocaleString').mockImplementation(function (
      this: number,
      locales?: Parameters<number['toLocaleString']>[0],
      options?: Intl.NumberFormatOptions,
    ) {
      return realToLocale.call(this, locales ?? 'de-DE', options);
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function momentumOn(os: 'ios' | 'android' | 'web'): Promise<HTMLElement> {
    platform.os = os;
    vi.resetModules();
    const { default: CommunityPage } = await import('../app/(tabs)/(home)/community/[groupId]/index');
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    act(() => root.render(<CommunityPage />));
    await act(async () => {
      for (let i = 0; i < 30; i++) await Promise.resolve();
    });
    const row = container.querySelector('[data-testid="wsf-momentum-row"]') as HTMLElement | null;
    expect(row, 'the momentum row is drawn').not.toBeNull();
    return row!;
  }

  it.each(['ios', 'android'] as const)("%s: '4,999' under a German device, not '4.999'", async (os) => {
    const row = await momentumOn(os);
    expect(row.textContent).toContain('+4,999 squats');
    expect(row.textContent).toContain('added 4,999 squats');
    expect(row.textContent).not.toContain('4.999');
  });

  it("web: today's string exactly, the browser's own locale (here de-DE)", async () => {
    const row = await momentumOn('web');
    // Today: row.amount.toLocaleString() in the device's locale.
    const today = AMOUNT.toLocaleString();
    expect(today).toBe('4.999');
    expect(row.textContent).toContain(`+${today} squats`);
    expect(row.textContent).toContain(`added ${today} squats`);
  });
});
