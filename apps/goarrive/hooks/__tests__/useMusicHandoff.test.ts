/** @vitest-environment jsdom */

import { vi, describe, test, expect, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '../../test-utils/renderHook';
import { Platform } from 'react-native';
import { createBlessedMusicPlayer, getAudioContextState } from '../useWorkoutTTS';
import { useMusicHandoff, pickNearestBucket, buildVariantGcsUri } from '../useMusicHandoff';

vi.mock('../useWorkoutTTS', () => ({
  createBlessedMusicPlayer: vi.fn(),
  getAudioContextState: vi.fn(() => 'running'),
  resumeAudioGraph: vi.fn(),
}));

vi.mock('../../utils/musicHandoffVariant', () => ({
  getMusicHandoffVariant: vi.fn(() => 'v3'),
}));

vi.mock('../../utils/handoffLog', () => ({
  pushHandoffLog: vi.fn(),
}));

const originalOS = Platform.OS;
const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');

function makeAudio() {
  const el: any = {
    currentTime: 0,
    muted: false,
    paused: true,
    src: '',
    volume: 1,
    load: vi.fn(),
    removeAttribute: vi.fn(),
  };
  el.pause = vi.fn(() => { el.paused = true; });
  el.play = vi.fn(() => {
    el.paused = false;
    return Promise.resolve();
  });
  return el as HTMLAudioElement;
}

describe('useMusicHandoff v3 shadow controls', () => {
  let visibilityState: DocumentVisibilityState;
  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', {
      value: 'web',
      configurable: true,
      writable: true,
    });
    visibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibilityState,
    });
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.mocked(getAudioContextState).mockReturnValue('running');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(Platform, 'OS', {
      value: originalOS,
      configurable: true,
      writable: true,
    });
    if (originalVisibility) {
      Object.defineProperty(document, 'visibilityState', originalVisibility);
    }
  });

  function setup() {
    const shadow = makeAudio();
    const audible = makeAudio();
    audible.src = 'https://example.com/music.mp3';
    audible.currentTime = 12;
    const musicPausedRef = { current: false };
    const musicHoldRef = { current: false };
    const musicOffRef = { current: false };
    vi.mocked(createBlessedMusicPlayer).mockReturnValue(shadow);

    const hook = renderHook(
      (props: { isPaused: boolean; isMuted: boolean; volume: number }) =>
        useMusicHandoff({
          enabled: true,
          ...props,
          musicPausedRef,
          musicHoldRef,
          musicOffRef,
        }),
      { initialProps: { isPaused: false, isMuted: false, volume: 0.25 } },
    );

    act(() => {
      hook.result.current.primeShadow(audible);
      hook.result.current.swapTrack(audible.src);
      visibilityState = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    });

    return { ...hook, audible, shadow, musicPausedRef };
  }

  test('propagates pause, mute, and effective volume while v3 is background-audible', () => {
    const { audible, shadow, rerender, unmount } = setup();

    expect(shadow.play).toHaveBeenCalled();
    expect(shadow.currentTime).toBe(12);
    expect(shadow.muted).toBe(false);
    expect(shadow.volume).toBe(0.25);
    expect(audible.pause).toHaveBeenCalled();

    act(() => rerender({ isPaused: true, isMuted: false, volume: 0.25 }));
    expect(shadow.pause).toHaveBeenCalled();

    act(() => rerender({ isPaused: false, isMuted: true, volume: 0.09 }));
    expect(shadow.play).toHaveBeenCalledTimes(2);
    expect(shadow.muted).toBe(true);
    expect(shadow.volume).toBe(0.09);

    act(() => rerender({ isPaused: false, isMuted: false, volume: 0.64 }));
    expect(shadow.muted).toBe(false);
    expect(shadow.volume).toBe(0.64);
    unmount();
  });

  test('restores position, mute, and active playback on foreground return', () => {
    const { audible, shadow, rerender, unmount } = setup();
    act(() => rerender({ isPaused: false, isMuted: true, volume: 0.25 }));
    shadow.currentTime = 19;
    vi.mocked(audible.play).mockClear();
    vi.mocked(shadow.pause).mockClear();

    act(() => {
      visibilityState = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(audible.currentTime).toBe(19);
    expect(audible.muted).toBe(true);
    expect(audible.play).toHaveBeenCalledTimes(1);
    expect(shadow.pause).toHaveBeenCalledTimes(1);
    unmount();
  });

  test('does not restart the graph-wired element on return while paused', () => {
    const { audible, rerender, unmount } = setup();
    vi.mocked(audible.play).mockClear();

    act(() => rerender({ isPaused: true, isMuted: false, volume: 0.25 }));
    act(() => {
      visibilityState = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });

    expect(audible.pause).toHaveBeenCalled();
    expect(audible.play).not.toHaveBeenCalled();
    unmount();
  });
});

// ── pickNearestBucket unit tests ──────────────────────────────────────────────

describe('pickNearestBucket', () => {
  test.each([
    [100, 1.0],
    [70, 0.5],
    [50, 0.25],
    [35, 0.12],
    [22, 0.05],
    [10, 0.05],
  ])('slider %i%% → bucket %f', (sliderPct, expected) => {
    expect(pickNearestBucket(sliderPct)).toBe(expected);
  });
});

// ── swapTrack volume-bucket picker integration ────────────────────────────────

describe('swapTrack volume-bucket picker (v3)', () => {
  const FIREBASE_URL = 'https://firebasestorage.googleapis.com/v0/b/goarrive.appspot.com/o/music_cache%2Fchill%2Ftrack_10.mp3?alt=media';
  // slider 50% → volume*volume = 0.25 → sliderPct = sqrt(0.25)*100 = 50 → bucket 0.25 → gain_025
  const VARIANT_URL = 'https://firebasestorage.googleapis.com/v0/b/goarrive.appspot.com/o/music_cache%2Fchill%2Fgain_025%2Ftrack_10.mp3?alt=media';

  let visibilityState: DocumentVisibilityState;
  const originalOSField = Platform.OS;
  const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');

  beforeEach(() => {
    Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true, writable: true });
    visibilityState = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibilityState });
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => { cb(0); return 1; });
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.mocked(getAudioContextState).mockReturnValue('running');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(Platform, 'OS', { value: originalOSField, configurable: true, writable: true });
    if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
  });

  function setupPicker(volume = 0.25) {
    const shadow = makeAudio();
    vi.mocked(createBlessedMusicPlayer).mockReturnValue(shadow);
    const hook = renderHook(
      (props: { volume: number }) =>
        useMusicHandoff({ enabled: true, isPaused: false, isMuted: false, ...props, musicPausedRef: { current: false }, musicHoldRef: { current: false }, musicOffRef: { current: false } }),
      { initialProps: { volume } },
    );
    act(() => { hook.result.current.primeShadow(makeAudio()); });
    return { hook, shadow };
  }

  test('variant exists (HEAD 200) → variant URI used, fallbackUsed=false', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
    const { hook, shadow } = setupPicker(0.25); // slider² = 0.25 → sliderPct=50 → bucket 0.25

    act(() => { hook.result.current.swapTrack(FIREBASE_URL); });
    // Wait for the async headCheck + .then() to resolve
    await act(async () => { await Promise.resolve(); });

    expect(shadow.src).toBe(VARIANT_URL);
    const logCalls = vi.mocked(console.info).mock.calls.map((c: any[]) => c[0] as string);
    const bucketLog = logCalls.find((l: string) => l.includes('[VOLUME_BUCKET]'));
    expect(bucketLog).toBeTruthy();
    expect(bucketLog).toContain('"fallbackUsed":false');
    hook.unmount();
  });

  test('variant 404 → falls back to fullVolumeUri, fallbackUsed=true', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false } as Response);
    const { hook, shadow } = setupPicker(0.25);

    act(() => { hook.result.current.swapTrack(FIREBASE_URL); });
    await act(async () => { await Promise.resolve(); });

    expect(shadow.src).toBe(FIREBASE_URL);
    const logCalls = vi.mocked(console.info).mock.calls.map((c: any[]) => c[0] as string);
    const bucketLog = logCalls.find((l: string) => l.includes('[VOLUME_BUCKET]'));
    expect(bucketLog).toBeTruthy();
    expect(bucketLog).toContain('"fallbackUsed":true');
    hook.unmount();
  });

  test('stale HEAD from prior swap does not overwrite newer track (currentUrlRef guard)', async () => {
    const URL_A = 'https://firebasestorage.googleapis.com/v0/b/goarrive.appspot.com/o/music_cache%2Fchill%2Ftrack_10.mp3?alt=media';
    const URL_B = 'https://firebasestorage.googleapis.com/v0/b/goarrive.appspot.com/o/music_cache%2Fchill%2Ftrack_20.mp3?alt=media';
    const VARIANT_A = 'https://firebasestorage.googleapis.com/v0/b/goarrive.appspot.com/o/music_cache%2Fchill%2Fgain_025%2Ftrack_10.mp3?alt=media';
    const VARIANT_B = 'https://firebasestorage.googleapis.com/v0/b/goarrive.appspot.com/o/music_cache%2Fchill%2Fgain_025%2Ftrack_20.mp3?alt=media';

    // Queue HEAD-check resolvers so we can decide the order manually.
    const resolvers: Array<(v: Response) => void> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise<Response>((resolve) => {
      resolvers.push(resolve);
    }));

    const { hook, shadow } = setupPicker(0.25);

    // Two rapid swaps — currentUrlRef ends on B, but HEAD-A is still in flight.
    act(() => { hook.result.current.swapTrack(URL_A); });
    act(() => { hook.result.current.swapTrack(URL_B); });
    expect(resolvers).toHaveLength(2);

    // B resolves first — should land on shadow.
    resolvers[1]({ ok: true } as Response);
    await act(async () => { await Promise.resolve(); });
    expect(shadow.src).toBe(VARIANT_B);

    // A resolves LATE — the guard must drop it, keeping B.
    resolvers[0]({ ok: true } as Response);
    await act(async () => { await Promise.resolve(); });
    expect(shadow.src).toBe(VARIANT_B);
    expect(shadow.src).not.toBe(VARIANT_A);
    hook.unmount();
  });
});
