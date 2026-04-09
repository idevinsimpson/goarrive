/**
 * generateMovementDerivatives — Professional media pipeline for GoArrive movements
 *
 * Single-pass frame capture from a cropped video, producing multiple derivative assets:
 *   1. High-quality GIF (240×300, quality 10, 8fps) — movement cards
 *   2. Low-quality GIF  (120×150, quality 20, 6fps) — folder thumbnails, slow networks
 *   3. First-frame JPEG (240×300) — static poster image
 *
 * The crop transform is the single source of truth:
 *   - cropScale, cropTranslateX, cropTranslateY define the coach's crop choice
 *   - cropFrameWidth, cropFrameHeight record the actual modal frame dimensions
 *   - Every derivative applies the exact same transform
 *
 * When zoomed out (cropScale < 1), exposed area is filled with a blurred version
 * of the same video frame (InShot-style), not black bars.
 *
 * Web-only — returns null on native platforms.
 */

import { Platform } from 'react-native';

let GIFConstructor: any = null;
if (Platform.OS === 'web') {
  try {
    const mod = require('gif.js.optimized');
    GIFConstructor = mod.default || mod;
  } catch (e) {
    console.warn('[Derivatives] Failed to load gif.js.optimized:', e);
  }
}

// ── Output dimensions ────────────────────────────────────────────────────────
const HI_WIDTH = 240;
const HI_HEIGHT = 300;
const LO_WIDTH = 120;
const LO_HEIGHT = 150;

const HI_FPS = 8;
const LO_FPS = 6;
const MAX_DURATION_SEC = 10;

// ── Types ────────────────────────────────────────────────────────────────────

export interface CropTransform {
  cropScale: number;
  cropTranslateX: number;
  cropTranslateY: number;
  /** Actual frame width from the crop modal — needed for accurate translate scaling */
  cropFrameWidth: number;
  /** Actual frame height from the crop modal */
  cropFrameHeight: number;
}

export interface DerivativeBlobs {
  /** 240×300 high-quality animated GIF */
  gifHigh: Blob | null;
  /** 120×150 low-quality animated GIF */
  gifLow: Blob | null;
  /** 240×300 JPEG of the first frame */
  firstFrame: Blob | null;
  /** Raw high-res frame ImageData array — kept for optional one-rep loop encoding */
  _hiFrames: ImageData[];
  /** Raw low-res frame ImageData array */
  _loFrames: ImageData[];
}

/**
 * Draw a single video frame onto a canvas with crop transform applied.
 * When zoomed out (scale < 1), draws a blurred background fill first.
 */
function drawCroppedFrame(
  ctx: CanvasRenderingContext2D,
  video: HTMLVideoElement,
  canvasW: number,
  canvasH: number,
  crop: CropTransform,
): void {
  const frameAspect = 4 / 5;
  const videoW = video.videoWidth;
  const videoH = video.videoHeight;
  const videoAspect = videoW / videoH;

  // Calculate "cover" fit dimensions on the canvas
  let coverW: number, coverH: number;
  if (videoAspect > frameAspect) {
    coverH = canvasH;
    coverW = coverH * videoAspect;
  } else {
    coverW = canvasW;
    coverH = coverW / videoAspect;
  }

  // Apply the user's crop scale
  const drawW = coverW * crop.cropScale;
  const drawH = coverH * crop.cropScale;

  // Center offset
  let drawX = (canvasW - drawW) / 2;
  let drawY = (canvasH - drawH) / 2;

  // Convert translate from crop-modal space to canvas space
  const scaleRatioX = canvasW / crop.cropFrameWidth;
  const scaleRatioY = canvasH / crop.cropFrameHeight;
  drawX += crop.cropTranslateX * scaleRatioX * crop.cropScale;
  drawY += crop.cropTranslateY * scaleRatioY * crop.cropScale;

  // Clear canvas
  ctx.clearRect(0, 0, canvasW, canvasH);

  // When zoomed out, fill exposed area with blurred background
  if (crop.cropScale < 1) {
    ctx.save();
    // Draw video at cover-fit (fills entire canvas), blurred
    const bgW = coverW; // cover-fit at scale=1
    const bgH = coverH;
    const bgX = (canvasW - bgW) / 2;
    const bgY = (canvasH - bgH) / 2;
    ctx.filter = 'blur(15px)';
    // Slight overscale to prevent blur edge artifacts
    ctx.drawImage(video, bgX - 5, bgY - 5, bgW + 10, bgH + 10);
    ctx.filter = 'none';
    ctx.restore();
  }

  // Draw the main (cropped) video frame
  ctx.drawImage(video, drawX, drawY, drawW, drawH);
}

/**
 * Encode an array of ImageData frames into a GIF blob.
 */
function encodeGif(
  frames: ImageData[],
  width: number,
  height: number,
  fps: number,
  quality: number,
  onProgress?: (p: number) => void,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const gif = new GIFConstructor({
      workers: 2,
      quality,
      width,
      height,
      workerScript: '/gif.worker.js',
    });

    for (const frame of frames) {
      gif.addFrame(frame, { delay: Math.round(1000 / fps), copy: true });
    }

    gif.on('finished', (blob: Blob) => resolve(blob));
    gif.on('progress', (p: number) => onProgress?.(p));
    gif.render();

    setTimeout(() => reject(new Error('GIF encoding timeout')), 90000);
  });
}

/**
 * Generate all movement derivatives from a video with crop transform applied.
 *
 * @param videoUrl  URL of the source video
 * @param crop      Crop transform (single source of truth)
 * @param onProgress Optional progress callback (0–1)
 * @returns All derivative blobs, or null on failure
 */
export async function generateMovementDerivatives(
  videoUrl: string,
  crop: CropTransform,
  onProgress?: (progress: number) => void,
): Promise<DerivativeBlobs | null> {
  if (Platform.OS !== 'web') return null;

  const canEncodeGif = !!GIFConstructor;
  if (!canEncodeGif) {
    console.warn('[Derivatives] GIF encoder not available — will generate first-frame JPEG only');
  }

  try {
    // ── Load video ─────────────────────────────────────────────────────
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = videoUrl;

    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () =>
        reject(new Error('Failed to load video: ' + (video.error?.message || 'unknown')));
      setTimeout(() => reject(new Error('Video load timeout')), 15000);
    });

    await new Promise<void>((resolve) => {
      if (video.readyState >= 3) { resolve(); return; }
      video.oncanplaythrough = () => resolve();
      video.load();
      setTimeout(resolve, 5000);
    });

    // ── Setup canvases ─────────────────────────────────────────────────
    const hiCanvas = document.createElement('canvas');
    hiCanvas.width = HI_WIDTH;
    hiCanvas.height = HI_HEIGHT;
    const hiCtx = hiCanvas.getContext('2d');

    const loCanvas = document.createElement('canvas');
    loCanvas.width = LO_WIDTH;
    loCanvas.height = LO_HEIGHT;
    const loCtx = loCanvas.getContext('2d');

    if (!hiCtx || !loCtx) throw new Error('Canvas context unavailable');

    // ── CORS test ──────────────────────────────────────────────────────
    video.currentTime = 0;
    await new Promise<void>((r) => {
      video.onseeked = () => r();
      setTimeout(r, 2000);
    });
    try {
      hiCtx.drawImage(video, 0, 0, HI_WIDTH, HI_HEIGHT);
      hiCtx.getImageData(HI_WIDTH / 2, HI_HEIGHT / 2, 1, 1);
    } catch {
      console.error('[Derivatives] Canvas tainted by CORS — video URL:', videoUrl.slice(0, 120));
      video.src = '';
      video.remove();
      return null;
    }

    // ── Generate first-frame JPEG first (always) ──────────────────────
    drawCroppedFrame(hiCtx, video, HI_WIDTH, HI_HEIGHT, crop);

    let firstFrameBlob: Blob | null = null;
    try {
      firstFrameBlob = await new Promise<Blob>((resolve, reject) => {
        hiCanvas.toBlob(
          (blob) => (blob ? resolve(blob) : reject(new Error('First frame JPEG failed'))),
          'image/jpeg',
          0.85,
        );
      });
    } catch (err) {
      console.warn('[Derivatives] First-frame JPEG failed:', err);
    }

    onProgress?.(0.1);

    // If GIF encoder isn't available, return with just the first frame
    if (!canEncodeGif) {
      video.src = '';
      video.remove();
      onProgress?.(1);
      return {
        gifHigh: null,
        gifLow: null,
        firstFrame: firstFrameBlob,
        _hiFrames: [],
        _loFrames: [],
      };
    }

    // ── Capture frames ─────────────────────────────────────────────────
    const videoDuration = Math.min(video.duration, MAX_DURATION_SEC);

    // High-res frames at HI_FPS
    const hiTotalFrames = Math.ceil(videoDuration * HI_FPS);
    const hiInterval = 1 / HI_FPS;
    const hiFrames: ImageData[] = [];

    // Low-res frames at LO_FPS (subset of time points)
    const loTotalFrames = Math.ceil(videoDuration * LO_FPS);
    const loInterval = 1 / LO_FPS;
    const loFrameTimes = new Set<number>();
    for (let i = 0; i < loTotalFrames; i++) {
      loFrameTimes.add(+(i * loInterval).toFixed(4));
    }
    const loFrames: ImageData[] = [];

    // Low-res crop transform (scaled to low-res canvas)
    const loCrop: CropTransform = { ...crop };

    for (let i = 0; i < hiTotalFrames; i++) {
      const time = +(i * hiInterval).toFixed(4);

      // Seek
      video.currentTime = time;
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        setTimeout(resolve, 500);
      });

      // Draw high-res frame
      drawCroppedFrame(hiCtx, video, HI_WIDTH, HI_HEIGHT, crop);
      hiFrames.push(hiCtx.getImageData(0, 0, HI_WIDTH, HI_HEIGHT));

      // Check if this time aligns with a low-res frame
      // Find closest lo frame time within half a hi interval
      let isLoFrame = false;
      for (const lt of loFrameTimes) {
        if (Math.abs(time - lt) < hiInterval * 0.6) {
          isLoFrame = true;
          loFrameTimes.delete(lt);
          break;
        }
      }

      if (isLoFrame) {
        drawCroppedFrame(loCtx, video, LO_WIDTH, LO_HEIGHT, loCrop);
        loFrames.push(loCtx.getImageData(0, 0, LO_WIDTH, LO_HEIGHT));
      }

      // Progress: frame capture = 50% of total work
      onProgress?.((0.1 + (i / hiTotalFrames) * 0.45));
    }

    onProgress?.(0.55);

    // ── Encode GIFs (failures are non-fatal) ───────────────────────────
    let gifHighBlob: Blob | null = null;
    let gifLowBlob: Blob | null = null;

    try {
      gifHighBlob = await encodeGif(hiFrames, HI_WIDTH, HI_HEIGHT, HI_FPS, 10, (p) =>
        onProgress?.(0.55 + p * 0.2),
      );
    } catch (err) {
      console.warn('[Derivatives] High-quality GIF encoding failed:', err);
    }
    onProgress?.(0.75);

    try {
      gifLowBlob = await encodeGif(loFrames, LO_WIDTH, LO_HEIGHT, LO_FPS, 20, (p) =>
        onProgress?.(0.75 + p * 0.2),
      );
    } catch (err) {
      console.warn('[Derivatives] Low-quality GIF encoding failed:', err);
    }
    onProgress?.(0.95);

    // Cleanup
    video.src = '';
    video.remove();

    onProgress?.(1);

    return {
      gifHigh: gifHighBlob,
      gifLow: gifLowBlob,
      firstFrame: firstFrameBlob,
      _hiFrames: hiFrames,
      _loFrames: loFrames,
    };
  } catch (error) {
    console.error('[generateMovementDerivatives] Error:', error);
    return null;
  }
}

/**
 * Encode a one-rep loop GIF from a subset of previously captured frames.
 *
 * @param frames    Low-res ImageData frames from the full capture
 * @param startPct  Start of the rep as a percentage of total frames (0–1)
 * @param endPct    End of the rep as a percentage of total frames (0–1)
 * @returns Blob of the one-rep loop GIF, or null on failure
 */
export async function encodeOneRepLoopGif(
  frames: ImageData[],
  startPct: number,
  endPct: number,
): Promise<Blob | null> {
  if (!GIFConstructor || frames.length === 0) return null;

  try {
    const startIdx = Math.round(startPct * (frames.length - 1));
    const endIdx = Math.round(endPct * (frames.length - 1));

    if (endIdx <= startIdx) return null;

    const repFrames = frames.slice(startIdx, endIdx + 1);
    if (repFrames.length < 3) return null;

    return await encodeGif(repFrames, LO_WIDTH, LO_HEIGHT, LO_FPS, 20);
  } catch (error) {
    console.error('[encodeOneRepLoopGif] Error:', error);
    return null;
  }
}
