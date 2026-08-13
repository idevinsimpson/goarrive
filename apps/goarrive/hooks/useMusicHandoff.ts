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
 * Two variants are compared on-device via ?handoff=v1|v2:
 *   v1 (mute-flip): shadow plays muted alongside the audible in foreground;
 *     on hide, `shadow.muted = false; audible.muted = true` — a property
 *     change is instant.
 *   v2 (play-on-hide): shadow is paused in foreground (with src pre-loaded
 *     and a gesture-warmed play() history); on hide, `shadow.currentTime =
 *     audible.currentTime; shadow.play(); audible.pause()`.
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
import { getAudioContextState, resumeAudioGraph } from './useWorkoutTTS';
import {
  getMusicHandoffVariant,
  type MusicHandoffVariant,
} from '../utils/musicHandoffVariant';

// How often we nudge the muted element's position to match the audible one.
// Longer = less CPU, more drift on hide; shorter = tighter sync, more work.
// 1s keeps drift under ~1s worst case, which is inaudible when we swap.
const POSITION_SYNC_MS = 1000;

// How long we wait after resumeAudioGraph() before falling back to the
// user-tap retry path. 3s covers the observed suspended→running latency on
// iOS Safari devices (verified during device spike A/B/C).
const RETURN_TIMEOUT_MS = 3000;

export interface UseMusicHandoffOptions {
  /** Same as useWorkoutMusic.enabled — hook stays inert if false. */
  enabled: boolean;
  /** Master workout pause state; propagates to the shadow when backgrounded. */
  isPaused: boolean;
  /** Master mute state; propagates to whichever element is currently audible. */
  isMuted: boolean;
  /** Music-pane ref: true while user manually paused music via the panel. */
  musicPausedRef: MutableRefObject<boolean>;
  /** Music-hold ref: true while intro announcement is holding music silent. */
  musicHoldRef: MutableRefObject<boolean>;
  /** Music-off ref: true if user turned music off for the session. */
  musicOffRef: MutableRefObject<boolean>;
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
  const { enabled, isPaused, isMuted, musicPausedRef, musicHoldRef, musicOffRef } = opts;

  const variantRef = useRef<MusicHandoffVariant>('off');
  const audibleElRef = useRef<HTMLAudioElement | null>(null);
  const shadowElRef = useRef<HTMLAudioElement | null>(null);
  const currentUrlRef = useRef<string | null>(null);
  const isMutedRef = useRef(isMuted);
  const isPausedRef = useRef(isPaused);
  const enabledRef = useRef(enabled);
  // True while we are handed off (background); shadow is the audible master.
  const inBackgroundRef = useRef(false);
  // Cleanup for the pointerdown listener we install if the graph never
  // resumes within RETURN_TIMEOUT_MS (test case C fallback).
  const tapRetryCleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => { isMutedRef.current = isMuted; }, [isMuted]);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);
  useEffect(() => { enabledRef.current = enabled; }, [enabled]);

  // Resolve variant once per session. Query param wins; localStorage persists
  // the choice across page navigations during the device spike.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    variantRef.current = getMusicHandoffVariant();
    console.info('[HANDOFF/init]', { variant: variantRef.current });
  }, []);

  // ── Shadow lifecycle ──────────────────────────────────────────────────────

  const primeShadow = useCallback((audibleEl: HTMLAudioElement) => {
    audibleElRef.current = audibleEl;
    if (variantRef.current === 'off') return;
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
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
    console.info('[HANDOFF/prime]', { variant: variantRef.current });
  }, []);

  const swapTrack = useCallback((url: string) => {
    currentUrlRef.current = url;
    if (variantRef.current === 'off') return;
    const shadow = shadowElRef.current;
    if (!shadow) return;
    try {
      shadow.pause();
      shadow.src = url;
      shadow.load();
    } catch {}
    // Foreground behavior: v1 plays muted, v2 stays paused.
    if (variantRef.current === 'v1' && !isPausedRef.current) {
      try { shadow.play().catch(() => {}); } catch {}
    }
  }, []);

  const teardownShadow = useCallback(() => {
    const shadow = shadowElRef.current;
    shadowElRef.current = null;
    audibleElRef.current = null;
    currentUrlRef.current = null;
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
      const shadow = shadowElRef.current;
      if (!audible || !shadow) return;
      if (inBackgroundRef.current) return;
      if (document.visibilityState !== 'visible') return;
      try {
        // Only nudge if drift is > 100ms to avoid audible micro-glitches on v1.
        if (Math.abs(shadow.currentTime - audible.currentTime) > 0.1) {
          shadow.currentTime = audible.currentTime;
        }
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
    const shadow = shadowElRef.current;
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
    const shadow = shadowElRef.current;
    if (!shadow) return;
    if (!inBackgroundRef.current) {
      // Foreground: shadow stays muted for v1 (or paused for v2).
      shadow.muted = true;
      return;
    }
    // Background: shadow follows isMuted.
    shadow.muted = isMuted;
  }, [isMuted]);

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
      const shadow = shadowElRef.current;
      if (!audible || !shadow) return;
      const shadowPos = shadow.currentTime;
      const audiblePos = audible.currentTime;
      // Master position lives on the shadow while backgrounded — yank the
      // muted (audible) side to match, THEN unmute. Never yank the audible
      // while it is audible (echo).
      try { audible.currentTime = shadowPos; } catch {}
      if (variantRef.current === 'v1') {
        audible.muted = isMutedRef.current;
        shadow.muted = true;
      } else if (variantRef.current === 'v2') {
        try { audible.play().catch(() => {}); } catch {}
        try { shadow.pause(); } catch {}
      }
      inBackgroundRef.current = false;
      console.info('[HANDOFF/swap-back]', {
        variant: variantRef.current,
        pos: audiblePos,
        shadow: shadowPos,
        drift: Number((shadowPos - audiblePos).toFixed(3)),
      });
    };

    const runReturnSeam = () => {
      const audible = audibleElRef.current;
      const shadow = shadowElRef.current;
      if (variantRef.current === 'off' || !inBackgroundRef.current) {
        // Off-branch parity path: same guard conditions as the pre-adapter
        // handler at useWorkoutMusic:500-521.
        if (document.visibilityState !== 'visible') return;
        if (musicPausedRef.current || musicHoldRef.current || musicOffRef.current) return;
        resumeAudioGraph();
        if (audible && audible.src && audible.paused) audible.play().catch(() => {});
        return;
      }
      if (!audible || !shadow) return;

      resumeAudioGraph();
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
          console.info('[HANDOFF/visible]', {
            variant: variantRef.current,
            state: 'running',
            timeline: marks.join(' '),
          });
          swapBackToGraph();
          return;
        }
        if (Date.now() > deadline) {
          console.info('[HANDOFF/timeout]', {
            variant: variantRef.current,
            timeline: marks.join(' '),
            note: 'ctx still suspended after 3s — waiting for user tap',
          });
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
      const audible = audibleElRef.current;
      const shadow = shadowElRef.current;
      if (variantRef.current === 'off') return;
      if (!audible || !shadow) return;
      if (!enabledRef.current) return;
      if (musicOffRef.current) return;
      // Music-hold means the intro is playing; we should NOT start music yet
      // just because the page hid. Same for user-paused / muted.
      if (musicHoldRef.current || musicPausedRef.current) return;
      const pos = audible.currentTime;
      if (variantRef.current === 'v1') {
        // Property change is instant on iOS — no gesture, no await.
        shadow.muted = isMutedRef.current;
        audible.muted = true;
      } else if (variantRef.current === 'v2') {
        try { shadow.currentTime = pos; } catch {}
        try { shadow.play().catch(() => {}); } catch {}
        try { audible.pause(); } catch {}
      }
      inBackgroundRef.current = true;
      console.info('[HANDOFF/hide]', {
        variant: variantRef.current,
        pos: Number(pos.toFixed(3)),
        shadowPlaying: !shadow.paused,
        ctxState: getAudioContextState(),
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        runReturnSeam();
      } else {
        runHideSeam();
      }
    };
    // pageshow + focus mirror the pre-adapter handler so bfcache restores and
    // iOS overlay dismissals (call-in overlays, Face ID, etc.) still resume
    // playback. These paths NEVER hide, so they always dispatch to return.
    const onPageShow = () => runReturnSeam();
    const onFocus = () => runReturnSeam();

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('pageshow', onPageShow);
    window.addEventListener('focus', onFocus);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('pageshow', onPageShow);
      window.removeEventListener('focus', onFocus);
      if (tapRetryCleanupRef.current) {
        tapRetryCleanupRef.current();
        tapRetryCleanupRef.current = null;
      }
    };
  }, [musicPausedRef, musicHoldRef, musicOffRef]);

  return { primeShadow, swapTrack, teardownShadow };
}
