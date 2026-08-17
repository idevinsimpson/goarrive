/// <reference lib="dom" />
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPipAudioStream } from './useWorkoutTTS';
import { pushHandoffLog } from '../utils/handoffLog';
import {
  drawVideoFrame,
  drawFallbackGradient,
  drawTimer,
  drawMovementName,
  drawRepCount,
  drawProgressBar,
} from './usePipCanvasStream.helpers';

// Pass-10 fingerprint fix. Pass-9 device log showed the tile RENDERED but
// FROZE state at a phase boundary: "WORK / Swiss Ball Lunge With Twist /
// 0:00" persisted across multiple later WORK phases while the fps counter
// stayed live (20-22fps) and `cvCT` kept advancing. Read: the draw loop
// is alive and frames flow, but its state feed is severed — the loop
// captured refs belonging to a component instance that detached at a
// phase boundary. The singleton loop keeps drawing that dead instance's
// refs forever: frozen state, null videoRS=-1, live fps.
//
// Fix shape: state and video are published to module-level pointers on
// every render. Draw loop reads THIS, never captured refs. If the hook
// remounts (subtree swap, fast-refresh, key change), the new mount rebinds
// the pointers and the loop keeps tracking the live workout.
type PipFeed = {
  phase: string;
  current: { name?: string; isRepBased?: boolean; target?: number; reps?: string } | null;
  next: { name?: string } | null;
  timeLeft: number;
  isPaused: boolean;
  isRepBased: boolean;
  repsDone: number;
  progressPct: number;
  videoEl: HTMLVideoElement | null;
  // Pass-14 Fix 1: draw-loop-callable resolver. WorkoutPlayer installs a
  // function that scans videosRef for the best <video> candidate and
  // logs the pick to the COPY LOG. drawFrame invokes it whenever its
  // bound videoEl is null-or-paused during a work-like phase, so a
  // stale binding self-corrects on the next rAF tick.
  resolveVideo: (() => HTMLVideoElement | null) | null;
};
let latestPipFeed: PipFeed | null = null;

// Pass-14 instrumentation: expose the liveness AudioContext so the
// autopsy in useMusicHandoff and the PiP presentation-change listeners
// in WorkoutPlayer can sample its state. iOS may suspend the liveness
// ctx on background (a finding of its own — it means the "no active AV
// session" reclaim theory is one layer deeper than we thought).
let latestLivenessCtx: AudioContext | null = null;
export function getLivenessCtxState(): string {
  if (!latestLivenessCtx) return 'not-initialized';
  return latestLivenessCtx.state;
}

// Pass-16 Fix 2: gesture-blessed resume() for the liveness AudioContext.
// Pass-15 device log showed a suspended/interrupted storm at 00:07:54→
// 00:08:41 (voice cues seizing the audio session) and PiP entering with
// livenessCtx=suspended — the keep-alive track was luck-dependent.
// Throttle to 1s min interval so a burst of statechange events can't spam
// resume() calls (some browsers reject rapid resume attempts). Callable
// from anywhere with an active user gesture on the stack.
let lastLivenessResumeAt = 0;
export function resumeLivenessCtx(reason: string): void {
  if (!latestLivenessCtx) {
    pushHandoffLog(`[PiP] livenessCtx resume skip reason=${reason} state=not-initialized`);
    return;
  }
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - lastLivenessResumeAt < 1000) return;
  lastLivenessResumeAt = now;
  const ctx = latestLivenessCtx;
  const before = ctx.state;
  if (before === 'running') {
    pushHandoffLog(`[PiP] livenessCtx resume noop reason=${reason} state=running`);
    return;
  }
  try {
    const p = ctx.resume();
    if (p && typeof p.then === 'function') {
      p.then(
        () => pushHandoffLog(`[PiP] livenessCtx resume ok reason=${reason} before=${before} after=${ctx.state}`),
        (err: unknown) => pushHandoffLog(`[PiP] livenessCtx resume fail reason=${reason} before=${before} err=${(err as Error)?.name ?? 'unknown'}`),
      );
    } else {
      pushHandoffLog(`[PiP] livenessCtx resume sync reason=${reason} before=${before} after=${ctx.state}`);
    }
  } catch (e) {
    pushHandoffLog(`[PiP] livenessCtx resume throw reason=${reason} before=${before} err=${(e as Error)?.name ?? 'unknown'}`);
  }
}

// Pass-19 R4: module-level image cache for prep-phase static assets
// (grabEquipment image, demo movement posters). Keyed by URL. Cache persists
// across workout phases so a poster loaded during demo is free during the
// next visit. Eviction: none (bounded by session poster count, not a concern).
const pipImageCache = new Map<string, HTMLImageElement>();
function getOrLoadPipImage(url: string): HTMLImageElement | null {
  if (!url || typeof Image === 'undefined') return null;
  const cached = pipImageCache.get(url);
  if (cached) return cached;
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = url;
  pipImageCache.set(url, img);
  return img;
}

// True on iOS Safari (WebKit). Pass-10 fork-insensitive stutter fix: on
// iOS the PiP stream carries NO music — video-only. Music path stays on
// the proven v3 shadow via the hide seam. This resolves both the (A)
// standdown-never-engaged branch and the (B) element-stall-under-graph
// branch without waiting for the discriminator log.
function isIOSSafariUA(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iP(hone|od|ad)/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

interface PipCanvasStreamOptions {
  enabled: boolean;
  phase: string;
  current: { name?: string; isRepBased?: boolean; target?: number; reps?: string } | null;
  next: { name?: string } | null;
  timeLeft: number;
  isPaused: boolean;
  isRepBased: boolean;
  repsDone: number;
  progressPct: number;
  videoElRef: React.RefObject<HTMLVideoElement | null>;
  // Pass-14 Fix 1: self-healing pipSource resolver. drawFrame invokes
  // this whenever its bound videoEl is null-or-paused during a work-like
  // phase so the loop can retry element selection on the next rAF tick
  // without waiting for another effect trigger. Owner (WorkoutPlayer)
  // is responsible for logging every rebind to the COPY LOG.
  pipSourceResolverRef?: React.RefObject<(() => HTMLVideoElement | null) | null>;
  // Pass-7: presentation-target video (the hidden element with
  // srcObject = mergedStream). Read in the periodic drawFrame log to
  // sample .currentTime + .readyState — direct evidence of whether the
  // canvas captureStream is producing video frames the video element can
  // consume. If currentTime advances while the PiP tile is black, frames
  // are flowing and the black tile is downstream of the stream (PiP window
  // rendering). If currentTime stays 0.00, the stream carries no video
  // and the invisible-canvas hypothesis (known-issues-and-lessons #251)
  // holds.
  canvasVideoElRef?: React.RefObject<HTMLVideoElement | null>;
  canvasW?: number;
  canvasH?: number;
  // Pass-2 mechanism probe (staging-only). Runs the hook inline with a
  // subset of components so the caller can isolate which step starves the
  // foreground music path.
  //   'canvas' → rAF + canvas draws, NO audio track merge
  //   'audio'  → rAF + canvas + audio merge (caller still skips hidden video)
  //   'full'   → everything, including caller-owned hidden video
  probeMode?: 'canvas' | 'audio' | 'full';
}

interface PipCanvasStreamResult {
  mediaStream: MediaStream | null;
  videoElRef: React.RefObject<HTMLVideoElement | null>;
  isReady: boolean;
  canvasElRef: React.RefObject<HTMLCanvasElement | null>;
  // Imperative start: creates canvas + captureStream + audio merge and returns
  // the MediaStream synchronously so a caller (armPip) can assign srcObject
  // inside the same tap-gesture stack. Idempotent — safe to call twice.
  startStream: () => MediaStream | null;
  stopStream: () => void;
  // Pass-4 deferred-audio: 'audio' probeMode warms a video-only stream so the
  // continuously-playing hidden element never carries our music/voice bus.
  // armPip calls this inside the tap gesture to attach audio just-in-time.
  // Returns true if audio tracks were added (or already present).
  attachAudioTracks: () => boolean;
  // Pass-5 exit path: on PiP exit AND on failed PiP entry, remove any audio
  // tracks from the merged stream. Video track stays warm so the next arm is
  // still fast. Without this, the P0-known "hidden element carrying merged
  // audio starves foreground music" configuration persists inline for the
  // rest of the session after any arm attempt (successful OR failed).
  detachAudioTracks: () => number;
}

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${rem.toString().padStart(2, '0')}`;
}

export function usePipCanvasStream({
  enabled,
  phase,
  current,
  next,
  timeLeft,
  isPaused,
  isRepBased,
  repsDone,
  progressPct,
  videoElRef,
  pipSourceResolverRef,
  canvasVideoElRef,
  canvasW = 540,
  canvasH = 675,
  probeMode,
}: PipCanvasStreamOptions): PipCanvasStreamResult {
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [isReady, setIsReady] = useState(false);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Pass-10: publish to the module-level feed on every render so the
  // singleton draw loop reads live state even if this hook instance
  // detaches and a new one takes over. No dep array — publish always.
  useEffect(() => {
    latestPipFeed = {
      phase, current, next, timeLeft, isPaused, isRepBased, repsDone, progressPct,
      videoEl: videoElRef.current,
      resolveVideo: pipSourceResolverRef?.current ?? null,
    };
  });

  // Keep options that startStream reads from a stable ref so armPip's callback
  // identity doesn't churn on every prop change.
  const optsRef = useRef({ canvasW, canvasH, probeMode });
  useEffect(() => { optsRef.current = { canvasW, canvasH, probeMode }; }, [canvasW, canvasH, probeMode]);

  const startStream = useCallback((): MediaStream | null => {
    if (streamRef.current) return streamRef.current;
    if (typeof window === 'undefined') return null;
    if (!('captureStream' in HTMLCanvasElement.prototype)) {
      pushHandoffLog('[PiP] startStream: captureStream unsupported');
      return null;
    }

    const { canvasW: cw, canvasH: ch, probeMode: pm } = optsRef.current;

    // Pass-6 canvas-identity tag. Blank-tile hypothesis: startStream could be
    // called twice under some ref/effect ordering, leaving an orphan rAF loop
    // drawing to canvas A while the srcObject was rebuilt from canvas B. The
    // drawFrame closure captures canvas.__pipCanvasId at creation; canvasElRef
    // is reassigned every startStream. If the periodic drawFrame log shows a
    // different id than canvasElRef.current.__pipCanvasId, we have proof of
    // a stale-closure double-canvas — the video's srcObject is fed by a
    // canvas nobody draws into, so the tile presents transparent (i.e. black).
    // Identical ids means the tile-black cause is elsewhere (e.g. drawVideoFrame
    // shortcut, ctx.reset, off-screen composite).
    const canvasId = Math.random().toString(36).slice(2, 8);
    const canvas = document.createElement('canvas');
    (canvas as any).__pipCanvasId = canvasId;
    canvas.width = cw;
    canvas.height = ch;
    // Pass-7 visibility fix: iOS WKWebView does not populate frames into
    // an invisible canvas's captureStream MediaStream (known-issues-and-
    // lessons #251 — display:none/visibility:hidden confirmed; pass-6b
    // evidence extends this to opacity:0 + left:-10000px). Pass 6 proved
    // one canvas, one draw loop, frame counter to #5100 — yet the tile
    // stays black. Working theory: iOS treats "effectively invisible"
    // the same way, regardless of the specific CSS mechanism. Small
    // visible thumbnail top-left is #251's exact remedy. Prove painting
    // fixes it first, then dial visibility down as its own follow-up.
    Object.assign(canvas.style, {
      position: 'fixed',
      top: '8px',
      left: '8px',
      width: '80px',
      height: '100px',
      zIndex: '1',
      opacity: '1',
      pointerEvents: 'none',
      border: '1px solid #F5A623',
    });
    document.body.appendChild(canvas);
    canvasElRef.current = canvas;

    const ctxRaw = canvas.getContext('2d');
    if (!ctxRaw) {
      canvas.parentNode?.removeChild(canvas);
      canvasElRef.current = null;
      pushHandoffLog('[PiP] startStream: 2d ctx null');
      return null;
    }
    const ctx: CanvasRenderingContext2D = ctxRaw;

    // Draw one frame synchronously so captureStream has content the moment
    // the caller assigns srcObject. Without this, iOS Safari may reject
    // requestPictureInPicture (video readyState = HAVE_NOTHING).
    ctx.fillStyle = '#0E1117';
    ctx.fillRect(0, 0, cw, ch);
    ctx.fillStyle = '#F5A623';
    ctx.font = `600 ${Math.round(cw * 0.045)}px -apple-system, BlinkMacSystemFont, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('LOADING…', cw / 2, ch / 2);

    const canvasStream: MediaStream = (canvas as any).captureStream(30);
    const videoTrack = canvasStream.getVideoTracks()[0];

    const mergedStream = new MediaStream();
    if (videoTrack) mergedStream.addTrack(videoTrack);

    // Attach audio synchronously ONLY in probeMode='full' — pass-4 splits the
    // audio path so we can test PM's hypothesis: warm-stream starvation comes
    // from the continuously-playing element carrying our audio bus, not from
    // the canvas draws. 'audio' mode leaves the stream video-only and exposes
    // attachAudioTracks() for armPip to call in-gesture. 'canvas' never
    // attaches audio at all — control mode for the mechanism.
    // Pass 10: iOS fork-insensitive fix — the PiP stream on iOS is
    // VIDEO-ONLY. Music path stays on the v3 shadow via the hide seam.
    // Two-part change: (1) skip audio merge here on iOS regardless of
    // probeMode, (2) drop the standdown in useMusicHandoff so hide seam
    // runs normally. Kills both stutter branches without waiting for the
    // A/B discriminator log. Non-iOS keeps the graph-audio path.
    const iOS = isIOSSafariUA();
    let audioAttached = false;
    let initialMergeOutcome: string;
    // Pass 11: iOS silent-oscillator liveness track. Pass-10 device log
    // caught spontaneous mid-PiP page teardown (17:44:23 mode=inline →
    // 17:44:37 fresh startStream/canvasId/videoId/HANDOFF/init all again)
    // — iOS is reclaiming the tab because a video-only MediaStream reads
    // as "no active AV session". The 08/13 spike, which survived swipe-
    // home for 59s with frames flowing, always carried an oscillator
    // audio track in the stream. That track was the liveness signal, not
    // the music. Pass 11 restores exactly that topology minus audibility:
    // near-zero-gain oscillator → MediaStreamAudioDestinationNode → audio
    // track on the merged stream. Music path stays on the v3 shadow
    // (pass-10 hide seam remains). References stashed on the merged
    // stream itself so cleanup can close the context on stopStream.
    let livenessOsc: OscillatorNode | null = null;
    let livenessCtx: AudioContext | null = null;
    let livenessDest: MediaStreamAudioDestinationNode | null = null;
    if (iOS) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        livenessCtx = new AudioCtx();
        livenessDest = livenessCtx.createMediaStreamDestination();
        const osc = livenessCtx.createOscillator();
        const gain = livenessCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 20; // sub-audible
        gain.gain.value = 0.00001; // effectively silent
        osc.connect(gain);
        gain.connect(livenessDest);
        osc.start();
        livenessOsc = osc;
        for (const track of livenessDest.stream.getAudioTracks()) {
          mergedStream.addTrack(track);
        }
        // Pass-14 instrumentation: publish to module-level pointer + attach
        // statechange listener. If iOS suspends the liveness ctx on
        // background, that's a finding on its own — the video-only stream
        // that looks like "no active AV session" is upstream of the
        // suspend, and pass-15 needs to lift music INTO the stream.
        latestLivenessCtx = livenessCtx;
        try {
          const ctxRef = livenessCtx;
          ctxRef.addEventListener('statechange', () => {
            const vs = typeof document !== 'undefined' ? document.visibilityState : 'unknown';
            pushHandoffLog(`[PiP] livenessCtx statechange state=${ctxRef.state} visState=${vs}`);
            // Pass-16 Fix 2: self-heal — whenever the ctx drops off
            // 'running' (interrupted, suspended by another audio session,
            // etc.) attempt an immediate resume. Throttled inside
            // resumeLivenessCtx so a burst of state flips can't spam
            // resume() calls. Without this the ctx sits suspended until
            // the next user gesture, which is exactly the state Devin's
            // pass-15 log caught on PiP entry (livenessCtx=suspended).
            if (ctxRef.state !== 'running') {
              resumeLivenessCtx('statechange');
            }
          });
        } catch {}
        initialMergeOutcome = `iOS:VIDEO+LIVENESS (silent osc gain=1e-5 freq=20Hz — spike topology, music via shadow hide-seam)`;
        pushHandoffLog(`[PiP] iOS liveness track attached: silent oscillator gain=1e-5 freq=20Hz tracks=${livenessDest.stream.getAudioTracks().length} state=${livenessCtx.state}`);
      } catch (e) {
        initialMergeOutcome = `iOS:VIDEO-ONLY (liveness osc failed: ${(e as Error)?.name ?? 'unknown'}) music via shadow hide-seam`;
        pushHandoffLog(`[PiP] iOS liveness track FAILED: ${(e as Error)?.name ?? 'unknown'} — stream is video-only (tab-reclaim risk remains)`);
      }
      setIsReady(true);
    } else if (pm === 'full') {
      const audioStream = getPipAudioStream();
      if (!audioStream) {
        initialMergeOutcome = 'full:AUDIO-NULL@prime (getPipAudioStream()=null at startStream)';
      } else {
        const audioTracks = audioStream.getAudioTracks();
        for (const track of audioTracks) mergedStream.addTrack(track);
        if (audioTracks.length > 0) {
          audioAttached = true;
          setIsReady(true);
          initialMergeOutcome = `full:merged ${audioTracks.length} track(s)`;
        } else {
          initialMergeOutcome = 'full:audioStream had 0 tracks';
        }
      }
    } else {
      initialMergeOutcome = `${pm}:no initial merge (by design)`;
    }

    const TARGET_FPS = 30;
    const FRAME_INTERVAL = 1000 / TARGET_FPS;
    let lastFrameTime = 0;
    let rafId = 0;

    let fpsWindowStart = 0;
    let fpsWindowFrames = 0;
    let currentFps = 0;
    let firstFrameLogged = false;
    let totalFrameCount = 0;
    // Pass-16: switch drawFrame periodic log from frame-count throttle
    // (every 60 frames = ~2s @ 30fps) to wall-clock throttle (every 5s).
    // The COPY LOG ring is 5000 entries; the pass-15 capture window
    // consumed the ring in <60s and lost the PiP-leave event on three
    // consecutive runs. Cutting cadence 2.5× buys ~5× wall-clock coverage
    // per copy (leave events fire once, at unpredictable moments in the
    // PiP-background window).
    let lastPeriodicLogAt = 0;
    const PERIODIC_LOG_INTERVAL_MS = 5000;
    // Pass 12: taint tripwire flag. captureStream() from a canvas that
    // has been drawn with cross-origin (non-CORS) video silently stops
    // delivering frames while ctx.drawImage keeps working — on-page
    // canvas paints, PiP tile freezes. Root fix lives in WorkoutPlayer
    // registerVideo (crossOrigin=anonymous BEFORE src). This flag is
    // the second-line defence: getImageData throws once tainted, we
    // log CANVAS TAINTED once, and subsequent frames skip video draws
    // in favour of a poster/text fallback so one bad element can never
    // kill the whole tile again.
    let pipCanvasTainted = false;
    // Pass-19 R3: hold last decoded video element so a brief rebind gap
    // (new element readyState < 2 for one or more frames) paints the frozen
    // last frame instead of the fallback gradient. blipCoveredTotal tracks
    // how many frames were covered for the probe log.
    //
    // Pass-19 R3v2 (2026-08-17): pin cache to the element's src URL — NOT to
    // cur.name. During REST, feed.current still points to the FINISHED
    // movement (WorkoutTimer keeps cur=prev, next=incoming through rest), so
    // a name-based key can't tell "next movement's element still loading"
    // from "same movement, brief decode hiccup." The name check evaluated
    // true across rest boundaries and the tile froze on the prior movement's
    // frame while the main player showed the incoming preview (Lawn Mower
    // report, IMG_5117). Src-based invalidation asks the right question:
    // "does the cached frame belong to the URL we're now trying to draw?"
    // If not, drop the cover and let the gradient placeholder render.
    let lastDecodedVideoEl: HTMLVideoElement | null = null;
    let blipResetTotal = 0;
    let blipCoveredTotal = 0;
    let blipSkipStaleTotal = 0;
    // Pass-19: one-time log on first prep-phase draw (bundle marker for grep)
    let prepPhaseFirstDrawLogged = false;
    let prepTextFirstDrawLogged = false;
    let demoMotionFirstDrawLogged = false;
    // Pass-20 R4 prep-cut: per-boundary suppression counter. Signature is
    // (targetStepType | name | videoUrl); a change means we entered a new
    // no-video boundary. On boundary end we log the count of frames the
    // hard-cut saved from painting a stale previous-movement frame.
    // pipPrepCut=1
    let prepCutLastBoundarySig = '';
    let prepCutBoundarySuppressed = 0;
    let prepCutFirstHitLogged = false;

    function drawFrame(now: number) {
      rafId = requestAnimationFrame(drawFrame);
      totalFrameCount++;

      if (!firstFrameLogged) {
        firstFrameLogged = true;
        const parentTag = canvas.parentNode?.nodeName ?? 'DETACHED';
        // Pass-10: read the movement video via the module-level feed so
        // the log names the element the loop actually draws from, not the
        // possibly-stale prop capture.
        const videoEl = latestPipFeed?.videoEl ?? null;
        const vrs = videoEl?.readyState ?? -1;
        const feedTag = latestPipFeed ? 'live' : 'null';
        pushHandoffLog(`[PiP] drawFrame#1 canvasId=${canvasId} canvasParent=${parentTag} videoRS=${vrs} feed=${feedTag}`);
      }
      if (now - lastPeriodicLogAt >= PERIODIC_LOG_INTERVAL_MS) {
        lastPeriodicLogAt = now;
        const parentTag = canvas.parentNode?.nodeName ?? 'DETACHED';
        const videoEl = latestPipFeed?.videoEl ?? null;
        const vrs = videoEl?.readyState ?? -1;
        const vpaused = videoEl?.paused ?? true;
        const feedPhase = latestPipFeed?.phase ?? 'null';
        // Divergence check: closure canvasId vs the id of whatever canvas is
        // currently in canvasElRef. Same id = single canvas, stale-closure
        // hypothesis dead. Different id = orphan rAF loop, srcObject is
        // fed by canvasElRef.current which nobody draws into. See canvas
        // creation site for the full theory.
        const refCanvasId = (canvasElRef.current as any)?.__pipCanvasId ?? 'null';
        const divergent = refCanvasId !== canvasId ? ' DIVERGENT' : '';
        // Pass-7 direct measure: canvas video's currentTime is the ground
        // truth for "did the stream produce frames?" Advancing = yes;
        // stuck at 0.00 = the captureStream carries no video (invisible-
        // canvas hypothesis alive).
        const canvasVideoEl = canvasVideoElRef?.current;
        const cvCT = canvasVideoEl ? canvasVideoEl.currentTime.toFixed(2) : 'null';
        const cvRS = canvasVideoEl?.readyState ?? -1;
        // Pass 11: visState — document.visibilityState at the sample. Lets
        // the log distinguish "rAF still firing while page hidden" (iOS
        // sometimes throttles background rAF to 1Hz, sometimes freezes it)
        // from "page went visible and reload took over". Combined with
        // PAGE-INIT the tab lifecycle is fully observable in one grep.
        const visState = typeof document !== 'undefined' ? document.visibilityState : 'unknown';
        // Pass-16: sample liveness ctx state on every periodic tick — if
        // the self-heal misses a beat we can see it here alongside cvCT.
        const lvCtx = latestLivenessCtx?.state ?? 'null';
        pushHandoffLog(`[PiP] drawFrame#${totalFrameCount} canvasId=${canvasId} refCanvasId=${refCanvasId}${divergent} canvasParent=${parentTag} videoRS=${vrs} vpaused=${vpaused} cvCT=${cvCT} cvRS=${cvRS} feedPhase=${feedPhase} visState=${visState} livenessCtx=${lvCtx}`);
      }

      if (now - lastFrameTime < FRAME_INTERVAL) return;
      lastFrameTime = now;

      fpsWindowFrames++;
      if (fpsWindowStart === 0) fpsWindowStart = now;
      if (now - fpsWindowStart >= 1000) {
        currentFps = Math.round((fpsWindowFrames * 1000) / (now - fpsWindowStart));
        fpsWindowFrames = 0;
        fpsWindowStart = now;
      }

      // Pass-10: read live state through the module-level pointer so a
      // stale hook instance can't freeze the loop. If the pointer is null
      // (first frame before publish effect runs), fall back to a paused
      // placeholder so drawing never crashes.
      const feed = latestPipFeed;
      const ph = feed?.phase ?? 'ready';
      const cur = feed?.current ?? null;
      const nx = feed?.next ?? null;
      const tl = feed?.timeLeft ?? 0;
      const repBased = feed?.isRepBased ?? false;
      const done = feed?.repsDone ?? 0;
      const pct = feed?.progressPct ?? 0;
      let videoEl = feed?.videoEl ?? null;
      // Pass-14 Fix 1 / Pass-16 extension: self-healing binding across
      // work AND rest. Pass-15 excluded rest from resolver calls so the
      // tile lost its bind at every rest and fell to the text-card
      // fallback while the main app kept showing the next movement's
      // preview (Devin's rest screenshot: video visible in the player,
      // text card in the PiP tile — same time, same URL). Adding rest
      // + demoing-like phases to the visual-phase set lets the picker
      // stay bound to the correct element through rest and into the
      // next work.
      //
      // Also drop the `!videoEl.paused` gate: pass-16 relaxes
      // drawVideoFrame to draw paused rs>=2 frames (a frozen frame is
      // what the main area shows during rest — better than a text
      // card). If the bound element is null we still need the resolver,
      // otherwise we keep the current bind and let the resolver run
      // when either (a) the expected URL changes (miss window resets)
      // or (b) the picked candidate goes null.
      // Pass-19 R4: add intro + followAlongVideo so their video elements are
      // resolved by the picker. Image-only phases (demo, grabEquipment with
      // static image) also need the phase in this set so the resolver runs and
      // produces probe log lines even when the draw slot uses an image instead.
      const visualPhase = ph === 'work' || ph === 'rest' || ph === 'swap' || ph === 'transition' || ph === 'grabEquipment' || ph === 'waterBreak' || ph === 'demo' || ph === 'intro' || ph === 'followAlongVideo';
      if (visualPhase) {
        const resolved = feed?.resolveVideo?.() ?? null;
        if (resolved) videoEl = resolved;
      }
      const isRest = ph === 'rest';
      // Pass-10: REST tile mirrors the player — show "Next: <name>" as the
      // primary label instead of leaving the previous movement's name in
      // place. Fall through to cur.name during WORK/other phases.
      const movName = isRest && nx?.name ? `Next: ${nx.name}` : (cur?.name ?? '');

      // Retry audio attach each frame until the shared graph is up. Only in
      // 'full' mode AND non-iOS — pass-10 makes iOS video-only. 'audio'
      // defers to armPip's in-gesture call, 'canvas' never attaches.
      if (!audioAttached && pm === 'full' && !iOS) {
        const audioStream = getPipAudioStream();
        if (audioStream) {
          const audioTracks = audioStream.getAudioTracks();
          for (const track of audioTracks) mergedStream.addTrack(track);
          if (audioTracks.length > 0) {
            audioAttached = true;
            setIsReady(true);
            // Pass 8: name the moment the per-frame retry succeeds so we
            // can tell "audio came online mid-stream at frame N" from
            // "audio was never attached". Silent success was invisible.
            pushHandoffLog(`[PiP] audio attached mid-stream retry frame=${totalFrameCount} tracks=${audioTracks.length}`);
          }
        }
      }

      const pad = Math.round(cw * 0.04);
      const timerFontPx = Math.round(cw * 0.09);
      const barH = Math.round(ch * 0.012);
      const barY = ch - barH - Math.round(ch * 0.03);
      // Pass-10: movement region is 4:5 (house media ratio). Fit inside a
      // middle band with room above for header/name and below for rep
      // count / next label / progress bar. Center horizontally.
      const topBand = Math.round(ch * 0.13);
      const bottomBand = Math.round(ch * 0.25);
      const availH = ch - topBand - bottomBand;
      const availW = cw - 2 * pad;
      const RATIO_W_H = 4 / 5;
      let videoW = availH * RATIO_W_H;
      let videoH = availH;
      if (videoW > availW) {
        videoW = availW;
        videoH = videoW / RATIO_W_H;
      }
      videoW = Math.round(videoW);
      videoH = Math.round(videoH);
      const videoX = Math.round((cw - videoW) / 2);
      const videoY = topBand + Math.round((availH - videoH) / 2);
      const overlayY = videoY + videoH + Math.round(ch * 0.025);

      ctx.fillStyle = '#0E1117';
      ctx.fillRect(0, 0, cw, ch);

      // Pass-19 R4 + Pass-20 R4 prep-cut: per-frame draw gate for no-video
      // steps. Runs BEFORE the taint-guarded video path so the previous
      // movement's still-bound element can never paint through at the reveal
      // boundary. Asymmetric on purpose: with-video → with-video keeps the
      // R3v2 blip cover (desired for smooth handoff); only no-video / prep
      // targets get the hard cut.
      //
      // Draw target: during REST the timer keeps cur=finished + nx=incoming
      // and WorkoutPlayer's reveal shows next throughout. Gating on cur
      // during REST would evaluate the OLD movement's stepType and let the
      // stale video keep drawing. Use drawTarget instead so no-video
      // detection fires the same frame the incoming step's data is
      // published — before any resolver rebind can land.
      //
      // pipPrepCut=1
      let prepDrawn = false;
      const drawTarget: any = ph === 'rest' && nx ? nx : cur;
      const targetStepType: string = drawTarget?.stepType ?? '';
      const targetVideoUrl: string = drawTarget?.videoUrl ?? '';
      const isNoVideoTarget =
        targetStepType === 'grabEquipment'
        || targetStepType === 'waterBreak'
        || targetStepType === 'demo'
        || targetStepType === 'transition'
        || (targetStepType === 'exercise' && !targetVideoUrl);

      // Boundary tracker: log the count of suppressed frames every time we
      // leave a no-video boundary. Devin's finding — "the previous movement
      // sometimes flashes" — becomes measurable here as "how many frames
      // the hard-cut caught for each countdown-into-prep boundary."
      const boundarySig = isNoVideoTarget
        ? `${targetStepType}|${drawTarget?.name ?? ''}|${targetVideoUrl}`
        : '';
      if (boundarySig !== prepCutLastBoundarySig) {
        if (prepCutLastBoundarySig !== '' && prepCutBoundarySuppressed > 0) {
          pushHandoffLog(`[PiP] pipPrepCut=1 boundaryEnd sig=${prepCutLastBoundarySig} suppressedFrames=${prepCutBoundarySuppressed}`);
        }
        prepCutBoundarySuppressed = 0;
        prepCutLastBoundarySig = boundarySig;
        if (isNoVideoTarget) {
          pushHandoffLog(`[PiP] pipPrepCut=1 boundaryStart target=${targetStepType} phase=${ph} name=${drawTarget?.name ?? ''} frame=${totalFrameCount}`);
        }
      }

      if (isNoVideoTarget) {
        prepCutBoundarySuppressed++;
        if (!prepCutFirstHitLogged) {
          prepCutFirstHitLogged = true;
          pushHandoffLog(`[PiP] pipPrepCut=1 firstHit target=${targetStepType} phase=${ph} frame=${totalFrameCount}`);
        }

        if (targetStepType === 'grabEquipment') {
          const imgUrl: string | undefined = drawTarget?.grabEquipmentImageUrl;
          const img = imgUrl ? getOrLoadPipImage(imgUrl) : null;
          if (img && img.complete && img.naturalWidth > 0) {
            try {
              const iAsp = img.naturalWidth / img.naturalHeight;
              const dAsp = videoW / videoH;
              let sx = 0; let sy = 0; let sw = img.naturalWidth; let sh = img.naturalHeight;
              if (iAsp > dAsp) { sw = img.naturalHeight * dAsp; sx = (img.naturalWidth - sw) / 2; }
              else { sh = img.naturalWidth / dAsp; sy = (img.naturalHeight - sh) / 2; }
              ctx.save();
              ctx.beginPath();
              ctx.roundRect(videoX, videoY, videoW, videoH, Math.round(videoW * 0.04));
              ctx.clip();
              ctx.drawImage(img, sx, sy, sw, sh, videoX, videoY, videoW, videoH);
              ctx.restore();
            } catch {
              drawFallbackGradient(ctx, videoX, videoY, videoW, videoH, movName);
            }
          } else {
            // Image missing or still loading — slate + title. Never a black
            // rectangle, and never the previous movement's frozen frame.
            drawFallbackGradient(ctx, videoX, videoY, videoW, videoH, movName);
          }
          if (!prepPhaseFirstDrawLogged) {
            prepPhaseFirstDrawLogged = true;
            const imgReady = !!(img && img.complete && img.naturalWidth > 0);
            pushHandoffLog(`[PiP] pipPass19R4PrepScreen=1 target=grabEquipment imgReady=${imgReady} frame=${totalFrameCount}`);
          }
        } else if (targetStepType === 'demo') {
          const demos: any[] = drawTarget?.demoMovements ?? [];
          if (demos.length > 0) {
            const cols = demos.length <= 4 ? 2 : 3;
            const rows = Math.ceil(demos.length / cols);
            const gutter = 4;
            const cellW = Math.floor((videoW - gutter * (cols - 1)) / cols);
            const cellH = Math.floor((videoH - gutter * (rows - 1)) / rows);
            for (let i = 0; i < demos.length; i++) {
              const col = i % cols;
              const row = Math.floor(i / cols);
              const mx = videoX + col * (cellW + gutter);
              const my = videoY + row * (cellH + gutter);
              // Prefer thumbnailUrl (GIF) over posterUrl (still) — same
              // priority as PosterThumb. Marker pipPass19R4Motion=1 fires
              // when a GIF is drawn.
              const gifUrl: string | undefined = demos[i].thumbnailUrl;
              const posterUrl: string | undefined = demos[i].posterUrl;
              const drawUrl = gifUrl || posterUrl;
              ctx.save();
              ctx.beginPath();
              ctx.roundRect(mx, my, cellW, cellH, 4);
              ctx.clip();
              if (drawUrl) {
                const img = getOrLoadPipImage(drawUrl);
                if (img && img.complete && img.naturalWidth > 0) {
                  try { ctx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, mx, my, cellW, cellH); } catch {}
                } else {
                  ctx.fillStyle = '#1A2030';
                  ctx.fillRect(mx, my, cellW, cellH);
                }
              } else {
                ctx.fillStyle = '#1A2030';
                ctx.fillRect(mx, my, cellW, cellH);
              }
              ctx.restore();
            }
            if (!prepPhaseFirstDrawLogged) {
              prepPhaseFirstDrawLogged = true;
              pushHandoffLog(`[PiP] pipPass19R4PrepScreen=1 target=demo demos=${demos.length} frame=${totalFrameCount}`);
            }
            if (!demoMotionFirstDrawLogged) {
              const hasGif = demos.some((d: any) => !!d.thumbnailUrl);
              if (hasGif) {
                demoMotionFirstDrawLogged = true;
                pushHandoffLog(`[PiP] pipPass19R4Motion=1 target=demo gifTiles=${demos.filter((d: any) => !!d.thumbnailUrl).length}/${demos.length} frame=${totalFrameCount}`);
              }
            }
          } else {
            drawFallbackGradient(ctx, videoX, videoY, videoW, videoH, movName);
          }
        } else {
          // waterBreak / transition / no-video exercise → gradient + centered
          // name. The old code let these fall through to the video draw path,
          // which is exactly where the previous movement flashed.
          drawFallbackGradient(ctx, videoX, videoY, videoW, videoH, movName);
        }

        prepDrawn = true;
      }

      // Pass 12: taint-guarded video draw. Skip once tainted. On each
      // untainted draw verify with getImageData(1x1); log the first
      // hit and switch to fallback for the rest of the session.
      // Pass-19 R3: hold last decoded video element so a rebind gap
      // (new element readyState < 2 for one or more frames) paints the
      // last decoded frame instead of the fallback gradient.
      // pipPass19R3Blip=1
      if (!prepDrawn) {
        if (!pipCanvasTainted) {
          // R3v2: update cache whenever the current picked element is decoded.
          if (videoEl && videoEl.readyState >= 2) {
            lastDecodedVideoEl = videoEl;
          }
          // R3v2: src-based cache invalidation. Compare the URL the cached
          // element is playing to the URL the current pick points at. If
          // they diverge (different movements), the cache is stale — drop it
          // so blip cover falls through to the fallback gradient with
          // "Next: <name>" instead of freezing on the prior movement's
          // frame. Marker pipPass19R3SrcReset=1 (bundle-grep).
          const cachedSrc = lastDecodedVideoEl
            ? (lastDecodedVideoEl.currentSrc || lastDecodedVideoEl.src || '')
            : '';
          const currentSrc = videoEl ? (videoEl.currentSrc || videoEl.src || '') : '';
          const srcDiverged = cachedSrc !== '' && currentSrc !== '' && cachedSrc !== currentSrc;
          if (srcDiverged) {
            lastDecodedVideoEl = null;
            blipResetTotal++;
            if (blipResetTotal === 1 || blipResetTotal % 10 === 0) {
              pushHandoffLog(`[PiP] pipPass19R3SrcReset=1 blipResetTotal=${blipResetTotal} frame=${totalFrameCount}`);
            }
          }
          // R3v2: blip cover only when cache is FOR THE SAME URL as the
          // current pick. Same-URL cache = same movement, brief decode
          // hiccup — safe to cover. Different-URL or empty-current cache
          // = wrong content, skip cover (fall through to gradient). This
          // is the fix for the Lawn Mower report: REST with next=Lawn
          // Mower kept painting the finished movement's cached frame
          // because name-based comparison couldn't see the URL change.
          const cachedSameContent =
            cachedSrc !== '' && currentSrc !== '' && cachedSrc === currentSrc;
          const blipEl =
            (!videoEl || videoEl.readyState < 2)
            && lastDecodedVideoEl
            && lastDecodedVideoEl.readyState >= 2
            && cachedSameContent
              ? lastDecodedVideoEl
              : null;
          const wouldHaveCovered =
            (!videoEl || videoEl.readyState < 2)
            && lastDecodedVideoEl
            && lastDecodedVideoEl.readyState >= 2
            && !cachedSameContent;
          const drawEl = blipEl ?? videoEl;
          if (blipEl) {
            blipCoveredTotal++;
            if (blipCoveredTotal === 1 || blipCoveredTotal % 30 === 0) {
              pushHandoffLog(`[PiP] pipPass19R3Blip=1 blipCoveredTotal=${blipCoveredTotal} frame=${totalFrameCount}`);
            }
          }
          if (wouldHaveCovered) {
            blipSkipStaleTotal++;
            if (blipSkipStaleTotal === 1 || blipSkipStaleTotal % 30 === 0) {
              pushHandoffLog(`[PiP] pipPass19R3SkipStale=1 blipSkipStaleTotal=${blipSkipStaleTotal} frame=${totalFrameCount}`);
            }
          }
          drawVideoFrame(ctx, drawEl, videoX, videoY, videoW, videoH, movName);
          try {
            ctx.getImageData(0, 0, 1, 1);
          } catch (e) {
            pipCanvasTainted = true;
            pushHandoffLog(`[PiP] CANVAS TAINTED — getImageData rejected after video draw (${(e as Error)?.name ?? 'unknown'}) — captureStream will silently stop delivering frames; falling back to poster for rest of session. Root cause: movement <video> loaded without crossOrigin=anonymous BEFORE src.`);
          }
        }
        if (pipCanvasTainted) {
          ctx.save();
          ctx.fillStyle = '#111';
          ctx.fillRect(videoX, videoY, videoW, videoH);
          ctx.fillStyle = '#8A95A3';
          ctx.font = `500 ${Math.round(cw * 0.03)}px -apple-system, BlinkMacSystemFont, sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('(video unavailable)', videoX + videoW / 2, videoY + videoH / 2);
          ctx.restore();
        }
      }

      ctx.fillStyle = 'rgba(14,17,23,0.65)';
      ctx.fillRect(0, 0, cw, videoY);

      ctx.save();
      ctx.fillStyle = '#8A95A3';
      ctx.font = `500 ${Math.round(cw * 0.035)}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(ph.toUpperCase(), pad, Math.round(ch * 0.06));
      ctx.restore();

      const nameMaxW = cw * 0.6;
      // Pass-19 R4 follow-up + Pass-20 R4: for grabEquipment, mirror the
      // main player's title (grabEquipmentText || name — see WorkoutPlayer
      // L2425) so the tile shows the instruction ("Grab 35 pound Dumbbells
      // & a Swiss Ball") above the image instead of just the block name.
      // Use targetStepType so this also fires during REST heading INTO a
      // grabEquipment step — same frame the prep-cut renders the image.
      // Marker pipPass19R4Text=1 stays for served-JS verification.
      const nameText = targetStepType === 'grabEquipment'
        ? (drawTarget?.grabEquipmentText || movName)
        : movName;
      if (targetStepType === 'grabEquipment' && !prepTextFirstDrawLogged && nameText && nameText !== movName) {
        prepTextFirstDrawLogged = true;
        pushHandoffLog(`[PiP] pipPass19R4Text=1 target=grabEquipment textLen=${nameText.length} frame=${totalFrameCount}`);
      }
      drawMovementName(ctx, nameText, pad, Math.round(ch * 0.075), nameMaxW);

      if (!repBased) {
        const timerStr = formatTime(tl);
        drawTimer(ctx, timerStr, cw - pad, Math.round(ch * 0.02), timerFontPx);
      }

      if (repBased) {
        const target = Number(cur?.reps ?? 0);
        drawRepCount(ctx, done, target, cw / 2, overlayY, Math.round(cw * 0.12));
      }

      // Bottom "NEXT:" pill hidden during REST — the primary label already
      // shows "Next: <name>" per the player's convention. During WORK/other
      // phases it stays as the up-next hint.
      const nextName = nx?.name;
      if (nextName && !isRest) {
        ctx.save();
        ctx.fillStyle = '#8A95A3';
        ctx.font = `500 ${Math.round(cw * 0.032)}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`NEXT: ${nextName}`, pad, barY - Math.round(ch * 0.02));
        ctx.restore();
      }

      ctx.save();
      ctx.fillStyle = 'rgba(240,244,248,0.55)';
      ctx.font = `500 ${Math.round(cw * 0.028)}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${currentFps}fps`, cw - pad, barY - Math.round(ch * 0.005));
      ctx.restore();

      drawProgressBar(ctx, pct, 0, barY, cw, barH);
    }

    rafId = requestAnimationFrame(drawFrame);

    streamRef.current = mergedStream;
    setMediaStream(mergedStream);

    cleanupRef.current = () => {
      cancelAnimationFrame(rafId);
      try {
        for (const track of mergedStream.getTracks()) track.stop();
      } catch {}
      // Pass 11: tear down the liveness oscillator + AudioContext so we
      // don't leak an AudioContext across unmounts (Safari caps them per
      // origin at 6).
      try { livenessOsc?.stop(); } catch {}
      try { livenessOsc?.disconnect(); } catch {}
      try { livenessDest?.disconnect(); } catch {}
      try { livenessCtx?.close(); } catch {}
      livenessOsc = null;
      livenessDest = null;
      if (latestLivenessCtx === livenessCtx) latestLivenessCtx = null;
      livenessCtx = null;
      canvas.parentNode?.removeChild(canvas);
      canvasElRef.current = null;
      streamRef.current = null;
      setMediaStream(null);
      setIsReady(false);
    };

    pushHandoffLog(`[PiP] startStream primed video+${audioAttached ? 'audio' : 'noaudio'} probe=${pm} outcome=${initialMergeOutcome} canvasId=${canvasId}`);
    return mergedStream;
  }, []);

  const stopStream = useCallback(() => {
    const cleanup = cleanupRef.current;
    cleanupRef.current = null;
    if (cleanup) cleanup();
  }, []);

  // Pass-4 late-attach: 'audio' probeMode leaves the warm stream video-only so
  // the continuously-playing hidden element never carries the music/voice bus.
  // armPip calls this inside the tap gesture — same MediaStream the element is
  // already playing gets audio tracks added just-in-time. Safari has been seen
  // to honor addTrack() on an active srcObject; if it doesn't, the log will say.
  const attachAudioTracks = useCallback((): boolean => {
    // Pass-10 iOS fork-insensitive: PiP stream is video-only on iOS.
    // No-op the tap-time attach so the merged stream stays clean and the
    // v3 shadow (via hide seam) is the sole music path.
    if (isIOSSafariUA()) {
      pushHandoffLog('[PiP] attachAudioTracks: iOS skip (video-only stream, music via shadow)');
      return false;
    }
    const stream = streamRef.current;
    if (!stream) {
      pushHandoffLog('[PiP] attachAudioTracks: no stream');
      return false;
    }
    const existingCount = stream.getAudioTracks().length;
    if (existingCount > 0) {
      // Pass 8: name the pass-through so the log distinguishes
      // "attach found tracks already merged at prime" from silent success.
      pushHandoffLog(`[PiP] attachAudioTracks: stream already has ${existingCount} audio track(s) — no-op`);
      return true;
    }
    const audioStream = getPipAudioStream();
    if (!audioStream) {
      // Pass 8: pass-7 session never once logged 'added N track(s)'. If we
      // land here it means (a) the initial prime merge failed with
      // AUDIO-NULL@prime AND (b) the audio graph is STILL cold at tap time.
      // Distinctive prefix so this failure names itself in the log grep.
      pushHandoffLog('[PiP] AUDIO-NULL@arm: attachAudioTracks called but getPipAudioStream()=null — no music track on merged stream');
      return false;
    }
    const audioTracks = audioStream.getAudioTracks();
    for (const track of audioTracks) stream.addTrack(track);
    if (audioTracks.length > 0) {
      pushHandoffLog(`[PiP] attachAudioTracks: added ${audioTracks.length} track(s)`);
      setIsReady(true);
      return true;
    }
    pushHandoffLog('[PiP] attachAudioTracks: audioStream had 0 tracks');
    return false;
  }, []);

  // Pass-5 exit path (see interface doc). Idempotent: returns 0 if nothing to
  // remove. Keeps the video track — only audio is stripped so the next arm's
  // attach is still cheap.
  const detachAudioTracks = useCallback((): number => {
    // Pass 11: iOS no-op. The only audio track on the iOS stream is the
    // silent liveness oscillator; ripping it out would kill the exact
    // signal that keeps iOS treating the tab as an active AV session
    // (the pass-10 mid-PiP reload cause). Music is never on this stream
    // on iOS, so there is nothing to detach for the P0 starvation guard.
    if (isIOSSafariUA()) {
      pushHandoffLog('[PiP] detachAudioTracks: iOS skip (liveness track must persist across arms)');
      return 0;
    }
    const stream = streamRef.current;
    if (!stream) {
      pushHandoffLog('[PiP] detachAudioTracks: no stream');
      return 0;
    }
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return 0;
    for (const track of audioTracks) {
      try { stream.removeTrack(track); } catch {}
    }
    pushHandoffLog(`[PiP] detachAudioTracks: removed ${audioTracks.length} track(s)`);
    return audioTracks.length;
  }, []);

  // Pass-4 keep-warm: startStream once on enabled=true and DON'T tear down on
  // enabled=false. Pass-3 rebuilt every ~3s (pipArming timeout) which starved
  // readyState between arms. Teardown now only on unmount.
  useEffect(() => {
    if (!enabled) return;
    startStream();
  }, [enabled, startStream]);
  useEffect(() => () => stopStream(), [stopStream]);

  return { mediaStream, videoElRef, isReady, canvasElRef, startStream, stopStream, attachAudioTracks, detachAudioTracks };
}
