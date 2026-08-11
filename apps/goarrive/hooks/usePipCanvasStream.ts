/// <reference lib="dom" />
import { useEffect, useRef, useState } from 'react';
import { getPipAudioStream } from './useWorkoutTTS';
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
}

interface PipCanvasStreamResult {
  mediaStream: MediaStream | null;
  videoElRef: React.RefObject<HTMLVideoElement | null>;
  isReady: boolean;
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
  canvasW = 1080,
  canvasH = 1350,
}: PipCanvasStreamOptions): PipCanvasStreamResult {
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [isReady, setIsReady] = useState(false);

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

  useEffect(() => {
    // Guard: only run on web with captureStream support
    if (!enabled) return;
    if (typeof window === 'undefined') return;
    if (!('captureStream' in HTMLCanvasElement.prototype)) return;

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    Object.assign(canvas.style, {
      position: 'fixed',
      left: '-10000px',
      top: '0',
      opacity: '0',
      pointerEvents: 'none',
    });
    document.body.appendChild(canvas);

    const ctxRaw = canvas.getContext('2d');
    if (!ctxRaw) {
      canvas.parentNode?.removeChild(canvas);
      return;
    }
    // Narrow to non-null for use inside rAF closure (TS can't narrow through lambdas).
    const ctx: CanvasRenderingContext2D = ctxRaw;

    // Capture video track from canvas at 30fps
    const canvasStream: MediaStream = (canvas as any).captureStream(30);
    const videoTrack = canvasStream.getVideoTracks()[0];

    // Build the merged MediaStream (video + audio). Audio may not be available
    // yet on first frame — retry each frame until it's connected.
    const mergedStream = new MediaStream();
    if (videoTrack) mergedStream.addTrack(videoTrack);

    let audioAttached = false;

    const TARGET_FPS = 30;
    const FRAME_INTERVAL = 1000 / TARGET_FPS;
    let lastFrameTime = 0;
    let rafId = 0;

    function drawFrame(now: number) {
      rafId = requestAnimationFrame(drawFrame);

      // Throttle to ~30fps
      if (now - lastFrameTime < FRAME_INTERVAL) return;
      lastFrameTime = now;

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

      // Try to attach audio tracks if not yet done
      if (!audioAttached) {
        const audioStream = getPipAudioStream();
        if (audioStream) {
          const audioTracks = audioStream.getAudioTracks();
          for (const track of audioTracks) {
            mergedStream.addTrack(track);
          }
          if (audioTracks.length > 0) {
            audioAttached = true;
            setIsReady(true);
          }
        }
      }

      // Layout constants (proportional to canvas size)
      const pad = Math.round(canvasW * 0.04);
      const videoH = Math.round(canvasH * 0.55);
      const videoY = Math.round(canvasH * 0.12);
      const timerFontPx = Math.round(canvasW * 0.09);
      const barH = Math.round(canvasH * 0.012);
      const barY = canvasH - barH - Math.round(canvasH * 0.03);
      const overlayY = videoY + videoH + Math.round(canvasH * 0.025);

      // Clear background
      ctx.fillStyle = '#0E1117';
      ctx.fillRect(0, 0, canvasW, canvasH);

      // Video frame or fallback
      drawVideoFrame(ctx, videoEl, 0, videoY, canvasW, videoH, movName);

      // Semi-transparent header bar for timer/name readability
      ctx.fillStyle = 'rgba(14,17,23,0.65)';
      ctx.fillRect(0, 0, canvasW, videoY);

      // Phase label (small, top-left)
      ctx.save();
      ctx.fillStyle = '#8A95A3';
      ctx.font = `500 ${Math.round(canvasW * 0.035)}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(ph.toUpperCase(), pad, Math.round(canvasH * 0.06));
      ctx.restore();

      // Movement name (left side of header)
      const nameMaxW = canvasW * 0.6;
      drawMovementName(ctx, movName, pad, Math.round(canvasH * 0.075), nameMaxW);

      // Timer (right side of header)
      if (!repBased) {
        const timerStr = formatTime(tl);
        drawTimer(ctx, timerStr, canvasW - pad, Math.round(canvasH * 0.02), timerFontPx);
      }

      // Rep count (center overlay below video)
      if (repBased) {
        const target = Number(cur?.reps ?? 0);
        drawRepCount(ctx, done, target, canvasW / 2, overlayY, Math.round(canvasW * 0.12));
      }

      // Next up label (bottom area)
      const nextName = stateRef.current.next?.name;
      if (nextName && ph === 'rest') {
        ctx.save();
        ctx.fillStyle = '#8A95A3';
        ctx.font = `500 ${Math.round(canvasW * 0.032)}px -apple-system, BlinkMacSystemFont, sans-serif`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        ctx.fillText(`NEXT: ${nextName}`, pad, barY - Math.round(canvasH * 0.02));
        ctx.restore();
      }

      // Progress bar (very bottom)
      drawProgressBar(ctx, pct, 0, barY, canvasW, barH);
    }

    rafId = requestAnimationFrame(drawFrame);
    setMediaStream(mergedStream);

    return () => {
      cancelAnimationFrame(rafId);
      try {
        for (const track of mergedStream.getTracks()) track.stop();
      } catch {}
      canvas.parentNode?.removeChild(canvas);
      setMediaStream(null);
      setIsReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, canvasW, canvasH]);

  return { mediaStream, videoElRef, isReady };
}
