import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Component, act, type ComponentType, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Platform, Text } from 'react-native';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigate = vi.fn();
vi.mock('expo-router', () => ({ router: { navigate: (...a: unknown[]) => navigate(...a) } }));
// The real module imports React Native internals jsdom cannot load. The
// fallback reads only this constant from it (no provider).
vi.mock('react-native-safe-area-context', () => ({
  initialWindowMetrics: { insets: { top: 47, bottom: 34, left: 0, right: 0 }, frame: { x: 0, y: 0, width: 390, height: 844 } },
}));

import * as webContainment from '../src/crashContainment';
import { installCrashContainment } from '../src/crashContainment.native';
import * as webHarness from '../src/crashHarness';
import {
  armCrashSiteForTest,
  disarmAllCrashSites,
  fireAsyncCrashFaults,
  injectedRenderFault,
  isCrashSiteArmed,
  parseCrashHarness,
} from '../src/crashHarness.native';
import {
  CRASH_RECORDS_KEY,
  MAX_CRASH_RECORDS,
  MAX_SCRUB_INPUT,
  crashRecordOf,
  type CrashKv,
  WITHHELD_MESSAGE,
  persistCrash,
  readCrashRecords,
  recordMessage,
  scrubFrames,
  scrubMessage,
} from '../src/crashRecords';
import * as webRecordsCard from '../src/ui/CrashRecordsCard';
import { CrashRecordsCard } from '../src/ui/CrashRecordsCard.native';
import * as webFallback from '../src/ui/RouteErrorFallback';
import { RouteErrorFallback, nativeErrorBoundary } from '../src/ui/RouteErrorFallback.native';
import type { FallbackVariant } from '../src/ui/routeErrorTypes';

/**
 * NATIVE-INTEGRATOR-1 (INT-01): crash containment, everything vitest can run.
 * No device and no binary: the cases that need one stay in Appendix C. What is
 * proved here is each piece's contract: the route boundary's fallback and its
 * retry, the root fallback needing no provider, the harness's injected throws,
 * and the global handler's record-then-pass-on order.
 */

const APP_ROOT = join(__dirname, '..');

// Typed as the narrow store the crash modules take, so this fake compiles
// whatever else DeviceKv requires (#641 SH-4: the state lane's readItem).
function memoryKv(opts: { hang?: boolean; fail?: boolean } = {}): CrashKv & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async getItem(k) {
      return data.get(k) ?? null;
    },
    setItem(k, v) {
      if (opts.hang) return new Promise<boolean>(() => undefined);
      if (opts.fail) return Promise.reject(new Error('disk'));
      data.set(k, v);
      return Promise.resolve(true);
    },
    async removeItem(k) {
      data.delete(k);
      return true;
    },
  };
}

const flush = async () => {
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

// PII a record must never carry.
const EMAIL = 'alex.rivera@example.com';
const DISPLAY_NAME = 'Alex Rivera';
const GOAL_TITLE = '500 squats together';
const JOIN_CODE = 'Kq7ZpX2mNv9TbR4wYc';

describe('scrubbing: a record carries no email, display name, goal title or join code', () => {
  it('removes each kind of personal text from a message', () => {
    const raw = `Could not save "${GOAL_TITLE}" for '${DISPLAY_NAME}' (${EMAIL}) via https://westay.fit/join/${JOIN_CODE} code ${JOIN_CODE}`;
    const out = scrubMessage(raw);
    for (const secret of [EMAIL, DISPLAY_NAME, 'Alex', 'Rivera', GOAL_TITLE, 'squats', JOIN_CODE, 'westay.fit']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('Could not save');
  });

  it('keeps a code path an engine quotes, which is what makes a record useful', () => {
    expect(scrubMessage("undefined is not an object (evaluating 'window.location.origin')")).toBe(
      "undefined is not an object (evaluating 'window.location.origin')",
    );
    // A single quoted word could be a name: dropped.
    expect(scrubMessage("Cannot read property 'origin' of undefined")).toBe('Cannot read property <text> of undefined');
  });

  it('frames keep only function and file basename, never a host, path or query', () => {
    const stack = [
      'Error: boom',
      '    at render (http://192.168.1.20:8081/index.bundle?platform=ios&dev=true:1234:56)',
      '    at anonymous (address at /data/user/0/com.westayfit.app/files/index.android.bundle:1:98765)',
      'commitRoot@http://10.0.2.2:8081/index.bundle?platform=android:77:8',
      '    at native',
    ].join('\n');
    expect(scrubFrames(stack)).toEqual([
      'render@index.bundle:1234:56',
      'anonymous@index.android.bundle:1:98765',
      'commitRoot@index.bundle:77:8',
      '?@native',
    ]);
  });

  it('a whole record, serialized, contains none of it', () => {
    const e = new Error(`goal "${GOAL_TITLE}" by ${EMAIL} code ${JOIN_CODE} name '${DISPLAY_NAME}'`);
    const json = JSON.stringify(crashRecordOf(e, 'fatal'));
    for (const secret of [EMAIL, DISPLAY_NAME, GOAL_TITLE, JOIN_CODE]) expect(json).not.toContain(secret);
    expect(JSON.parse(json)).toMatchObject({ v: 1, kind: 'fatal', name: 'Error' });
  });

  it('a thrown non-Error is recorded as such', () => {
    expect(crashRecordOf('plain string', 'rejection')).toMatchObject({ name: 'NonError', message: WITHHELD_MESSAGE, frames: [] });
  });

  it('only messages of a known engine, React or harness shape are kept; any other is withheld', () => {
    // An unquoted name cannot be told apart from ordinary words: such a message is withheld whole.
    expect(recordMessage(`rejected for ${DISPLAY_NAME}`)).toBe(WITHHELD_MESSAGE);
    expect(recordMessage(`Goal ${GOAL_TITLE} is closed`)).toBe(WITHHELD_MESSAGE);
    expect(recordMessage(`${DISPLAY_NAME} is not a function`)).toBe(WITHHELD_MESSAGE);
    // Engine and React shapes survive, with their code tokens.
    expect(recordMessage("Cannot read property 'origin' of undefined")).toBe('Cannot read property <text> of undefined');
    expect(recordMessage("undefined is not an object (evaluating 'window.location.origin')")).toBe(
      "undefined is not an object (evaluating 'window.location.origin')",
    );
    expect(recordMessage("undefined is not a function (near '...render...')")).toBe(
      'undefined is not a function (near <text>)',
    );
    expect(recordMessage("Property 'Foo' doesn't exist")).toBe("Property <text> doesn't exist");
    expect(recordMessage('Text strings must be rendered within a <Text> component.')).toBe(
      'Text strings must be rendered within a <Text> component.',
    );
    expect(recordMessage('Firebase: Error (auth/network-request-failed).')).toBe(
      'Firebase: Error (auth/network-request-failed).',
    );
    expect(recordMessage('WSF injected render fault: community-detail-origin (read undefined)')).toBe(
      'WSF injected render fault: community-detail-origin (read undefined)',
    );
    expect(recordMessage('')).toBe('');
  });

  it('a message React builds from app data keeps only its fixed opening words (CS-1)', () => {
    const raw =
      `Objects are not valid as a React child (found: object with keys {${DISPLAY_NAME}, Sam Lee, ${GOAL_TITLE}}). ` +
      'If you meant to render a collection of children, use an array instead.';
    expect(recordMessage(raw)).toBe('Objects are not valid as a React child…');
    const json = JSON.stringify(crashRecordOf(new Error(raw), 'boundary'));
    for (const secret of [DISPLAY_NAME, 'Alex', 'Rivera', 'Sam Lee', GOAL_TITLE, 'squats']) expect(json).not.toContain(secret);
    expect(recordMessage('Maximum update depth exceeded. This can happen when a component repeatedly calls setState.')).toBe(
      'Maximum update depth exceeded…',
    );
    expect(recordMessage('Rendered fewer hooks than expected. This may be caused by an accidental early return statement.')).toBe(
      'Rendered fewer hooks than…',
    );
    expect(recordMessage('Rendered more hooks than during the previous render.')).toBe('Rendered more hooks than…');
  });

  it('a very long message or stack is cut before any pattern runs, so building a record stays fast (CS-2)', () => {
    // Shapes that made the old patterns quadratic: long runs with no digit, long dotted runs.
    const runs = ['a'.repeat(80_000), 'a.'.repeat(40_000), `${'x'.repeat(40_000)}@`, `${'b+'.repeat(40_000)}://`];
    for (const raw of runs) {
      const t0 = performance.now();
      const out = recordMessage(raw);
      const frames = scrubFrames(`Error: x\n    at ok (index.bundle:5:6)\n    at ${raw} (${raw}:1:2)\n${raw}@${raw}:3:4`);
      expect(performance.now() - t0).toBeLessThan(250);
      expect(out.length).toBeLessThanOrEqual(160);
      expect(frames).toEqual(['ok@index.bundle:5:6']);
    }
    // An over-long line is skipped unread; a real frame after it is still kept.
    const long = 'q'.repeat(500);
    expect(scrubFrames(`    at ${long} (${long}:1:2)\n    at ok (index.bundle:5:6)`)).toEqual(['ok@index.bundle:5:6']);
    // What is cut is never looked at, so text past the cut cannot reach the record,
    // even where everything before it collapses to nothing.
    expect(scrubMessage(`${' '.repeat(MAX_SCRUB_INPUT)}${DISPLAY_NAME}`)).toBe('');
    expect(scrubMessage(`${'word '.repeat(MAX_SCRUB_INPUT / 5)}${EMAIL}`)).not.toContain('example');
    // The same digit and long-token rules as before, in one pass.
    expect(scrubMessage(`code ${JOIN_CODE} id a1b and abcdefghijklmnop plain`)).toBe('code <id> id <id> and <id> plain');
  });
});

describe('the global handler: record, then pass on (never swallowed)', () => {
  function fakeGlobal() {
    const order: string[] = [];
    let handler: ((e: unknown, fatal?: boolean) => void) | undefined;
    const previous = vi.fn((_e: unknown, fatal?: boolean) => order.push(`previous:${fatal}`));
    let tracker: { onUnhandled: (id: number, r: unknown) => void } | null = null;
    const g = {
      ErrorUtils: {
        getGlobalHandler: () => previous,
        setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => {
          handler = h;
        },
      },
      HermesInternal: {
        enablePromiseRejectionTracker: vi.fn((o: { onUnhandled: (id: number, r: unknown) => void }) => {
          tracker = o;
        }),
      },
    };
    return { g, previous, order, fire: (e: unknown, fatal?: boolean) => handler!(e, fatal), tracker: () => tracker };
  }

  it('a fatal timer error is written to the device BEFORE the previous handler ends the process', async () => {
    const f = fakeGlobal();
    const kv = memoryKv();
    const realSet = kv.setItem.bind(kv);
    kv.setItem = async (k, v) => {
      const ok = await realSet(k, v);
      f.order.push('persisted');
      return ok;
    };
    expect(installCrashContainment({ globalObject: f.g, platform: 'android', dev: false, kv, force: true })).toBe(true);
    f.fire(new Error(`timer fault for ${EMAIL}`), true);
    expect(f.previous).not.toHaveBeenCalled();
    await flush();
    await vi.waitFor(() => expect(f.previous).toHaveBeenCalledTimes(1));
    expect(f.order).toEqual(['persisted', 'previous:true']);
    const records = await readCrashRecords(kv);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ kind: 'fatal', platform: Platform.OS });
    expect(JSON.stringify(records)).not.toContain(EMAIL);
  });

  it('a write that hangs never holds a fatal error back past the grace period', async () => {
    vi.useFakeTimers();
    try {
      const f = fakeGlobal();
      installCrashContainment({ globalObject: f.g, platform: 'ios', dev: false, kv: memoryKv({ hang: true }), graceMs: 1500, force: true });
      const err = new Error('boom');
      f.fire(err, true);
      expect(f.previous).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1500);
      expect(f.previous).toHaveBeenCalledTimes(1);
      expect(f.previous).toHaveBeenCalledWith(err, true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a failing write still passes the error on, once', async () => {
    const f = fakeGlobal();
    installCrashContainment({ globalObject: f.g, platform: 'ios', dev: false, kv: memoryKv({ fail: true }), force: true });
    f.fire(new Error('boom'), true);
    await vi.waitFor(() => expect(f.previous).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(f.previous).toHaveBeenCalledTimes(1);
  });

  it('a non-fatal error passes on at once and is recorded', async () => {
    const f = fakeGlobal();
    const kv = memoryKv();
    installCrashContainment({ globalObject: f.g, platform: 'android', dev: false, kv, force: true });
    const err = new Error('soft');
    f.fire(err, false);
    expect(f.previous).toHaveBeenCalledWith(err, false);
    await vi.waitFor(async () => expect(await readCrashRecords(kv)).toHaveLength(1));
    expect((await readCrashRecords(kv))[0]!.kind).toBe('error');
  });

  it('release builds record unhandled rejections (not escalated); development leaves RN its own tracker', async () => {
    const rel = fakeGlobal();
    const kv = memoryKv();
    installCrashContainment({ globalObject: rel.g, platform: 'android', dev: false, kv, force: true });
    expect(rel.g.HermesInternal.enablePromiseRejectionTracker).toHaveBeenCalledWith(
      expect.objectContaining({ allRejections: true }),
    );
    rel.tracker()!.onUnhandled(1, new Error(`rejected for ${DISPLAY_NAME}`));
    await vi.waitFor(async () => expect(await readCrashRecords(kv)).toHaveLength(1));
    const [r] = await readCrashRecords(kv);
    expect(r).toMatchObject({ kind: 'rejection' });
    expect(JSON.stringify(r)).not.toContain('Rivera');
    expect(rel.previous).not.toHaveBeenCalled();

    const dev = fakeGlobal();
    installCrashContainment({ globalObject: dev.g, platform: 'android', dev: true, kv: memoryKv(), force: true });
    expect(dev.g.HermesInternal.enablePromiseRejectionTracker).not.toHaveBeenCalled();
  });

  it('installs nothing on web, nothing without ErrorUtils, and only once', () => {
    const f = fakeGlobal();
    expect(installCrashContainment({ globalObject: f.g, platform: 'web', force: true })).toBe(false);
    expect(installCrashContainment({ globalObject: {}, platform: 'ios', force: true })).toBe(false);
    expect(installCrashContainment({ globalObject: f.g, platform: 'ios', kv: memoryKv(), force: true })).toBe(true);
    expect(installCrashContainment({ globalObject: f.g, platform: 'ios', kv: memoryKv() })).toBe(false);
  });

  it('keeps the newest few records, newest first, and serializes writes so none is lost', async () => {
    const kv = memoryKv();
    await Promise.all(
      Array.from({ length: MAX_CRASH_RECORDS + 2 }, (_, i) =>
        persistCrash(crashRecordOf(new Error(`e${i}`), 'error', new Date(Date.UTC(2026, 0, 1, 0, 0, i))), kv),
      ),
    );
    const records = await readCrashRecords(kv);
    expect(records).toHaveLength(MAX_CRASH_RECORDS);
    expect(records[0]!.at).toBe('2026-01-01T00:00:06.000Z');
    expect(kv.data.has(CRASH_RECORDS_KEY)).toBe(true);
  });
});

describe('the injected-throw harness (behind EXPO_PUBLIC_WSF_CRASH_HARNESS)', () => {
  afterEach(() => disarmAllCrashSites());

  it('is off unless the build names sites, always off on web and in production', () => {
    expect(parseCrashHarness(undefined, { platform: 'ios', env: 'staging' }).size).toBe(0);
    expect(parseCrashHarness('progress', { platform: 'web', env: 'staging' }).size).toBe(0);
    expect(parseCrashHarness('progress', { platform: 'android', env: 'production' }).size).toBe(0);
    expect(parseCrashHarness('progress, community-tab ,bogus', { platform: 'android', env: 'staging' })).toEqual(
      new Set(['progress', 'community-tab']),
    );
    // This test run names none, so every site is disarmed.
    expect(isCrashSiteArmed('progress')).toBe(false);
    expect(() => injectedRenderFault('progress')).not.toThrow();
  });

  it('an armed render site throws until disarmed', () => {
    armCrashSiteForTest('community-tab');
    expect(() => injectedRenderFault('community-tab')).toThrow('WSF injected render fault: community-tab');
    expect(() => injectedRenderFault('community-tab')).toThrow();
    disarmAllCrashSites();
    expect(() => injectedRenderFault('community-tab')).not.toThrow();
  });

  it('the community-detail site performs the real window.location.origin read: a TypeError where it is missing', () => {
    armCrashSiteForTest('community-detail-origin');
    // A native release build: RN defines `window` as the global, with no `location`.
    expect(() => injectedRenderFault('community-detail-origin', { window: {} })).toThrow(TypeError);
    // A development build has Metro's window.location: the harness throws in its place.
    expect(() =>
      injectedRenderFault('community-detail-origin', { window: { location: { origin: 'http://10.0.2.2:8081' } } }),
    ).toThrow('community-detail-origin (read string)');
  });

  it('the timer and rejection faults fire once each, after a delay', async () => {
    armCrashSiteForTest('timer');
    armCrashSiteForTest('rejection');
    const scheduled: Array<() => void> = [];
    fireAsyncCrashFaults((fn) => scheduled.push(fn));
    fireAsyncCrashFaults((fn) => scheduled.push(fn));
    expect(scheduled).toHaveLength(2);
    expect(() => scheduled[0]!()).toThrow('WSF injected timer fault');
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);
    try {
      scheduled[1]!();
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).toHaveBeenCalledWith(expect.objectContaining({ message: 'WSF injected rejection' }), expect.anything());
    } finally {
      process.off('unhandledRejection', unhandled);
    }
  });
});

/**
 * The boundary expo-router puts around a route that exports `ErrorBoundary`
 * (node_modules/expo-router/build/views/Try.js), reproduced so it runs under
 * jsdom (the real module imports `expo`). The contract test below holds it to
 * the installed source.
 */
class Try extends Component<{ catch: ComponentType<{ error: Error; retry: () => Promise<void> }>; children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = { error: undefined };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  retry = () => new Promise<void>((resolve) => this.setState({ error: undefined }, () => resolve()));
  render() {
    const { catch: Fallback, children } = this.props;
    return this.state.error ? <Fallback error={this.state.error} retry={this.retry} /> : children;
  }
}

describe('route boundaries and their fallback', () => {
  let container: HTMLDivElement;
  let root: Root;
  const byId = (id: string) => container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  let consoleError: ReturnType<typeof vi.spyOn>;
  const os = Platform.OS;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    localStorage.clear();
    navigate.mockClear();
    // React logs every caught render error; the throws here are deliberate.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    (Platform as { OS: string }).OS = 'ios';
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    consoleError.mockRestore();
    disarmAllCrashSites();
    (Platform as { OS: string }).OS = os;
  });

  it('holds to expo-router\'s installed contract: a route exporting ErrorBoundary is wrapped, and it gets { error, retry }', () => {
    const useScreens = readFileSync(join(APP_ROOT, 'node_modules/expo-router/build/useScreens.js'), 'utf8');
    expect(useScreens).toMatch(/function fromImport\(value, \{ ErrorBoundary, \.\.\.component \}\)/);
    expect(useScreens).toMatch(/if \(ErrorBoundary\) \{[\s\S]*?<Try_1\.Try catch=\{ErrorBoundary\}>/);
    const tryJs = readFileSync(join(APP_ROOT, 'node_modules/expo-router/build/views/Try.js'), 'utf8');
    expect(tryJs).toContain('<ErrorBoundary error={error} retry={this.retry}/>');
    expect(tryJs).toContain('this.setState({ error: undefined }');
  });

  it('every boundary is native only: the web module returns undefined, so expo-router wraps nothing there', () => {
    const variants = ['root', 'shell', 'homeTab', 'tab', 'screen', 'contribute'] as FallbackVariant[];
    // The module Metro bundles for web.
    for (const v of variants) expect(webFallback.nativeErrorBoundary(v)).toBeUndefined();
    // The native module, with its own second guard should it ever be bundled for web.
    (Platform as { OS: string }).OS = 'web';
    for (const v of variants) expect(nativeErrorBoundary(v)).toBeUndefined();
    (Platform as { OS: string }).OS = 'android';
    for (const v of variants) expect(nativeErrorBoundary(v)).toBeTypeOf('function');
    // Stable identity per variant (no new component type per render).
    expect(nativeErrorBoundary('tab')).toBe(nativeErrorBoundary('tab'));
  });

  it('the web modules are inert: no handler, no harness, no records card', () => {
    expect(webContainment.installCrashContainment()).toBe(false);
    expect(webHarness.crashHarnessEnabled()).toBe(false);
    expect(webHarness.isCrashSiteArmed('progress')).toBe(false);
    expect(() => webHarness.injectedRenderFault('progress')).not.toThrow();
    expect(() => webHarness.fireAsyncCrashFaults()).not.toThrow();
    expect(webRecordsCard.CrashRecordsCard({})).toBeNull();
  });

  function Progress() {
    injectedRenderFault('progress');
    return <Text testID="wsf-activity">Progress</Text>;
  }

  it('INT-01 case 2: a throw injected into Progress shows the contained screen; Try again re-renders once the throw is removed', async () => {
    armCrashSiteForTest('progress');
    const Boundary = nativeErrorBoundary('tab')!;
    act(() =>
      root.render(
        <>
          <Text testID="wsf-member-tabbar">tabs</Text>
          <Try catch={Boundary}>
            <Progress />
          </Try>
        </>,
      ),
    );
    expect(byId('wsf-activity')).toBeNull();
    expect(byId('wsf-route-error')).not.toBeNull();
    // Contained: what is outside the route is still there.
    expect(byId('wsf-member-tabbar')).not.toBeNull();
    expect(byId('wsf-route-error-retry')!.textContent).toBe('Try again');
    // Retrying while the fault is still there shows the fallback again, not a crash.
    await act(async () => byId('wsf-route-error-retry')!.click());
    expect(byId('wsf-route-error')).not.toBeNull();
    disarmAllCrashSites();
    await act(async () => byId('wsf-route-error-retry')!.click());
    expect(byId('wsf-route-error')).toBeNull();
    expect(byId('wsf-activity')!.textContent).toBe('Progress');
  });

  it('INT-01 case 1: the Community tab fallback offers Try again and a way to Home', () => {
    armCrashSiteForTest('community-tab');
    function CommunityTab() {
      injectedRenderFault('community-tab');
      return null;
    }
    act(() =>
      root.render(
        <Try catch={nativeErrorBoundary('tab')!}>
          <CommunityTab />
        </Try>,
      ),
    );
    expect(byId('wsf-route-error-home')!.textContent).toBe('Go to Home');
    act(() => byId('wsf-route-error-home')!.click());
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('INT-01 case 3: the root fallback renders with no SafeAreaProvider and no auth provider, and its retry works', async () => {
    armCrashSiteForTest('root-shell');
    function Shell() {
      injectedRenderFault('root-shell');
      return <Text testID="wsf-shell">shell</Text>;
    }
    // Nothing but the boundary: no provider anywhere in this tree.
    act(() =>
      root.render(
        <Try catch={nativeErrorBoundary('root')!}>
          <Shell />
        </Try>,
      ),
    );
    expect(byId('wsf-route-error')).not.toBeNull();
    disarmAllCrashSites();
    await act(async () => byId('wsf-route-error-retry')!.click());
    expect(byId('wsf-shell')).not.toBeNull();
  });

  it.each(['root', 'shell', 'homeTab'] as FallbackVariant[])(
    'CS-4: the %s fallback has a way out when Try again throws again: Go to Home asks for Home, then remounts',
    async (variant) => {
      vi.useFakeTimers();
      try {
        armCrashSiteForTest('root-shell');
        let renders = 0;
        function Navigator() {
          renders += 1;
          injectedRenderFault('root-shell');
          return <Text testID="wsf-home">home</Text>;
        }
        act(() =>
          root.render(
            <Try catch={nativeErrorBoundary(variant)!}>
              <Navigator />
            </Try>,
          ),
        );
        // Still throwing: Try again comes straight back to the fallback.
        await act(async () => byId('wsf-route-error-retry')!.click());
        expect(byId('wsf-route-error')).not.toBeNull();
        expect(byId('wsf-route-error-home')!.textContent).toBe('Go to Home');
        // Go to Home: '/' is requested first, and only then is the navigator remounted.
        disarmAllCrashSites();
        const before = renders;
        act(() => byId('wsf-route-error-home')!.click());
        expect(navigate).toHaveBeenCalledWith('/');
        expect(renders).toBe(before);
        await act(async () => {
          vi.runAllTimers();
        });
        expect(byId('wsf-route-error')).toBeNull();
        expect(byId('wsf-home')).not.toBeNull();
      } finally {
        vi.useRealTimers();
      }
    },
  );

  it('CS-4: at the root no navigator is mounted, so Home is refused; the press never throws and the remount still happens', async () => {
    vi.useFakeTimers();
    try {
      navigate.mockImplementationOnce(() => {
        throw new Error('Attempted to navigate before mounting the Root Layout component.');
      });
      armCrashSiteForTest('root-shell');
      function Shell() {
        injectedRenderFault('root-shell');
        return <Text testID="wsf-shell">shell</Text>;
      }
      act(() =>
        root.render(
          <Try catch={nativeErrorBoundary('root')!}>
            <Shell />
          </Try>,
        ),
      );
      disarmAllCrashSites();
      expect(() => act(() => byId('wsf-route-error-home')!.click())).not.toThrow();
      await act(async () => {
        vi.runAllTimers();
      });
      expect(byId('wsf-shell')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('CS-4: inside a live navigator (tab, screen, contribute) Go to Home only navigates; it never remounts the failed route', async () => {
    vi.useFakeTimers();
    try {
      for (const variant of ['tab', 'screen', 'contribute'] as FallbackVariant[]) {
        const retry = vi.fn();
        act(() => root.render(<RouteErrorFallback error={new Error('x')} retry={retry} variant={variant} />));
        navigate.mockClear();
        act(() => byId('wsf-route-error-home')!.click());
        await act(async () => {
          vi.runAllTimers();
        });
        expect(navigate).toHaveBeenCalledWith('/');
        expect(retry).not.toHaveBeenCalled();
      }
    } finally {
      vi.useRealTimers();
    }
  });

  it('CS-6: the fallback never shows the error\'s own text, whatever the variant', () => {
    const variants = ['root', 'shell', 'homeTab', 'tab', 'screen', 'contribute'] as FallbackVariant[];
    for (const variant of variants) {
      const error = new Error(`render failed for ${DISPLAY_NAME} <${EMAIL}> on "${GOAL_TITLE}" code ${JOIN_CODE}`);
      act(() => root.render(<RouteErrorFallback error={error} retry={() => undefined} variant={variant} />));
      const text = container.textContent!;
      expect(text).toContain('Something went wrong');
      for (const secret of [DISPLAY_NAME, EMAIL, GOAL_TITLE, JOIN_CODE, 'render failed']) expect(text, variant).not.toContain(secret);
    }
  });

  it('INT-01 case 4: a window.location.origin read during community detail render shows the contained screen', () => {
    armCrashSiteForTest('community-detail-origin');
    const realWindow = globalThis.window;
    function CommunityDetail() {
      // The native release shape: `window` exists, `window.location` does not.
      injectedRenderFault('community-detail-origin', { window: {} });
      return null;
    }
    act(() =>
      root.render(
        <Try catch={nativeErrorBoundary('homeTab')!}>
          <CommunityDetail />
        </Try>,
      ),
    );
    expect(globalThis.window).toBe(realWindow);
    expect(byId('wsf-route-error')).not.toBeNull();
    // Home is the tab that failed: Try again, Go to Home, and the tab bar is the way elsewhere.
    expect(byId('wsf-route-error-body')!.textContent).toContain('pick another tab');
    expect(byId('wsf-route-error-home')).not.toBeNull();
  });

  it('the contribute fallback says not confirmed and points to Progress; it never says recorded', () => {
    act(() => root.render(<RouteErrorFallback error={new Error('x')} retry={() => undefined} variant="contribute" />));
    const body = byId('wsf-route-error-body')!.textContent!;
    expect(body).toContain('not confirmed');
    expect(body).toContain('Progress');
    expect(container.textContent!.toLowerCase()).not.toContain('recorded');
  });

  it('a caught error is recorded, scrubbed, and Build details lists it on the next launch', async () => {
    act(() =>
      root.render(
        <RouteErrorFallback error={new Error(`render failed for ${EMAIL}`)} retry={() => undefined} variant="tab" />,
      ),
    );
    await vi.waitFor(() => expect(localStorage.getItem(CRASH_RECORDS_KEY)).not.toBeNull());
    expect(localStorage.getItem(CRASH_RECORDS_KEY)).not.toContain(EMAIL);
    act(() => root.render(<CrashRecordsCard />));
    await vi.waitFor(() => expect(byId('wsf-health-crashes')).not.toBeNull());
    expect(byId('wsf-health-crash-0')!.textContent).toContain('boundary');
    await act(async () => byId('wsf-health-crashes-clear')!.click());
    await vi.waitFor(() => expect(byId('wsf-health-crashes')).toBeNull());
    expect(localStorage.getItem(CRASH_RECORDS_KEY)).toBeNull();
  });

  it('Build details shows nothing when nothing was recorded', async () => {
    act(() => root.render(<CrashRecordsCard />));
    await act(async () => undefined);
    expect(container.innerHTML).toBe('');
  });
});

describe('the route files export their boundaries, and the handler installs early', () => {
  const read = (p: string) => readFileSync(join(APP_ROOT, p), 'utf8');
  it.each([
    ['app/_layout.tsx', 'root'],
    ['app/(tabs)/_layout.tsx', 'shell'],
    ['app/(tabs)/(home)/_layout.tsx', 'homeTab'],
    ['app/(tabs)/community/_layout.tsx', 'tab'],
    ['app/(tabs)/activity.tsx', 'tab'],
    ['app/move/index.tsx', 'screen'],
    ['app/contribute/[goalId].tsx', 'contribute'],
  ])('%s exports ErrorBoundary = nativeErrorBoundary(%s)', (file, variant) => {
    expect(read(file)).toContain(`export const ErrorBoundary = nativeErrorBoundary('${variant}');`);
  });

  it('app/_layout.tsx imports crashContainment first (it installs within the same route-loading pass, before any timer or callback can run)', () => {
    const firstImport = read('app/_layout.tsx')
      .split('\n')
      .find((l) => l.startsWith('import '));
    expect(firstImport).toBe("import '../src/crashContainment';");
  });

  it('each harness site is wired where the case injects it', () => {
    expect(read('app/_layout.tsx')).toContain("injectedRenderFault('root-shell');");
    expect(read('app/(tabs)/community/_layout.tsx')).toContain("injectedRenderFault('community-tab');");
    expect(read('app/(tabs)/activity.tsx')).toContain("injectedRenderFault('progress');");
    expect(read('app/(tabs)/(home)/community/[groupId]/index.tsx')).toContain(
      "injectedRenderFault('community-detail-origin');",
    );
    expect(read('app/_layout.tsx')).toContain('fireAsyncCrashFaults();');
  });
});
