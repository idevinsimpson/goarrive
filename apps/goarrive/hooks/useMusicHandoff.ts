/**
 * useMusicHandoff — iOS background-music handoff adapter.
 *
 * Problem: workout music runs through the shared Web Audio graph so the
 * in-player slider can control gain (element.volume is a no-op on iOS). But
 * iOS suspends the AudioContext the instant Safari backgrounds, so anything
 * flowing through the graph goes silent when the member switches apps.
 *
 * Fix: run a second `<audio>` element in parallel — the "shadow" — that is
 * NEVER wired to the graph. It uses the native HTMLAudioElement pipeline,
 * which iOS keeps alive via MediaSession through backgrounding. On hide, we
 * hand playback off from the audible (graph-wired) element to the shadow.
 * On return, we resume the AudioContext, wait for state==='running', then
 * swap playback back to the graph so the slider works again.
 *
 * The hide-flip MUST be synchronous — iOS gives hidden-page JS about one
 * second of grace after backgrounding, and any await inside the handler
 * risks running after the tab is frozen.
 *
 * Three variants are compared on-device via ?handoff=v1|v2|v3:
 *   v1 (mute-flip): shadow plays muted alongside the audible in foreground;
 *     on hide, `shadow.muted = false; audible.muted = true` — a property
 *     change is instant.
 *   v2 (play-on-hide): shadow is paused in foreground (with src pre-loaded
 *     and a gesture-warmed play() history); on hide, `shadow.currentTime =
 *     audible.currentTime; shadow.play(); audible.pause()`.
 *   v3 (blessed-shadow): a gesture-blessed native shadow stays outside the
 *     Web Audio graph and takes over synchronously on hide.
 *
 * off (default): no shadow. The adapter still installs the pre-adapter
 * resume-on-return behavior (byte-for-byte parity with the handler that
 * used to live in useWorkoutMusic:500-521), so desktop Chrome, Android, and
 * Firefox behave exactly as they did before.
 *
 * Design invariants (from the audio-team PM spec, don't relax):
 *   - Single source of truth for playback position: the controller owns it.
 *     Only ever yank the MUTED element's `currentTime` to match; never yank
 *     the audible element (introduces echo).
 *   - Exclusive-audible: only one of {audible, shadow} produces sound at any
 *     moment. Both playing unmuted = echo bug.
 *   - MediaSession is the ONLY OS control surface. Lock-screen pause flows
 *     through React state → useWorkoutMusic → this adapter propagates the
 *     state to the shadow when the shadow is the audible one.
 *   - Return seam order: resume graph first, wait for running, THEN silence
 *     the shadow. Never silence the shadow before the graph is running or
 *     the member hears a gap.
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { Platform } from 'react-native';
import { getAudioContextState, resumeAudioGraph, createBlessedMusicPlayer, subscribeMainCtxStatechange } from './useWorkoutTTS';
import { getLivenessCtxState } from './usePipCanvasStream';
import {
  getMusicHandoffVariant,
  type MusicHandoffVariant,
} from '../utils/musicHandoffVariant';
import { pushHandoffLog } from '../utils/handoffLog';

function log(...args: any[]) {
  const line = args.map(a => typeof a === 'string' ? a : JSON.stringify(a)).join(' ');
  console.info(line);
  pushHandoffLog(line);
}

// ── Volume-bucket picker ──────────────────────────────────────────────────────
// Maps a slider percentage (0..100) through slider² to the nearest pre-rendered
// gain bucket [1.0, 0.5, 0.25, 0.12, 0.05]. Used to select the GCS variant
// URI for the iOS shadow <audio> element.

const PICKER_BUCKETS = [1.0, 0.5, 0.25, 0.12, 0.05];

/** Maps sliderPct (0..100) → slider² → nearest gain bucket. */
export function pickNearestBucket(sliderPct: number): number {
  const gain = (sliderPct / 100) ** 2;
  return PICKER_BUCKETS.reduce((best, b) =>
    Math.abs(b - gain) < Math.abs(best - gain) ? b : best
  );
}

/**
 * Transforms a full-volume Firebase Storage URL into the variant URL for the
 * given gain bucket. Returns null if the URL is not a recognised music_cache
 * Firebase Storage URL (e.g. test/dev URLs).
 */
export function buildVariantGcsUri(fullVolumeUri: string, bucket: number): string | null {
  try {
    const m = fullVolumeUri.match(
      /^(https:\/\/firebasestorage\.googleapis\.com\/v0\/b\/[^/]+\/o\/)([^?]+)(\?.*)?$/
    );
    if (!m) return null;
    const decodedPath = decodeURIComponent(m[2]);
    const pathMatch = decodedPath.match(/^(music_cache\/[^/]+\/)(track_\d+\.mp3)$/);
    if (!pathMatch) return null;
    const gainLabel = String(Math.round(bucket * 100)).padStart(3, '0');
    const variantPath = `${pathMatch[1]}gain_${gainLabel}/${pathMatch[2]}`;
    return `${m[1]}${encodeURIComponent(variantPath)}${m[3] ?? '?alt=media'}`;
  } catch {
    return null;
  }
}

/** HEAD-checks a URI; returns true if the server responds 2xx. */
async function headCheck(uri: string): Promise<boolean> {
  try {
    const res = await fetch(uri, { method: 'HEAD' });
    return res.ok;
  } catch {
    return false;
  }
}

// How often we nudge the muted element's position to match the audible one.
// Longer = less CPU, more drift on hide; shorter = tighter sync, more work.
// 1s keeps drift under ~1s worst case, which is inaudible when we swap.
const POSITION_SYNC_MS = 1000;

// Debounce before re-pointing the shadow at a new gain bucket when the member
// moves the slider. Every src swap costs the element its buffer, so we wait for
// the slider to settle rather than swapping on every pixel of travel.
const BUCKET_REPICK_DEBOUNCE_MS = 400;

// How much buffered runway the paused v3 shadow must hold ahead of the live
// playhead before we leave it alone. Below this we re-seek to refill.
const SHADOW_BUFFER_MARGIN_S = 5;

// Minimum gap between v3 warm-up seeks. Without it the tick re-seeks while the
// previous fetch is still in flight, so the buffer never fills — the treadmill
// that left the shadow cold at the hide seam.
const SHADOW_SEEK_COOLDOWN_MS = 4000;

/**
 * True if `pos` sits inside one of the element's buffered ranges with at least
 * `margin` seconds still buffered ahead of it.
 */
function hasBufferedRunway(el: HTMLMediaElement, pos: number, margin: number): boolean {
  try {
    const b = el.buffered;
    for (let i = 0; i < b.length; i++) {
      if (pos >= b.start(i) && pos + margin <= b.end(i)) return true;
    }
  } catch {}
  return false;
}

// How long we wait after resumeAudioGraph() before falling back to the
// user-tap retry path. 3s covers the observed suspended→running latency on
// iOS Safari devices (verified during device spike A/B/C).
const RETURN_TIMEOUT_MS = 3000;

// Ceiling on the loadeddata wait before we attempt play() anyway. A silent
// no-attempt path is the one outcome this probe cannot afford — an empty log
// is indistinguishable from "handler never fired" on device.
const BGPLAY_LOADEDDATA_TIMEOUT_MS = 4000;
// Consecutive shadow errors we tolerate before disabling background advance.
// Prevents burning the playlist in seconds if backgrounded play() is refused
// and the next-src load errors immediately (error -> advance -> error -> ...).
const BGPLAY_MAX_CONSECUTIVE_ERRORS = 3;
const bgplayConsecutiveErrors = new WeakMap<HTMLAudioElement, number>();
const bgplayGivenUp = new WeakMap<HTMLAudioElement, boolean>();

/**
 * First-ever backgrounded fresh-src play() attempt on the v3 shadow. iOS may
 * refuse a play() that follows a src change outside a user gesture — load()
 * resets readyState to HAVE_NOTHING and iOS treats that as new-media rather
 * than a continuation. We log readyState + networkState alongside the promise
 * outcome so a policy refusal (NotAllowedError) is distinguishable from a
 * load stall (readyState stuck at HAVE_NOTHING / networkState NETWORK_LOADING).
 *
 * Waits for `loadeddata` before calling play() so the play isn't racing an
 * incomplete load — but only for BGPLAY_LOADEDDATA_TIMEOUT_MS. If loadeddata
 * never fires (dead CDN, iOS deprioritizing a backgrounded tab), we log the
 * stall explicitly and still attempt play() so the log is never silent.
 */
function attemptBgPlay(shadow: HTMLAudioElement): void {
  let attempted = false;
  let stallTimer: ReturnType<typeof setTimeout> | null = null;
  const runPlay = (stalled: boolean) => {
    if (attempted) return;
    attempted = true;
    if (stallTimer !== null) { clearTimeout(stallTimer); stallTimer = null; }
    const snap = {
      readyState: shadow.readyState,
      networkState: shadow.networkState,
      srcLen: shadow.src?.length ?? 0,
      stalled,
    };
    log('[HANDOFF/bgplay attempt]', snap);
    try {
      const p = shadow.play();
      if (p && typeof p.then === 'function') {
        p.then(() => log('[HANDOFF/bgplay ok]', snap))
         .catch((e: Error) => log('[HANDOFF/bgplay refused]', { ...snap, name: e?.name, message: e?.message }));
      }
    } catch (e) {
      log('[HANDOFF/bgplay throw]', { ...snap, err: String(e) });
    }
  };
  const onLoaded = () => runPlay(false);
  try {
    shadow.addEventListener('loadeddata', onLoaded, { once: true } as AddEventListenerOptions);
  } catch {
    const wrapped = () => {
      shadow.removeEventListener('loadeddata', wrapped);
      onLoaded();
    };
    shadow.addEventListener('loadeddata', wrapped);
  }
  stallTimer = setTimeout(() => {
    if (attempted) return;
    log('[HANDOFF/bgplay stall]', {
      readyState: shadow.readyState,
      networkState: shadow.networkState,
      srcLen: shadow.src?.length ?? 0,
      timeoutMs: BGPLAY_LOADEDDATA_TIMEOUT_MS,
    });
    runPlay(true);
  }, BGPLAY_LOADEDDATA_TIMEOUT_MS);
}

export interface UseMusicHandoffOptions {
  /** Same as useWorkoutMusic.enabled — hook stays inert if false. */
  enabled: boolean;
  /** Master workout pause state; propagates to the shadow when backgrounded. */
  isPaused: boolean;
  /** Master mute state; propagates to whichever element is currently audible. */
  isMuted: boolean;
  /** Effective music-only volume (0..1); applied to the native v3 shadow. */
  volume: number;
  /** Music-pane ref: true while user manually paused music via the panel. */
  musicPausedRef: MutableRefObject<boolean>;
  /** Music-hold ref: true while intro announcement is holding music silent. */
  musicHoldRef: MutableRefObject<boolean>;
  /** Music-off ref: true if user turned music off for the session. */
  musicOffRef: MutableRefObject<boolean>;
  /**
   * Playlist advance callback. Invoked from the v3 shadow's own 'ended' and
   * 'error' handlers while backgrounded — the audible's ended listener in
   * useWorkoutMusic cannot fire when the audible is paused by the hide seam,
   * so nothing else moves the playlist forward between hide and return.
   * Optional so tests without an advance path can omit it.
   */
  advanceRef?: MutableRefObject<() => void>;
  /**
   * True while a PiP session is active. When PiP is on, the canvas hook's
   * merged MediaStream is already carrying music (via getPipAudioStream's
   * MediaStreamAudioDestinationNode) and Safari keeps that stream audible
   * across backgrounding on its own. If the hide seam ALSO starts the
   * shadow, the member hears two sources offset by stream latency — a
   * beat-echo. Skipping the hide seam when this ref is true keeps the PiP
   * stream as the sole background source. The return seam is a no-op in
   * this case because inBackgroundRef stays false. Optional; omit for
   * non-PiP callers.
   */
  isPiPRef?: MutableRefObject<boolean>;
}

export interface UseMusicHandoffReturn {
  /**
   * Attach the shadow element to the audible one. MUST be called
   * synchronously inside the Play tap gesture so the shadow's play() is
   * legal on iOS. Safe to call when variant === 'off' — no-ops.
   */
  primeShadow: (audibleEl: HTMLAudioElement) => void;
  /**
   * Mirror the audible's current track onto the shadow. Called from
   * useWorkoutMusic.attachTrack after el.src is set + loaded.
   */
  swapTrack: (url: string) => void;
  /** Release the shadow. Called from useWorkoutMusic.stopMusic. */
  teardownShadow: () => void;
}

export function useMusicHandoff(opts: UseMusicHandoffOptions): UseMusicHandoffReturn {
  const { enabled, isPaused, isMuted, volume, musicPausedRef, musicHoldRef, musicOffRef, advanceRef, isPiPRef } = opts;

  const variantRef = useRef<MusicHandoffVariant>('off');
  const audibleElRef = useRef<HTMLAudioElement | null>(null);
  const shadowElRef = useRef<HTMLAudioElement | null>(null);
  // v3 only: a second blessed element (never wired to the Web Audio graph)
  const shadowMusicElRef = useRef<HTMLAudioElement | null>(null);
  const currentUrlRef = useRef<string | null>(null);
  // Gain bucket currently loaded into the shadow, so slider movement only pays
  // for an src swap when it actually crosses a bucket boundary.
  const currentBucketRef = useRef<number | null>(null);
  const lastShadowSeekAtRef = useRef(0);
  const isMutedRef = useRef(isMuted);
  const isPausedRef = useRef(isPaused);
  const volumeRef = useRef(volume);
  const enabledRef = useRef(enabled);
  // True while we are handed off (background); shadow is the audible master.
  const inBackgroundRef = useRef(false);
  // Cleanup for the pointerdown listener we install if the graph never
  // resumes within RETURN_TIMEOUT_MS (test case C fallback).
  const tapRetryCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => { volumeRef.current = volume; }, [volume]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Resolve variant once per session. Query param wins; localStorage persists
  // the choice across page navigations during the device spike.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    variantRef.current = getMusicHandoffVariant();
    log('[HANDOFF/init]', JSON.stringify({ variant: variantRef.current }));
  }, []);

  // ── Shadow lifecycle ──────────────────────────────────────────────────────

  const primeShadow = useCallback((audibleEl: HTMLAudioElement) => {
    audibleElRef.current = audibleEl;
    if (variantRef.current === 'off') return;
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    if (variantRef.current === 'v3') {
      if (shadowMusicElRef.current) return; // already primed
      // createBlessedMusicPlayer runs blessElement inside the gesture stack —
      // primeShadow is called from startMusic inside useWorkoutMusic which is
      // triggered by the Start tap, so the gesture is still live here.
      const shadow = createBlessedMusicPlayer();
      if (!shadow) {
        log('[HANDOFF/prime v3]', { hasShadow: false });
        return;
      }
      shadow.muted = true;
      shadow.volume = volumeRef.current;
      // Buffer eagerly. The v3 shadow never plays until the hide seam, so
      // without this mobile Safari keeps it at metadata-only and the seek +
      // play() at hide costs a range request and a decode — audible as a
      // ~1s silence when the member leaves the app. The position tick below
      // keeps the buffered window near the live playhead.
      try { shadow.preload = 'auto'; } catch {}
      // Shadow drives advance while backgrounded — audible's 'ended' handler
      // in useWorkoutMusic cannot fire when the hide seam has paused it, so
      // without these the playlist stalls at the current track boundary.
      // Identity guard matches audible's pattern (musicElRef.current !== el).
      shadow.addEventListener('ended', () => {
        if (shadowMusicElRef.current !== shadow) return;
        if (!inBackgroundRef.current) return;
        // A track that plays to completion is proof that background advance is
        // working — reset the runaway counter so a later isolated load error
        // isn't judged against ancient failures.
        bgplayConsecutiveErrors.set(shadow, 0);
        log('[HANDOFF/shadow ended]', { pos: shadow.currentTime, src: shadow.src.slice(-40) });
        advanceRef?.current?.();
      });
      shadow.addEventListener('error', () => {
        if (shadowMusicElRef.current !== shadow) return;
        if (!inBackgroundRef.current) return;
        if (bgplayGivenUp.get(shadow)) return;
        const failures = (bgplayConsecutiveErrors.get(shadow) ?? 0) + 1;
        bgplayConsecutiveErrors.set(shadow, failures);
        log('[HANDOFF/shadow error]', { pos: shadow.currentTime, hasSrc: !!shadow.src, failures });
        if (failures >= BGPLAY_MAX_CONSECUTIVE_ERRORS) {
          bgplayGivenUp.set(shadow, true);
          log('[HANDOFF/shadow giveup]', { failures, max: BGPLAY_MAX_CONSECUTIVE_ERRORS });
          return;
        }
        advanceRef?.current?.();
      });
      shadowMusicElRef.current = shadow;
      log('[HANDOFF/prime v3]', { hasShadow: !!shadowMusicElRef.current });
      return;
    }

    if (shadowElRef.current) return; // already primed

    const shadow: HTMLAudioElement = new (window as any).Audio();
    // crossOrigin must be set BEFORE src so the Mubert/Storage fetch honors
    // CORS. Matches useWorkoutMusic.startMusic's ordering exactly.
    try { (shadow as any).crossOrigin = 'anonymous'; } catch {}
    shadow.loop = false;
    // v1 plays muted in foreground; v2 stays paused until hide.
    shadow.muted = true;
    shadow.volume = 1.0; // volume slider drives the graph, not the shadow
    // Prime the audio session inside the gesture — even a src-less play()
    // that rejects counts toward Safari's "this page has active audio"
    // heuristic, which is what makes the later hide-flip legal.
    try { shadow.play().catch(() => {}); } catch {}
    shadowElRef.current = shadow;
    log('[HANDOFF/prime]', JSON.stringify({ variant: variantRef.current }));
  }, []);

  /**
   * Point the shadow at the pre-rendered gain variant matching the CURRENT
   * slider position.
   *
   * The loudness is baked into the file — `element.volume` is a no-op on iOS,
   * which is the whole reason the buckets exist — so the only way to change
   * background loudness is to change which file the shadow holds. That makes
   * this the single place volume is actually applied, and it must run on slider
   * movement as well as on track change.
   *
   * `force` re-applies even when the bucket is unchanged; used on track change,
   * where the src has to move regardless of volume.
   */
  const applyBucket = useCallback((url: string, force: boolean) => {
    const variant = variantRef.current;
    if (variant === 'off') return;
    const shadow = variant === 'v3' ? shadowMusicElRef.current : shadowElRef.current;
    if (!shadow) return;

    // opts.volume = slider² (passed as volume*volume from useWorkoutMusic).
    const sliderPct = Math.sqrt(volumeRef.current) * 100;
    const gainEffective = (sliderPct / 100) ** 2;
    const bucketPicked = pickNearestBucket(sliderPct);
    // Swapping src throws away the buffer we spent the last tick building, so
    // don't pay that cost when the slider hasn't crossed a bucket boundary.
    if (!force && currentBucketRef.current === bucketPicked) return;
    // While backgrounded the shadow IS the audible element, so pausing it and
    // reloading a new src would cut the music dead. A slider move followed by
    // backgrounding inside the debounce window lands exactly here — which is
    // the member's normal "set the volume, then leave" gesture. Defer instead:
    // the next slider move or track change re-applies once we're foreground.
    // `force` (a genuine track change) must still move the src.
    if (!force && inBackgroundRef.current) return;

    // Foreground behavior: v1 plays muted, v2/v3 stay paused.
    const resumeIfV1 = () => {
      if (variant === 'v1' && !isPausedRef.current) {
        try { shadow.play().catch(() => {}); } catch {}
      }
    };
    const point = (finalUri: string) => {
      try { shadow.pause(); shadow.src = finalUri; shadow.load(); } catch {}
      currentBucketRef.current = bucketPicked;
      // load() resets the element to 0 with an empty buffer; clear the cooldown
      // so the warm-up tick may re-seek to the live playhead immediately.
      lastShadowSeekAtRef.current = 0;
      resumeIfV1();
      // Background re-point on v3: audible is paused and silent, so if we
      // don't play the shadow after src change the member hears nothing after
      // an advance(). The upstream guard `!force && inBackgroundRef.current`
      // returns before we get here on volume-driven re-points, so this only
      // fires on genuine track changes (force=true) — no conflict with #285.
      if (variant === 'v3' && force && inBackgroundRef.current) {
        attemptBgPlay(shadow);
      }
    };

    const variantUri = buildVariantGcsUri(url, bucketPicked);
    if (!variantUri) {
      // Non-Firebase-Storage URL (dev/test) — mirror as-is, no HEAD check.
      point(url);
      return;
    }

    // Async: HEAD-check variant, fall back to full-volume on 404 (first-play case).
    void headCheck(variantUri).then((exists) => {
      // Staleness guards: a newer swapTrack updates currentUrlRef synchronously,
      // and the member may have moved the slider again while this was in flight.
      if (currentUrlRef.current !== url) return;
      if (pickNearestBucket(Math.sqrt(volumeRef.current) * 100) !== bucketPicked) return;
      // Re-check: the page may have backgrounded while this HEAD was in flight,
      // making the shadow audible. Same reasoning as the synchronous guard.
      if (!force && inBackgroundRef.current) return;
      const finalUri = exists ? variantUri : url;
      point(finalUri);
      log('[VOLUME_BUCKET]', {
        sliderDisplay: sliderPct, gainEffective, bucketPicked,
        sourceUri: finalUri, fallbackUsed: !exists,
      });
    });
  }, []);

  const swapTrack = useCallback((url: string) => {
    currentUrlRef.current = url;
    if (variantRef.current === 'off') return;
    // New track: the src must move even if the bucket is identical.
    currentBucketRef.current = null;
    applyBucket(url, true);
    if (variantRef.current === 'v3') log('[HANDOFF/swap v3]', { url: url.slice(0, 60) });
  }, [applyBucket]);

  // ── Slider → bucket re-pick ────────────────────────────────────────────────
  // Without this the bucket is chosen once, when the track attaches, and then
  // frozen: moving the slider updates volumeRef and the in-app Web Audio gain,
  // but never re-points the shadow. In-app volume therefore tracks the slider
  // while background volume stays stuck at whatever the slider read at attach,
  // so leaving the app jumps to an unrelated level. Debounced because each swap
  // costs the shadow its buffer.
  useEffect(() => {
    if (!enabled) return;
    if (variantRef.current === 'off') return;
    const url = currentUrlRef.current;
    if (!url) return;
    const t = window.setTimeout(() => applyBucket(url, false), BUCKET_REPICK_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [volume, enabled, applyBucket]);

  const teardownShadow = useCallback(() => {
    // v3: tear down the blessed shadow music element
    if (variantRef.current === 'v3') {
      const shadow = shadowMusicElRef.current;
      if (shadow) {
        try { shadow.pause(); shadow.src = ''; shadow.load(); } catch {}
        shadowMusicElRef.current = null;
      }
      log('[HANDOFF/teardown v3]');
    }

    const shadow = shadowElRef.current;
    shadowElRef.current = null;
    audibleElRef.current = null;
    currentUrlRef.current = null;
    currentBucketRef.current = null;
    lastShadowSeekAtRef.current = 0;
    inBackgroundRef.current = false;
    if (tapRetryCleanupRef.current) {
      tapRetryCleanupRef.current();
      tapRetryCleanupRef.current = null;
    }
    if (!shadow) return;
    try {
      shadow.pause();
      shadow.currentTime = 0;
      shadow.removeAttribute('src');
      shadow.load();
    } catch {}
  }, []);

  // ── Position sync (foreground only) ───────────────────────────────────────
  // Keep the muted element's currentTime aligned with the audible one so the
  // hide-flip doesn't jump. Never runs when backgrounded — the shadow is
  // master then and yanking it would introduce echo on return.

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (variantRef.current === 'off') return;
    const tick = () => {
      const audible = audibleElRef.current;
      // v3's shadow lives in shadowMusicElRef, not shadowElRef. Before this
      // was variant-aware the v3 shadow was never synced at all: it sat
      // paused at position 0 with an unbuffered src, so the hide seam's
      // `shadow.currentTime = audible.currentTime` was a cold seek into the
      // middle of a track. Keeping it near the live playhead means the seek
      // at hide lands inside an already-buffered range.
      const shadow =
        variantRef.current === 'v3' ? shadowMusicElRef.current : shadowElRef.current;
      if (!audible || !shadow) return;
      if (inBackgroundRef.current) return;
      if (document.visibilityState !== 'visible') return;

      // v1's shadow is PLAYING, so it advances on its own and only needs a
      // nudge when it genuinely drifts. Threshold avoids audible micro-glitches.
      if (variantRef.current !== 'v3') {
        try {
          if (Math.abs(shadow.currentTime - audible.currentTime) > 0.1) {
            shadow.currentTime = audible.currentTime;
          }
        } catch {}
        return;
      }

      // v3's shadow is PAUSED, so it never advances: drift against the audible
      // grows by a full second every tick and a drift test is true every time.
      // Seeking on each tick restarts buffering before the previous fetch lands,
      // so the element stays permanently cold — the opposite of warming it.
      // Instead, seek only when the live playhead is about to run past what the
      // shadow has actually buffered, and otherwise leave the fetch alone.
      try {
        if (shadow.seeking) return;
        const pos = audible.currentTime;
        if (hasBufferedRunway(shadow, pos, SHADOW_BUFFER_MARGIN_S)) return;
        if (Date.now() - lastShadowSeekAtRef.current < SHADOW_SEEK_COOLDOWN_MS) return;
        lastShadowSeekAtRef.current = Date.now();
        shadow.currentTime = pos;
      } catch {}
    };
    const interval = setInterval(tick, POSITION_SYNC_MS);
    return () => clearInterval(interval);
  }, []);

  // ── Lock-screen pause propagation (background only) ──────────────────────
  // While backgrounded, the shadow is the audible element. React state
  // isPaused updates flow through useWorkoutMusic's own effect and pause the
  // audible element — but the audible is silent then, so we also need to
  // pause/resume the shadow so lock-screen pause actually silences audio.
  // In foreground, useWorkoutMusic handles the audible; the mirror listeners
  // attached in primeShadow keep the shadow in sync.

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    if (variantRef.current === 'off') return;
    const shadow = variantRef.current === 'v3'
      ? shadowMusicElRef.current
      : shadowElRef.current;
    if (!shadow) return;
    if (!inBackgroundRef.current) return;
    if (musicOffRef.current || musicHoldRef.current) return;
    if (isPaused) {
      try { shadow.pause(); } catch {}
    } else {
      try { shadow.play().catch(() => {}); } catch {}
    }
  }, [isPaused, musicOffRef, musicHoldRef]);

  // ── Master mute propagation ──────────────────────────────────────────────
  // Whichever element is currently audible has to honor isMuted. In
  // foreground: audible follows isMuted, shadow stays muted (v1) or paused
  // (v2). In background: shadow follows isMuted, audible is muted or paused.

  useEffect(() => {
    if (variantRef.current === 'off') return;
    const variant = variantRef.current;
    const shadow = variant === 'v3'
      ? shadowMusicElRef.current
      : shadowElRef.current;
    if (!shadow) return;
    if (variant === 'v3') shadow.volume = volume;
    if (!inBackgroundRef.current) {
      // Foreground: every shadow stays silent; v2/v3 are also paused.
      shadow.muted = true;
      return;
    }
    // Background: shadow follows isMuted.
    shadow.muted = isMuted;
  }, [isMuted, volume]);

  // ── Visibility handling ──────────────────────────────────────────────────
  // Owns visibilitychange for all variants. The `off` branch is a byte-for-
  // byte reimplementation of the resume handler that used to live at
  // useWorkoutMusic:500-521 — same event set (visibilitychange + pageshow +
  // focus), same guard conditions (paused/hold/off/visibilityState), same
  // resume + play() call order. Verified on desktop Chrome tab-switch.

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const swapBackToGraph = () => {
      const audible = audibleElRef.current;
      const variant = variantRef.current;

      if (variant === 'v3') {
        const shadow = shadowMusicElRef.current;
        if (!audible || !shadow) return;
        const shadowPos = shadow.currentTime;
        const audiblePos = audible.currentTime;
        try { audible.currentTime = shadowPos; } catch {}
        audible.muted = isMutedRef.current;
        if (isPausedRef.current || musicHoldRef.current || musicOffRef.current) {
          try { audible.pause(); } catch {}
        } else {
          try { audible.play().catch(() => {}); } catch {}
        }
        try { shadow.pause(); } catch {}
        inBackgroundRef.current = false;
        log('[HANDOFF/swap-back v3]', JSON.stringify({
          pos: audiblePos,
          shadow: shadowPos,
          drift: Number((shadowPos - audiblePos).toFixed(3)),
        }));
        return;
      }

      const shadow = shadowElRef.current;
      if (!audible || !shadow) return;
      const shadowPos = shadow.currentTime;
      const audiblePos = audible.currentTime;
      // Master position lives on the shadow while backgrounded — yank the
      // muted (audible) side to match, THEN unmute. Never yank the audible
      // while it is audible (echo).
      try { audible.currentTime = shadowPos; } catch {}
      if (variant === 'v1') {
        audible.muted = isMutedRef.current;
        shadow.muted = true;
      } else if (variant === 'v2') {
        try { audible.play().catch(() => {}); } catch {}
        try { shadow.pause(); } catch {}
      }
      inBackgroundRef.current = false;
      log('[HANDOFF/swap-back]', JSON.stringify({
        variant,
        pos: audiblePos,
        shadow: shadowPos,
        drift: Number((shadowPos - audiblePos).toFixed(3)),
      }));
    };

    const runReturnSeam = () => {
      const audible = audibleElRef.current;
      const variant = variantRef.current;

      if (variant === 'off' || !inBackgroundRef.current) {
        // Off-branch parity path: same guard conditions as the pre-adapter
        // handler at useWorkoutMusic:500-521.
        if (document.visibilityState !== 'visible') return;
        if (musicPausedRef.current || musicHoldRef.current || musicOffRef.current) return;
        resumeAudioGraph();
        if (audible && audible.src && audible.paused) audible.play().catch(() => {});
        return;
      }

      resumeAudioGraph();
      log('[HANDOFF/visible v3]', JSON.stringify({ state: getAudioContextState() }));

      // Log ctx state at t+0, +500ms, +2s so the device spike (test case C)
      // has evidence of whether resume() succeeds without a user gesture.
      const marks: string[] = [`+0ms=${getAudioContextState()}`];
      const t500 = window.setTimeout(() => {
        marks.push(`+500ms=${getAudioContextState()}`);
      }, 500);
      const t2000 = window.setTimeout(() => {
        marks.push(`+2s=${getAudioContextState()}`);
      }, 2000);

      const deadline = Date.now() + RETURN_TIMEOUT_MS;
      const poll = () => {
        if (getAudioContextState() === 'running') {
          window.clearTimeout(t500);
          window.clearTimeout(t2000);
          log('[HANDOFF/visible]', JSON.stringify({
            variant,
            state: 'running',
            timeline: marks.join(' '),
          }));
          swapBackToGraph();
          return;
        }
        if (Date.now() > deadline) {
          log('[HANDOFF/timeout]', JSON.stringify({
            variant,
            timeline: marks.join(' '),
            note: 'ctx still suspended after 3s — waiting for user tap',
          }));
          // Fallback: shadow stays audible until the next user tap on the
          // page provides a fresh gesture, then we retry the swap.
          const retry = () => {
            window.removeEventListener('pointerdown', retry);
            tapRetryCleanupRef.current = null;
            resumeAudioGraph();
            window.setTimeout(() => {
              if (getAudioContextState() === 'running') swapBackToGraph();
            }, 100);
          };
          window.addEventListener('pointerdown', retry, { once: true });
          tapRetryCleanupRef.current = () => {
            window.removeEventListener('pointerdown', retry);
            tapRetryCleanupRef.current = null;
          };
          return;
        }
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    };

    const runHideSeam = () => {
      // Fires synchronously from the visibilitychange event — no awaits
      // before the mute-flip / play() call. iOS gives us ~1s of grace after
      // backgrounding; anything asynchronous risks running after freeze.
      //
      // Pass-14 instrumentation: every early-return names its skip reason
      // to the COPY LOG so a fired-but-declined seam is distinguishable
      // from a visibilitychange that never fired at all. Without this the
      // pass-13 log's silence on the "no music after leaving with PiP"
      // path (zero HANDOFF/hide lines) is uninterpretable.
      const audible = audibleElRef.current;
      const variant = variantRef.current;
      if (variant === 'off') { pushHandoffLog('[HANDOFF/hide skip variant-off]'); return; }
      if (!audible) { pushHandoffLog('[HANDOFF/hide skip no-audible]'); return; }
      if (!enabledRef.current) { pushHandoffLog('[HANDOFF/hide skip disabled]'); return; }
      if (musicOffRef.current) { pushHandoffLog('[HANDOFF/hide skip music-off]'); return; }
      // Music-hold means the intro is playing; we should NOT start music yet
      // just because the page hid. Same for user-paused / muted.
      if (musicHoldRef.current) { pushHandoffLog('[HANDOFF/hide skip hold]'); return; }
      if (musicPausedRef.current) { pushHandoffLog('[HANDOFF/hide skip paused]'); return; }
      // PiP standdown (non-iOS only): the canvas PiP stream on desktop
      // Safari and Chrome carries our music via a MediaStreamAudioDestination
      // Node, and running the shadow flip here would layer a second
      // latency-offset source under the PiP audio — the beat-echo Devin
      // heard on pass-5. On iOS (pass-10 fork-insensitive fix) the PiP
      // stream is video-only: the hide seam MUST run the shadow so the
      // proven v3 shadow keeps carrying backgrounded music. Skipping
      // standdown on iOS kills both stutter branches without waiting for
      // the A/B discriminator.
      const iOS = typeof navigator !== 'undefined'
        && /iP(hone|od|ad)/.test(navigator.userAgent)
        && !/CriOS|FxiOS|EdgiOS/.test(navigator.userAgent);
      if (isPiPRef?.current && !iOS) {
        pushHandoffLog('[HANDOFF/hide skipped isPiP]');
        return;
      }
      if (isPiPRef?.current && iOS) {
        pushHandoffLog('[HANDOFF/hide iOS: PiP open but standdown skipped — stream is video-only, shadow carries music]');
      }
      const pos = audible.currentTime;

      if (variant === 'v3') {
        const shadow = shadowMusicElRef.current;
        if (!shadow) return;
        // bufferedEnd proves whether the shadow was warm at the seam. If it is
        // at or ahead of pos, play() resumes from memory and the member hears
        // no gap; if it is 0 or behind, the seek is cold and a silence follows.
        let bufferedEnd = -1;
        try {
          bufferedEnd = shadow.buffered.length ? shadow.buffered.end(shadow.buffered.length - 1) : 0;
        } catch {}
        const seamWall = Date.now();
        log('[HANDOFF/hide v3]', JSON.stringify({
          pos: audible.currentTime,
          src: !!shadow.src,
          bufferedEnd,
          warm: bufferedEnd >= audible.currentTime,
        }));
        // SYNCHRONOUS — do NOT await the play() promise; iOS freeze window is ~1s.
        shadow.currentTime = audible.currentTime;
        shadow.muted = isMutedRef.current;
        shadow.volume = volumeRef.current;
        const p = shadow.play();
        if (p) p.catch((err: unknown) => log('[HANDOFF/hide v3 err]', String(err)));
        audible.pause();
        inBackgroundRef.current = true;
        // Pass-14 instrumentation: post-seam autopsy at ~2s. A late-firing
        // timer exposes a frozen page (wall-clock delta will be much more
        // than 2000ms); a normal delta with shadow.paused=true means iOS
        // paused our shadow after we told it to play (media-session
        // competition with the PiP element — the pass-15 fork). Shadow
        // advancing but silent means route/mute/volume; those fields ride
        // the same line so no cross-referencing is needed.
        setTimeout(() => {
          try {
            const wallDelta = Date.now() - seamWall;
            const audibleNow = audibleElRef.current;
            const vs = typeof document !== 'undefined' ? document.visibilityState : 'unknown';
            log('[HANDOFF/autopsy]', JSON.stringify({
              wallDeltaMs: wallDelta,
              shadow: {
                paused: shadow.paused,
                currentTime: Number(shadow.currentTime.toFixed(3)),
                readyState: shadow.readyState,
                muted: shadow.muted,
                volume: Number(shadow.volume.toFixed(3)),
              },
              audible: { paused: audibleNow?.paused ?? null },
              mainCtx: getAudioContextState(),
              livenessCtx: getLivenessCtxState(),
              visState: vs,
            }));
          } catch (err: any) {
            log('[HANDOFF/autopsy err]', String(err?.name || err));
          }
        }, 2000);
        return;
      }

      const shadow = shadowElRef.current;
      if (!shadow) return;
      if (variant === 'v1') {
        // Property change is instant on iOS — no gesture, no await.
        shadow.muted = isMutedRef.current;
        audible.muted = true;
      } else if (variant === 'v2') {
        try { shadow.currentTime = pos; } catch {}
        try { shadow.play().catch(() => {}); } catch {}
        try { audible.pause(); } catch {}
      }
      inBackgroundRef.current = true;
      log('[HANDOFF/hide]', JSON.stringify({
        variant,
        pos: Number(pos.toFixed(3)),
        shadowPlaying: !shadow.paused,
        ctxState: getAudioContextState(),
      }));
    };

    const onVisibilityChange = () => {
      // Pass-18: log every visibilitychange unconditionally so a fired-but-
      // guarded event is distinguishable from an event that never fired at
      // all. Four consecutive pass-14→17 sessions captured zero PiP-leave
      // events; the leading theory is WebKit keeps document 'visible' under
      // active PiP presentation and this handler never runs. Log first, then
      // dispatch.
      const vs = document.visibilityState;
      pushHandoffLog(`[PiP] trigger visibilitychange visState=${vs} bg=${inBackgroundRef.current} pip=${!!isPiPRef?.current}`);
      if (vs === 'visible') {
        runReturnSeam();
      } else {
        runHideSeam();
      }
    };
    // pageshow + focus mirror the pre-adapter handler so bfcache restores and
    // iOS overlay dismissals (call-in overlays, Face ID, etc.) still resume
    // playback. These paths NEVER hide, so they always dispatch to return.
    const onPageShow = () => {
      pushHandoffLog(`[PiP] trigger pageshow bg=${inBackgroundRef.current} pip=${!!isPiPRef?.current}`);
      runReturnSeam();
    };
    const onFocus = () => {
      pushHandoffLog(`[PiP] trigger focus bg=${inBackgroundRef.current} pip=${!!isPiPRef?.current}`);
      runReturnSeam();
    };
    // Pass-18: window.blur is LOG-ONLY. Blur fires spuriously in-foreground
    // (dev tools focus, popover open) so it must never trigger the seam;
    // but its presence in the log helps disambiguate "iOS never told the tab
    // anything" from "iOS fired blur but not visibilitychange".
    const onBlur = () => {
      pushHandoffLog(`[PiP] trigger blur logOnly bg=${inBackgroundRef.current} pip=${!!isPiPRef?.current}`);
    };

    // Pass-18: mainCtx statechange is the actual leave signal when WebKit
    // withholds visibilitychange under PiP. iOS suspends the AudioContext
    // when Safari backgrounds; the ctx state transition to suspended/
    // interrupted IS the backgrounding event. Guarded by inBackgroundRef
    // so a duplicate trigger (if visibilitychange also fires) is a no-op —
    // runHideSeam owns its own idempotence via inBackgroundRef.
    const unsubMainCtx = subscribeMainCtxStatechange((state) => {
      pushHandoffLog(`[PiP] trigger mainCtx state=${state} bg=${inBackgroundRef.current} pip=${!!isPiPRef?.current} vs=${document.visibilityState}`);
      if (state === 'suspended' || state === 'interrupted') {
        if (!inBackgroundRef.current && isPiPRef?.current) {
          runHideSeam();
        }
        return;
      }
      if (state === 'running') {
        if (inBackgroundRef.current) {
          runReturnSeam();
        }
      }
    });

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      unsubMainCtx();
      if (tapRetryCleanupRef.current) {
        tapRetryCleanupRef.current();
        tapRetryCleanupRef.current = null;
      }
    };
  }, [musicPausedRef, musicHoldRef, musicOffRef]);

  return { primeShadow, swapTrack, teardownShadow };
}
