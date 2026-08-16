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

  // Keep latest props accessible inside the rAF loop without re-creating it.
  const stateRef = useRef({
    phase,
    current,
    next,
    timeLeft,
    isPaused,
    isRepBased,
    repsDone,
    progressPct,
  });
  useEffect(() => {
    stateRef.current = { phase, current, next, timeLeft, isPaused, isRepBased, repsDone, progressPct };
  }, [phase, current, next, timeLeft, isPaused, isRepBased, repsDone, progressPct]);

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
    let audioAttached = false;
    let initialMergeOutcome: string;
    if (pm === 'full') {
      const audioStream = getPipAudioStream();
      if (!audioStream) {
        initialMergeOutcome = 'full:getPipAudioStream=null';
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
        const videoEl = videoElRef.current;
        const vrs = videoEl?.readyState ?? -1;
        pushHandoffLog(`[PiP] drawFrame#1 canvasId=${canvasId} canvasParent=${parentTag} videoRS=${vrs}`);
      }
      if (totalFrameCount % 60 === 0) {
        const parentTag = canvas.parentNode?.nodeName ?? 'DETACHED';
        const videoEl = videoElRef.current;
        const vrs = videoEl?.readyState ?? -1;
        const vpaused = videoEl?.paused ?? true;
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
        pushHandoffLog(`[PiP] drawFrame#${totalFrameCount} canvasId=${canvasId} refCanvasId=${refCanvasId}${divergent} canvasParent=${parentTag} videoRS=${vrs} vpaused=${vpaused} cvCT=${cvCT} cvRS=${cvRS}`);
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

      const {
        phase: ph,
        current: cur,
        timeLeft: tl,
        isRepBased: repBased,
        repsDone: done,
        progressPct: pct,
      } = stateRef.current;

      const videoEl = videoElRef.current;
      const movName = cur?.name ?? '';

      // Retry audio attach each frame until the shared graph is up. Only in
      // 'full' mode — 'audio' defers audio to armPip's in-gesture call, and
      // 'canvas' never attaches. Same conditional as the initial merge above.
      if (!audioAttached && pm === 'full') {
        const audioStream = getPipAudioStream();
        if (audioStream) {
          const audioTracks = audioStream.getAudioTracks();
          for (const track of audioTracks) mergedStream.addTrack(track);
          if (audioTracks.length > 0) {
            audioAttached = true;
            setIsReady(true);
          }
        }
      }

      const pad = Math.round(cw * 0.04);
      const videoH = Math.round(ch * 0.55);
      const videoY = Math.round(ch * 0.12);
      const timerFontPx = Math.round(cw * 0.09);
      const barH = Math.round(ch * 0.012);
      const barY = ch - barH - Math.round(ch * 0.03);
      const overlayY = videoY + videoH + Math.round(ch * 0.025);

      ctx.fillStyle = '#0E1117';
      ctx.fillRect(0, 0, cw, ch);

      drawVideoFrame(ctx, videoEl, 0, videoY, cw, videoH, movName);

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

      const nextName = stateRef.current.next?.name;
      if (nextName) {
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
    const stream = streamRef.current;
    if (!stream) {
      pushHandoffLog('[PiP] attachAudioTracks: no stream');
      return false;
    }
    if (stream.getAudioTracks().length > 0) return true;
    const audioStream = getPipAudioStream();
    if (!audioStream) {
      pushHandoffLog('[PiP] attachAudioTracks: getPipAudioStream null');
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
