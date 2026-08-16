/// <reference lib="dom" />
import { useCallback, useEffect, useRef, useState } from 'react';
import { getPipAudioStream } from './useWorkoutTTS';
import { pushHandoffLog } from '../utils/handoffLog';
import {
  drawVideoFrame,
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
};
let latestPipFeed: PipFeed | null = null;

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
        initialMergeOutcome = `iOS:VIDEO+LIVENESS (silent osc gain=1e-5 freq=20Hz — spike topology, music via shadow hide-seam)`;
        pushHandoffLog(`[PiP] iOS liveness track attached: silent oscillator gain=1e-5 freq=20Hz tracks=${livenessDest.stream.getAudioTracks().length}`);
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
      if (totalFrameCount % 60 === 0) {
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
        pushHandoffLog(`[PiP] drawFrame#${totalFrameCount} canvasId=${canvasId} refCanvasId=${refCanvasId}${divergent} canvasParent=${parentTag} videoRS=${vrs} vpaused=${vpaused} cvCT=${cvCT} cvRS=${cvRS} feedPhase=${feedPhase} visState=${visState}`);
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
      const videoEl = feed?.videoEl ?? null;
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

      drawVideoFrame(ctx, videoEl, videoX, videoY, videoW, videoH, movName);

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
      drawMovementName(ctx, movName, pad, Math.round(ch * 0.075), nameMaxW);

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
