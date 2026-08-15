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

    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    Object.assign(canvas.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      opacity: '0',
      pointerEvents: 'none',
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

    // Attach audio synchronously if the shared graph is up. Skipped in
    // probeMode='canvas' — the audio merge itself is one of the three
    // candidate culprits for foreground-music starvation.
    let audioAttached = false;
    if (pm !== 'canvas') {
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

    const TARGET_FPS = 30;
    const FRAME_INTERVAL = 1000 / TARGET_FPS;
    let lastFrameTime = 0;
    let rafId = 0;

    let fpsWindowStart = 0;
    let fpsWindowFrames = 0;
    let currentFps = 0;

    function drawFrame(now: number) {
      rafId = requestAnimationFrame(drawFrame);

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

      // Retry audio attach each frame until the shared graph is up (audio may
      // not have been primed by the time armPip fires — first-frame attach
      // still counts as arriving before iOS opens PiP).
      if (!audioAttached && pm !== 'canvas') {
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

    pushHandoffLog(`[PiP] startStream primed video+${audioAttached ? 'audio' : 'noaudio'}`);
    return mergedStream;
  }, []);

  const stopStream = useCallback(() => {
    const cleanup = cleanupRef.current;
    cleanupRef.current = null;
    if (cleanup) cleanup();
  }, []);

  // React to enabled changes. startStream is idempotent so an armPip that
  // already ran does not double-create; stopStream fires when PiP exits.
  useEffect(() => {
    if (!enabled) {
      stopStream();
      return;
    }
    startStream();
    return () => { stopStream(); };
  }, [enabled, startStream, stopStream]);

  return { mediaStream, videoElRef, isReady, canvasElRef, startStream, stopStream };
}
