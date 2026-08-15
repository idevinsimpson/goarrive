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
  const listeners: Record<string, Array<(ev?: Event) => void>> = {};
  const el: any = {
    currentTime: 0,
    muted: false,
    paused: true,
    src: '',
    volume: 1,
    // readyState/networkState mirror the HTMLMediaElement spec constants:
    // HAVE_NOTHING=0, HAVE_METADATA=1, HAVE_CURRENT_DATA=2, HAVE_FUTURE_DATA=3, HAVE_ENOUGH_DATA=4.
    // Default HAVE_ENOUGH_DATA so bgplay tests can proceed without simulating a real load.
    readyState: 4,
    networkState: 1,
    load: vi.fn(),
    removeAttribute: vi.fn(),
    addEventListener: vi.fn((event: string, cb: (ev?: Event) => void, _opts?: unknown) => {
      (listeners[event] ??= []).push(cb);
    }),
    removeEventListener: vi.fn((event: string, cb: (ev?: Event) => void) => {
      const arr = listeners[event];
      if (!arr) return;
      const i = arr.indexOf(cb);
      if (i >= 0) arr.splice(i, 1);
    }),
    // Test helper — not part of the spec surface, but lets a test fire an
    // event and assert the handler ran.
    dispatch: (event: string) => {
      (listeners[event] ?? []).slice().forEach((cb) => cb());
    },
  };
  el.pause = vi.fn(() => { el.paused = true; });
  el.play = vi.fn(() => {
    el.paused = false;
    return Promise.resolve();
  });
  return el as HTMLAudioElement & { dispatch: (event: string) => void };
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
    const shadow = makeAudio() as HTMLAudioElement & { dispatch: (event: string) => void };
    const audible = makeAudio() as HTMLAudioElement & { dispatch: (event: string) => void };
    audible.src = 'https://example.com/music.mp3';
    audible.currentTime = 12;
    const musicPausedRef = { current: false };
    const musicHoldRef = { current: false };
    const musicOffRef = { current: false };
    const advance = vi.fn();
    const advanceRef = { current: advance };
    vi.mocked(createBlessedMusicPlayer).mockReturnValue(shadow);

    const hook = renderHook(
      (props: { isPaused: boolean; isMuted: boolean; volume: number }) =>
        useMusicHandoff({
          enabled: true,
          ...props,
          musicPausedRef,
          musicHoldRef,
          musicOffRef,
          advanceRef,
        }),
      { initialProps: { isPaused: false, isMuted: false, volume: 0.25 } },
    );

    act(() => {
      hook.result.current.primeShadow(audible);
      hook.result.current.swapTrack(audible.src);
      visibilityState = 'hidden';
      document.dispatchEvent(new Event('visibilitychange'));
    });

    return { ...hook, audible, shadow, musicPausedRef, advance };
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

  // ── Backgrounded advance (bug fix — v3 shadow drives playlist while hidden) ─
  // Before this fix the audible's 'ended' listener was the only advance path,
  // and the hide seam paused the audible — so music simply stopped at the
  // current track boundary. The shadow now carries its own 'ended' handler.

  test('shadow ended while backgrounded advances the playlist', () => {
    const { shadow, advance, unmount } = setup();
    // setup() leaves us backgrounded (inBackgroundRef=true, shadow playing).
    advance.mockClear();

    act(() => { (shadow as any).dispatch('ended'); });

    expect(advance).toHaveBeenCalledTimes(1);
    unmount();
  });

  test('shadow error while backgrounded advances the playlist (dead-CDN fallthrough)', () => {
    const { shadow, advance, unmount } = setup();
    advance.mockClear();

    act(() => { (shadow as any).dispatch('error'); });

    expect(advance).toHaveBeenCalledTimes(1);
    unmount();
  });

  test('shadow ended while foreground does NOT advance (audible owns advance in fg)', () => {
    const { shadow, advance, rerender, unmount } = setup();
    // Return to foreground first.
    act(() => {
      visibilityState = 'visible';
      document.dispatchEvent(new Event('visibilitychange'));
    });
    advance.mockClear();
    // Sanity: rerender to force an effect flush; state should be inBackground=false.
    act(() => rerender({ isPaused: false, isMuted: false, volume: 0.25 }));

    act(() => { (shadow as any).dispatch('ended'); });

    expect(advance).not.toHaveBeenCalled();
    unmount();
  });

  test('backgrounded swapTrack fires bgplay attempt + ok log after loadeddata', async () => {
    const { hook, shadow } = (function setupIsolated() {
      const s = makeAudio() as HTMLAudioElement & { dispatch: (event: string) => void };
      const a = makeAudio() as HTMLAudioElement & { dispatch: (event: string) => void };
      a.src = 'https://example.com/music.mp3';
      const musicPausedRef = { current: false };
      const musicHoldRef = { current: false };
      const musicOffRef = { current: false };
      const advanceRef = { current: vi.fn() };
      vi.mocked(createBlessedMusicPlayer).mockReturnValue(s);
      const h = renderHook(
        () => useMusicHandoff({
          enabled: true, isPaused: false, isMuted: false, volume: 0.25,
          musicPausedRef, musicHoldRef, musicOffRef, advanceRef,
        }),
        { initialProps: {} },
      );
      act(() => {
        h.result.current.primeShadow(a);
        h.result.current.swapTrack(a.src);
        visibilityState = 'hidden';
        document.dispatchEvent(new Event('visibilitychange'));
      });
      return { hook: h, shadow: s };
    })();

    vi.mocked(console.info).mockClear();

    // Simulate the advance path: swap to a fresh track while backgrounded.
    // Non-Firebase URL → no HEAD check, synchronous through applyBucket → point().
    act(() => {
      hook.result.current.swapTrack('https://example.com/new-track.mp3');
    });

    // load() was called; simulate loadeddata firing.
    act(() => { (shadow as any).dispatch('loadeddata'); });
    // Flush the play() promise microtask.
    await act(async () => { await Promise.resolve(); });

    const logs = vi.mocked(console.info).mock.calls.map((c: any[]) => c[0] as string);
    expect(logs.some((l) => l.includes('[HANDOFF/bgplay attempt]'))).toBe(true);
    expect(logs.some((l) => /"readyState":\s?\d/.test(l))).toBe(true);
    expect(logs.some((l) => /"networkState":\s?\d/.test(l))).toBe(true);
    expect(shadow.play).toHaveBeenCalled();
    expect(logs.some((l) => l.includes('[HANDOFF/bgplay ok]'))).toBe(true);

    hook.unmount();
  });

  test('bgplay stall: loadeddata never fires → timeout logs stall + still attempts play', async () => {
    vi.useFakeTimers();
    try {
      const { hook, shadow } = (function setupIsolated() {
        const s = makeAudio() as HTMLAudioElement & { dispatch: (event: string) => void };
        const a = makeAudio() as HTMLAudioElement & { dispatch: (event: string) => void };
        a.src = 'https://example.com/music.mp3';
        const musicPausedRef = { current: false };
        const musicHoldRef = { current: false };
        const musicOffRef = { current: false };
        const advanceRef = { current: vi.fn() };
        vi.mocked(createBlessedMusicPlayer).mockReturnValue(s);
        const h = renderHook(
          () => useMusicHandoff({
            enabled: true, isPaused: false, isMuted: false, volume: 0.25,
            musicPausedRef, musicHoldRef, musicOffRef, advanceRef,
          }),
          { initialProps: {} },
        );
        act(() => {
          h.result.current.primeShadow(a);
          h.result.current.swapTrack(a.src);
          visibilityState = 'hidden';
          document.dispatchEvent(new Event('visibilitychange'));
        });
        return { hook: h, shadow: s };
      })();

      vi.mocked(console.info).mockClear();
      vi.mocked(shadow.play).mockClear();

      // Swap while backgrounded — this registers loadeddata + arms the stall timer.
      act(() => { hook.result.current.swapTrack('https://example.com/new-track.mp3'); });

      // Do NOT dispatch loadeddata — simulate a dead-CDN / iOS-throttled load.
      // Fast-forward past the timeout ceiling.
      act(() => { vi.advanceTimersByTime(5000); });
      await act(async () => { await Promise.resolve(); });

      const logs = vi.mocked(console.info).mock.calls.map((c: any[]) => c[0] as string);
      expect(logs.some((l) => l.includes('[HANDOFF/bgplay stall]'))).toBe(true);
      expect(logs.some((l) => l.includes('[HANDOFF/bgplay attempt]') && l.includes('"stalled":true'))).toBe(true);
      expect(shadow.play).toHaveBeenCalledTimes(1);

      hook.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  test('runaway guard: 3rd consecutive shadow error stops advancing + logs giveup', () => {
    const { shadow, advance, unmount } = setup();
    advance.mockClear();
    vi.mocked(console.info).mockClear();

    act(() => { (shadow as any).dispatch('error'); }); // 1st: advance
    act(() => { (shadow as any).dispatch('error'); }); // 2nd: advance
    act(() => { (shadow as any).dispatch('error'); }); // 3rd: giveup

    expect(advance).toHaveBeenCalledTimes(2);
    const logs = vi.mocked(console.info).mock.calls.map((c: any[]) => c[0] as string);
    expect(logs.some((l) => l.includes('[HANDOFF/shadow giveup]'))).toBe(true);

    // A 4th error stays inert — the giveup latch holds.
    act(() => { (shadow as any).dispatch('error'); });
    expect(advance).toHaveBeenCalledTimes(2);

    unmount();
  });

  test('runaway guard reset: a successful ended between errors clears the counter', () => {
    const { shadow, advance, unmount } = setup();
    advance.mockClear();

    act(() => { (shadow as any).dispatch('error'); }); // 1st error → advance
    act(() => { (shadow as any).dispatch('error'); }); // 2nd error → advance
    act(() => { (shadow as any).dispatch('ended'); }); // ended → advance + reset
    act(() => { (shadow as any).dispatch('error'); }); // counter reset → advance
    act(() => { (shadow as any).dispatch('error'); }); // 2nd error post-reset → advance

    // 2 errors + 1 ended + 2 errors = 5 advances, no giveup.
    expect(advance).toHaveBeenCalledTimes(5);

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

  // Debounce in useMusicHandoff before a slider change re-points the shadow.
  const REPICK_SETTLE_MS = 400 + 60;

  test('moving the slider re-points the shadow at the matching bucket', async () => {
    // Regression: the bucket used to be chosen only inside swapTrack, so it was
    // frozen at whatever the slider read when the track attached. Moving the
    // slider changed in-app volume (Web Audio gain) but left background volume
    // stuck, because loudness is baked into the file — element.volume is a
    // no-op on iOS.
    const QUIET_VARIANT_URL = 'https://firebasestorage.googleapis.com/v0/b/goarrive.appspot.com/o/music_cache%2Fchill%2Fgain_005%2Ftrack_10.mp3?alt=media';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
    const { hook, shadow } = setupPicker(0.25); // sliderPct 50 → bucket 0.25

    act(() => { hook.result.current.swapTrack(FIREBASE_URL); });
    await act(async () => { await Promise.resolve(); });
    expect(shadow.src).toBe(VARIANT_URL);

    // Member drags to 10%: volume = 0.1² = 0.01 → sliderPct 10 → bucket 0.05.
    // rerender() already wraps in act(); nesting it inside an async act()
    // swallows the passive-effect flush that schedules the debounce.
    hook.rerender({ volume: 0.01 });
    await new Promise((r) => setTimeout(r, REPICK_SETTLE_MS));
    await act(async () => { await Promise.resolve(); });

    expect(shadow.src).toBe(QUIET_VARIANT_URL);
    hook.unmount();
  });

  test('slider movement inside the same bucket does not churn the shadow src', async () => {
    // Every src swap costs the shadow its buffer, which is what makes the hide
    // seam audible — so only cross-boundary movement may re-point it.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
    const { hook, shadow } = setupPicker(0.25); // sliderPct 50 → bucket 0.25

    act(() => { hook.result.current.swapTrack(FIREBASE_URL); });
    await act(async () => { await Promise.resolve(); });
    expect(shadow.src).toBe(VARIANT_URL);
    const loadCallsAfterAttach = vi.mocked(shadow.load).mock.calls.length;

    // sliderPct 55 → gain 0.3025 → still nearest 0.25, same bucket.
    hook.rerender({ volume: 0.3025 });
    await new Promise((r) => setTimeout(r, REPICK_SETTLE_MS));
    await act(async () => { await Promise.resolve(); });

    expect(shadow.src).toBe(VARIANT_URL);
    expect(vi.mocked(shadow.load).mock.calls.length).toBe(loadCallsAfterAttach);
    hook.unmount();
  });

  test('a slider change landing after backgrounding must not cut the live shadow', async () => {
    // The shadow IS the audible element once backgrounded, so pausing it and
    // reloading a new src would stop the music dead. A slider move followed by
    // pressing home inside the debounce window lands exactly here — the
    // member's normal "set the volume, then leave" gesture.
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true } as Response);
    const { hook, shadow } = setupPicker(0.25);

    act(() => { hook.result.current.swapTrack(FIREBASE_URL); });
    await act(async () => { await Promise.resolve(); });
    expect(shadow.src).toBe(VARIANT_URL);

    // Move the slider, then background before the debounce fires.
    hook.rerender({ volume: 0.01 });
    visibilityState = 'hidden';
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    const pauseCallsAtHandoff = vi.mocked(shadow.pause).mock.calls.length;

    await new Promise((r) => setTimeout(r, REPICK_SETTLE_MS));
    await act(async () => { await Promise.resolve(); });

    // src untouched and the live element never paused: music keeps playing.
    expect(shadow.src).toBe(VARIANT_URL);
    expect(vi.mocked(shadow.pause).mock.calls.length).toBe(pauseCallsAtHandoff);
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
