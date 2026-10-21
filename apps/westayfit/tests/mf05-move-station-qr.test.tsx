import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Platform } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildEventJoinUrlFromScreenedCode, buildEventUrl } from '../src/ui/eventLinks';
import { encodeQr, renderQrSvg } from '../src/ui/qr';

/**
 * W12-19 (MF-05 adopters): the MOVE handoff QR and the station's two QR codes
 * were `qrSvgDataUriRaw` data URIs in React Native's <Image>, which draws an
 * SVG data URI as an empty box on a phone. They now go through SvgMarkup.
 *
 *   · Web: each QR element's DOM is byte-identical to a snapshot recorded from
 *     the code before the change
 *     (tests/fixtures/mf05-move-station-qr-web-before-w12-19.json; the record
 *     mode, WSF_RECORD_W12_19=1, writes only a missing file).
 *   · iOS and Android: each QR is SvgMarkup's native box, the RAW markup in
 *     SvgXml (react-native-svg, mocked at its boundary), and no data URI.
 *
 * Both QRs are null on a phone today until INT-08 names an origin; here the
 * address comes from jsdom's own origin (http://localhost:3000), a fixed URL
 * injected the way the web reads it. The routes render in jsdom with the
 * callables mocked at the network boundary; SvgMarkup is the twin Metro
 * would pick for Platform.OS. No device.
 */
const QR_OPTS = { dark: '#0B1F3A', light: '#FFFFFF' };
const JOIN_CODE = 'AbCdEfGhIjKlMnOpQrStUv';
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

vi.mock('react-native-svg', () => ({
  SvgXml: ({ xml, width, height }: { xml: string; width: string; height: string }) => (
    <svg data-testid="svg-xml" data-xml={xml} data-width={width} data-height={height} />
  ),
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
const params = vi.hoisted(() => ({ value: { goalId: 'g1' } as Record<string, string> }));
vi.mock('expo-router', () => ({
  useLocalSearchParams: () => params.value,
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
// The station's stored credential, for this goal (src/stationSession.ts keeps it in storage).
vi.mock('../src/stationSession', async () => {
  const actual = await vi.importActual<typeof import('../src/stationSession')>('../src/stationSession');
  return { ...actual, credentialForGoal: (goalId: string) => (goalId === 'g1' ? { stationId: 'st1', secret: 's'.repeat(32), goalId: 'g1', slot: 1 } : null) };
});
// The composed tree's FollowAlongCard may draw the media lane's MovementDemoMedia, whose expo-video cannot load in jsdom.
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

const { default: MoveGoal } = await import('../app/move/[goalId]');
const { default: StationScreen } = await import('../app/station/[goalId]');
const { moveHandoffUrl } = await import('../src/moveSession');

const FIXTURE = join(__dirname, 'fixtures', 'mf05-move-station-qr-web-before-w12-19.json');

let container: HTMLDivElement;
let root: Root;
let os: string;
const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await act(async () => undefined);
};

beforeEach(() => {
  os = Platform.OS;
  params.value = { goalId: 'g1' };
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
  vi.restoreAllMocks();
});

const ORIGIN = 'http://localhost:3000';
/** Each QR as a member reaches it: the element, and the URL it encodes. */
const QRS: Record<string, () => Promise<{ el: HTMLElement | null; url: string }>> = {
  async moveHandoff() {
    act(() => root.render(<MoveGoal />));
    await settle();
    return { el: byId('wsf-move-panel-qr'), url: moveHandoffUrl({ origin: ORIGIN, goalId: 'g1', roundId: null, groupId: null })! };
  },
  async stationJoin() {
    act(() => root.render(<StationScreen />));
    await settle();
    return {
      el: byId('wsf-station-qr-join-image'),
      url: buildEventJoinUrlFromScreenedCode({ origin: ORIGIN, joinCode: JOIN_CODE, goalId: 'g1', activity: 'squats' })!,
    };
  },
  async stationMember() {
    act(() => root.render(<StationScreen />));
    await settle();
    return { el: byId('wsf-station-qr-member-image'), url: buildEventUrl({ origin: ORIGIN, goalId: 'g1' })! };
  },
};
const NAMES = Object.keys(QRS);

describe('W12-19: on the web each QR is the DOM it was before', () => {
  const recorded: Record<string, string> = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : {};
  const record = process.env.WSF_RECORD_W12_19 === '1' && !existsSync(FIXTURE);
  const fresh: Record<string, string> = {};

  it('the address is jsdom\'s own origin, so the symbol is the same in any checkout', () => {
    expect(window.location.origin).toBe(ORIGIN);
  });

  it.each(NAMES)('%s: identical to the snapshot', async (name) => {
    (Platform as { OS: string }).OS = 'web';
    const { el } = await QRS[name]!();
    expect(el).not.toBeNull();
    if (record) {
      fresh[name] = el!.outerHTML;
      if (Object.keys(fresh).length === NAMES.length) {
        // Written once, before the change, and never over an existing file.
        writeFileSync(FIXTURE, `${JSON.stringify(fresh, null, 2)}\n`, { flag: 'wx' });
      }
      return;
    }
    expect(Object.keys(recorded).sort()).toEqual([...NAMES].sort());
    expect(el!.outerHTML).toBe(recorded[name]);
  });
});

describe('W12-19: on a phone each QR is drawn from its markup, never a data URI', () => {
  for (const platform of ['ios', 'android'] as const) {
    it.each(NAMES)(`${platform}: %s is SvgMarkup's box with the RAW markup in SvgXml`, async (name) => {
      (Platform as { OS: string }).OS = platform;
      const { el, url } = await QRS[name]!();
      expect(el).not.toBeNull();
      const svg = el!.querySelector('[data-testid="svg-xml"]');
      expect(svg).not.toBeNull();
      expect(svg!.getAttribute('data-xml')).toBe(renderQrSvg(encodeQr(url), QR_OPTS));
      expect(svg!.getAttribute('data-width')).toBe('100%');
      expect(el!.outerHTML).not.toContain('data:image/svg');
      expect(el!.querySelector('img')).toBeNull();
    });
  }
});
