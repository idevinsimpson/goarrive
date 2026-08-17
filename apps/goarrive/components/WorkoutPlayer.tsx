/**
 * WorkoutPlayer — Coach-in-your-pocket workout execution engine
 *
 * Phase 3 upgrade: Full special block rendering
 *   - Intro: full-screen cinematic welcome with logo + workout name
 *   - Outro: full-screen completion celebration
 *   - Demo: preview upcoming multi-movement block with thumbnails
 *   - Transition: instruction card with countdown
 *   - Water Break: hydration screen with countdown
 *   - Exercise: video playback with timer, controls, next-up bar
 *
 * Layout (WORK phase):
 *   - GoArrive logo centered at top (on black background)
 *   - Movement name (left) + countdown timer (right) on same row
 *   - Video in the middle with small side margins
 *   - Controls hidden by default — appear on video tap, auto-hide after 3s
 *   - NEXT UP bar at the bottom
 *
 * Decomposed into hooks: useWorkoutFlatten, useWorkoutTimer, useMediaPrefetch,
 * useMovementHydrate, useMovementSwap, usePlaybackSpeed
 */
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Platform,
  Dimensions,
  Image,
  TextInput,
  useWindowDimensions,
  ScrollView,
  Pressable,
} from 'react-native';
import { Video, ResizeMode } from 'expo-av';
import MovementVideoControls from './MovementVideoControls';
import { Icon } from './Icon';
import { useWakeLock } from '../lib/useWakeLock';
import { useWorkoutFlatten, buildPreviewSections, sectionTitle } from '../hooks/useWorkoutFlatten';
import { useWorkoutTimer } from '../hooks/useWorkoutTimer';
import { useMediaPrefetch } from '../hooks/useMediaPrefetch';
import { useMovementSwap } from '../hooks/useMovementSwap';
import { useMovementHydrate } from '../hooks/useMovementHydrate';
import { usePlaybackSpeed } from '../hooks/usePlaybackSpeed';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useWorkoutTTS, unlockAudioPlayback, getAudioContextState } from '../hooks/useWorkoutTTS';
import { usePipCanvasStream, getLivenessCtxState, resumeLivenessCtx } from '../hooks/usePipCanvasStream';
import { useHeartRate, HeartRateSessionStats } from '../hooks/useHeartRate';
import { useAuth } from '../lib/AuthContext';
import { doc, getDoc, updateDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { setAudioMuted, unlockAudioContext } from '../lib/audioCues';
import { useWorkoutMusic } from '../hooks/useWorkoutMusic';
import MusicSettingsSheet from './MusicSettingsSheet';
import { FB, FH } from '../lib/theme';
import VoiceAuditPanel from './VoiceAuditPanel';
import { isStagingHost } from '../lib/runtimeEnv';
import {
  getMusicHandoffVariant,
  setMusicHandoffVariant,
  type MusicHandoffVariant,
} from '../utils/musicHandoffVariant';
import { getPipProbeMode, setPipProbeMode, nextPipProbeMode, pipProbeModeLabel, type PipProbeMode } from '../utils/pipProbeMode';
import { pushHandoffLog, readHandoffLog } from '../utils/handoffLog';
import { installVoiceAuditCapture } from '../lib/voiceAuditLog';
import PosterThumb from './PosterThumb';
import { isImageUrl } from '../utils/mediaKind';
import {
  buildDefaultIntroScript,
  generateIntroAnnouncementVoice,
  introAnnouncementHash,
} from '../utils/workoutIntroAnnouncement';

// Install [VOICE-AUDIT] console capture at module load on staging only so the
// in-app debug panel can mirror the forensic trace without DevTools. Has zero
// effect in production where isStagingHost() returns false.
if (isStagingHost()) {
  installVoiceAuditCapture();
}

// ── PiP canvas feature flags (Phase 2 — staging only) ───────────────────────
// Default true on staging so QA can verify the canvas renders without a
// Firebase Remote Config toggle. Phase 3 will wire this to Remote Config.
const workoutFlags = { pipCanvasEnabled: true };

// ── Constants ───────────────────────────────────────────────────────────────
// How many seconds before a timed phase ends should the visual switch to the
// next timeline item. Aligns with the spoken "3, 2, 1" countdown cue at
// timeLeft === 3 so the screen and audio reveal together.
const REVEAL_LEAD_SECONDS = 3.5;

// Compose a movement label that appends coach-prescribed weight and reps after
// the name (e.g. "Cable Curls, 75 lbs, 15 reps"). Purely-numeric weight/reps
// get the unit appended; freeform values ("bodyweight", "AMRAP") render as-is.
export function composePrescriptionLabel(name: string, weight?: string, reps?: string): string {
  const w = (weight || '').trim();
  const r = (reps || '').trim();
  const parts: string[] = [];
  if (w) parts.push(/^\d+(\.\d+)?$/.test(w) ? `${w} lbs` : w);
  if (r) parts.push(/^\d+$/.test(r) ? `${r} reps` : r);
  return parts.length === 0 ? name : `${name}, ${parts.join(', ')}`;
}

// Pure helpers live in WorkoutPlayer.helpers.ts (no Firebase dep — safe to import in tests).
export { computePreloadVideoUrl, handleVideoLayerPlaybackStatus } from './WorkoutPlayer.helpers';
import { pickNameTier, computePlayerCanvas, nextStallRecoveryAction, type StallRecoveryState } from './WorkoutPlayer.helpers';

// ── Types ──────────────────────────────────────────────────────────────────
export interface WorkoutLiveProgress {
  phase: string;
  currentIndex: number;
  total: number;
  movementName: string | null;
  nextMovementName: string | null;
  isPaused: boolean;
  timeLeft: number | null;
  roundNumber: number | null;
}

interface WorkoutPlayerProps {
  visible: boolean;
  workout: any;
  onClose: () => void;
  onComplete: () => void;
  onSwapLog?: (swaps: any[]) => void;
  onHeartRateSummary?: (stats: HeartRateSessionStats | null) => void;
  isPreview?: boolean;
  /** Fires on phase/movement/pause transitions (playbook live view). */
  onLiveProgress?: (state: WorkoutLiveProgress) => void;
  /** When set, writes live player state to session_instances/{id}/live/player for coach live-view. */
  sessionInstanceId?: string;
  /** Rendered above the player inside the fullscreen modal (Zoom PiP tile). */
  zoomOverlay?: React.ReactNode;
}

// ── Heart-rate zone color ───────────────────────────────────────────────────
// Percent of estimated max HR → zone color. Est max = 220 - age when the
// member's age is known, else a fixed 190.
function hrZoneColor(bpm: number, estMaxHR: number): string {
  const pct = bpm / estMaxHR;
  if (pct < 0.5) return '#8A95A3';   // grey — very light
  if (pct < 0.6) return '#5B9BD5';   // blue — light
  if (pct < 0.7) return '#6EBB7A';   // green — moderate
  if (pct < 0.85) return '#F5A623';  // orange — hard
  return '#E05252';                  // red — max effort
}

function ageFromDateOfBirth(dob: unknown): number | null {
  if (typeof dob !== 'string' || !dob.trim()) return null;
  // Accepts MM/DD/YYYY or YYYY-MM-DD.
  let d: Date | null = null;
  const us = dob.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (us) d = new Date(Number(us[3]), Number(us[1]) - 1, Number(us[2]));
  else if (iso) d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  if (!d || isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  if (now.getMonth() < d.getMonth() || (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) age--;
  return age > 0 && age < 120 ? age : null;
}

// ── Component ──────────────────────────────────────────────────────────────
export default function WorkoutPlayer({
  visible,
  workout,
  onClose,
  onComplete,
  onSwapLog,
  onHeartRateSummary,
  isPreview = false,
  onLiveProgress,
  sessionInstanceId,
  zoomOverlay,
}: WorkoutPlayerProps) {
  // ── Hooks ────────────────────────────────────────────────────────────
  const flatFromBlocks = useWorkoutFlatten(workout);
  const hydratedMovements = useMovementHydrate(flatFromBlocks);
  const [flatOverride, setFlatOverride] = useState<any[] | null>(null);
  const flatMovements = flatOverride || hydratedMovements;

  const timer = useWorkoutTimer({ flatMovements });

  const {
    phase, currentIndex, timeLeft, swapSide, isPaused,
    current, next, total, isRepBased, progressPct, isSpecialPhase, roundNumber,
    handleStart, handlePauseResume, handleSkip, handleRepDone,
    seekRelative, advanceToNext,
  } = timer;

  useWakeLock(phase !== 'ready' && phase !== 'complete');

  // ── PiP canvas-stream (Phase 2, staging-only) ────────────────────────────
  const pipEnabled = isStagingHost() && workoutFlags.pipCanvasEnabled;
  // Hoisted above the canvas hook so `enabled` can gate on it; setter is
  // wired from the enterpictureinpicture / leavepictureinpicture listeners
  // further down. The gate keeps the rAF loop + hidden video off the
  // foreground-workout hot path — they only spin up during PiP.
  const [isPiP, setIsPiP] = useState(false);
  // Pass-6 handoff-standdown gate: PiP-active ref threaded into useWorkoutMusic
  // → useMusicHandoff so the visibilitychange hide seam skips starting the
  // shadow when PiP is presenting. Written synchronously in onEnter/onLeave
  // below (before setIsPiP) so the ref is correct at the moment the browser's
  // visibilitychange fires from a rapid PiP→home-screen gesture.
  const pipActiveRef = useRef(false);
  // Arming flag: onPressIn on the PiP button sets this true so the canvas
  // hook + hidden video warm up during the ~100ms between touch-down and
  // touch-up. requestPictureInPicture() must stay inside the gesture, and
  // iOS won't accept the presentation without at least one canvas frame in
  // the target video — arming buys that head start without leaving the tap.
  // Cleared on PiP entry, PiP failure, or a 3s safety timeout.
  const [pipArming, setPipArming] = useState(false);
  // Pass-2 mechanism probe: getPipProbeMode() = query > localStorage > default
  // 'full'. Staging-only via pipEnabled gate below. The probe runs inline with
  // a subset of the hook so a device tester can isolate which step starves the
  // foreground music path (see pipProbeMode.ts).
  const pipProbeMode = useMemo<PipProbeMode>(() => getPipProbeMode(), []);
  // Ref to the DOM video element for the currently-active workout video.
  // Populated via effect when the expo-av Video mounts/changes. Marked
  // disablePictureInPicture so iOS Safari's own PiP affordance on this
  // element does not compete with our canvas-composite tile — the movement
  // video is a source for the canvas, not a presentation target.
  const pipSourceVideoRef = useRef<HTMLVideoElement | null>(null);
  // NOTE: the populating effect lives further down (after displayedUrl,
  // videoRef and videosRef are declared) so it can watch displayedUrl —
  // without that dep the ref stays null after the first layer swap and
  // PiP renders a frozen tile (pass-12 bug 4).
  //
  // Pass-14: the pass-13 one-shot effect regressed the tile (permanent
  // videoRS=-1 after 23:05:07 in the device log). The effect ran once
  // per (phase, currentIndex, displayedUrl) tuple and picked whatever
  // element existed at that instant — often paused mid-transition.
  // Self-healing resolver: the draw loop calls this every frame when
  // its current binding is null or paused, so a bad pick self-corrects
  // on the next rAF tick. Scanning all layer:* entries beats trusting
  // videoRef.current, which the ref callback may not have refreshed
  // yet after a layer swap. Every rebind is logged via pushHandoffLog
  // (device tester copies COPY LOG; console.warn was invisible on iOS).
  //
  // Pass-15: resolver is now expected-URL-driven. Pass-14 selection
  // quality landed (paused=false picks) but targeting broke — Class 1
  // (empty registry, no retry, 30s+ text-only) and Class 2 (single
  // stale layer held 90s+ across movements) proved the picker had no
  // concept of what SHOULD play. Pass-15 uses activeVideoUrl as the
  // expected URL, prefers expected+!paused, retries for up to 3s on
  // no-match, and widens scan beyond `layer:*` (transition/
  // grabEquipment videos register under phase-name keys).
  const pipSourceResolverRef = useRef<(() => HTMLVideoElement | null) | null>(null);
  // Pass-15: expected-URL pointer. activeVideoUrl already encodes the
  // reveal walk-forward (during rest/reveal it's the next movement's
  // video), so the resolver can prefer the intended layer over any
  // stale in-registry candidate. Ref lets the resolver read the latest
  // value without churning effect deps.
  const expectedUrlRef = useRef<string | null>(null);
  // Pass-15: first-miss timestamp per expected URL. When the resolver
  // finds no candidate matching the expected URL, we retry (return null)
  // rather than binding a stale/wrong element. The 3s cap bounds the
  // black-tile window — after that, any playing candidate beats a
  // frozen black tile. Reset whenever expected URL changes.
  const expectedMissAtRef = useRef<{ url: string | null; ts: number }>({ url: null, ts: 0 });
  // Pass-19 R1: retry count for canplay/loadeddata events fired on low-readyState
  // candidates. Incremented each time a listener fires and re-invokes the resolver.
  const r1RetryCountRef = useRef(0);
  // Pass-19 R1: WeakSet of elements that already have a canplay listener attached.
  // Prevents duplicate listeners when the resolver is called multiple rAF ticks
  // before the element fires canplay.
  const r1ListenersAttachedRef = useRef(typeof WeakSet !== 'undefined' ? new WeakSet<HTMLVideoElement>() : null);

  // Pass 12: publish a window flag while this player is mounted. The SW
  // auto-reload handler injected in inject_pwa_meta.py reads this flag
  // on controllerchange — if truthy, it defers the reload rather than
  // nuking the workout mid-session. The Aug 16 pass-10 log caught
  // exactly that footprint (17:44:23 backgrounded → 17:44:37 fresh
  // PAGE-INIT with workout restarted from ready). Gate on mount, not
  // on "timer running," so pause and rest are covered too.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    (window as any).__goarrivePlayerMounted = true;
    return () => {
      (window as any).__goarrivePlayerMounted = false;
    };
  }, []);

  // Pass-7: presentation-target ref declared before the hook call so it can
  // be threaded into usePipCanvasStream for the .currentTime sample log.
  // The element itself is created imperatively in the useEffect below.
  const pipCanvasVideoRef = useRef<HTMLVideoElement | null>(null);

  // Pass-20 R8 reveal-ahead for no-video next steps. Mirror of the big
  // reveal memo further down (line ~1537) that produces `isInRevealWindow`
  // for the main player's double-buffered video swap. Hoisted here so the
  // PiP hook call can consume it — the two calculations MUST stay in sync
  // (both apply REVEAL_LEAD_SECONDS to the last of any timed non-rest
  // phase, both include REST as continuously in-window, both suppress
  // during rep-based and swap-sides work-L). If you change the reveal
  // rule, update both.
  const isInPipRevealWindow = useMemo<boolean>(() => {
    if (!current || !next) return false;
    if (phase === 'rest') return true;
    const isTimedRevealPhase =
      phase === 'work' || phase === 'transition' || phase === 'waterBreak'
      || phase === 'grabEquipment' || phase === 'demo';
    if (!isTimedRevealPhase) return false;
    if (isRepBased) return false;
    const stayingOnSameMovement =
      phase === 'work' && (current as any)?.swapSides === true && swapSide === 'L';
    if (stayingOnSameMovement) return false;
    if (typeof timeLeft !== 'number' || timeLeft <= 0) return false;
    return timeLeft <= REVEAL_LEAD_SECONDS;
  }, [phase, timeLeft, current, next, isRepBased, swapSide]);

  const { mediaStream, startStream, attachAudioTracks, detachAudioTracks } = usePipCanvasStream({
    // Pass-4 keep-warm: stream comes up on workout mount and stays up so
    // readyState reaches 4 well before the user taps PiP. Pass-3 rebuilt on
    // every arm and 24/26 taps landed on readyState=0 (InvalidStateError).
    // 'audio' probeMode keeps the audio bus OFF the continuously-playing
    // element (PR #289 mechanism) — armPip calls attachAudioTracks() inside
    // the tap gesture. 'full' merges audio from mount (original path).
    enabled: pipEnabled && Platform.OS === 'web',
    probeMode: pipProbeMode,
    phase,
    current: current as any,
    next: next as any,
    timeLeft: typeof timeLeft === 'number' ? timeLeft : 0,
    isPaused,
    isRepBased,
    repsDone: 0,
    progressPct,
    // Pass-20 R8: hand the reveal-window flag to the PiP draw loop so it
    // can early-cut to next's placeholder when next is a no-video exercise.
    isInRevealWindow: isInPipRevealWindow,
    videoElRef: pipSourceVideoRef,
    // Pass-7: expose the presentation-target video so the periodic
    // drawFrame log can sample .currentTime + .readyState.
    canvasVideoElRef: pipCanvasVideoRef,
    // Pass-14 Fix 1: self-healing resolver. drawFrame calls this when
    // its bound videoEl is null-or-paused during a work-like phase so
    // a stale pick auto-corrects on the next rAF tick.
    pipSourceResolverRef,
  });

  // Hidden <video> that carries the canvas-stream MediaStream as srcObject
  // and is the PiP presentation target. Created imperatively so RN JSX doesn't
  // choke on raw <video>. Exists eagerly whenever the feature is on (staging +
  // full mode) so it's ready to receive srcObject the moment the hook arms.
  //
  // Event listeners live here so state transitions hook the same element that
  // PiP presents (webkitpresentationmodechanged covers the iOS branch that
  // never fires enter/leavepictureinpicture).
  useEffect(() => {
    if (Platform.OS !== 'web' || !pipEnabled) return;
    // Pass-4: hidden video exists for AUDIO + FULL modes. CANVAS mode is the
    // no-audio control and has no presentation target.
    if (pipProbeMode === 'canvas') return;
    const vid = document.createElement('video');
    vid.autoplay = true;
    vid.muted = true;
    vid.playsInline = true;
    vid.setAttribute('playsinline', '');
    // Pass 9: give the hidden video the same visibility treatment pass 7 gave
    // the capture canvas. Pass-8 log proved entry works (PiP resolved 2/2,
    // held 53s) but the tile stayed black while cvCT advanced 52.80 → 105.05
    // — frames flowed INTO this element, they did not reach the PiP window.
    // The 08/13 spike (only full end-to-end success) had its video fully
    // visible; the app's is 1px × 1px at left:-10000px. That's the ONE
    // remaining property where the app diverges from the spike. Same iOS
    // "doesn't render what it can't see" rule that bit the canvas, one
    // element downstream. Blue border so Devin can tell the two thumbnails
    // apart at a glance (canvas = orange, video = blue). Parked beside the
    // canvas: canvas is at left:8 width:80 → video at left:96 (80+8+8 gap).
    Object.assign(vid.style, {
      position: 'fixed',
      top: '8px',
      left: '96px',
      width: '80px',
      height: '100px',
      zIndex: '1',
      opacity: '1',
      pointerEvents: 'none',
      border: '1px solid #3B82F6',
      background: '#000',
    });
    document.body.appendChild(vid);
    pipCanvasVideoRef.current = vid;
    // Identity marker: a re-init between arms would break the "first tap
    // after load" pattern seen in 08/15 device test. If two mount logs land
    // between a workout start and a tap, the element identity changed.
    const idTag = Math.floor(Math.random() * 1e6).toString(36);
    (vid as any).__pipIdTag = idTag;
    pushHandoffLog(`[PiP] pipCanvasVideo mounted id=${idTag} probe=${pipProbeMode}`);

    // Pass-14 instrumentation: enrich every presentation transition with
    // visState + both AudioContext states (main via getAudioContextState,
    // liveness via getLivenessCtxState). If iOS suspends the liveness ctx
    // at PiP enter (or leave), that transition is visible in the log
    // instead of an inferred silence.
    const logPresentationChange = (tag: string, extra?: string) => {
      const vs = typeof document !== 'undefined' ? document.visibilityState : 'unknown';
      pushHandoffLog(`[PiP] ${tag} visState=${vs} mainCtx=${getAudioContextState()} livenessCtx=${getLivenessCtxState()}${extra ? ' ' + extra : ''}`);
    };
    const onEnter = () => {
      pipActiveRef.current = true;
      setIsPiP(true);
      setPipArming(false);
      logPresentationChange('enterpictureinpicture');
      // Pass 9: log the video element's actual on-screen box at PiP entry.
      // If pass 9 does NOT fill the tile, this rules the styling hypothesis
      // in or out without another guess — 0×0 means the visibility change
      // didn't apply; 80×100 (or spike-sized) means the visibility change
      // applied but iOS still refused to composite frames into the window.
      try {
        pushHandoffLog(`[PiP] onEnter videoBox offsetWidth=${vid.offsetWidth} offsetHeight=${vid.offsetHeight} clientRect=${JSON.stringify({ w: Math.round(vid.getBoundingClientRect().width), h: Math.round(vid.getBoundingClientRect().height), x: Math.round(vid.getBoundingClientRect().x), y: Math.round(vid.getBoundingClientRect().y) })}`);
      } catch (err: any) {
        pushHandoffLog(`[PiP] onEnter videoBox read err: ${err?.name || err}`);
      }
    };
    const onLeave = () => {
      pipActiveRef.current = false;
      setIsPiP(false);
      setPipArming(false);
      logPresentationChange('leavepictureinpicture');
      try { vid.muted = true; } catch {}
      // Pass-5 exit path: strip audio tracks so the warm hidden element does
      // not keep carrying merged audio inline (P0 starves foreground music).
      // Video track stays so the next arm is still fast.
      detachAudioTracks();
      // Pass 9: after external PiP close, iOS pauses the element and cvCT
      // freezes until the next arm re-plays it. Pass-8 log confirmed:
      // cvCT stuck at 105.05 after mode=inline. Re-play here so the warm
      // stream keeps ticking and the next arm doesn't have to cold-start.
      try {
        const p = vid.play();
        if (p && typeof (p as any).catch === 'function') {
          (p as any).catch((e: any) => pushHandoffLog(`[PiP] onLeave replay rejected: ${e?.name || e}`));
        }
        pushHandoffLog('[PiP] onLeave replay issued');
      } catch (err: any) {
        pushHandoffLog(`[PiP] onLeave replay threw: ${err?.name || err}`);
      }
    };
    const onWebkitModeChange = () => {
      const mode = (vid as any).webkitPresentationMode;
      // Pass-7: webkitSetPresentationMode is silent — the log needs the
      // outcome, not just the call. This handler + the 500ms re-read in
      // handlePiP together give us both the async event path (if it fires)
      // and a direct snapshot.
      logPresentationChange('webkitpresentationmodechanged', `mode=${mode}`);
      // Pass-15 dedupe: on newer WebKit, `enterpictureinpicture` /
      // `leavepictureinpicture` fire alongside webkitpresentationmodechanged.
      // Pass-14 log showed duplicate onEnter/onLeave bodies per real
      // transition (two `videoBox` and two `replay issued` lines).
      // Trivially safe: guard on pipActiveRef so the enter/leave body
      // runs at most once per state flip, while the webkit tag log
      // above still records the raw event for observability.
      if (mode === 'picture-in-picture') {
        if (!pipActiveRef.current) onEnter();
      } else {
        if (pipActiveRef.current) onLeave();
      }
    };
    vid.addEventListener('enterpictureinpicture', onEnter);
    vid.addEventListener('leavepictureinpicture', onLeave);
    vid.addEventListener('webkitpresentationmodechanged' as any, onWebkitModeChange);

    return () => {
      pushHandoffLog(`[PiP] pipCanvasVideo unmounted id=${idTag}`);
      vid.removeEventListener('enterpictureinpicture', onEnter);
      vid.removeEventListener('leavepictureinpicture', onLeave);
      vid.removeEventListener('webkitpresentationmodechanged' as any, onWebkitModeChange);
      vid.pause();
      (vid as any).srcObject = null;
      vid.parentNode?.removeChild(vid);
      pipCanvasVideoRef.current = null;
    };
  }, [pipEnabled, pipProbeMode, detachAudioTracks]);

  // Wire the canvas MediaStream into the hidden video when it's available.
  // volume=0 (not muted) so PiP still carries audio via the MediaStream track.
  useEffect(() => {
    const vid = pipCanvasVideoRef.current;
    if (!vid || !mediaStream) return;
    (vid as any).srcObject = mediaStream;
    vid.volume = 0;
    vid.play().catch(() => {});
  }, [mediaStream]);

  // Live progress publisher (playbook live view). Fires on transitions only —
  // not every timer tick — so Firestore writes stay cheap for the caller.
  const liveSnapshotRef = useRef<{ timeLeft: number | null; movementName: string | null; nextMovementName: string | null; total: number; roundNumber: number | null }>({
    timeLeft: null, movementName: null, nextMovementName: null, total: 0, roundNumber: null,
  });
  liveSnapshotRef.current = {
    timeLeft: typeof timeLeft === 'number' ? timeLeft : null,
    movementName: current?.name ?? null,
    nextMovementName: next?.name ?? null,
    total,
    roundNumber: roundNumber ?? null,
  };
  useEffect(() => {
    const state = { phase, currentIndex, isPaused, ...liveSnapshotRef.current };
    if (onLiveProgress) onLiveProgress(state);
    if (sessionInstanceId) {
      setDoc(
        doc(db, 'session_instances', sessionInstanceId, 'live', 'player'),
        { ...state, workoutName: workout?.title ?? workout?.name ?? null, updatedAt: serverTimestamp() },
      ).catch((err) => console.warn('[WorkoutPlayer] live state write failed:', err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentIndex, isPaused]);


  useMediaPrefetch(
    flatMovements,
    currentIndex,
    phase === 'work',
    phase === 'rest',
    false,
    phase === 'ready',
  );

  // ── Offline resilience ─────────────────────────────
  const { isOffline, queueSize } = useNetworkStatus();

  // ── Mute toggle ───────────────────────────────────────
  // Single source of truth for every audio layer: MP3 cues + voiceUrl clips
  // (gated inside useWorkoutTTS), Web Speech / expo-speech (gated in `speak`),
  // and the audioCues.ts tone module (gated by setAudioMuted below). Player
  // <Video> elements are always `isMuted` so video has no audio layer to gate.
  const [isMuted, setIsMuted] = useState(false);
  useEffect(() => { setAudioMuted(isMuted); }, [isMuted]);

  // ── Workout background music (Mubert playlist) ────────────────────────
  // Coach-enabled pooled tracks played softly under coach audio/TTS as a
  // no-repeat playlist that changes songs through the workout. Web-only.
  // All element/queue mechanics live in useWorkoutMusic — the single blessed
  // element, in-gesture priming, e49f0a0 release discipline and announcement
  // hold are preserved verbatim from the original inline implementation.
  const { user, claims } = useAuth();
  const musicVolume =
    typeof workout?.workoutMusicVolume === 'number' ? workout.workoutMusicVolume : 0.35;
  const musicEnabled = Platform.OS === 'web' && !!workout?.workoutMusicEnabled;
  const musicStyle =
    typeof workout?.workoutMusicStyle === 'string' && workout.workoutMusicStyle
      ? workout.workoutMusicStyle
      : 'workout';
  const music = useWorkoutMusic({
    enabled: musicEnabled,
    visible,
    phase,
    isPaused,
    isMuted,
    initialStyle: musicStyle,
    initialVolume: musicVolume,
    uid: user?.uid ?? null,
    workoutId: typeof workout?.id === 'string' ? workout.id : null,
    coachId: typeof workout?.coachId === 'string' ? workout.coachId : null,
    // Pass-6: PiP standdown for handoff. When PiP is active, the canvas
    // stream is the sole background audio source; the shadow flip would
    // double it (beat-echo on device 08/15).
    isPiPRef: pipActiveRef,
  });
  // Local aliases keep the announcement/start call sites identical to the
  // pre-hook implementation.
  const { startMusic, releaseMusicHold, musicHoldRef } = music;
  const [showMusicSheet, setShowMusicSheet] = useState(false);
  useEffect(() => {
    if (!visible || phase === 'complete') setShowMusicSheet(false);
  }, [visible, phase]);

  // ── Voice coaching ────────────────────────────────────
  const { stopAllAudio, playExclusiveVoice } = useWorkoutTTS({
    phase,
    current,
    next,
    isMuted,
    isPaused,
    currentIndex,
    total,
    timeLeft,
    currentDuration: current?.duration ?? 0,
    swapSide,
    roundNumber,
    steps: flatMovements,
  });

  // ── Movement swap ─────────────────────────────
  const {
    showSwap, alternatives, loadingAlts,
    closeSwap, swapMovement, getSwapLog,
  } = useMovementSwap(flatMovements, currentIndex, setFlatOverride);
  const [swapReason, setSwapReason] = useState('');

  // ── Live heart rate (Web Bluetooth) ───────────────────────────────────
  // (user/claims come from the useAuth destructure in the music block above.)
  const hr = useHeartRate();
  const isMember = !!user && claims?.role === 'member';

  // ── Live View session writes (workoutSessions collection) ────────────────
  // Members-only: create a session doc on open, update on state changes,
  // throttle video position every 500ms, delete on close/complete.
  const liveSessionIdRef = useRef<string | null>(null);
  const liveSessionPositionRef = useRef<number>(0);
  const isLiveEligible = isMember && !isPreview;

  // Compute position ms from timer state (best-effort; 0 for non-work phases)
  const currentPositionMs = phase === 'work' && typeof timeLeft === 'number' && typeof current?.duration === 'number'
    ? Math.max(0, (current.duration - timeLeft) * 1000)
    : 0;
  liveSessionPositionRef.current = currentPositionMs;

  // Create session on open; delete on close/unmount
  useEffect(() => {
    if (!visible || !isLiveEligible || !user) return;
    const sessionId = `${user.uid}_${Date.now()}`;
    liveSessionIdRef.current = sessionId;
    const coachId = (workout?.coachId ?? claims?.coachId ?? '') as string;
    const memberName = user.displayName || '';
    const workoutId = workout?.id ?? '';
    const workoutName = (workout?.title ?? workout?.name ?? '') as string;
    setDoc(doc(db, 'workoutSessions', sessionId), {
      sessionId,
      memberId: user.uid,
      memberName,
      coachId,
      workoutId,
      workoutName,
      phase: 'ready',
      movementIndex: 0,
      videoPositionMs: 0,
      isPlaying: false,
      startedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }).catch((err) => console.warn('[LiveView] session create failed:', err));

    return () => {
      const sid = liveSessionIdRef.current;
      liveSessionIdRef.current = null;
      if (sid) {
        deleteDoc(doc(db, 'workoutSessions', sid))
          .catch((err) => console.warn('[LiveView] session delete failed:', err));
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, isLiveEligible]);

  // Update session on phase/index/pause changes
  useEffect(() => {
    const sid = liveSessionIdRef.current;
    if (!sid || !isLiveEligible) return;
    setDoc(doc(db, 'workoutSessions', sid), {
      phase,
      movementIndex: currentIndex,
      isPlaying: !isPaused,
      videoPositionMs: liveSessionPositionRef.current,
      movementName: current?.name ?? null,
      currentVideoUrl: (current as any)?.videoUrl ?? null,
      updatedAt: serverTimestamp(),
    }, { merge: true }).catch(() => {});
    if (phase === 'complete') {
      const s = sid;
      liveSessionIdRef.current = null;
      deleteDoc(doc(db, 'workoutSessions', s)).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentIndex, isPaused]);

  // Throttled position update every 500ms while playing
  useEffect(() => {
    if (!isLiveEligible || phase !== 'work' || isPaused) return;
    const interval = setInterval(() => {
      const sid = liveSessionIdRef.current;
      if (!sid) return;
      setDoc(doc(db, 'workoutSessions', sid), {
        videoPositionMs: liveSessionPositionRef.current,
        updatedAt: serverTimestamp(),
      }, { merge: true }).catch(() => {});
    }, 500);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLiveEligible, phase, isPaused]);

  const [savedHrDeviceName, setSavedHrDeviceName] = useState<string | null>(null);
  const [hrEnabled, setHrEnabled] = useState(true);
  const [memberAge, setMemberAge] = useState<number | null>(null);

  // Load the member's saved HR device + preference once per open. Guests
  // (user null — e.g. /share links) never touch Firestore.
  useEffect(() => {
    if (!visible || !hr.supported || !isMember) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'members', user!.uid));
        if (cancelled || !snap.exists()) return;
        const data = snap.data();
        if (typeof data.hrDeviceName === 'string' && data.hrDeviceName) {
          setSavedHrDeviceName(data.hrDeviceName);
        }
        if (data.hrEnabled === false) setHrEnabled(false);
        setMemberAge(ageFromDateOfBirth(data.dateOfBirth));
      } catch {
        // No member doc / no permission — HR still works, just no saved device.
      }
    })();
    return () => { cancelled = true; };
  }, [visible, hr.supported, isMember, user]);

  // After a successful connect, remember the device on the member doc so the
  // next session offers one-tap reconnect. Best-effort — never blocks the UI.
  const lastSavedDeviceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isMember || hr.status !== 'connected' || !hr.deviceName) return;
    if (lastSavedDeviceRef.current === hr.deviceName) return;
    lastSavedDeviceRef.current = hr.deviceName;
    setSavedHrDeviceName(hr.deviceName);
    updateDoc(doc(db, 'members', user!.uid), {
      hrDeviceName: hr.deviceName,
      hrEnabled: true,
    }).catch(() => {});
  }, [isMember, hr.status, hr.deviceName, user]);

  const estMaxHR = memberAge != null ? 220 - memberAge : 190;
  const hrSessionRef = useRef<HeartRateSessionStats | null>(null);
  hrSessionRef.current = hr.sessionStats;
  const hrDisconnectRef = useRef(hr.disconnect);
  hrDisconnectRef.current = hr.disconnect;

  // ── 9:16 artboard scaling ─────────────────────────────────────────────
  // The whole player is one composition designed at a fixed BASE_W × BASE_H
  // artboard. At runtime we compute ONE uniform scale that's the largest
  // value where the whole 9:16 artboard fits inside the available viewport
  // (after reserving hardware safe-area). Every dimension inside the canvas
  // — logo, title, timer box, media, next-up, fonts, gaps — is a constant in
  // BASE units rendered through `fs(n) = n * scale`. This is the only source
  // of truth: no per-module responsive logic, no flex reflow, no orientation
  // special-cases. The composition behaves like a true vertical video.
  const { width: winW, height: winH } = useWindowDimensions();
  const dimsValid = winW > 0 && winH > 0;
  const BASE_W = 360;
  const BASE_H = 640;
  // Reserve hardware safe-area BELOW the canvas so the canvas itself never
  // overlaps the home indicator / browser chrome. Conservative constant —
  // the canvas centers in the remaining space, so a small overshoot just
  // shifts the canvas up a few px (harmless).
  const SAFE_BOTTOM = (Platform.select({ ios: 34, android: 24, web: 24, default: 16 }) ?? 16) as number;
  // Mirror SAFE_BOTTOM for the status bar / notch / Dynamic Island at the top.
  // Without this, PWA + iOS native overlap the logo with the status bar.
  const SAFE_TOP = (Platform.select({ ios: 47, android: 24, web: 0, default: 0 }) ?? 0) as number;
  // Canvas math lives in WorkoutPlayer.helpers.ts (computePlayerCanvas) so it
  // is unit-testable across real-world viewports. Portrait: width always wins
  // and short viewports shrink the media slot (cover-crop) instead of the
  // whole canvas. Landscape / degenerate heights: uniform 9:16 fit.
  const canvas = dimsValid
    ? computePlayerCanvas(winW, winH, SAFE_TOP, SAFE_BOTTOM)
    : { scale: 1, frameW: BASE_W, frameH: BASE_H, baseMediaW: 304, baseMediaH: 380 };
  const { scale, frameW, frameH } = canvas;
  const fs = (n: number) => n * scale;

  // Every in-canvas style is produced by the makeStyles factory below with
  // all dimensional constants (BASE units) passed through fs(). Recomputed
  // only when the canvas scale changes, so no in-canvas style can ever carry
  // an unscaled pixel size — the composition is proportionally identical in
  // portrait, landscape, small and large windows.
  const st = useMemo(() => makeStyles((n: number) => n * scale), [scale]);

  // Slot dimensions in BASE design units. Sum (260) + media slot (380)
  // = BASE_H (640), so the canvas is exactly the design height with no
  // leftover space.
  const BASE_LOGO_H = 56;
  const BASE_GAP_LOGO = 4;
  const BASE_TITLE_H = 112;
  const BASE_GAP_TITLE = 12;
  const BASE_GAP_MEDIA = 12;
  const BASE_NEXTUP_H = 64;
  const SLOT_LOGO_H = fs(BASE_LOGO_H);
  const SLOT_TITLE_H = fs(BASE_TITLE_H);
  const SLOT_NEXTUP_H = fs(BASE_NEXTUP_H);
  const SLOT_GAP_LOGO = fs(BASE_GAP_LOGO);
  const SLOT_GAP_TITLE = fs(BASE_GAP_TITLE);
  const SLOT_GAP_MEDIA = fs(BASE_GAP_MEDIA);

  // 4:5 media — BASE-unit size from computePlayerCanvas. On short portrait
  // viewports baseMediaH shrinks below 380 (video cover-crops) so the canvas
  // keeps full screen width instead of pillarboxing.
  const { baseMediaW, baseMediaH } = canvas;
  const _mediaW = fs(baseMediaW);
  const _mediaH = fs(baseMediaH);
  const mediaInnerSize = { width: _mediaW, height: _mediaH };

  // ── Video ref ────────────────────────────────
  const videoRef = useRef<any>(null);
  // Stall watchdog: tracks {pos, ts} per URL to detect frozen playback.
  const lastPositionUpdateAtRef = useRef<Map<string, { pos: number; ts: number }>>(new Map());

  // Track every mounted <Video> so we can imperatively pause/play them all on
  // isPaused changes. The declarative `shouldPlay` prop alone doesn't reliably
  // pause an already-playing expo-av Video on web, so this imperative mirror
  // is what actually stops the movement loop when the user taps Pause.
  // Keyed by a stable string (phase name or `layer:<url>`) so entries are
  // deleted when the ref callback fires with null on unmount — the Set
  // version grew unbounded over long workouts.
  const videosRef = useRef<Map<string, any>>(new Map());
  const isPausedRef = useRef(isPaused);
  useEffect(() => { isPausedRef.current = isPaused; }, [isPaused]);

  const registerVideo = useCallback((key: string, el: any | null) => {
    // Pass-20 R4v2 dedup: the ref callbacks at the JSX call sites are
    // inline arrow functions, so React sees a "new" ref every render and
    // fires the OLD callback with null then the NEW callback with the
    // element on EVERY commit. WorkoutPlayer re-renders on every timeLeft
    // tick (~1 Hz), so every mounted <Video> got a null→set churn per
    // second — driving pushHandoffLog spam AND repeated playAsync() /
    // pause() / crossOrigin-load() cycles that could stall decode.
    //
    // Guardrail: if the incoming element is the same DOM node we already
    // hold under this key, no-op. If the incoming is null but the map
    // already holds an element, defer the delete via queueMicrotask —
    // React fires null THEN set within the same commit, so the same-el
    // set will land first and cancel the delete. Genuine unmounts still
    // work: the delayed check finds the entry unchanged (or already
    // replaced by something new) and skips only when identity matches.
    // pipRegDedup=1
    //
    // Pass-20 R6 (2026-08-17): the microtask-defer alone does not catch
    // React's inline-arrow churn. On churn React fires oldRef(null) then
    // newRef(same-el) synchronously in the same commit; the microtask
    // sees `get(key) === currentEl` still true (identity unchanged) and
    // proceeds to delete. Device log at 17:02–17:09 showed cands going
    // 1→0→1 at ~1Hz for the whole session, producing a ~1s placeholder
    // flash on every empty beat and a 55s straight stretch at 17:07–08.
    //
    // Verify death via isConnected in the microtask: on real unmount
    // React removes the DOM node after commit so isConnected flips to
    // false; on churn the DOM node stays in the tree so isConnected
    // stays true. Skip the delete when connected — the null was churn.
    // pipRegDedupR6=1
    const readDomEl = (entry: any): HTMLVideoElement | null => {
      try { return entry?._nativeRef?.current?.getVideoElement?.() ?? null; } catch { return null; }
    };
    if (!el) {
      const currentEl = videosRef.current.get(key);
      if (!currentEl) return;
      if (typeof queueMicrotask === 'function') {
        queueMicrotask(() => {
          if (videosRef.current.get(key) !== currentEl) return;
          const domEl = readDomEl(currentEl);
          if (domEl && domEl.isConnected) {
            if (!(currentEl as any).__pipRegDedupR6SkipLogged) {
              (currentEl as any).__pipRegDedupR6SkipLogged = true;
              pushHandoffLog(`[PiP] pipRegDedupR6=1 skipDelete key=${key} isConnected=true`);
            }
            return;
          }
          videosRef.current.delete(key);
        });
      } else {
        videosRef.current.delete(key);
      }
      return;
    }
    const existing = videosRef.current.get(key);
    if (existing === el) {
      if (!(el as any).__pipRegDedupLogged) {
        (el as any).__pipRegDedupLogged = true;
        pushHandoffLog(`[PiP] pipRegDedup=1 firstHit key=${key}`);
      }
      return;
    }
    // Pass-18 Fix 1: event-driven rebind wake signal. Time-capped retry can't
    // cover the 62-second hole pass-16 caught at 00:23:44 (rebind key=null
    // layerKeys=0 → tile text-only across work→rest→work until a natural
    // displayedUrl change rescued it). The registry itself is the wake:
    // when a NEW layer entry lands and the current binding is null or its
    // src doesn't match expectedUrlRef, invoke the resolver immediately.
    // Only layer:* keys — phase-name entries already ride the widened scan.
    const isNewEntry = !existing;
    videosRef.current.set(key, el);
    // iOS Safari needs the legacy webkit-playsinline attribute (expo-av only
    // sets the modern playsInline prop) or playback hijacks into fullscreen.
    if (Platform.OS === 'web') {
      try {
        const node = typeof el._nativeRef?.current?.getVideoElement === 'function'
          ? el._nativeRef.current.getVideoElement()
          : null;
        if (node?.setAttribute) {
          // Pass 12: crossOrigin=anonymous BEFORE src prevents canvas taint
          // when the movement <video> is drawn into the PiP canvas.
          // captureStream() from a tainted canvas silently stops delivering
          // frames — the on-page canvas keeps painting but the PiP tile
          // freezes. Same class as useWorkoutTTS.ts:176's audio-graph
          // lesson. Firebase Storage already serves CORS headers (the audio
          // path proves it). If expo-av set src before the ref callback
          // fired, load() forces a CORS-enabled refetch.
          if ((node as HTMLVideoElement).crossOrigin !== 'anonymous') {
            const hadSrc = !!(node as HTMLVideoElement).currentSrc || !!(node as HTMLVideoElement).src;
            (node as HTMLVideoElement).crossOrigin = 'anonymous';
            node.setAttribute('crossorigin', 'anonymous');
            if (hadSrc) { try { (node as HTMLVideoElement).load(); } catch { /* best-effort */ } }
          }
          node.playsInline = true;
          node.setAttribute('playsinline', '');
          node.setAttribute('webkit-playsinline', '');
          // Pass-17: auto-resume when iOS pauses the element under us. The
          // pass-15 device log showed the bound PiP element with vpaused=
          // true throughout every rest EXCEPT rest #1 (the only rest with
          // no preceding work→rest transition). Rest #1 the element stayed
          // vpaused=false and rolled seamlessly into work #1. Every later
          // rest was frozen. The most parsimonious explanation is iOS
          // pauses <video> elements when the audio session is interrupted
          // by the end-of-work TTS cue — expo-av's shouldPlay prop is
          // unchanged so it never re-issues play(). Mirror the visibility-
          // change resume pattern at line 847 but per-element: whenever a
          // layer pauses while the user hasn't paused, re-issue play(). No
          // loop — the pause event only fires on actual pause transitions.
          // Guarded by __pipAutoResumeAttached so re-registers don't
          // stack listeners on the same element.
          if (!(node as any).__pipAutoResumeAttached) {
            (node as any).__pipAutoResumeAttached = true;
            const domNode = node as HTMLVideoElement;
            domNode.addEventListener('pause', () => {
              if (isPausedRef.current) return;
              pushHandoffLog(`[PiP] video auto-resume key=${key} rs=${domNode.readyState}`);
              el.playAsync?.().catch(() => {});
            });
          }
        }
      } catch { /* best-effort */ }
    }
    // Freshly-mounted Videos default to playing; if we're paused right now
    // (e.g. Skip while paused swapped in a new video), pause it immediately.
    if (isPausedRef.current) {
      el.pauseAsync?.().catch(() => {});
    } else {
      // Explicitly start via programmatic play() rather than relying on the
      // HTML autoPlay attribute. Chrome blocks unmuted video autoPlay on
      // first-visit sessions with low MEI, but allows programmatic play()
      // when the page has user activation (set by the "Start" button tap).
      el.playAsync?.().catch(() => {});
    }
    if (Platform.OS === 'web') {
      // expo-av's web <video> gets React's playsInline but not the legacy
      // webkit-playsinline attribute older iOS Safari needs for inline play.
      const domVideo = el._nativeRef?.current?.getVideoElement?.();
      domVideo?.setAttribute?.('webkit-playsinline', '');
    }
    // Pass-18 Fix 1: fire the resolver on new layer registration if the
    // current binding is null or mismatched. This is the wake signal —
    // no polling, no cap, no waiting for the next rAF.
    if (
      Platform.OS === 'web'
      && isNewEntry
      && key.startsWith('layer:')
      && pipSourceResolverRef.current
    ) {
      const bound = pipSourceVideoRef.current;
      const expected = expectedUrlRef.current;
      const boundSrc = bound?.currentSrc || bound?.src || '';
      const mismatched = !bound || (!!expected && boundSrc !== expected);
      if (mismatched) {
        pushHandoffLog(`[PiP] registerVideo trigger key=${key} boundNull=${!bound} matchExpected=${!!expected && boundSrc === expected}`);
        try { pipSourceResolverRef.current(); } catch {}
      }
    }
  }, []);

  // Detached from `phase` on purpose: the displayed video must not restart
  // when the timer rolls work→rest or rest→work. Playback state is driven by
  // the user's pause/resume only; the imperative mirror handles the toggle
  // reliably on web across every mounted Video (intro/outro/transition/
  // waterBreak/shared work-rest layers).
  useEffect(() => {
    for (const el of videosRef.current.values()) {
      if (isPaused) el?.pauseAsync?.().catch(() => {});
      else el?.playAsync?.().catch(() => {});
    }
  }, [isPaused]);

  // iOS Safari pauses every <video> when the tab backgrounds, the screen
  // locks, or an audio interruption fires (call, Siri, another app's media)
  // — and never resumes them. `shouldPlay` can't recover it: the prop value
  // never changed, so expo-av doesn't re-issue play(). Mirror the audio-side
  // foreground recovery: imperatively resume every mounted video unless the
  // member paused on purpose. pageshow covers bfcache restores; focus covers
  // iOS overlay dismissals that don't fire visibilitychange.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const resumeAll = () => {
      if (document.visibilityState !== 'visible') return;
      if (isPausedRef.current) return;
      for (const el of videosRef.current.values()) {
        el?.playAsync?.().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', resumeAll);
    window.addEventListener('pageshow', resumeAll);
    window.addEventListener('focus', resumeAll);
    return () => {
      document.removeEventListener('visibilitychange', resumeAll);
      window.removeEventListener('pageshow', resumeAll);
      window.removeEventListener('focus', resumeAll);
    };
  }, []);

  // ── MediaSession API (C) ──────────────────────────────────────────────────
  // Registers OS-level media controls (lock screen, Now Playing widget, headset
  // buttons) so the member can pause/skip without unlocking the phone.
  // Feature-detected: only wires on web, only when the API is available.
  // Also signals to iOS that media is actively playing, which helps prevent
  // AudioContext auto-suspend alongside the graph keepalive oscillator.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof navigator === 'undefined') return;
    if (!('mediaSession' in navigator)) return;
    if (phase === 'ready' || phase === 'complete') return;

    const title = current?.name || (workout?.title ?? workout?.name ?? 'GoArrive Workout');
    const workoutTitle = workout?.title ?? workout?.name ?? 'GoArrive';
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title,
        artist: 'GoArrive',
        album: workoutTitle,
      });
      navigator.mediaSession.setActionHandler('play', () => {
        if (isPaused) handlePauseResume();
      });
      navigator.mediaSession.setActionHandler('pause', () => {
        if (!isPaused) handlePauseResume();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        handleSkip();
      });
      // previoustrack: seek back to the start of the current step so the
      // member can replay the current movement without jumping backward.
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        seekRelative(-timeLeft);
      });
    } catch {}
    return () => {
      try {
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
        navigator.mediaSession.setActionHandler('previoustrack', null);
      } catch {}
    };
  }, [phase, current?.name, workout?.title, workout?.name, isPaused, handlePauseResume, handleSkip, seekRelative, timeLeft]);

  // ── PiP (D) ──────────────────────────────────────────────────────────────
  // Picture-in-Picture for the movement demo video. Lets the member follow
  // the movement guide in a floating tile while navigating other apps.
  // isPiP state is declared above the canvas-stream hook so it can gate it.

  // Imperative arm: called from the PiP button's onPressIn (touch-down).
  // React state + useEffect chain is too slow between onPressIn and onPress
  // (~10ms) for iOS's gesture-scoped requestPictureInPicture() requirement,
  // so we synchronously create the canvas MediaStream, assign srcObject on
  // the hidden video, and start playback all inside the same call stack.
  // pipArming is still set so the hook's enable path stays consistent and
  // the 3s safety timeout clears state if iOS silently refuses.
  //
  // All diagnostic paths write to pushHandoffLog (COPY LOG buffer) so the
  // tester can read what happened on an iPhone without DevTools.
  const armPip = useCallback(() => {
    if (Platform.OS !== 'web') return;
    // Pass-16 Fix 2: gesture-blessed resume of the liveness ctx. Pass-15
    // caught PiP entry with livenessCtx=suspended after a voice-cue
    // suspend/interrupt storm; a resume() attempted from a non-gesture
    // path can be rejected by iOS. armPip's onPressIn is the earliest
    // point in the tap flow we hold a gesture, so we spend it here
    // unconditionally — noop if already running.
    resumeLivenessCtx('armPip');
    pushHandoffLog(`[PiP] armPip fired livenessCtx=${getLivenessCtxState()}`);
    setPipArming(true);
    window.setTimeout(() => setPipArming(false), 3000);

    // Pass-4: stream is warm from mount; startStream() is idempotent so this
    // returns the existing MediaStream. attachAudioTracks() is the load-bearing
    // call for probe=audio — adds audio tracks to the already-playing stream
    // inside the tap gesture, just before requestPictureInPicture unmutes.
    const stream = startStream();
    if (!stream) {
      pushHandoffLog('[PiP] armPip: startStream returned null');
      return;
    }
    // Canvas mode is the no-audio control — never merge the music bus into it.
    if (pipProbeMode !== 'canvas') {
      const audioResult = attachAudioTracks();
      pushHandoffLog(`[PiP] armPip: attachAudioTracks=${audioResult}`);
    }
    const vid = pipCanvasVideoRef.current;
    if (!vid) {
      pushHandoffLog('[PiP] armPip: pipCanvasVideoRef null (probe=canvas has no target)');
      return;
    }
    // srcObject may already be assigned from the keep-warm effect below; only
    // reassign if it's a different stream (identity check avoids Safari's
    // "reset readyState on srcObject set" behavior).
    if ((vid as any).srcObject !== stream) {
      try {
        (vid as any).srcObject = stream;
        pushHandoffLog('[PiP] armPip: srcObject assigned');
      } catch (err: any) {
        pushHandoffLog(`[PiP] armPip: srcObject assign threw: ${err?.name || err}`);
        return;
      }
    } else {
      pushHandoffLog(`[PiP] armPip: srcObject already set readyState=${vid.readyState}`);
    }
    try {
      const p = vid.play();
      if (p && typeof (p as any).catch === 'function') {
        (p as any).catch((e: any) => pushHandoffLog(`[PiP] armPip: play rejected: ${e?.name || e}`));
      }
    } catch (err: any) {
      pushHandoffLog(`[PiP] armPip: play threw: ${err?.name || err}`);
    }
  }, [startStream, attachAudioTracks, pipProbeMode]);

  const handlePiP = useCallback(async () => {
    pushHandoffLog('[PiP] handlePiP fired');
    // Exit path — if we're already in PiP, tear it down. Works for both the
    // standard PiP element registry and the iOS webkit presentation mode.
    if ((document as any).pictureInPictureElement) {
      pushHandoffLog('[PiP] handlePiP: exiting existing PiP');
      try { await (document as any).exitPictureInPicture(); } catch (err: any) {
        pushHandoffLog(`[PiP] exitPictureInPicture err: ${err?.name || err}`);
      }
      return;
    }
    const canvasVideo = pipCanvasVideoRef.current;
    if (canvasVideo && (canvasVideo as any).webkitPresentationMode === 'picture-in-picture') {
      pushHandoffLog('[PiP] handlePiP: exiting webkit PiP');
      try { (canvasVideo as any).webkitSetPresentationMode('inline'); } catch (err: any) {
        pushHandoffLog(`[PiP] webkitSetPresentationMode inline err: ${err?.name || err}`);
      }
      return;
    }
    if (!canvasVideo) {
      pushHandoffLog('[PiP] handlePiP: canvas video ref null — probe mode may not be "full"');
      console.warn('[PiP] canvas video ref is null — probe mode may not be "full"');
      setPipArming(false);
      return;
    }
    // Report the presentation-target readiness state so a silent failure
    // (readyState=0, srcObject=null) is diagnosable from COPY LOG alone.
    const hasSrc = !!(canvasVideo as any).srcObject;
    const dpip = (canvasVideo as any).disablePictureInPicture;
    const dpipAttr = canvasVideo.hasAttribute('disablePictureInPicture');
    const idTag = (canvasVideo as any).__pipIdTag ?? '?';
    pushHandoffLog(`[PiP] handlePiP: srcObject=${hasSrc} readyState=${canvasVideo.readyState} paused=${canvasVideo.paused} dpip=${dpip} dpipAttr=${dpipAttr} id=${idTag}`);
    // Unmute inside the tap gesture — this is the seam iOS is strictest about.
    try {
      canvasVideo.muted = false;
      canvasVideo.volume = 1;
    } catch (err: any) {
      pushHandoffLog(`[PiP] unmute rejected: ${err?.name || err}`);
      console.warn('[PiP] unmute rejected:', err);
    }
    // Pass-8: flip entry order — standard requestPictureInPicture() FIRST,
    // webkit fallback second. Pass 7 showed webkitSetPresentationMode
    // silently refused 15/15 attempts (modeAfter=inline, event never fired)
    // even though frames were flowing at 1x realtime with a visible canvas.
    // Two reasons for the flip:
    //   1) Standard API rejects with a NAMED error (NotSupportedError,
    //      NotAllowedError, InvalidStateError). Silent refusals become
    //      diagnosis; even total failure names its cause.
    //   2) The 08/13 spike — the one time end-to-end worked on this device
    //      — entered via requestPictureInPicture, not the webkit call.
    //      Visible canvas is the other half of the spike's recipe.
    // Webkit fallback preserved because pass 5 showed the standard API can
    // reject with NotSupportedError on MediaStream sources on some builds.
    const hasWebkit = typeof (canvasVideo as any).webkitSetPresentationMode === 'function';
    const hasStandard = !!(document as any).pictureInPictureEnabled
      && typeof (canvasVideo as any).requestPictureInPicture === 'function';
    const runWebkitProbe = () => {
      window.setTimeout(() => {
        try {
          const modeAfter = (canvasVideo as any).webkitPresentationMode;
          pushHandoffLog(`[PiP] webkitPresentationMode@500ms=${modeAfter}`);
        } catch (err: any) {
          pushHandoffLog(`[PiP] webkitPresentationMode@500ms read err: ${err?.name || err}`);
        }
      }, 500);
    };
    try {
      let attempted = false;
      if (hasStandard) {
        try {
          await (canvasVideo as any).requestPictureInPicture();
          pushHandoffLog('[PiP] requestPictureInPicture resolved (preferred)');
          attempted = true;
        } catch (err: any) {
          pushHandoffLog(`[PiP] requestPictureInPicture rejected: ${err?.name || 'unknown'} — ${err?.message || ''}`);
          if (!hasWebkit) throw err;
          // else fall through to webkit fallback
        }
      }
      if (!attempted && hasWebkit) {
        (canvasVideo as any).webkitSetPresentationMode('picture-in-picture');
        pushHandoffLog(`[PiP] webkitSetPresentationMode picture-in-picture called (${hasStandard ? 'fallback after standard rejected' : 'no standard API'})`);
        runWebkitProbe();
        attempted = true;
      }
      if (!attempted) {
        pushHandoffLog('[PiP] no PiP API available on this browser');
        console.warn('[PiP] no PiP API available on this browser');
        setPipArming(false);
        try { canvasVideo.muted = true; } catch {}
      }
    } catch (err: any) {
      pushHandoffLog(`[PiP] request rejected: ${err?.name || err} — ${err?.message || ''}`);
      console.warn('[PiP] request rejected:', err);
      setPipArming(false);
      try { canvasVideo.muted = true; } catch {}
      // Pass-5 exit path: a failed entry leaves the hidden video carrying
      // merged audio inline for the rest of the session — the P0 config that
      // starves foreground music. Strip audio tracks so inline music returns.
      detachAudioTracks();
    }
  }, [detachAudioTracks]);

  const pipSupported = Platform.OS === 'web'
    && typeof document !== 'undefined'
    && ((document as any).pictureInPictureEnabled
      || typeof (document.createElement('video') as any).webkitSetPresentationMode === 'function');

  // ── Tap-to-show controls ──────────────────────────────
  const [showControls, setShowControls] = useState(false);
  const controlsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [videoReady, setVideoReady] = useState(false);

  // ── Playback speed ────────────────────────────
  const { speed } = usePlaybackSpeed(current?.id);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.setRateAsync?.(speed, true).catch(() => {});
  }, [speed, currentIndex, videoReady]);

  const handleVideoTap = useCallback(() => {
    setShowControls(prev => {
      const next = !prev;
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
      if (next) {
        controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
      }
      return next;
    });
  }, []);

  // Reset the auto-hide timer so the overlay stays visible while the user is
  // actively interacting (e.g. repeated Skip taps). Phase/movement changes must
  // NOT force-hide the overlay — it should fade only when the user stops.
  const extendControlsTimer = useCallback(() => {
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  // ── Post-interruption touch recovery (web) ───────────────────────────
  // iOS bug: when a phone call interrupts a standalone PWA, the in-call
  // status bar shifts the visual viewport; after the call ends WebKit can
  // leave touch hit-testing misaligned with the rendered layer — every tap
  // lands offset from the drawn buttons, so the whole player feels dead
  // while audio keeps playing. On every return-to-foreground signal we
  // re-anchor the scroll position, force a reflow, re-dispatch resize so
  // the artboard scale recomputes, and clear any responder RNW left stuck
  // mid-touch when the call stole the gesture.
  useEffect(() => {
    if (Platform.OS !== 'web' || !visible) return;
    if (typeof window === 'undefined') return;
    const resync = () => {
      try {
        const ae = document.activeElement as HTMLElement | null;
        // Don't fight the on-screen keyboard while an input is focused.
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        void document.body.offsetHeight;
        window.dispatchEvent(new Event('resize'));
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const rs = require('react-native-web/dist/modules/useResponderEvents/ResponderSystem');
          rs.terminateResponder?.();
        } catch {}
        console.info('[VOICE-AUDIT] player touch resync', {
          innerH: window.innerHeight,
          vvH: window.visualViewport?.height,
          vvTop: window.visualViewport?.offsetTop,
        });
      } catch {}
    };
    const onVis = () => { if (document.visibilityState === 'visible') resync(); };
    window.addEventListener('focus', resync);
    window.addEventListener('pageshow', resync);
    document.addEventListener('visibilitychange', onVis);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', resync);
    vv?.addEventListener('scroll', resync);
    return () => {
      window.removeEventListener('focus', resync);
      window.removeEventListener('pageshow', resync);
      document.removeEventListener('visibilitychange', onVis);
      vv?.removeEventListener('resize', resync);
      vv?.removeEventListener('scroll', resync);
    };
  }, [visible]);

  const handleSkipFromOverlay = useCallback(() => {
    // Cancel any audio from the skipped-from state BEFORE advancing. This
    // stops the in-flight MP3/voice clip and clears pending deferred cues so
    // they don't overlap with the new skip target's audio.
    stopAllAudio();
    handleSkip();
    extendControlsTimer();
  }, [handleSkip, extendControlsTimer, stopAllAudio]);

  // ── Intro announcement (spoken welcome before the first movement) ─────
  // Plays a coach-editable AI-generated TTS welcome when Play is tapped,
  // BEFORE handleStart() kicks the timer. Skippable via tap. Web-only, like
  // the rest of the voice pipeline. Routed through the serialized voice queue
  // (playExclusiveVoice) so it can never overlap cues, and music is held
  // until it finishes.
  const [announcementUrl, setAnnouncementUrl] = useState<string | null>(null);
  const [announcementActive, setAnnouncementActive] = useState(false);
  const announcementFetchedTextRef = useRef<string | null>(null);
  const announcementDoneRef = useRef(false);
  const announcementStartedRef = useRef(false);

  const announcementEnabled = workout?.introAnnouncementEnabled !== false;
  const announcementText = useMemo(() => {
    if (!announcementEnabled) return '';
    const coachText = typeof workout?.introAnnouncementText === 'string'
      ? workout.introAnnouncementText.trim()
      : '';
    if (coachText) return coachText;
    const musclesByMovementId: Record<string, string[]> = {};
    for (const fm of flatMovements) {
      if (fm.movementId && Array.isArray(fm.primaryMuscles) && fm.primaryMuscles.length > 0) {
        musclesByMovementId[fm.movementId] = fm.primaryMuscles;
      }
    }
    return buildDefaultIntroScript(workout, musclesByMovementId);
  }, [announcementEnabled, workout, flatMovements]);

  // Prefetch the intro MP3 while the ready screen shows so Play never waits
  // on the TTS round trip. Coach-saved URL is used directly when its hash
  // still matches the effective script; otherwise generate lazily (Storage
  // cache makes repeats cheap). Debounced so movement hydration can deliver
  // primaryMuscles before the default script's hash is locked in. If the
  // clip isn't ready at Play-tap time, the workout just starts without it.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    if (!announcementEnabled || !announcementText || phase !== 'ready') return;
    if (
      workout?.introAnnouncementVoiceUrl
      && workout?.introAnnouncementVoiceHash === introAnnouncementHash(announcementText)
    ) {
      setAnnouncementUrl(workout.introAnnouncementVoiceUrl);
      return;
    }
    if (announcementFetchedTextRef.current === announcementText) return;
    const timer = setTimeout(() => {
      announcementFetchedTextRef.current = announcementText;
      const requestedText = announcementText;
      generateIntroAnnouncementVoice(workout?.id || workout?.workoutId || '', requestedText)
        .then(({ url }) => {
          // Ignore stale responses from a script that has since changed.
          if (url && announcementFetchedTextRef.current === requestedText) {
            setAnnouncementUrl(url);
          }
        });
    }, 1500);
    return () => clearTimeout(timer);
  }, [announcementEnabled, announcementText, phase, workout]);

  const finishAnnouncement = useCallback(() => {
    if (announcementDoneRef.current) return;
    announcementDoneRef.current = true;
    // Flush without resetting spoken-state so a skip tap stops the clip
    // immediately; on natural end the queue is already idle and this is a
    // no-op. Then let the music in and start the workout.
    stopAllAudio(false);
    releaseMusicHold();
    setAnnouncementActive(false);
    handleStart();
  }, [handleStart, stopAllAudio, releaseMusicHold]);

  // iOS Safari autoplay policy: HTMLAudioElement.play() and AudioContext
  // resume are only allowed from inside a user gesture. Every tap that can
  // start audio-producing flows must unlock synchronously — Start is the
  // primary unlock; pause/resume is belt-and-braces (e.g. after the tab was
  // backgrounded and iOS re-suspended the context).
  const handleStartWithUnlock = useCallback(() => {
    unlockAudioPlayback();
    unlockAudioContext();
    // Intro announcement gate: speak the welcome clip through the serialized
    // voice queue before the timer starts. Music is primed in-gesture but
    // held silent until the announcement settles (finishAnnouncement).
    const wantsAnnouncement =
      Platform.OS === 'web'
      && announcementEnabled
      && !!announcementUrl
      && !isMuted
      && !announcementDoneRef.current;
    if (wantsAnnouncement && !announcementStartedRef.current) {
      announcementStartedRef.current = true;
      musicHoldRef.current = true;
      startMusic();
      playExclusiveVoice(announcementUrl as string, finishAnnouncement);
      setAnnouncementActive(true);
      return;
    }
    if (wantsAnnouncement) return; // double-tap while announcement pending
    startMusic();
    handleStart();
  }, [handleStart, startMusic, announcementEnabled, announcementUrl, isMuted, finishAnnouncement, playExclusiveVoice]);

  const handlePauseResumeFromOverlay = useCallback(() => {
    unlockAudioPlayback();
    unlockAudioContext();
    handlePauseResume();
    extendControlsTimer();
  }, [handlePauseResume, extendControlsTimer]);

  const handleRepDoneFromOverlay = useCallback(() => {
    handleRepDone();
    extendControlsTimer();
  }, [handleRepDone, extendControlsTimer]);

  const handleSeek10 = useCallback((deltaSec: number) => {
    // Cancel any in-flight audio + queued cues BEFORE seeking. seekRelative can
    // cross multiple phase boundaries in one jump; each crossing would otherwise
    // enqueue that phase's voice/cues, replaying the spanned audio in order.
    // Mirrors the Skip button's behavior (handleSkipFromOverlay above).
    stopAllAudio();
    seekRelative(deltaSec);
    extendControlsTimer();
  }, [seekRelative, extendControlsTimer, stopAllAudio]);

  useEffect(() => {
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, []);

  // ── Format time ───────────────────────────────────────────────────────
  // Ceil so a fractional Skip pre-entry (e.g. timeLeft=3.5) still displays as
  // a clean integer countdown (4,3,2,1) instead of "3.5, 2.5, 1.5".
  const formatTime = (sec: number): string => {
    const total = Math.max(0, Math.ceil(sec));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}`;
  };

  // Dominant-digit timer sizing. Char-count tiers are scaled by frameScale so
  // the timer text grows with the player frame. Box is also scaled (see
  // the factory-scaled goldTimerBox/restTimerBox) so the box/font ratio stays
  // the same on every size.
  const getTimerFontStyle = (
    text: string,
  ): { fontSize: number; lineHeight: number; letterSpacing: number } => {
    const len = (text || '').length;
    if (len <= 2) return { fontSize: fs(96), lineHeight: fs(96), letterSpacing: fs(-2) };
    if (len === 3) return { fontSize: fs(64), lineHeight: fs(68), letterSpacing: fs(-1) };
    return { fontSize: fs(48), lineHeight: fs(52), letterSpacing: 0 };
  };

  // Auto-shrink the movement-name font so the name fits the fixed title
  // module without mid-word breaks. Tier-picking algorithm lives in
  // WorkoutPlayer.helpers.ts (pickNameTier) — scale-free: computed in BASE
  // units (both font size and available width scale by the same factor), so
  // the picked tier is identical on every screen size.
  const NAME_MAX_LINES = 3;
  const getNameFontStyle = (
    text: string,
    baseAvailWidth: number,
    maxLines: number = NAME_MAX_LINES,
    maxFontSize?: number,
    maxHeight?: number,
  ): { fontSize: number; lineHeight: number } => {
    const t = pickNameTier(text, baseAvailWidth, maxLines, maxFontSize, maxHeight);
    return { fontSize: fs(t.size), lineHeight: fs(t.line) };
  };

  // Inner content width of titleColumn in BASE units. titleColumn has
  // marginRight: 4 and paddingHorizontal: 8 (both in BASE units, scaled by
  // the makeStyles factory). The timer column, when present,
  // is a fixed BASE 132. Used by getNameFontStyle to pick a tier that never
  // overflows and never mid-word-breaks.
  const BASE_TITLE_INNER_W_WITH_TIMER = Math.max(0, baseMediaW - 132 - 4 - 16);
  const BASE_TITLE_INNER_W_NO_TIMER = Math.max(0, baseMediaW - 16);

  // Shared auto-fit title text. Every state that renders content in the top
  // title module uses this — work movement name, rest "Next: <name>",
  // transition name, grab-equipment name, swap name, demo block name — so
  // shrink rules (no mid-word breaks, no ellipses when the text can wrap or
  // shrink, scale-invariant tiering) stay identical across phases. Phases
  // that pair the title with a small label above (REST, TRANSITION, GRAB
  // EQUIPMENT, SWITCH SIDES) pass maxLines=2 so both fit inside the fixed
  // 112-unit title module; the work phase keeps the original 3-line budget.
  const renderAutoFitTitle = (
    text: string,
    opts: { hasTimer?: boolean; maxLines?: number; color?: string; marginTop?: number; maxFontSize?: number; maxHeight?: number } = {},
  ): React.ReactNode => {
    const hasTimer = opts.hasTimer ?? true;
    const maxLines = opts.maxLines ?? NAME_MAX_LINES;
    const color = opts.color ?? '#FFFFFF';
    const baseWidth = hasTimer
      ? BASE_TITLE_INNER_W_WITH_TIMER
      : BASE_TITLE_INNER_W_NO_TIMER;
    return (
      <Text
        style={[
          st.workMovementName,
          { color },
          opts.marginTop != null ? { marginTop: fs(opts.marginTop) } : null,
          getNameFontStyle(text, baseWidth, maxLines, opts.maxFontSize, opts.maxHeight),
          Platform.OS === 'web'
            ? ({ wordBreak: 'normal', overflowWrap: 'break-word' } as any)
            : null,
        ]}
        numberOfLines={maxLines}
      >
        {text}
      </Text>
    );
  };

  // All module dimensions (logo, timer box, next-up bar, labels) are scaled
  // inside the makeStyles factory — no per-render override objects needed.
  const handleFinish = () => {
    if (onSwapLog) {
      const swaps = getSwapLog();
      if (swaps.length > 0) onSwapLog(swaps);
    }
    if (onHeartRateSummary) onHeartRateSummary(hrSessionRef.current);
    onComplete();
  };

  // Release the strap when the player closes (component may stay mounted).
  useEffect(() => {
    if (!visible) hrDisconnectRef.current();
  }, [visible]);

  // ── Count exercise steps for progress display ─────────────────────
  const exerciseSteps = flatMovements.filter(f => f.stepType === 'exercise');
  const exerciseIndex = exerciseSteps.indexOf(current as any);
  const exerciseTotal = exerciseSteps.length;

  // ── Single source of truth: which timeline item should be on screen now? ───
  // Reveal-ahead pattern: the displayed item == the "current upcoming work item."
  // It switches to the next timeline item at REVEAL_LEAD_SECONDS before the current
  // phase ends, then stays through any rest + the next item's content, until 3.5s
  // before that next item ends. Same rule covers movement→movement, movement→rest,
  // movement→water break, movement→demo, movement→grab equipment.
  //
  // Exception: swap-sides movements stay on the current movement during the L-side
  // lookahead (the R side of the same movement is coming next, not a new item).
  const { activeVideoUrl, activeThumbUrl, isInRevealWindow, revealDisplayItem } = useMemo<{
    activeVideoUrl: string | null;
    activeThumbUrl: string | null;
    isInRevealWindow: boolean;
    revealDisplayItem: any;
  }>(() => {
    if (!current) return { activeVideoUrl: null, activeThumbUrl: null, isInRevealWindow: false, revealDisplayItem: null };

    // Resolve a timeline item to a displayable {video, thumb} pair, falling back
    // to the next exercise's media if the item itself has none (e.g. waterBreak,
    // grabEquipment, transition often carry no media of their own).
    const pickAsset = (item: any, indexOfItem: number) => {
      if (!item) return { activeVideoUrl: null, activeThumbUrl: null };
      if (item.videoUrl || item.thumbnailUrl || item.posterUrl) {
        // Still-image media renders through the Image fallback path,
        // never through a <Video> layer — surface it as the thumb.
        if (isImageUrl(item.videoUrl)) {
          return { activeVideoUrl: null, activeThumbUrl: item.videoUrl };
        }
        return {
          activeVideoUrl: item.videoUrl ?? null,
          activeThumbUrl: item.thumbnailUrl ?? item.posterUrl ?? null,
        };
      }
      // Placeholder movements are exercises that intentionally have no video yet.
      // Don't borrow the next movement's media — return null URLs so the
      // placeholder render path takes over.
      if (item.stepType === 'exercise') {
        return { activeVideoUrl: null, activeThumbUrl: null };
      }
      for (let i = indexOfItem + 1; i < flatMovements.length; i++) {
        const m = flatMovements[i];
        if (m.stepType === 'exercise' && (m.videoUrl || m.thumbnailUrl || m.posterUrl)) {
          if (isImageUrl(m.videoUrl)) {
            return { activeVideoUrl: null, activeThumbUrl: m.videoUrl ?? null };
          }
          return { activeVideoUrl: m.videoUrl ?? null, activeThumbUrl: m.thumbnailUrl ?? m.posterUrl ?? null };
        }
      }
      return { activeVideoUrl: null, activeThumbUrl: null };
    };

    let displayItem: any = current;
    let displayIndex = currentIndex;
    let inRevealWindow = false;

    // Suppress the reveal only during work-L of a swap-sides movement — the R
    // side of the SAME movement is coming next, not a new item. work-R is NOT
    // suppressed: its reveal shows the next movement's start (always unmirrored).
    const stayingOnSameMovement =
      phase === 'work' && current?.swapSides === true && swapSide === 'L';

    const isTimedRevealPhase =
      phase === 'work' || phase === 'transition' || phase === 'waterBreak'
      || phase === 'grabEquipment' || phase === 'demo';

    if (phase === 'rest' && next) {
      // Rest is the bridge between current and next; show next throughout.
      displayItem = next;
      displayIndex = currentIndex + 1;
      inRevealWindow = true;
    } else if (
      isTimedRevealPhase
      && !isRepBased
      && !stayingOnSameMovement
      && timeLeft > 0
      && timeLeft <= REVEAL_LEAD_SECONDS
      && next
    ) {
      // Last 3.5s of any timed phase: preview the next timeline item.
      displayItem = next;
      displayIndex = currentIndex + 1;
      inRevealWindow = true;
    }

    return {
      ...pickAsset(displayItem, displayIndex),
      isInRevealWindow: inRevealWindow,
      revealDisplayItem: inRevealWindow ? displayItem : null,
    };
  }, [phase, timeLeft, current, next, currentIndex, isRepBased, swapSide, flatMovements]);

  // ── Double-buffered video layers, with eager preload ─────────────────
  // We render up to two Video elements at once: the one being shown, and
  // the upcoming one mounted invisibly so it has time to fully decode
  // before the reveal point. When activeVideoUrl flips at the 3.5s mark,
  // the upcoming layer is already ready, so the visibility swap is
  // instantaneous — no poster flash, no waiting on load.
  //
  // displayedUrl is the layer that's actually painted on screen. It only
  // changes once a new layer reports ready, so the outgoing video keeps
  // playing visibly until the incoming one can take over without a gap.
  const preloadVideoUrl = useMemo<string | null>(() => {
    if (!activeVideoUrl) return null;
    for (let offset = 1; offset <= 3; offset++) {
      const url = flatMovements[currentIndex + offset]?.videoUrl;
      if (url && url !== activeVideoUrl && !isImageUrl(url)) return url;
    }
    return null;
  }, [activeVideoUrl, currentIndex, flatMovements]);

  const [videoLayers, setVideoLayers] = useState<Array<{ url: string; ready: boolean }>>([]);
  const [displayedUrl, setDisplayedUrl] = useState<string | null>(null);

  // Pass-15 Fix 1: expected-URL-driven resolver + bounded retry.
  //
  // Pass-14 selection quality worked (picker preferred !paused && rs>=3)
  // but targeting failed. Two classes of miss showed up on device:
  //   Class 1 — empty registry (layerKeys=0) at movement start: resolver
  //     bound null once, drawFrame kept calling but the "no candidate"
  //     branch only re-logs on state change so we saw ~30s of text-only
  //     tile with no rebind entries.
  //   Class 2 — single stale layer held for 90+ seconds across multiple
  //     movements: picker had no concept of what SHOULD play, so any
  //     playing candidate was "good enough" even when it was the wrong
  //     movement's video.
  //
  // Pass-15 fixes both:
  //   1. expected = activeVideoUrl (encodes reveal walk-forward — during
  //      rest it's already the next movement's URL). Prefer expected
  //      match && !paused && rs>=3 first, expected match paused second.
  //      A non-matching stale layer is worse than a short retry window.
  //   2. On no-match: track first-miss timestamp per expected URL.
  //      Return null (retry) for up to 3s before falling back to any
  //      playing candidate. drawFrame calls the resolver every rAF tick
  //      when videoEl is null/paused, so retries are automatic.
  //   3. Widen scan beyond `layer:*` — transition/grabEquipment/
  //      waterBreak/followAlong/intro/outro register under phase-name
  //      keys (WorkoutPlayer.tsx registerVideo call sites). Read
  //      el.currentSrc to match the URL regardless of the map key
  //      format. That closes the "layerKeys=0 while movement plays on
  //      screen" gap: the visible element IS in videosRef, just under
  //      a phase-name key.
  //   4. Every rebind log carries expected=<shortUrl> + match=true/false
  //      so wrong-binds are visible in the log immediately.
  //
  // Effect keeps deps on phase/currentIndex/displayedUrl so the log
  // closure captures fresh values for the rebind context fields.
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    // Pass-20 R6 keepPrev log throttle. R5 device log had the keepPrev
    // path running per-frame from 17:04:09→17:06:15 (hundreds of lines
    // at 20Hz) — visually fine but flooded the 5000-entry ring buffer.
    // One line per second with count-since-last preserves signal
    // without ring pressure. Vars live in the effect closure so a
    // phase change (which re-runs the effect) resets the throttle.
    let keepPrevLastLogAt = 0;
    let keepPrevSinceLastLogCount = 0;

    // Pass-16: log the full /videos/<file> segment (not just the coach
    // prefix). Pass-15 truncated to 32 chars which cut off exactly at
    // the shared coach-prefix `movements%2F<coachId>%2F...`, making
    // every rebind's expected= look identical in the log even when the
    // actual URLs differed. Grab the segment starting at `videos%2F`
    // if present (Firebase Storage URL shape), else the last two path
    // components — that always includes the discriminating filename.
    const shortUrl = (u: string | null): string => {
      if (!u) return 'null';
      const vIdx = u.indexOf('videos%2F');
      if (vIdx >= 0) {
        const tail = u.slice(vIdx);
        const qIdx = tail.indexOf('?');
        return qIdx >= 0 ? tail.slice(0, qIdx) : tail;
      }
      const slashIdx = u.lastIndexOf('/', u.lastIndexOf('/') - 1);
      return slashIdx >= 0 ? u.slice(slashIdx + 1) : u;
    };

    const resolve = (): HTMLVideoElement | null => {
      const map = videosRef.current;
      const expected = expectedUrlRef.current;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();

      const readVideoEl = (el: any): HTMLVideoElement | null => {
        try { return el?._nativeRef?.current?.getVideoElement?.() ?? null; } catch { return null; }
      };

      // Reset the miss window whenever expected URL changes so each
      // new movement gets its own fresh 3s retry budget.
      if (expectedMissAtRef.current.url !== expected) {
        expectedMissAtRef.current = { url: expected, ts: 0 };
      }

      // Widened scan: read el.currentSrc to match the URL, ignoring
      // whether the map key is `layer:` or a phase-name (transition,
      // grabEquipment, etc.).
      type Cand = { key: string; el: HTMLVideoElement; paused: boolean; rs: number; matches: boolean };
      const cands: Cand[] = [];
      for (const [key, entry] of map.entries()) {
        const el = readVideoEl(entry);
        if (!el) continue;
        const src = el.currentSrc || el.src || '';
        const matches = !!expected && src === expected;
        cands.push({ key, el, paused: el.paused, rs: el.readyState, matches });
      }

      // Pass-19 R2: when multiple candidates match the expected URL
      // (e.g. INCOMING and current share a movement URL during transition),
      // prefer the element registered under the exact `layer:${expected}`
      // key before falling to any-match. This prevents the INCOMING element
      // from stealing the bind away from the already-decoded current layer.
      // Preference order:
      //   1a. layer:${expected} key + playing + decoded (exact-key first-class)
      //   1b. any match + playing + decoded (first-class hit)
      //   2a. layer:${expected} key at all (correct element even if paused)
      //   2b. any match at all (correct URL even if paused)
      //   3.  after 3s no-match cap: any playing decoded candidate
      const exactLayerKey = expected ? `layer:${expected}` : null;
      let pick: Cand | null = null;
      pick = cands.find((c) => c.matches && !c.paused && c.rs >= 3 && c.key === exactLayerKey) ?? null;
      if (!pick) pick = cands.find((c) => c.matches && !c.paused && c.rs >= 3) ?? null;
      if (!pick) pick = cands.find((c) => c.matches && c.key === exactLayerKey) ?? null;
      if (!pick) pick = cands.find((c) => c.matches) ?? null;

      if (!pick) {
        if (expectedMissAtRef.current.ts === 0) expectedMissAtRef.current.ts = now;
        const missElapsedMs = now - expectedMissAtRef.current.ts;
        if (missElapsedMs >= 3000) {
          pick = cands.find((c) => !c.paused && c.rs >= 3) ?? null;
          if (!pick) {
            const el = readVideoEl(videoRef.current);
            if (el) pick = { key: 'videoRef', el, paused: el.paused, rs: el.readyState, matches: false };
          }
        }
      } else {
        // Reset the miss clock; the URL slot stays associated so a
        // fresh miss under the same expected restarts from zero.
        expectedMissAtRef.current.ts = 0;
      }

      const prev = pipSourceVideoRef.current;
      // Pass-20 R4v2 keep-bound: on no-match, keep the previous binding
      // rather than nulling it. The prior code unbound on every mismatch,
      // which combined with ref-callback identity churn caused the tile
      // to blink black across reveals.
      //
      // Pass-20 R6: extend keepPrev to cover cands=0 too. R5 device log
      // showed the registry itself oscillating (cands 1→0→1 at ~1Hz);
      // every empty beat previously nulled the binding under the old
      // `cands.length > 0` gate, driving the visible flicker. New rule:
      // keep prev whenever the bound element is still alive
      // (isConnected && !paused), regardless of cands count. The alive-
      // check protects against holding a dead element after a real
      // unmount. Log throttled to ≤1/s with count (see R6 flood note
      // in the effect header). pipKeepBound=1 pipKeepBoundR6=1
      const prevAlive = prev !== null && prev.isConnected && !prev.paused;
      if (!pick && prevAlive) {
        keepPrevSinceLastLogCount++;
        if (now - keepPrevLastLogAt >= 1000) {
          pushHandoffLog(`[PiP] pipKeepBound=1 pipKeepBoundR6=1 keepPrev expected=${shortUrl(expected)} phase=${phase} displayedUrl=${shortUrl(displayedUrl)} cands=${cands.length} countSinceLast=${keepPrevSinceLastLogCount}`);
          keepPrevLastLogAt = now;
          keepPrevSinceLastLogCount = 0;
        }
        return prev;
      }
      if (pick) {
        // Pass-19 R1: if the picked element has readyState < 2, attach a
        // one-shot canplay/loadeddata listener so we re-invoke the resolver
        // as soon as the element becomes drawable — faster than waiting for
        // the next rAF tick. Deduped by r1ListenersAttachedRef.
        // pipPass19R1Retry=1
        if (Platform.OS === 'web' && pick.rs < 2) {
          const ws = r1ListenersAttachedRef.current;
          if (ws && !ws.has(pick.el)) {
            ws.add(pick.el);
            const el = pick.el;
            const onReady = () => {
              el.removeEventListener('canplay', onReady);
              el.removeEventListener('loadeddata', onReady);
              r1RetryCountRef.current++;
              pushHandoffLog(`[PiP] pipPass19R1Retry=1 retryCount=${r1RetryCountRef.current} rs=${el.readyState} resolving`);
              try { pipSourceResolverRef.current?.(); } catch {}
            };
            el.addEventListener('canplay', onReady, { once: true });
            el.addEventListener('loadeddata', onReady, { once: true });
            pushHandoffLog(`[PiP] R1 listener attached rs=${pick.rs} key=${pick.key}`);
          }
        }
        if (prev !== pick.el) {
          pipSourceVideoRef.current = pick.el;
          try {
            (pick.el as any).disablePictureInPicture = true;
            pick.el.setAttribute('disablePictureInPicture', '');
          } catch {}
          const pickedSrc = pick.el.currentSrc || pick.el.src || '';
          // Pass-19 R2: log elementSwitch=1 when the bound element changes
          // (not first bind). pipPass19R2Switch=1
          const elementSwitch = prev !== null ? 1 : 0;
          pushHandoffLog(`[PiP] pipSource rebind key=${pick.key} paused=${pick.paused} rs=${pick.rs} match=${pick.matches} elementSwitch=${elementSwitch} pipPass19R2Switch=1 expected=${shortUrl(expected)} picked=${shortUrl(pickedSrc)} phase=${phase} displayedUrl=${shortUrl(displayedUrl)} cands=${cands.length}`);
        }
        return pick.el;
      }
      if (prev !== null) {
        pipSourceVideoRef.current = null;
        const missMs = expectedMissAtRef.current.ts === 0 ? 0 : Math.round(now - expectedMissAtRef.current.ts);
        pushHandoffLog(`[PiP] pipSource rebind key=null match=false expected=${shortUrl(expected)} phase=${phase} displayedUrl=${shortUrl(displayedUrl)} cands=${cands.length} missMs=${missMs}`);
      }
      return null;
    };

    pipSourceResolverRef.current = resolve;
    resolve();
    return () => { pipSourceResolverRef.current = null; };
  }, [phase, currentIndex, displayedUrl]);

  // Pass-15: keep expectedUrlRef in sync with activeVideoUrl. Ref
  // update lets the resolver read the latest expected URL without
  // triggering the resolver-install effect on every reveal flip.
  useEffect(() => {
    expectedUrlRef.current = activeVideoUrl;
  }, [activeVideoUrl]);

  // URLs whose <Video> reported a load/decode error. Failed layers are
  // unmounted and never re-mounted, so the poster/thumbnail fallback renders
  // instead of a frozen or blank video.
  const [failedVideoUrls, setFailedVideoUrls] = useState<Set<string>>(new Set());
  const markVideoFailed = useCallback((url: string) => {
    setFailedVideoUrls((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  }, []);

  // Stall recovery: when the watchdog sees a frozen layer, escalate through
  // play() nudge → full remount (epoch bump changes the element key so React
  // builds a fresh <video> + decoder) → thumbnail fallback via
  // markVideoFailed. Per-URL state, reset whenever playback advances again.
  const stallRecoveryRef = useRef<Map<string, StallRecoveryState>>(new Map());
  const [layerEpochs, setLayerEpochs] = useState<Record<string, number>>({});
  const recoverStalledLayer = useCallback((url: string, now: number) => {
    const { action, state } = nextStallRecoveryAction(stallRecoveryRef.current.get(url), now);
    if (action === 'wait') return;
    stallRecoveryRef.current.set(url, state);
    console.warn('[WorkoutPlayer] video stall recovery', { url, action, attempt: state.attempts });
    if (action === 'nudge') {
      videosRef.current.get(`layer:${url}`)?.playAsync?.().catch(() => {});
    } else if (action === 'remount') {
      setLayerEpochs((prev) => ({ ...prev, [url]: (prev[url] ?? 0) + 1 }));
    } else {
      markVideoFailed(url);
    }
  }, [markVideoFailed]);

  // Keep the imperative video registry and stall-watchdog maps in sync with
  // the mounted layers so none grows unbounded over a long workout.
  useEffect(() => {
    const live = new Set(videoLayers.map((l) => l.url));
    for (const key of Array.from(videosRef.current.keys())) {
      if (key.startsWith('layer:') && !live.has(key.slice('layer:'.length))) {
        videosRef.current.delete(key);
      }
    }
    for (const url of Array.from(lastPositionUpdateAtRef.current.keys())) {
      if (!live.has(url)) lastPositionUpdateAtRef.current.delete(url);
    }
    for (const url of Array.from(stallRecoveryRef.current.keys())) {
      if (!live.has(url)) stallRecoveryRef.current.delete(url);
    }
  }, [videoLayers]);

  // Saved crop keyed by videoUrl so the videoLayers crossfade can look up
  // crop from a URL alone (layers only store {url, ready}).
  const cropByUrl = useMemo(() => {
    const map = new Map<string, {
      cropScale: number;
      cropTranslateX: number;
      cropTranslateY: number;
      cropFrameWidth?: number;
      cropFrameHeight?: number;
    }>();
    for (const m of flatMovements as any[]) {
      const url = m?.videoUrl;
      if (!url || map.has(url)) continue;
      const scale = m.cropScale ?? 1;
      const tx = m.cropTranslateX ?? 0;
      const ty = m.cropTranslateY ?? 0;
      if (scale !== 1 || tx !== 0 || ty !== 0) {
        map.set(url, {
          cropScale: scale,
          cropTranslateX: tx,
          cropTranslateY: ty,
          cropFrameWidth: m.cropFrameWidth,
          cropFrameHeight: m.cropFrameHeight,
        });
      }
    }
    return map;
  }, [flatMovements]);

  // Returns the transform array for a crop object.
  // cropTranslateX/Y are saved in modal-pixel units relative to
  // cropFrameWidth/cropFrameHeight; scale them to the actual player frame
  // so the framing matches what the coach set in VideoCropModal.
  const getCropTransform = useCallback(
    (
      crop: any,
      playerW: number,
      playerH: number,
    ): object[] => {
      if (!crop) return [];
      const scale = crop.cropScale ?? 1;
      const rawTX = crop.cropTranslateX ?? 0;
      const rawTY = crop.cropTranslateY ?? 0;
      if (scale === 1 && rawTX === 0 && rawTY === 0) return [];
      const tx = rawTX * (playerW / (crop.cropFrameWidth ?? playerW));
      const ty = rawTY * (playerH / (crop.cropFrameHeight ?? playerH));
      return [{ scale }, { translateX: tx }, { translateY: ty }];
    },
    [],
  );

  // Mount the active layer if not already in the stack.
  useEffect(() => {
    if (!activeVideoUrl || failedVideoUrls.has(activeVideoUrl)) return;
    setVideoLayers((prev) => {
      if (prev.some((l) => l.url === activeVideoUrl)) return prev;
      return [...prev, { url: activeVideoUrl, ready: false }];
    });
  }, [activeVideoUrl, failedVideoUrls]);

  // Mount the preload layer ahead of time so it's decoded by reveal.
  useEffect(() => {
    if (!preloadVideoUrl || failedVideoUrls.has(preloadVideoUrl)) return;
    setVideoLayers((prev) => {
      if (prev.some((l) => l.url === preloadVideoUrl)) return prev;
      return [...prev, { url: preloadVideoUrl, ready: false }];
    });
  }, [preloadVideoUrl, failedVideoUrls]);

  const handleLayerReady = useCallback((url: string) => {
    setVideoLayers((prev) => prev.map((l) => (l.url === url ? { ...l, ready: true } : l)));
  }, []);

  // Promote the active layer to displayed as soon as it's ready. Until
  // then, displayedUrl holds the previous URL so the outgoing layer stays
  // visible. Initial mount: displayed flips from null → active on first ready.
  useEffect(() => {
    if (!activeVideoUrl) {
      setDisplayedUrl(null);
      return;
    }
    if (displayedUrl === activeVideoUrl) return;
    const activeLayer = videoLayers.find((l) => l.url === activeVideoUrl);
    if (activeLayer?.ready) setDisplayedUrl(activeVideoUrl);
  }, [activeVideoUrl, displayedUrl, videoLayers]);

  // Prune layers we no longer need: keep only active, preload, and the
  // currently displayed (in case displayed is briefly different from active
  // during a transition that's about to complete).
  useEffect(() => {
    setVideoLayers((prev) => {
      const keep = new Set<string>();
      if (activeVideoUrl) keep.add(activeVideoUrl);
      if (preloadVideoUrl) keep.add(preloadVideoUrl);
      if (displayedUrl) keep.add(displayedUrl);
      const next = prev.filter((l) => keep.has(l.url) && !failedVideoUrls.has(l.url));
      return next.length === prev.length ? prev : next;
    });
  }, [activeVideoUrl, preloadVideoUrl, displayedUrl, failedVideoUrls]);

  // If the displayed layer failed, drop it so the thumbnail fallback shows.
  useEffect(() => {
    if (displayedUrl && failedVideoUrls.has(displayedUrl)) setDisplayedUrl(null);
  }, [displayedUrl, failedVideoUrls]);

  // videoReady drives the poster fallback — true once anything is on screen.
  useEffect(() => { setVideoReady(displayedUrl !== null); }, [displayedUrl]);

  // Stable {uri} object per URL so expo-av doesn't re-evaluate the source
  // on every render of the same layer.
  const sourceCacheRef = useRef<Map<string, { uri: string }>>(new Map());
  const getVideoSource = useCallback((url: string) => {
    let cached = sourceCacheRef.current.get(url);
    if (!cached) {
      cached = { uri: url };
      sourceCacheRef.current.set(url, cached);
    }
    return cached;
  }, []);

  // ── Shared header component ───────────────────────────────────────
  const renderHeader = (showProgress = true) => (
    <>
      <View style={st.header}>
        <TouchableOpacity onPress={onClose} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Icon name="close" size={fs(28)} color="#8A95A3" />
        </TouchableOpacity>
        <Text style={st.workoutName} numberOfLines={1}>
          {workout?.name ?? 'Workout'}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: fs(12) }}>
          {isOffline && (
            <View style={st.offlineBadge}>
              <Icon name="wifi-off" size={fs(12)} color="#F59E0B" />
              <Text style={st.offlineBadgeText}>Offline{queueSize > 0 ? ` (${queueSize})` : ''}</Text>
            </View>
          )}
          {musicEnabled && (
            <TouchableOpacity
              onPress={() => setShowMusicSheet(true)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              {/* Amber = music silenced (muted or turned off), matching the
                  old mute-toggle affordance; the button now opens the panel. */}
              <Icon
                name="music"
                size={fs(22)}
                color={music.musicMuted || music.musicOff ? '#F59E0B' : '#8A95A3'}
              />
            </TouchableOpacity>
          )}
          <TouchableOpacity
            onPress={() => setIsMuted(m => !m)}
            hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          >
            <Icon name={isMuted ? 'volume-x' : 'volume-2'} size={fs(22)} color={isMuted ? '#F59E0B' : '#8A95A3'} />
          </TouchableOpacity>
          {showProgress && (
            <Text style={st.progressText}>
              {currentIndex + 1}/{total}
            </Text>
          )}
        </View>
      </View>
      {showProgress && (
        <View style={st.progressBar}>
          <View style={[st.progressFill, { width: `${progressPct}%` }]} />
        </View>
      )}
    </>
  );

  // ── Shared next-up bar ────────────────────────────────────────────
  // Single-row layout so the bar is short and the media slot can be tall:
  //   [ NEXT UP | name + meta (flex) | thumb ]
  const renderNextUp = () => {
    if (!next) return null;
    const nextLabel = next.stepType === 'exercise'
      ? composePrescriptionLabel(next.name, next.weight, next.reps)
      : next.originalBlockType || next.name;
    return (
      <View style={st.nextUpBar}>
        <Text style={st.nextUpLabel}>NEXT UP</Text>
        <View style={st.nextUpInfo}>
          <Text style={st.nextUpName} numberOfLines={1}>{nextLabel}</Text>
          <Text style={st.nextUpMeta} numberOfLines={1}>
            {next.blockName}{next.duration ? ` · ${next.duration}s` : ''}
          </Text>
        </View>
        {(next.posterUrl || next.thumbnailUrl) ? (
          <PosterThumb
            posterUrl={(next as any).posterUrl}
            gifUrl={next.thumbnailUrl}
            containerStyle={st.nextUpThumb}
            resizeMode="cover"
          />
        ) : (
          <View style={[st.nextUpThumb, { justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A2035' }]}>
            <Icon name={
              next.stepType === 'waterBreak' ? 'droplet' :
              next.stepType === 'transition' ? 'arrow-right' :
              next.stepType === 'grabEquipment' ? 'briefcase' :
              next.stepType === 'demo' ? 'eye' :
              'play-circle'
            } size={Math.round(fs(20))} color="#3A4050" />
          </View>
        )}
      </View>
    );
  };

  // ── Shared slot helpers ──────────────────────────────────────────
  // Every "in-workout" phase (work, rest, transition, waterBreak, demo,
  // grabEquipment, swap) uses the same vertical structure so modules stay
  // in fixed positions across phase changes:
  //   header → logoSlot → titleTimerSlot → mediaSlot → nextUpSlot
  // Each slot has a stable height/flex; only the content inside changes.
  const renderLogoSlot = () => (
    <View style={[st.logoSlot, { height: SLOT_LOGO_H, marginBottom: SLOT_GAP_LOGO }]}>
      <Image
        source={require('../assets/logo.png')}
        style={st.slotLogo}
        resizeMode="contain"
      />
    </View>
  );

  // Title/timer + next-up rows are width-matched to the media so the timer's
  // right edge and the title module's left edge sit flush with the media's
  // left/right edges respectively. Without this, the row spans full frame
  // width and the timer can overhang past the media on letterboxed phones.
  const renderTitleTimerSlot = (
    title: React.ReactNode,
    timer: React.ReactNode | null,
  ) => (
    <View style={[st.titleTimerSlot, { height: SLOT_TITLE_H, marginBottom: SLOT_GAP_TITLE, width: _mediaW }]}>
      <View style={[st.titleColumn, { height: SLOT_TITLE_H }]}>{title}</View>
      {timer ? <View style={st.timerColumn}>{timer}</View> : null}
    </View>
  );

  const renderNextUpSlot = (content: React.ReactNode | null) => (
    <View style={[st.nextUpSlot, { height: SLOT_NEXTUP_H, marginTop: SLOT_GAP_MEDIA, width: _mediaW }]}>{content}</View>
  );

  // Timer box helpers — keep box and font scale in lockstep so the digit
  // never crops or floats on a larger frame. Used by every phase that shows
  // a countdown (work/rest/demo/transition/grabEquipment/waterBreak/swap/outro).
  const renderGoldTimer = (text: string) => (
    <View style={st.goldTimerBox}>
      <Text style={[st.goldTimerText, getTimerFontStyle(text)]}>{text}</Text>
    </View>
  );
  const renderRestTimer = (text: string) => (
    <View style={st.restTimerBox}>
      <Text style={[st.restTimerText, getTimerFontStyle(text)]}>{text}</Text>
    </View>
  );

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} animationType="fade" transparent={false}>
      <View style={[st.portraitLockOuter, Platform.OS === 'web'
        ? ({
            paddingTop: `max(${SAFE_TOP}px, env(safe-area-inset-top, ${SAFE_TOP}px))`,
            paddingBottom: `max(${SAFE_BOTTOM}px, env(safe-area-inset-bottom, ${SAFE_BOTTOM}px))`,
          } as any)
        : { paddingTop: SAFE_TOP, paddingBottom: SAFE_BOTTOM }]}>
      <View style={[st.container, dimsValid && { width: frameW, height: frameH, maxWidth: frameW }]}>
        {/* ── READY state — Block overview grid ─────────────────── */}
        {phase === 'ready' && (() => {
          // Consecutive blocks between Water Breaks roll up into one titled
          // section (e.g. "Superset + Tabata"); movements list plainly inside.
          const sections = buildPreviewSections(workout);

          return (
            <>
              {renderHeader(false)}
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ paddingHorizontal: fs(16), paddingTop: fs(12), paddingBottom: fs(100) }}
                showsVerticalScrollIndicator={false}
              >
                {sections.map((section, si) => {
                  const roundsList = section.map(({ block }) => block.rounds ?? block.sets ?? 1);
                  const uniformRounds = roundsList.every((r) => r === roundsList[0]) ? roundsList[0] : null;
                  return (
                    <View key={si} style={st.readySection}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: fs(8) }}>
                        <View style={st.readyBlockBadge}>
                          <Text style={st.readyBlockBadgeText}>{si + 1}</Text>
                        </View>
                        <Text style={st.readyBlockLabel}>{sectionTitle(section)}</Text>
                        {uniformRounds && uniformRounds > 1 ? (
                          <Text style={st.readyBlockRounds}>{uniformRounds}×</Text>
                        ) : null}
                      </View>
                      <View style={st.readyThumbGrid}>
                        {section.map(({ block, bi }) => {
                          const blkRounds = block.rounds ?? block.sets ?? 1;
                          return (block.movements || [])
                            .filter((mv: any) => mv.showOnPreview !== false)
                            .map((mv: any, mi: number) => (
                              <View key={`${bi}-${mi}`} style={st.readyThumbCell}>
                                <PosterThumb
                                  posterUrl={mv.posterUrl}
                                  gifUrl={mv.thumbnailUrl}
                                  containerStyle={st.readyThumbImage}
                                  resizeMode="cover"
                                />
                                <Text style={st.readyThumbName} numberOfLines={1}>
                                  {mv.movementName || mv.name || 'Movement'}
                                </Text>
                                {!uniformRounds && blkRounds > 1 && (
                                  <Text style={[st.readyThumbName, { color: '#8A95A3' }]}>
                                    {blkRounds}×
                                  </Text>
                                )}
                              </View>
                            ));
                        })}
                      </View>
                    </View>
                  );
                })}
              </ScrollView>

              {/* Bottom: logo + play button */}
              <View style={st.readyFooter}>
                {hr.supported && hrEnabled && (
                  hr.status === 'connected' ? (
                    <View style={st.hrLinkRow}>
                      <Icon name="heart" size={fs(14)} color="#E05252" />
                      <Text style={st.hrLinkedText} numberOfLines={1}>
                        {hr.deviceName}{hr.bpm != null ? ` · ${hr.bpm} bpm` : ' · linked'}
                      </Text>
                    </View>
                  ) : (
                    <TouchableOpacity
                      style={st.hrLinkBtn}
                      onPress={hr.connect}
                      disabled={hr.status === 'connecting'}
                    >
                      <Icon name="heart" size={fs(14)} color="#E05252" />
                      <Text style={st.hrLinkBtnText} numberOfLines={1}>
                        {hr.status === 'connecting'
                          ? 'Connecting...'
                          : savedHrDeviceName
                            ? `Reconnect ${savedHrDeviceName}`
                            : 'Link wearable'}
                      </Text>
                    </TouchableOpacity>
                  )
                )}
                {!hr.supported && Platform.OS === 'web' && (
                  <Text style={st.hrUnsupportedNote}>Heart rate needs Chrome or the app</Text>
                )}
                <Image
                  source={require('../assets/logo.png')}
                  style={{ width: fs(140), height: fs(46), marginBottom: fs(12) }}
                  resizeMode="contain"
                />
                <TouchableOpacity style={st.readyPlayBtn} onPress={handleStartWithUnlock}>
                  <Icon name="play" size={fs(32)} color="#0E1117" />
                </TouchableOpacity>
              </View>
            </>
          );
        })()}

        {/* ── INTRO ANNOUNCEMENT — spoken welcome, tap to skip ──── */}
        {announcementActive && (
          <Pressable
            onPress={finishAnnouncement}
            style={[
              StyleSheet.absoluteFillObject,
              {
                backgroundColor: '#0E1117',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 100,
                paddingHorizontal: fs(28),
              },
            ]}
          >
            <Image
              source={require('../assets/logo.png')}
              style={{ width: fs(160), height: fs(52), marginBottom: fs(28) }}
              resizeMode="contain"
            />
            <Text
              style={{
                color: '#F0F4F8',
                fontSize: fs(24),
                fontFamily: FH,
                fontWeight: '700',
                textAlign: 'center',
              }}
            >
              {workout?.name || 'Workout'}
            </Text>
            <Text
              style={{
                color: '#FBBF24',
                fontSize: fs(14),
                fontFamily: FB,
                marginTop: fs(16),
                textAlign: 'center',
              }}
            >
              Your coach's intro is playing…
            </Text>
            <Text
              style={{
                color: '#8A95A3',
                fontSize: fs(12),
                fontFamily: FB,
                marginTop: fs(40),
                textAlign: 'center',
              }}
            >
              Tap anywhere to skip
            </Text>
          </Pressable>
        )}

        {/* ── INTRO — Full-screen cinematic welcome ────────────── */}
        {phase === 'intro' && current && (() => {
          // Use the intro block's own video, falling back to first exercise
          const firstExercise = flatMovements.find((f: any) => f.stepType === 'exercise');
          const introVideoUrl = current.videoUrl || firstExercise?.videoUrl;
          const introThumbUrl = firstExercise?.posterUrl || firstExercise?.thumbnailUrl;
          const introIsImage = isImageUrl(introVideoUrl);
          return (
            <View style={st.introSplitContainer}>
              {/* Left: video panel */}
              <View style={st.introVideoPanel}>
                {introVideoUrl && introIsImage ? (
                  <Image source={{ uri: introVideoUrl }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
                ) : introVideoUrl ? (
                  <Video
                    ref={(el: any) => registerVideo('intro', el)}
                    source={{ uri: introVideoUrl }}
                    resizeMode={ResizeMode.COVER}
                    isLooping
                    shouldPlay={!isPaused}
                    isMuted
                    style={StyleSheet.absoluteFillObject}
                    videoStyle={
                      Platform.OS === 'web'
                        ? ({ width: '100%', height: '100%', objectFit: 'cover' } as any)
                        : undefined
                    }
                  />
                ) : introThumbUrl ? (
                  <Image source={{ uri: introThumbUrl }} style={StyleSheet.absoluteFillObject} resizeMode="cover" />
                ) : (
                  <View style={[StyleSheet.absoluteFillObject, { backgroundColor: '#1A2035' }]} />
                )}
              </View>
              {/* Right: branding panel */}
              <View style={st.introBrandPanel}>
                <Image
                  source={require('../assets/logo.png')}
                  style={st.introLogo}
                  resizeMode="contain"
                />
                <Text style={st.introBlockLabel}>
                  {current.name || current.label || 'WARM-UP & STRETCH'}
                </Text>
                {renderGoldTimer(String(Math.max(0, Math.ceil(timeLeft))))}
              </View>
            </View>
          );
        })()}

        {/* ── OUTRO — Cinematic completion ────────────────────── */}
        {phase === 'outro' && current && (
          <View style={st.introOutroContainer}>
            {current.videoUrl && isImageUrl(current.videoUrl) ? (
              <Image
                source={{ uri: current.videoUrl }}
                style={StyleSheet.absoluteFillObject}
                resizeMode="cover"
              />
            ) : current.videoUrl ? (
              <Video
                ref={(el: any) => registerVideo('outro', el)}
                source={{ uri: current.videoUrl }}
                resizeMode={ResizeMode.COVER}
                isLooping
                shouldPlay={!isPaused}
                isMuted
                style={StyleSheet.absoluteFillObject}
                videoStyle={
                  Platform.OS === 'web'
                    ? ({ width: '100%', height: '100%', objectFit: 'cover' } as any)
                    : undefined
                }
              />
            ) : null}
            <View style={[st.introOutroGradient, current.videoUrl && { backgroundColor: 'rgba(14,17,23,0.6)' }]}>
              <Image
                source={require('../assets/logo.png')}
                style={{ width: fs(280), height: fs(90), marginBottom: fs(16) }}
                resizeMode="contain"
              />
              <Text style={st.outroTitle}>WORKOUT</Text>
              {renderGoldTimer(String(Math.max(0, Math.ceil(timeLeft))))}
            </View>
          </View>
        )}

        {/* ── DEMO — Preview upcoming movements ───────────────── */}
        {phase === 'demo' && current && (() => {
          const demos = current.demoMovements || [];
          const cols = demos.length <= 4 ? 2 : 3;
          return (
            <View style={[st.workContainer, webSafeBottomStyle]}>
              {renderLogoSlot()}
              {renderTitleTimerSlot(
                renderAutoFitTitle(current.name, { hasTimer: true, maxLines: 3 }),
                renderGoldTimer(String(Math.max(0, Math.ceil(timeLeft)))),
              )}
              <View style={st.mediaSlot}>
                <View style={[st.demoGrid, mediaInnerSize]}>
                  {demos.map((mv: any, i: number) => (
                    <View key={i} style={[st.demoGridCell, { width: `${Math.floor(100 / cols) - 2}%` as any }]}>
                      <PosterThumb
                        posterUrl={mv.posterUrl}
                        gifUrl={mv.thumbnailUrl}
                        containerStyle={st.demoGridImage}
                        resizeMode="cover"
                      />
                    </View>
                  ))}
                </View>
              </View>
              {renderNextUpSlot(null)}
            </View>
          );
        })()}

        {/* ── TRANSITION — Full-media with overlay text ───────── */}
        {phase === 'transition' && current && (() => {
          const transitionCropT = getCropTransform(current, mediaInnerSize.width, mediaInnerSize.height);
          const transitionCropStyle: any = transitionCropT.length ? { transform: transitionCropT } : null;
          return (
          <View style={[st.workContainer, webSafeBottomStyle]}>
            {renderLogoSlot()}
            {renderTitleTimerSlot(
              <>
                <Text style={[st.restPhaseLabel, { color: '#94A3B8' }]}>TRANSITION</Text>
                {renderAutoFitTitle(current.name, {
                  hasTimer: true,
                  maxLines: 2,
                  maxFontSize: 34,
                  color: '#F0F4F8',
                  marginTop: 2,
                })}
                {(current.instructionText || current.description) ? (
                  <Text style={st.transitionInstructionInline} numberOfLines={1}>
                    {current.instructionText || current.description}
                  </Text>
                ) : null}
              </>,
              renderGoldTimer(formatTime(timeLeft)),
            )}
            <View style={st.mediaSlot}>
              <View style={[st.mediaInner, mediaInnerSize]}>
                {activeVideoUrl ? (
                  <Video
                    ref={(el: any) => registerVideo('transition', el)}
                    key={activeVideoUrl}
                    source={{ uri: activeVideoUrl }}
                    resizeMode={ResizeMode.COVER}
                    isLooping
                    shouldPlay={!isPaused}
                    isMuted
                    style={[st.videoPlayer, transitionCropStyle]}
                    videoStyle={
                      Platform.OS === 'web'
                        ? ({ width: '100%', height: '100%', objectFit: 'cover' } as any)
                        : undefined
                    }
                  />
                ) : activeThumbUrl ? (
                  <Image source={{ uri: activeThumbUrl }} style={st.videoPlayer} resizeMode="cover" />
                ) : (
                  <View style={[st.videoPlayer, st.placeholderLogoFrame]}>
                    <Image
                      source={require('../assets/goarrive-icon.png')}
                      style={st.placeholderLogo}
                      resizeMode="cover"
                    />
                  </View>
                )}
              </View>
            </View>
            {renderNextUpSlot(renderNextUp())}
          </View>
          );
        })()}

        {/* ── GRAB EQUIPMENT — Equipment preparation ─────────── */}
        {phase === 'grabEquipment' && current && (
          <View style={[st.workContainer, webSafeBottomStyle]}>
            {renderLogoSlot()}
            {/* Standard fixed-slot layout (title in left column, gold timer
                in its fixed right column) — same as every other phase. The
                "less prominent" treatment is confined to the left column: a
                smaller label + an instruction title that auto-fits up to 4
                lines within a height budget so long prose never ellipsizes. */}
            {renderTitleTimerSlot(
              <>
                <Text style={[st.restPhaseLabel, { color: '#FB923C', fontSize: fs(13), letterSpacing: fs(1.5) }]}>GRAB EQUIPMENT</Text>
                {renderAutoFitTitle(current.grabEquipmentText || current.name, {
                  hasTimer: true,
                  maxLines: 4,
                  maxFontSize: 28,
                  maxHeight: 88,
                  color: '#F0F4F8',
                  marginTop: 2,
                })}
              </>,
              renderGoldTimer(formatTime(timeLeft)),
            )}
            <View style={st.mediaSlot}>
              <View style={[st.mediaInner, mediaInnerSize]}>
                {current.grabEquipmentImageUrl ? (
                  <>
                    <Image
                      source={{ uri: current.grabEquipmentImageUrl }}
                      style={[st.videoPlayer, { borderRadius: fs(12) }]}
                      resizeMode="cover"
                    />
                    <View
                      style={[
                        StyleSheet.absoluteFillObject,
                        { backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: fs(12) },
                      ]}
                    />
                  </>
                ) : activeVideoUrl ? (
                  // Fall through to the upcoming exercise's video so the member
                  // sees what they're about to do (pickAsset walks forward for
                  // non-exercise items). Dark overlay keeps the "get ready"
                  // framing so it doesn't feel like the workout has started.
                  <>
                    <Video
                      ref={(el: any) => registerVideo('grabEquipment', el)}
                      key={activeVideoUrl}
                      source={getVideoSource(activeVideoUrl)}
                      resizeMode={ResizeMode.COVER}
                      isLooping
                      shouldPlay={!isPaused}
                      isMuted
                      style={[st.videoPlayer, { borderRadius: fs(12) }]}
                      videoStyle={
                        Platform.OS === 'web'
                          ? ({ width: '100%', height: '100%', objectFit: 'cover' } as any)
                          : undefined
                      }
                    />
                    <View
                      style={[
                        StyleSheet.absoluteFillObject,
                        { backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: fs(12) },
                      ]}
                    />
                  </>
                ) : activeThumbUrl ? (
                  <>
                    <Image
                      source={{ uri: activeThumbUrl }}
                      style={[st.videoPlayer, { borderRadius: fs(12) }]}
                      resizeMode="cover"
                    />
                    <View
                      style={[
                        StyleSheet.absoluteFillObject,
                        { backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: fs(12) },
                      ]}
                    />
                  </>
                ) : (
                  <View style={[st.videoPlayer, st.equipmentPanel]}>
                    <View style={[st.specialIconCircle, { backgroundColor: 'rgba(251,146,60,0.15)' }]}>
                      <Icon name="briefcase" size={fs(48)} color="#FB923C" />
                    </View>
                  </View>
                )}
              </View>
            </View>
            {renderNextUpSlot(renderNextUp())}
          </View>
        )}

        {/* ── WATER BREAK — Hydration pause ───────────────────── */}
        {phase === 'followAlongVideo' && current && (() => {
          const followVideoUrl = current.videoUrl || activeVideoUrl;
          const followMuted = isMuted || current.soundEnabled === false;
          const followCropT = getCropTransform(current, mediaInnerSize.width, mediaInnerSize.height);
          const cropTransform = followCropT.length ? { transform: followCropT } : undefined;
          return (
            <View style={[st.workContainer, webSafeBottomStyle]}>
              {renderLogoSlot()}
              {renderTitleTimerSlot(
                renderAutoFitTitle(current.name || 'Follow Along', { hasTimer: true, maxLines: 2 }),
                renderGoldTimer(formatTime(timeLeft)),
              )}
              <View style={st.mediaSlot}>
                <View style={[st.mediaInner, mediaInnerSize]}>
                  {followVideoUrl ? (
                    <Video
                      ref={(el: any) => registerVideo('followAlong', el)}
                      key={followVideoUrl}
                      source={{ uri: followVideoUrl }}
                      resizeMode={ResizeMode.COVER}
                      isLooping={false}
                      shouldPlay={!isPaused}
                      isMuted={followMuted}
                      style={[st.videoPlayer, cropTransform as any]}
                      videoStyle={
                        Platform.OS === 'web'
                          ? ({ width: '100%', height: '100%', objectFit: 'cover' } as any)
                          : undefined
                      }
                      onPlaybackStatusUpdate={(status: any) => {
                        if (status?.isLoaded && status.didJustFinish) {
                          advanceToNext();
                        }
                      }}
                    />
                  ) : (
                    <View style={[st.videoPlayer, st.waterBreakPlaceholder]}>
                      <Icon name="video" size={fs(64)} color="#22D3EE" />
                    </View>
                  )}
                </View>
              </View>
              {renderNextUpSlot(null)}
            </View>
          );
        })()}

        {phase === 'waterBreak' && current && (() => {
          const waterCropT = getCropTransform(current, mediaInnerSize.width, mediaInnerSize.height);
          const waterCropStyle: any = waterCropT.length ? { transform: waterCropT } : null;
          return (
          <View style={[st.workContainer, webSafeBottomStyle]}>
            {renderLogoSlot()}
            {renderTitleTimerSlot(
              <Text style={st.waterBreakLabel}>WATER BREAK</Text>,
              renderGoldTimer(formatTime(timeLeft)),
            )}
            <View style={st.mediaSlot}>
              <View style={[st.mediaInner, mediaInnerSize]}>
                {activeVideoUrl ? (
                  <Video
                    ref={(el: any) => registerVideo('waterBreak', el)}
                    key={activeVideoUrl}
                    source={{ uri: activeVideoUrl }}
                    resizeMode={ResizeMode.COVER}
                    isLooping
                    shouldPlay={!isPaused}
                    isMuted
                    style={[st.videoPlayer, waterCropStyle]}
                    videoStyle={
                      Platform.OS === 'web'
                        ? ({ width: '100%', height: '100%', objectFit: 'cover' } as any)
                        : undefined
                    }
                  />
                ) : activeThumbUrl ? (
                  <Image source={{ uri: activeThumbUrl }} style={st.videoPlayer} resizeMode="cover" />
                ) : (
                  <View style={[st.videoPlayer, st.waterBreakPlaceholder]}>
                    <Icon name="droplet" size={fs(64)} color="#38BDF8" />
                  </View>
                )}
                {/* Blue tint overlay */}
                <View style={st.waterBreakVideoOverlay} />
                {/* WATER BREAK text overlay */}
                <View style={st.waterBreakTextOverlay}>
                  <Text style={st.waterBreakOverlayText}>WATER</Text>
                  <Text style={st.waterBreakOverlayText}>BREAK</Text>
                </View>
              </View>
            </View>
            {renderNextUpSlot(null)}
          </View>
          );
        })()}

        {/* ── WORK + REST + SWAP — share one Video element so the asset    */}
        {/* persists across phase boundaries. Rest overlays a REST label on  */}
        {/* the same video; swap keeps the video mounted (mirrored if going  */}
        {/* to R) so the member sees the next side instead of an empty card. */}
        {(phase === 'work' || phase === 'rest' || phase === 'swap') && current && (() => {
          // Single authoritative mirror flag driven by timer state (currentIndex,
          // phase, swapSide). Mirror is ON for swap phase and work-R, OFF otherwise.
          // Gated by isInRevealWindow: when the display has already switched to the
          // next movement's preview (3-2-1 countdown), that preview is always
          // unmirrored regardless of the current side — the next movement starts at
          // work-L. This fixes the Tabata bug where work-R's reveal window showed
          // the round-2 video still mirrored despite previewing round-2's work-L.
          const isMirrored = !isInRevealWindow
            && !!current.swapSides
            && ((phase === 'work' && swapSide === 'R') || phase === 'swap');
          const mirrorStyle = isMirrored ? { transform: [{ scaleX: -1 }] } as any : null;
          // RN does not merge `transform` arrays across style objects — last wins.
          // Crop goes in `style` (applied to the outer wrapper) on all platforms.
          // Mirror goes in `style` on native and in `videoStyle` on web so that
          // the CSS transform is applied directly to the <video> element — this
          // avoids a one-frame delay if expo-av's wrapper doesn't re-apply the
          // outer style transform synchronously on prop change.
          const buildLayerStyle = (url: string): any => {
            const crop = cropByUrl.get(url);
            const t = [
              ...getCropTransform(crop ?? null, mediaInnerSize.width, mediaInnerSize.height),
              ...(isMirrored && Platform.OS !== 'web' ? [{ scaleX: -1 }] : []),
            ];
            return t.length ? { transform: t } : null;
          };
          const layerVideoStyle: any = Platform.OS === 'web'
            ? (isMirrored
              ? { width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }
              : { width: '100%', height: '100%', objectFit: 'cover' })
            : undefined;
          return (
          <View style={[st.workContainer, webSafeBottomStyle]}>
            {renderLogoSlot()}
            {phase === 'work' && (() => {
              // During the 3.5s reveal window the video swaps to `next`; keep
              // the title in sync so both flip together instead of the title
              // lagging by REVEAL_LEAD_SECONDS behind the video.
              const titleItem = isInRevealWindow && revealDisplayItem ? revealDisplayItem : current;
              const titleHasSwapBadge = titleItem === current && current.swapSides;
              return renderTitleTimerSlot(
              <>
                {renderAutoFitTitle(composePrescriptionLabel(titleItem.name, titleItem.weight, titleItem.reps), {
                  hasTimer: !isRepBased,
                  // Swap-sides movements stack the FULL/SPLIT badge (~30 base
                  // units incl. margin) under the title inside the fixed
                  // 112-unit module — shrink the title budget so the pair
                  // never overflows into the logo above.
                  maxLines: titleHasSwapBadge ? 2 : NAME_MAX_LINES,
                  maxHeight: titleHasSwapBadge ? 82 : undefined,
                })}
                {/* Swap-mode badge stacks naturally below the title — the */}
                {/* title column is center-aligned, so it appears centered  */}
                {/* directly under the movement name without overlapping    */}
                {/* the media frame.                                        */}
                {titleHasSwapBadge && (() => {
                  const mode = (current as any).swapMode === 'duplicate' ? 'duplicate' : 'split';
                  const win = typeof (current as any).swapWindowSec === 'number'
                    ? (current as any).swapWindowSec : 5;
                  return (
                    <View style={st.swapBadgePill} pointerEvents="none">
                      <Text style={st.splitText}>{mode === 'split' ? 'SPLIT' : 'FULL'}</Text>
                      <Text style={st.splitSep}> | </Text>
                      <Text style={st.splitDuration}>{win} sec</Text>
                      <Text style={st.splitArrows}> ⇄</Text>
                    </View>
                  );
                })()}
              </>,
              !isRepBased ? renderGoldTimer(formatTime(timeLeft)) : null,
            );
            })()}
            {phase === 'rest' && renderTitleTimerSlot(
              <>
                <Text style={st.restPhaseLabel}>REST</Text>
                {next && renderAutoFitTitle(`Next: ${composePrescriptionLabel(next.name, next.weight, next.reps)}`, {
                  hasTimer: true,
                  maxLines: 3,
                  maxFontSize: 24,
                  color: '#F0F4F8',
                  marginTop: 2,
                })}
              </>,
              renderRestTimer(formatTime(timeLeft)),
            )}
            {phase === 'swap' && renderTitleTimerSlot(
              <>
                <Text style={st.phaseLabel}>SWITCH SIDES</Text>
                {renderAutoFitTitle(composePrescriptionLabel(current.name, current.weight, current.reps), {
                  hasTimer: true,
                  maxLines: 2,
                  maxFontSize: 34,
                  maxHeight: 82,
                  color: '#F0F4F8',
                  marginTop: 2,
                })}
              </>,
              renderGoldTimer(String(Math.max(0, Math.ceil(timeLeft)))),
            )}

            {/* Shared media slot — Video stays mounted across work↔rest↔swap. */}
            <View style={st.mediaSlot}>
              <View style={[st.mediaInner, mediaInnerSize]}>
                {videoLayers.length > 0 ? (
                  <>
                    {videoLayers.map((layer) => {
                      // The displayed layer is fully visible. The preload
                      // layer stays at opacity 0 — loaded but invisible —
                      // until the reveal point flips activeVideoUrl to it,
                      // at which point displayedUrl promotes it instantly.
                      const isDisplayed = layer.url === displayedUrl;
                      const opacity = isDisplayed ? 1 : 0;
                      return (
                        <Video
                          key={`${layer.url}#${layerEpochs[layer.url] ?? 0}`}
                          ref={(el: any) => {
                            registerVideo(`layer:${layer.url}`, el);
                            if (isDisplayed) videoRef.current = el;
                          }}
                          source={getVideoSource(layer.url)}
                          resizeMode={ResizeMode.COVER}
                          isLooping
                          shouldPlay={!isPaused}
                          isMuted
                          style={[st.videoPlayer, st.videoLayer, { opacity } as any, buildLayerStyle(layer.url)]}
                          videoStyle={layerVideoStyle}
                          onReadyForDisplay={() => handleLayerReady(layer.url)}
                          onError={() => {
                            console.warn('[WorkoutPlayer] video load error', { url: layer.url });
                            markVideoFailed(layer.url);
                          }}
                          onPlaybackStatusUpdate={(status: any) => {
                            if (!status?.isLoaded) {
                              if (status?.error) {
                                console.warn('[WorkoutPlayer] video error', { url: layer.url, error: status.error });
                                markVideoFailed(layer.url);
                              }
                              return;
                            }
                            if (status.error) {
                              console.warn('[WorkoutPlayer] video error', { url: layer.url });
                              markVideoFailed(layer.url);
                              return;
                            }
                            const now = Date.now();
                            const prev = lastPositionUpdateAtRef.current.get(layer.url);
                            if (prev === undefined || status.positionMillis !== prev.pos) {
                              lastPositionUpdateAtRef.current.set(layer.url, { pos: status.positionMillis, ts: now });
                              stallRecoveryRef.current.delete(layer.url);
                            } else if (status.shouldPlay && now - prev.ts >= 5000) {
                              // Hidden tabs legitimately stop advancing; the
                              // foreground-resume handler owns that case.
                              if (Platform.OS === 'web' && typeof document !== 'undefined'
                                && document.visibilityState !== 'visible') return;
                              console.warn('[WorkoutPlayer] video stall detected', { url: layer.url, stallMs: now - prev.ts });
                              recoverStalledLayer(layer.url, now);
                            }
                          }}
                        />
                      );
                    })}
                    {!displayedUrl && activeThumbUrl && (
                      <Image
                        source={{ uri: activeThumbUrl }}
                        style={[st.posterFallback, mirrorStyle]}
                        resizeMode="cover"
                      />
                    )}
                  </>
                ) : activeThumbUrl ? (
                  <Image
                    source={{ uri: activeThumbUrl }}
                    style={[st.videoPlayer, mirrorStyle]}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={[st.videoPlayer, st.placeholderLogoFrame]}>
                    <Image
                      source={require('../assets/goarrive-icon.png')}
                      style={st.placeholderLogo}
                      resizeMode="cover"
                    />
                  </View>
                )}
                {hr.status === 'connected' && hr.bpm != null && (
                  <View style={[st.hrBadge, { borderColor: hrZoneColor(hr.bpm, estMaxHR) }]} pointerEvents="none">
                    <Icon name="heart" size={Math.round(fs(12))} color={hrZoneColor(hr.bpm, estMaxHR)} />
                    <Text style={[st.hrBadgeText, { fontSize: fs(14), color: hrZoneColor(hr.bpm, estMaxHR) }]}>
                      {hr.bpm}
                    </Text>
                  </View>
                )}
              </View>
            </View>

            {/* Next-up slot — work shows next item, rest/swap stay empty   */}
            {/* (the rest/swap title slot already names the next thing).    */}
            {renderNextUpSlot(phase === 'work' ? renderNextUp() : null)}
          </View>
          );
        })()}

        {/* ── COMPLETE state ──────────────────────────────────── */}
        {phase === 'complete' && (
          <>
            {renderHeader(false)}
            <View style={st.centerContent}>
              {isPreview && (
                <View style={st.previewBadge}>
                  <Icon name="eye" size={fs(14)} color="#F5A623" />
                  <Text style={st.previewBadgeText}>COACH PREVIEW</Text>
                </View>
              )}
              <Icon name="check-circle" size={fs(72)} color="#F5A623" />
              <Text style={st.completeTitle}>
                {isPreview ? 'Preview Complete' : 'Workout Complete!'}
              </Text>
              <Text style={st.completeMeta}>
                {exerciseTotal} movement{exerciseTotal !== 1 ? 's' : ''} finished
              </Text>
              {hr.sessionStats && (
                <View style={st.hrSummaryRow}>
                  <Icon name="heart" size={fs(16)} color="#E05252" />
                  <Text style={st.hrSummaryText}>
                    Avg {hr.sessionStats.avgHR} bpm · Max {hr.sessionStats.maxHR} bpm
                  </Text>
                </View>
              )}
              <TouchableOpacity style={st.bigStartBtn} onPress={isPreview ? onClose : handleFinish}>
                <Text style={st.bigStartText}>{isPreview ? 'End Preview' : 'Continue'}</Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* ── Shared player-shell controls ─────────────────────── */}
        {/* The top header (close/title/mute/progress) lives INSIDE this   */}
        {/* overlay so playback is clean — it appears with pause/skip on   */}
        {/* tap and auto-hides 3s later. While paused the overlay sticks   */}
        {/* (controls + header stay visible) so the user can resume.       */}
        {phase !== 'ready' && phase !== 'complete' && !(showControls || isPaused) && (
          <TouchableOpacity
            style={st.sharedTapCatcher}
            onPress={handleVideoTap}
            activeOpacity={1}
          />
        )}

        {phase !== 'ready' && phase !== 'complete' && (showControls || isPaused) && (
          <View style={st.sharedControlsOverlay}>
            <TouchableOpacity
              style={st.sharedOverlayBackdrop}
              onPress={handleVideoTap}
              activeOpacity={1}
            />
            <View style={st.sharedOverlayHeader} pointerEvents="box-none">
              {renderHeader(true)}
            </View>
            <View style={st.sharedOverlayCenterStack} pointerEvents="box-none">
              <View style={st.seekRow}>
                <TouchableOpacity style={st.seekBtn10} onPress={() => handleSeek10(-10)}>
                  <Text style={st.seekBtn10Label}>‹‹</Text>
                  <Text style={st.seekBtn10Sec}>10s</Text>
                </TouchableOpacity>
                {phase === 'work' && isRepBased ? (
                  <TouchableOpacity style={st.sharedOverlayCenterBtn} onPress={handleRepDoneFromOverlay}>
                    <Icon name="check" size={fs(32)} color="#0E1117" />
                    <Text style={st.sharedOverlayDoneText}>Done</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity style={st.sharedOverlayCenterBtn} onPress={handlePauseResumeFromOverlay}>
                    <Icon name={isPaused ? 'play' : 'pause'} size={fs(36)} color="#0E1117" />
                  </TouchableOpacity>
                )}
                <TouchableOpacity style={st.seekBtn10} onPress={() => handleSeek10(10)}>
                  <Text style={st.seekBtn10Sec}>10s</Text>
                  <Text style={st.seekBtn10Label}>››</Text>
                </TouchableOpacity>
              </View>
              <View style={st.overlayBottomRow}>
                <TouchableOpacity style={st.sharedOverlaySkipBtn} onPress={handleSkipFromOverlay}>
                  <Icon name="skip-forward" size={fs(18)} color="#F5A623" />
                  <Text style={st.sharedOverlaySkipText}>Skip</Text>
                </TouchableOpacity>
                {pipSupported && pipEnabled && (
                  pipProbeMode === 'full' ? (
                    <TouchableOpacity style={st.pipBtn} onPressIn={armPip} onPress={handlePiP}>
                      <Icon name={isPiP ? 'minimize-2' : 'maximize-2'} size={fs(16)} color="#F0F4F8" />
                      <Text style={st.pipBtnText}>{isPiP ? 'Exit PiP' : 'PiP'}</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={[st.pipBtn, { opacity: 0.35 }]}>
                      <Icon name="alert-circle" size={fs(16)} color="#F0F4F8" />
                      <Text style={st.pipBtnText}>PiP off ({pipProbeModeLabel(pipProbeMode)})</Text>
                    </View>
                  )
                )}
              </View>
            </View>
          </View>
        )}

        {/* Music panel — independent of the auto-hiding controls overlay */}
        {musicEnabled && (
          <MusicSettingsSheet
            visible={showMusicSheet}
            onClose={() => setShowMusicSheet(false)}
            fs={fs}
            currentStyle={music.currentStyle}
            onChangeStyle={music.changeStyle}
            currentTrackIndex={music.currentTrackIndex}
            trackStatus={music.trackStatus}
            musicMuted={music.musicMuted}
            onToggleMute={music.toggleMusicMuted}
            onSkipNext={music.skipNext}
            onSkipBack={music.skipBack}
            liked={music.liked}
            disliked={music.disliked}
            onToggleLike={music.toggleLike}
            onToggleDislike={music.toggleDislike}
            canRate={!!user}
            volume={music.volume}
            onVolumeChange={music.setVolume}
            musicOff={music.musicOff}
            onTurnOffForSession={music.turnOffForSession}
            onTurnMusicBackOn={music.turnMusicBackOn}
            started={phase !== 'ready'}
          />
        )}
      </View>
      </View>

      {/* Staging-only debug pills. AUDIO cycles the ?handoff= variant, PROBE
          cycles the pass-2 pipprobe mode. Both write localStorage + reload —
          this is durable test infra, not scaffolding: four device sessions
          today were lost to invisible query-param preconditions. Never
          renders in production because isStagingHost() is host-based. */}
      {isStagingHost() && (
        <View style={st.audioVariantRow}>
          <Pressable
            style={st.audioVariantBadge}
            onPress={() => {
              const order: MusicHandoffVariant[] = ['v3', 'v1', 'v2', 'off'];
              const cur = getMusicHandoffVariant();
              const next = order[(order.indexOf(cur) + 1) % order.length];
              setMusicHandoffVariant(next);
              try { window.location.reload(); } catch {}
            }}
          >
            <Text style={st.audioVariantBadgeText}>
              AUDIO: {getMusicHandoffVariant().toUpperCase()}
            </Text>
          </Pressable>
          <Pressable
            style={st.audioVariantBadge}
            onPress={() => {
              setPipProbeMode(nextPipProbeMode(getPipProbeMode()));
              try { window.location.reload(); } catch {}
            }}
          >
            <Text style={st.audioVariantBadgeText}>
              PROBE: {pipProbeModeLabel(getPipProbeMode())}
            </Text>
          </Pressable>
          <Pressable
            style={st.copyLogBtn}
            onPress={() => {
              try {
                navigator.clipboard.writeText(readHandoffLog()).catch(() => {});
              } catch {}
            }}
          >
            <Text style={st.audioVariantBadgeText}>COPY LOG</Text>
          </Pressable>
        </View>
      )}

      {/* VOICE-AUDIT panel — staging only, mirrors [VOICE-AUDIT] console trace */}
      {isStagingHost() && (
        <VoiceAuditPanel
          workoutId={workout?.id || workout?.workoutId}
          workoutTitle={workout?.title || workout?.name}
          isMuted={isMuted}
          phase={phase}
          currentIndex={currentIndex}
          current={current}
          next={next}
          hydratedMovements={flatMovements}
        />
      )}

      {/* Swap movement modal */}
      <Modal visible={showSwap} transparent animationType="slide">
        <View style={st.swapOverlay}>
          <View style={st.swapSheet}>
            <View style={st.swapHeader}>
              <Text style={st.swapTitle}>Swap Movement</Text>
              <TouchableOpacity onPress={closeSwap}>
                <Icon name="x" size={22} color="#8A95A3" />
              </TouchableOpacity>
            </View>
            {loadingAlts && (
              <Text style={st.swapHint}>Loading alternatives...</Text>
            )}
            {!loadingAlts && alternatives.length === 0 && (
              <Text style={st.swapHint}>No alternatives found for this category.</Text>
            )}
            <TextInput
              style={st.swapReasonInput}
              placeholder="Reason for swap (optional)"
              placeholderTextColor="#6B7280"
              value={swapReason}
              onChangeText={setSwapReason}
              maxLength={100}
            />
            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
              {alternatives.map((alt) => (
                <TouchableOpacity
                  key={alt.id}
                  style={st.swapItem}
                  onPress={() => {
                    swapMovement(alt, swapReason.trim() || undefined);
                    setSwapReason('');
                  }}
                >
                  <Text style={st.swapItemName}>{alt.name}</Text>
                  <Text style={st.swapItemCat}>{alt.category}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Zoom PiP overlay (playbook live view) — floats above the player. */}
      {zoomOverlay ? (
        <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
          {zoomOverlay}
        </View>
      ) : null}
    </Modal>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────
const { width: SCREEN_W } = Dimensions.get('window');

// Safe-area is handled OUTSIDE the canvas (paddingBottom on portraitLockOuter)
// so the canvas itself can be a clean 9:16 design surface with no inner bottom
// padding fighting the artboard math. Anything that previously consumed inner
// space at the bottom is now reserved by the centered outer wrapper instead.
const webSafeBottomStyle: any = null;

const makeStyles = (fs: (n: number) => number) => StyleSheet.create({
  portraitLockOuter: {
    flex: 1,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Canvas — actual width/height/maxWidth applied inline from the artboard
  // scale so the StyleSheet baseline doesn't fight the dynamic canvas size.
  // The flex/width fallback only applies during the first render before
  // useWindowDimensions resolves; once dims are valid the inline overrides win.
  container: {
    flex: 1,
    backgroundColor: '#0E1117',
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: fs(16),
    paddingTop: fs((Platform.select({ ios: 44, android: 24, web: 8, default: 8 }) ?? 8) as number),
    paddingBottom: fs(6),
  },
  workoutName: {
    flex: 1,
    textAlign: 'center',
    color: '#8A95A3',
    fontSize: fs(14),
    fontWeight: '600',
    fontFamily: FB,
    marginHorizontal: fs(12),
  },
  progressText: {
    color: '#F5A623',
    fontSize: fs(14),
    fontWeight: '700',
    fontFamily: FH,
  },
  progressBar: {
    height: fs(3),
    backgroundColor: '#1A1E26',
    marginHorizontal: fs(20),
    borderRadius: fs(2),
    overflow: 'hidden',
  },
  progressFill: {
    height: fs(3),
    backgroundColor: '#F5A623',
    borderRadius: fs(2),
  },

  // Center content area
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: fs(32),
    paddingBottom: fs(40),
  },

  // Ready
  readyLogo: { width: fs(180), height: fs(60), marginBottom: fs(16) },
  readyTitle: {
    fontSize: fs(28), fontWeight: '700', color: '#F0F4F8', fontFamily: FH,
    marginTop: fs(16), textAlign: 'center',
  },
  readyMeta: { fontSize: fs(15), color: '#8A95A3', fontFamily: FB, marginTop: fs(8) },
  bigStartBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: fs(10), backgroundColor: '#F5A623', paddingVertical: fs(18),
    paddingHorizontal: fs(48), borderRadius: fs(16), marginTop: fs(40),
  },
  bigStartText: { fontSize: fs(20), fontWeight: '700', color: '#0E1117', fontFamily: FH },

  // Ready — block overview grid
  readyBlockBadge: {
    width: fs(28), height: fs(28), borderRadius: fs(14),
    backgroundColor: '#F5A623', justifyContent: 'center', alignItems: 'center',
    marginRight: fs(10),
  },
  readyBlockBadgeText: {
    fontSize: fs(14), fontWeight: '700', color: '#0E1117', fontFamily: FH,
  },
  readyBlockLabel: {
    fontSize: fs(18), fontWeight: '700', color: '#F0F4F8', fontFamily: FH, flex: 1,
  },
  readyBlockRounds: {
    fontSize: fs(14), fontWeight: '600', color: '#8A95A3', fontFamily: FH, marginLeft: fs(8),
  },
  readyThumbGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: fs(8),
  },
  readyThumbCell: {
    width: '30%' as any, marginBottom: fs(4),
  },
  readyThumbImage: {
    width: '100%' as any, aspectRatio: 4 / 5, borderRadius: fs(8),
  },
  readyThumbName: {
    fontSize: fs(11), color: '#8A95A3', fontFamily: FB, marginTop: fs(4), textAlign: 'center',
  },
  readySection: {
    borderWidth: fs(1), borderColor: '#232B36', borderRadius: fs(12),
    backgroundColor: 'rgba(255,255,255,0.02)',
    padding: fs(10), marginBottom: fs(16),
  },
  readyFooter: {
    position: 'absolute' as any, bottom: fs(0), left: fs(0), right: fs(0),
    alignItems: 'center', paddingBottom: fs((Platform.select({ ios: 40, android: 24, web: 24, default: 24 }) ?? 24) as number),
    paddingTop: fs(16),
    backgroundColor: 'rgba(14,17,23,0.92)',
  },
  readyPlayBtn: {
    width: fs(64), height: fs(64), borderRadius: fs(32),
    backgroundColor: '#F5A623', justifyContent: 'center', alignItems: 'center',
  },

  // ── Heart rate ─────────────────────────────────────────────────────
  hrLinkBtn: {
    flexDirection: 'row', alignItems: 'center', gap: fs(6),
    paddingHorizontal: fs(14), paddingVertical: fs(8), marginBottom: fs(10),
    borderRadius: fs(20), borderWidth: fs(1), borderColor: '#1E2A3A',
    backgroundColor: '#151B28', maxWidth: fs(280),
  },
  hrLinkBtnText: {
    color: '#F0F4F8', fontSize: fs(13), fontWeight: '600', fontFamily: FB,
  },
  hrLinkRow: {
    flexDirection: 'row', alignItems: 'center', gap: fs(6), marginBottom: fs(10),
    maxWidth: fs(280),
  },
  hrLinkedText: {
    color: '#8A95A3', fontSize: fs(13), fontFamily: FB,
  },
  hrUnsupportedNote: {
    color: '#8A95A3', fontSize: fs(11), fontFamily: FB, marginBottom: fs(10),
  },
  hrBadge: {
    position: 'absolute', top: fs(8), right: fs(8),
    flexDirection: 'row', alignItems: 'center', gap: fs(4),
    paddingHorizontal: fs(8), paddingVertical: fs(4),
    borderRadius: fs(14), borderWidth: fs(1),
    backgroundColor: 'rgba(14,17,23,0.72)',
  },
  hrBadgeText: {
    fontWeight: '700', fontFamily: FH,
  },
  hrSummaryRow: {
    flexDirection: 'row', alignItems: 'center', gap: fs(6), marginTop: fs(4),
  },
  hrSummaryText: {
    color: '#8A95A3', fontSize: fs(14), fontFamily: FB,
  },

  // ── Intro / Outro ──────────────────────────────────────────────────
  introOutroContainer: {
    flex: 1,
    backgroundColor: '#0E1117',
    justifyContent: 'center',
    alignItems: 'center',
  },
  introOutroGradient: {
    flex: 1,
    width: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: fs(32),
  },
  // Intro split-screen
  introSplitContainer: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: '#0E1117',
  },
  introVideoPanel: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  introBrandPanel: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: fs(16),
    backgroundColor: '#0E1117',
  },
  introLogo: { width: fs(160), height: fs(54), marginBottom: fs(20) },
  introBlockLabel: {
    fontSize: fs(20), fontWeight: '700', color: '#F0F4F8', fontFamily: FH,
    textAlign: 'center', marginBottom: fs(24), letterSpacing: fs(1),
  },
  introTitle: {
    fontSize: fs(36), fontWeight: '700', color: '#F0F4F8', fontFamily: FH,
    textAlign: 'center', marginBottom: fs(8),
  },
  introSubtitle: {
    fontSize: fs(18), fontWeight: '700', color: '#F5A623', fontFamily: FH,
    letterSpacing: fs(4), marginBottom: fs(32),
  },
  introTimerPill: {
    backgroundColor: 'rgba(245,166,35,0.15)',
    paddingHorizontal: fs(24), paddingVertical: fs(8),
    borderRadius: fs(20), marginBottom: fs(16),
  },
  introTimerText: {
    fontSize: fs(24), fontWeight: '700', color: '#F5A623', fontFamily: FH,
  },
  outroTitle: {
    fontSize: fs(42), fontWeight: '900', color: '#FFFFFF', fontFamily: FH,
    textAlign: 'center', letterSpacing: fs(8), marginBottom: fs(24),
  },
  outroSubtitle: {
    fontSize: fs(18), color: '#8A95A3', fontFamily: FB,
    textAlign: 'center', marginBottom: fs(32),
  },

  // ── Special block shared styles ────────────────────────────────────
  specialContent: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: fs(24),
    paddingTop: fs(24),
  },
  specialIconCircle: {
    width: fs(72), height: fs(72), borderRadius: fs(36),
    backgroundColor: 'rgba(251,191,36,0.15)',
    justifyContent: 'center', alignItems: 'center',
    marginBottom: fs(16),
  },
  specialPhaseLabel: {
    fontSize: fs(14), fontWeight: '700', color: '#FBBF24', fontFamily: FH,
    letterSpacing: fs(2), marginBottom: fs(8),
  },
  specialTitle: {
    fontSize: fs(24), fontWeight: '700', color: '#F0F4F8', fontFamily: FH,
    textAlign: 'center', marginBottom: fs(16),
  },
  specialTimerRow: {
    alignItems: 'center', marginTop: 'auto' as any, paddingBottom: fs(24),
  },
  specialTimerNum: {
    fontSize: fs(48), fontWeight: '700', color: '#F0F4F8', fontFamily: FH,
    marginBottom: fs(8),
  },

  // ── Demo block — thumbnail grid ─────────────────────────────────────
  demoTitleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    width: '100%', paddingHorizontal: fs(4), marginBottom: fs(16),
  },
  demoBlockTitle: {
    fontSize: fs(22), fontWeight: '700', color: '#F0F4F8', fontFamily: FH, textAlign: 'center',
  },
  demoGrid: {
    flex: 1, flexDirection: 'row', flexWrap: 'wrap',
    justifyContent: 'center', gap: fs(8), width: '100%',
  },
  demoGridCell: {
    aspectRatio: 4 / 5,
    borderRadius: fs(10),
    overflow: 'hidden',
    backgroundColor: '#1A2035',
  },
  demoGridImage: {
    width: '100%', height: '100%',
  },

  // ── Transition block ───────────────────────────────────────────────
  transitionInstruction: {
    fontSize: fs(18), color: '#C9D1D9', fontFamily: FB,
    textAlign: 'center', lineHeight: fs(26),
    paddingHorizontal: fs(16), marginBottom: fs(24),
  },

  // ── Water Break block ──────────────────────────────────────────────
  waterBreakLabel: {
    fontSize: fs(20), fontWeight: '700', color: '#38BDF8', fontFamily: FH,
    letterSpacing: fs(2), textAlign: 'center',
  },
  waterBreakVideoOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(56,189,248,0.25)',
  } as any,
  waterBreakTextOverlay: {
    position: 'absolute', bottom: fs(24), left: fs(0), right: fs(0),
    alignItems: 'center',
  } as any,
  waterBreakOverlayText: {
    fontSize: fs(48), fontWeight: '900', color: '#FFFFFF', fontFamily: FH,
    letterSpacing: fs(6), textAlign: 'center', opacity: 0.7,
    textShadowColor: 'rgba(0,0,0,0.6)', textShadowOffset: { width: fs(0), height: fs(2) },
    textShadowRadius: fs(8),
  },
  waterBreakPlaceholder: {
    backgroundColor: 'rgba(56,189,248,0.08)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  waterBreakPlaceholderText: {
    fontSize: fs(32), fontWeight: '900', color: '#FFFFFF', fontFamily: FH,
    letterSpacing: fs(4), textAlign: 'center',
  },

  // Phase labels
  phaseLabel: {
    fontSize: fs(16), fontWeight: '700', color: '#F5A623', fontFamily: FH,
    letterSpacing: fs(2), marginBottom: fs(16), textAlign: 'center',
  },
  blockLabel: {
    fontSize: fs(14), fontWeight: '600', color: '#8A95A3', fontFamily: FB,
    marginBottom: fs(8),
  },

  // ── In-workout shared frame ────────────────────────────────────────
  // Every active phase (work, rest, transition, waterBreak, demo,
  // grabEquipment, swap) uses this container. The canvas is sized to fit
  // exactly inside the available viewport (after outer safe-area), so no
  // inner padding is needed — the slots fill the canvas precisely.
  workContainer: {
    flex: 1, paddingHorizontal: fs(0), paddingTop: fs(0), paddingBottom: fs(0),
    overflow: 'hidden',
  },

  // ── Fixed-position slots ───────────────────────────────────────────
  // Heights are stable across phases so logo / title / timer / media /
  // next-up never shift between work, rest, transition, etc.
  logoSlot: {
    height: fs(56),
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: fs(0),
    marginBottom: fs(4), // SLOT_GAP_LOGO — gap to title row
  },
  slotLogo: { width: fs(260), height: fs(52) },
  // Title/timer row is locked to a fixed pixel height — NOT minHeight — so
  // the slot does not grow when content varies between phases (REST shows
  // 2 short lines, WORK can show superset + 2-line name + reps + cues). If
  // this height changed phase-to-phase the flex mediaSlot below would
  // shrink/grow with it and the centered media would visibly shift.
  // Title/timer row sits flush with the media's left/right edges. Title is a
  // fixed-height transparent module with centered text (Devin's "title module"
  // requirement). Timer pins to the right with a fixed minWidth.
  titleTimerSlot: {
    height: fs(112),
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: fs(0),
    marginBottom: fs(12), // SLOT_GAP_TITLE — gap to media (must always be visible)
    alignSelf: 'center',
  },
  titleColumn: {
    flex: 1, height: fs(112), marginRight: fs(4),
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: fs(8), backgroundColor: 'transparent',
  },
  timerColumn: { justifyContent: 'center' },
  // Media slot — outer reserves the vertical space between the title row
  // and the next-up slot. The inner box (mediaInner) gets explicit pixel
  // width/height passed inline so the ratio is always exactly 4:5; this
  // avoids RN's ambiguous behavior when aspectRatio + percent dimensions
  // collide. Surrounding layout shrinks/grows around it, never the ratio.
  mediaSlot: {
    flex: 1,
    width: '100%',
    minHeight: fs(180),
    alignItems: 'center',
    justifyContent: 'center',
  },
  mediaInner: {
    overflow: 'hidden',
    backgroundColor: '#000000',
    borderRadius: fs(12),
    position: 'relative',
  },
  // Next-up row is also locked to a fixed pixel height. REST passes null
  // content (slot would be ~76px from minHeight) and WORK passes the next-up
  // bar (~92px). Locking the height stops the flex mediaSlot above from
  // shrinking on work, which is what was visibly shifting the media up.
  nextUpSlot: {
    height: fs(64),
    justifyContent: 'center',
    paddingTop: fs(0),
    marginTop: fs(12), // SLOT_GAP_MEDIA — gap from media (must always be visible)
    alignSelf: 'center',
  },
  // Swap-mode badge — small pill that stacks naturally inside the centered
  // title column, directly below the movement name. Replaces the older
  // `splitLabelOverlay` that was painted over the top-left of the video and
  // obscured the movement.
  swapBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: fs(10),
    paddingVertical: fs(3),
    borderRadius: fs(12),
    marginTop: fs(6),
  },
  equipmentPanel: {
    backgroundColor: 'rgba(251,146,60,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swapPanel: {
    backgroundColor: 'rgba(245,166,35,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  transitionInstructionInline: {
    fontSize: fs(13), color: '#8A95A3', fontFamily: FB, marginTop: fs(2), textAlign: 'center',
  },

  // Legacy aliases (kept for any leftover references)
  workLogo: { width: fs(260), height: fs(72), alignSelf: 'center', marginBottom: fs(6) },
  nameTimerRow: {
    flexDirection: 'row', alignItems: 'flex-start',
    justifyContent: 'space-between', paddingHorizontal: fs(4), marginBottom: fs(8),
  },
  nameColumn: { flex: 1, marginRight: fs(12) },
  workMovementName: {
    fontWeight: '800', color: '#FFFFFF', fontFamily: FH, textAlign: 'center',
  },
  workReps: {
    fontSize: fs(18), fontWeight: '600', color: '#F5A623', fontFamily: FH,
    marginTop: fs(2), textAlign: 'center',
  },
  workCues: {
    fontSize: fs(13), color: '#8A95A3', fontFamily: FB, marginTop: fs(2), textAlign: 'center',
  },
  workTimer: {
    fontSize: fs(80), fontWeight: '700', color: '#FFFFFF', fontFamily: FH, lineHeight: fs(80),
  },
  // Gold timer box (used across all screens). Width and height are fixed so
  // the box never resizes when the digit count changes (9→10, 39→40, or when
  // formatTime flips from "59" to "1:00"). Font size is controlled by
  // getTimerFontStyle at the call site so 1–2 char values dominate the box
  // and 3+ char values (M:SS) shrink to fit cleanly.
  goldTimerBox: {
    backgroundColor: '#F5A623',
    width: fs(132),
    height: fs(112),
    borderRadius: fs(12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  goldTimerText: {
    fontWeight: '800',
    color: '#0E1117',
    fontFamily: FH,
    textAlign: 'center',
  },
  // REST phase styles
  restPhaseLabel: {
    fontSize: fs(18), fontWeight: '700', color: '#8A95A3', fontFamily: FH,
    letterSpacing: fs(2), textAlign: 'center',
  },
  restNextName: {
    fontSize: fs(28), fontWeight: '800', color: '#F0F4F8', fontFamily: FH,
    marginTop: fs(2), textAlign: 'center',
  },
  restTimerBox: {
    backgroundColor: '#1A2035',
    width: fs(132),
    height: fs(112),
    borderRadius: fs(12),
    alignItems: 'center',
    justifyContent: 'center',
  },
  restTimerText: {
    fontWeight: '800',
    color: '#FFFFFF',
    fontFamily: FH,
    textAlign: 'center',
  },
  sideBadgeRow: { alignItems: 'center', marginBottom: fs(4) },
  // SPLIT label
  splitLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: fs(4),
    marginBottom: fs(4),
  },
  splitText: {
    fontSize: fs(14), fontWeight: '700', color: '#F5A623', fontFamily: FH, letterSpacing: fs(1),
  },
  splitSep: {
    fontSize: fs(14), color: '#6B7280', fontFamily: FB,
  },
  splitDuration: {
    fontSize: fs(14), color: '#8A95A3', fontFamily: FB,
  },
  splitArrows: {
    fontSize: fs(14), color: '#F5A623', fontFamily: FB,
  },

  // Video area — strict 4:5 portrait crop
  videoArea: {
    aspectRatio: 4 / 5, width: '100%', marginTop: fs(4),
    borderRadius: fs(0), overflow: 'hidden', backgroundColor: '#000000',
  },
  videoInner: { flex: 1, position: 'relative' },
  videoPlayer: { width: '100%', height: '100%' },
  videoLayer: { ...StyleSheet.absoluteFillObject } as any,
  videoPlaceholder: {
    justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A1E26',
  },
  placeholderLogoFrame: {
    justifyContent: 'center', alignItems: 'center', backgroundColor: '#0E1117', overflow: 'hidden',
  },
  placeholderLogo: {
    width: '100%', height: '100%',
  },
  posterFallback: {
    ...StyleSheet.absoluteFillObject, backgroundColor: '#000000',
  } as any,

  // ── Shared player-shell overlay ──────────────────────────────────────
  // Covers the whole player container so tap-anywhere + controls behave
  // identically across every active phase (work/rest/demo/intro/etc.).
  sharedTapCatcher: {
    ...StyleSheet.absoluteFillObject, backgroundColor: 'transparent', zIndex: 90,
  } as any,
  sharedControlsOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.55)',
    zIndex: 100,
  } as any,
  sharedOverlayBackdrop: {
    ...StyleSheet.absoluteFillObject,
  } as any,
  sharedOverlayHeader: {
    position: 'absolute' as any,
    top: fs(0), left: fs(0), right: fs(0),
    zIndex: 110,
  },
  sharedOverlayCloseRow: {
    position: 'absolute' as any,
    top: fs((Platform.select({ ios: 44, android: 20, web: 16, default: 16 }) ?? 16) as number),
    left: fs(16),
  },
  sharedOverlayCenterStack: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center', alignItems: 'center', gap: fs(18),
  } as any,
  sharedOverlayCenterBtn: {
    width: fs(84), height: fs(84), borderRadius: fs(42),
    backgroundColor: '#F5A623',
    justifyContent: 'center', alignItems: 'center',
  },
  sharedOverlayDoneText: {
    fontSize: fs(14), fontWeight: '700', color: '#0E1117', fontFamily: FH, marginTop: fs(2),
  },
  sharedOverlaySkipBtn: {
    flexDirection: 'row', alignItems: 'center', gap: fs(6),
    paddingVertical: fs(10), paddingHorizontal: fs(20),
    borderRadius: fs(20), borderWidth: fs(1),
    borderColor: 'rgba(245,166,35,0.5)',
  },
  sharedOverlaySkipText: {
    fontSize: fs(15), fontWeight: '600', color: '#F5A623', fontFamily: FH,
  },
  overlayBottomRow: {
    flexDirection: 'row' as any, alignItems: 'center' as any, gap: fs(12),
  },
  pipBtn: {
    flexDirection: 'row' as any, alignItems: 'center' as any, gap: fs(6),
    paddingVertical: fs(10), paddingHorizontal: fs(16),
    borderRadius: fs(20), borderWidth: fs(1),
    borderColor: 'rgba(240,244,248,0.3)',
  },
  pipBtnText: {
    fontSize: fs(13), fontWeight: '600' as any, color: '#F0F4F8', fontFamily: FH,
  },
  seekRow: {
    flexDirection: 'row' as any,
    alignItems: 'center' as any,
    gap: fs(24),
  },
  seekBtn10: {
    width: fs(60), height: fs(60), borderRadius: fs(30),
    borderWidth: fs(1), borderColor: 'rgba(255,255,255,0.3)',
    justifyContent: 'center' as any, alignItems: 'center' as any,
  },
  seekBtn10Label: {
    fontSize: fs(18), color: '#F0F4F8', fontWeight: '700' as any, lineHeight: fs(18),
    fontFamily: FH,
  },
  seekBtn10Sec: {
    fontSize: fs(10), color: '#8A95A3', fontWeight: '600' as any, lineHeight: fs(12),
    fontFamily: FH,
  },

  // Legacy styles
  movementName: {
    fontSize: fs(32), fontWeight: '700', color: '#F0F4F8', fontFamily: FH,
    textAlign: 'center', marginBottom: fs(8),
  },
  cues: {
    fontSize: fs(14), color: '#8A95A3', fontFamily: FB,
    textAlign: 'center', marginBottom: fs(8), lineHeight: fs(20),
  },
  repsText: {
    fontSize: fs(16), fontWeight: '600', color: '#F5A623', fontFamily: FH, marginBottom: fs(8),
  },
  sideBadge: {
    backgroundColor: 'rgba(245,166,35,0.15)',
    paddingHorizontal: fs(16), paddingVertical: fs(6), borderRadius: fs(12),
    borderWidth: fs(1), borderColor: 'rgba(245,166,35,0.3)',
    marginBottom: fs(12), alignSelf: 'center',
  },
  sideBadgeText: {
    fontSize: fs(14), fontWeight: '700', color: '#F5A623', fontFamily: FH, letterSpacing: fs(1),
  },

  // Timer
  timerRing: {
    width: Math.min(SCREEN_W * 0.55, 220),
    height: Math.min(SCREEN_W * 0.55, 220),
    borderRadius: Math.min(SCREEN_W * 0.55, 220) / 2,
    borderWidth: fs(6), borderColor: '#F5A623',
    justifyContent: 'center', alignItems: 'center',
    marginTop: fs(24), marginBottom: fs(24),
  },
  timerRingRest: { borderColor: '#2A3040' },
  timerNum: {
    fontSize: fs(64), fontWeight: '700', color: '#F0F4F8', fontFamily: FH,
  },
  timerSub: {
    fontSize: fs(13), color: '#8A95A3', fontFamily: FB, marginTop: fs(-4),
  },
  countdownNum: {
    fontSize: fs(96), fontWeight: '700', color: '#F5A623', fontFamily: FH,
  },
  upNextName: {
    fontSize: fs(22), fontWeight: '700', color: '#F0F4F8', fontFamily: FH,
    marginTop: fs(12), textAlign: 'center',
  },

  // Controls (REST phase)
  controls: { flexDirection: 'row', alignItems: 'center', gap: fs(24) },
  controlBtn: {
    width: fs(72), height: fs(72), borderRadius: fs(36),
    backgroundColor: '#F5A623', justifyContent: 'center', alignItems: 'center',
  },
  repDoneBtn: {
    width: fs(120), height: fs(120), borderRadius: fs(60),
    backgroundColor: '#6EBB7A', justifyContent: 'center', alignItems: 'center',
    marginTop: fs(24), marginBottom: fs(16),
  },
  repDoneBtnText: {
    fontSize: fs(18), fontWeight: '700', color: '#0E1117', fontFamily: FH, marginTop: fs(4),
  },
  skipBtn: {
    flexDirection: 'row', alignItems: 'center', gap: fs(6),
    paddingVertical: fs(12), paddingHorizontal: fs(16),
  },
  skipText: {
    fontSize: fs(14), fontWeight: '600', color: '#F5A623', fontFamily: FH,
  },

  // Next up — short horizontal row: [LABEL | name+meta (flex) | thumb]
  nextUpBar: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: fs(12), paddingVertical: fs(8), paddingHorizontal: fs(12),
    flexDirection: 'row', alignItems: 'center', width: '100%',
    borderWidth: fs(1), borderColor: 'rgba(255,255,255,0.1)',
    alignSelf: 'center', gap: fs(12),
  },
  nextUpLabel: {
    fontSize: fs(11), fontWeight: '700', color: '#8A95A3', fontFamily: FH,
    letterSpacing: fs(1),
  },
  nextUpContent: {
    flexDirection: 'row', alignItems: 'center', gap: fs(12), width: '100%',
  },
  nextUpThumb: { width: fs(40), height: fs(40), borderRadius: fs(8), backgroundColor: '#1A2035' },
  nextUpInfo: { flex: 1 },
  nextUpName: {
    fontSize: fs(15), fontWeight: '600', color: '#F0F4F8', fontFamily: FH,
  },
  nextUpMeta: {
    fontSize: fs(11), color: '#8A95A3', fontFamily: FB, marginTop: fs(1),
  },

  // Complete
  completeTitle: {
    fontSize: fs(28), fontWeight: '700', color: '#F0F4F8', fontFamily: FH,
    marginTop: fs(16), textAlign: 'center',
  },
  completeMeta: {
    fontSize: fs(15), color: '#8A95A3', fontFamily: FB, marginTop: fs(8),
  },

  // TTS warning
  ttsWarning: {
    flexDirection: 'row', alignItems: 'center', gap: fs(3),
    paddingHorizontal: fs(6), paddingVertical: fs(2), borderRadius: fs(8),
    backgroundColor: 'rgba(224,107,79,0.15)',
  },
  ttsWarningText: {
    fontSize: fs(10), color: '#E06B4F', fontFamily: FB, fontWeight: '600',
  },
  offlineBadge: {
    flexDirection: 'row', alignItems: 'center', gap: fs(3),
    paddingHorizontal: fs(6), paddingVertical: fs(2), borderRadius: fs(8),
    backgroundColor: 'rgba(245,158,11,0.15)',
  },
  offlineBadgeText: {
    fontSize: fs(10), color: '#F59E0B', fontFamily: FB, fontWeight: '600',
  },

  // Swap modal
  swapOverlay: {
    flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.7)',
  },
  swapSheet: {
    backgroundColor: '#111827', borderTopLeftRadius: 16, borderTopRightRadius: 16,
    padding: 20, maxHeight: '60%', overflow: 'hidden' as const,
  },
  swapHeader: {
    flexDirection: 'row', justifyContent: 'space-between',
    alignItems: 'center', marginBottom: 16,
  },
  swapTitle: {
    fontSize: 18, fontWeight: '700', color: '#E2E8F0', fontFamily: FH,
  },
  swapHint: {
    fontSize: 13, color: '#8A95A3', fontFamily: FB,
    textAlign: 'center', paddingVertical: 20,
  },
  swapItem: {
    paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#1E2A3A',
  },
  swapItemName: {
    fontSize: 15, fontWeight: '600', color: '#E2E8F0', fontFamily: FH,
  },
  swapItemCat: {
    fontSize: 12, color: '#8A95A3', fontFamily: FB, marginTop: 2,
  },
  swapReasonInput: {
    backgroundColor: '#1A1F2E', borderRadius: 8, padding: 10,
    fontSize: 14, color: '#E2E8F0', fontFamily: FB, marginBottom: 8,
    borderWidth: 1, borderColor: '#252B3B',
  },

  // Staging-only audio-handoff variant badge + COPY LOG button row.
  audioVariantRow: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    zIndex: 999,
  },
  audioVariantBadge: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 1,
    borderColor: '#F5A623',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  copyLogBtn: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderWidth: 1,
    borderColor: '#F5A623',
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  audioVariantBadgeText: {
    color: '#F5A623',
    fontFamily: FB,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },

  // Preview badge
  previewBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: fs(6),
    backgroundColor: 'rgba(245,166,35,0.12)',
    borderWidth: fs(1),
    borderColor: 'rgba(245,166,35,0.3)',
    borderRadius: fs(20),
    paddingHorizontal: fs(14),
    paddingVertical: fs(6),
    marginBottom: fs(16),
  },
  previewBadgeText: {
    fontSize: fs(12),
    fontWeight: '700',
    color: '#F5A623',
    fontFamily: FH,
    letterSpacing: fs(1),
  },
});
