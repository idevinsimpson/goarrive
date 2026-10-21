import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Platform } from 'react-native';
import ts from 'typescript';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEventJoinUrlFromScreenedCode } from '../src/ui/eventLinks';
import { encodeQr, renderQrSvg } from '../src/ui/qr';

/**
 * W12-13 (INT-08 preparation, ST-01): a phone's origin is the one its build
 * names (EXPO_PUBLIC_WSF_PUBLIC_ORIGIN, validated), never window.location,
 * which a development build points at Metro. The web keeps reading the
 * page's own address. currentOrigin is the twin Metro would pick for
 * Platform.OS; the env is stubbed per case and stays unset in the repo
 * (the owner names the host, E#1). No device.
 */
const QR_OPTS = { dark: '#0B1F3A', light: '#FFFFFF' };
const JOIN_CODE = 'AbCdEfGhIjKlMnOpQrStUv';
const NAMED = 'https://wsf.example.com';
const PULSE = {
  sharedTotal: 120,
  target: 500,
  unit: 'squats',
  status: 'active',
  communityDisplayName: 'Oak Grove',
  goalTitle: '500 squats together',
  startsAt: '2026-10-20T00:00:00.000Z',
  endsAt: '2026-10-27T00:00:00.000Z',
  timezone: 'America/New_York',
};

vi.mock('../src/ui/currentOrigin', async () => {
  const { Platform: P } = await import('react-native');
  const web = await vi.importActual<typeof import('../src/ui/currentOrigin')>('../src/ui/currentOrigin');
  const native = await import('../src/ui/currentOrigin.native');
  return { currentOrigin: () => (P.OS === 'web' ? web.currentOrigin() : native.currentOrigin()) };
});
// Every string a QR code is drawn from, in order.
const encoded = vi.hoisted(() => [] as string[]);
vi.mock('../src/ui/qr', async () => {
  const actual = await vi.importActual<typeof import('../src/ui/qr')>('../src/ui/qr');
  return {
    ...actual,
    encodeQr: (text: string) => {
      encoded.push(text);
      return actual.encodeQr(text);
    },
  };
});
vi.mock('react-native-svg', () => ({
  SvgXml: ({ xml }: { xml: string }) => <svg data-testid="svg-xml" data-xml={xml} />,
}));
vi.mock('../src/ui/SvgMarkup', async () => {
  const { Platform: P } = await import('react-native');
  const web = await vi.importActual<typeof import('../src/ui/SvgMarkup')>('../src/ui/SvgMarkup');
  const native = await import('../src/ui/SvgMarkup.native');
  return {
    SvgMarkup: (props: Parameters<typeof web.SvgMarkup>[0]) => createElement(P.OS === 'web' ? web.SvgMarkup : native.SvgMarkup, props),
  };
});
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  initialWindowMetrics: { insets: { top: 0, bottom: 0, left: 0, right: 0 }, frame: { x: 0, y: 0, width: 390, height: 844 } },
}));
vi.mock('expo-status-bar', () => ({ StatusBar: () => null }));
vi.mock('../src/ui/useScreenTopInset', () => ({
  TopCleared: ({ children }: { children?: unknown }) => children,
  useScreenTopInset: () => 0,
  ScreenTopSpacer: () => null,
  ScreenStatusBar: () => null,
}));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ goalId: 'g1' }),
  useFocusEffect: () => undefined,
  router: { push: vi.fn(), replace: vi.fn() },
  Link: ({ children }: { children?: unknown }) => children,
}));
vi.mock('../src/firebase', () => ({
  getFirebaseApp: () => ({}),
  getFirebaseAuth: () => ({}),
  getFirebaseFirestore: () => ({}),
  getFirebaseFunctions: () => ({}),
  wsfUsingEmulators: false,
  wsfIsStaging: false,
}));
vi.mock('../src/stationSession', async () => {
  const actual = await vi.importActual<typeof import('../src/stationSession')>('../src/stationSession');
  return { ...actual, credentialForGoal: (goalId: string) => (goalId === 'g1' ? { stationId: 'st1', secret: 's'.repeat(32), goalId: 'g1', slot: 1 } : null) };
});
vi.mock('expo-video', () => ({
  useVideoPlayer: () => ({ play() {}, pause() {}, release() {}, replace() {}, addListener: () => ({ remove: () => undefined }) }),
  VideoView: () => null,
  createVideoPlayer: () => {
    throw new Error('createVideoPlayer must not be used');
  },
}));
const answers: Record<string, () => Promise<unknown>> = {};
vi.mock('firebase/functions', () => ({
  httpsCallable: (_f: unknown, name: string) => async () => {
    const answer = answers[name];
    if (!answer) return new Promise(() => undefined);
    return { data: await answer() };
  },
}));

const { isDevTunnelHost, isPublicHost } = await import('../src/publicHost');
const { configuredPublicOrigin, publicOriginOf } = await import('../src/publicOrigin');
const { currentOrigin: webOrigin } = await vi.importActual<typeof import('../src/ui/currentOrigin')>('../src/ui/currentOrigin');
const { currentOrigin: nativeOrigin } = await import('../src/ui/currentOrigin.native');
const { currentOrigin: kioskOrigin } = await import('../src/ui/kioskLink');
const { default: MoveGoal } = await import('../app/move/[goalId]');
const { default: StationScreen } = await import('../app/station/[goalId]');
const { moveHandoffUrl } = await import('../src/moveSession');

const APP_ROOT = join(__dirname, '..');
const PAGE = 'http://localhost:3000';

let container: HTMLDivElement;
let root: Root;
let os: string;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await act(async () => undefined);
};
const qrXml = (id: string) => byId(id)?.querySelector('[data-testid="svg-xml"]')?.getAttribute('data-xml') ?? null;

beforeEach(() => {
  os = Platform.OS;
  encoded.length = 0;
  vi.unstubAllEnvs();
  for (const k of Object.keys(answers)) delete answers[k];
  answers.wsfGoalPulse = async () => PULSE;
  answers.wsfStationState = async () => ({ stationId: 'st1', slot: 1, label: 'Station 1', goalId: 'g1', queueId: 'q1', joinCode: JOIN_CODE, pulse: PULSE });
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  (Platform as { OS: string }).OS = os;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('W12-13: publicOriginOf, the one rule for a phone build\'s origin', () => {
  it.each([
    ['https://wsf.example.com', NAMED],
    ['  https://WSF.Example.com/  ', NAMED],
    ['HTTPS://app.westayfit.com', 'https://app.westayfit.com'],
  ])('accepts %j as %s', (value, origin) => {
    expect(publicOriginOf(value)).toBe(origin);
  });

  it.each([
    [undefined],
    [''],
    ['   '],
    ['http://wsf.example.com'],
    ['https://wsf.example.com:443'],
    ['https://wsf.example.com:8081'],
    ['http://192.168.1.20:8081'],
    ['https://10.0.2.2'],
    ['https://[::1]'],
    ['https://localhost'],
    ['https://laptop.local'],
    ['https://router.lan'],
    ['https://wsf'],
    ['https://abc.ngrok-free.app'],
    ['https://x.exp.direct'],
    ['https://my.ts.net'],
    ['https://wsf.example.com/app'],
    ['https://wsf.example.com?x=1'],
    ['https://user@wsf.example.com'],
    ['https://wsf.example.com.'],
    ['https://*.example.com'],
    ['wsf.example.com'],
    ['exp://192.168.1.20:8081'],
  ])('refuses %j', (value) => {
    expect(publicOriginOf(value)).toBeNull();
  });

  it('the host rules are the member lane\'s, from src/publicHost.ts', () => {
    expect(isPublicHost('wsf.example.com')).toBe(true);
    expect(isPublicHost('localhost')).toBe(false);
    expect(isPublicHost('fritz.box')).toBe(false);
    expect(isDevTunnelHost('abc.trycloudflare.com')).toBe(true);
    expect(isDevTunnelHost('wsf.example.com')).toBe(false);
  });

  it('configuredPublicOrigin reads EXPO_PUBLIC_WSF_PUBLIC_ORIGIN, which is unset in this repository', () => {
    expect(configuredPublicOrigin()).toBeNull();
    vi.stubEnv('EXPO_PUBLIC_WSF_PUBLIC_ORIGIN', `${NAMED}/`);
    expect(configuredPublicOrigin()).toBe(NAMED);
    vi.stubEnv('EXPO_PUBLIC_WSF_PUBLIC_ORIGIN', 'http://192.168.1.20:8081');
    expect(configuredPublicOrigin()).toBeNull();
  });

  it('one source: where the member lane\'s src/joinInput.ts is present, its host rules are these, or are imported from here', () => {
    const member = join(APP_ROOT, 'src', 'joinInput.ts');
    if (!existsSync(member)) return; // Not on this branch; checked on a composed tree.
    const decls = (file: string) => {
      const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
      const found: Record<string, string> = {};
      for (const st of sf.statements) {
        if (ts.isFunctionDeclaration(st) && st.name) found[st.name.text] = st.getText();
        if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) if (ts.isIdentifier(d.name)) found[d.name.text] = st.getText();
      }
      return { found, imports: sf.statements.filter(ts.isImportDeclaration).map((d) => (d.moduleSpecifier as ts.StringLiteral).text) };
    };
    const ours = decls(join(APP_ROOT, 'src', 'publicHost.ts'));
    const theirs = decls(member);
    for (const name of ['PUBLIC_HOST', 'NON_PUBLIC_SUFFIXES', 'DEV_TUNNEL_DOMAINS', 'isDevTunnelHost', 'isPublicHost']) {
      if (name in theirs.found) expect(theirs.found[name], name).toBe(ours.found[name]);
      else expect(theirs.imports, name).toContain('./publicHost');
    }
  });
});

describe('W12-13: currentOrigin, per platform', () => {
  it('web: the page\'s own origin, as before, whatever the env says', () => {
    expect(webOrigin()).toBe(PAGE);
    vi.stubEnv('EXPO_PUBLIC_WSF_PUBLIC_ORIGIN', NAMED);
    expect(webOrigin()).toBe(PAGE);
  });

  it('a phone: the configured origin or null, never the page\'s (jsdom has one here, as a dev build has Metro\'s)', () => {
    expect(window.location.origin).toBe(PAGE);
    expect(nativeOrigin()).toBeNull();
    vi.stubEnv('EXPO_PUBLIC_WSF_PUBLIC_ORIGIN', NAMED);
    expect(nativeOrigin()).toBe(NAMED);
    vi.stubEnv('EXPO_PUBLIC_WSF_PUBLIC_ORIGIN', 'http://localhost:8081');
    expect(nativeOrigin()).toBeNull();
  });

  it('kioskLink re-exports it, so combinedLink and the screens share one idea of the origin', () => {
    (Platform as { OS: string }).OS = 'web';
    expect(kioskOrigin()).toBe(PAGE);
    (Platform as { OS: string }).OS = 'ios';
    expect(kioskOrigin()).toBeNull();
  });
});

describe('W12-13: MOVE and the station build their QR codes from currentOrigin', () => {
  const handoff = (origin: string) => moveHandoffUrl({ origin, goalId: 'g1', roundId: null, groupId: null })!;
  const join = (origin: string) => buildEventJoinUrlFromScreenedCode({ origin, joinCode: JOIN_CODE, goalId: 'g1', activity: 'squats' })!;

  for (const platform of ['ios', 'android'] as const) {
    it(`${platform}: with no origin named, no QR code, though the page has an address`, async () => {
      (Platform as { OS: string }).OS = platform;
      act(() => root.render(<MoveGoal />));
      await settle();
      expect(byId('wsf-move-heading')).not.toBeNull();
      expect(byId('wsf-move-panel-qr')).toBeNull();
      act(() => root.unmount());
      root = createRoot(container);
      act(() => root.render(<StationScreen />));
      await settle();
      expect(byId('wsf-station-qr')).not.toBeNull();
      expect(byId('wsf-station-qr-join-image')).toBeNull();
      expect(byId('wsf-station-qr-member-image')).toBeNull();
      // Nothing was drawn from the page's address.
      expect(encoded.filter((t) => t.startsWith(PAGE))).toEqual([]);
    });

    it(`${platform}: with an origin named, each QR encodes that origin`, async () => {
      (Platform as { OS: string }).OS = platform;
      vi.stubEnv('EXPO_PUBLIC_WSF_PUBLIC_ORIGIN', NAMED);
      act(() => root.render(<MoveGoal />));
      await settle();
      expect(qrXml('wsf-move-panel-qr')).toBe(renderQrSvg(encodeQr(handoff(NAMED)), QR_OPTS));
      act(() => root.unmount());
      root = createRoot(container);
      act(() => root.render(<StationScreen />));
      await settle();
      expect(qrXml('wsf-station-qr-join-image')).toBe(renderQrSvg(encodeQr(join(NAMED)), QR_OPTS));
      expect(encoded.filter((t) => t.startsWith(PAGE))).toEqual([]);
    });
  }

  it('web: the page\'s own origin, as before, even with the env set', async () => {
    (Platform as { OS: string }).OS = 'web';
    vi.stubEnv('EXPO_PUBLIC_WSF_PUBLIC_ORIGIN', NAMED);
    act(() => root.render(<MoveGoal />));
    await settle();
    expect(byId('wsf-move-panel-qr')).not.toBeNull();
    expect(encoded).toContain(handoff(PAGE));
    act(() => root.unmount());
    root = createRoot(container);
    act(() => root.render(<StationScreen />));
    await settle();
    expect(byId('wsf-station-qr-join-image')).not.toBeNull();
    expect(encoded).toContain(join(PAGE));
    expect(encoded.filter((t) => t.startsWith(NAMED))).toEqual([]);
  });
});
