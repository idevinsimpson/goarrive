/**
 * generateCroppedGif — Client-side GIF generation from a cropped video
 *
 * Takes a video URL and crop transform values, captures frames using
 * HTML5 Canvas with the crop applied, and encodes them into an animated GIF.
 *
 * Uses gif.js.optimized for Web Worker-based encoding.
 *
 * Output: 4:5 aspect ratio GIF, capped at 10 seconds, ~8fps.
 * Typical file size: 200KB–1.5MB depending on video length and content.
 *
 * Web-only — returns null on native platforms.
 */

import { Platform } from 'react-native';

// Static require so Metro bundles it (dynamic import() doesn't resolve at runtime)
// gif.js.optimized is a UMD module — require() returns the constructor directly
// eslint-disable-next-line @typescript-eslint/no-var-requires
let GIFConstructor: any = null;
if (Platform.OS === 'web') {
  try {
    const mod = require('gif.js.optimized');
    // Handle both default export and direct module.exports
    GIFConstructor = mod.default || mod;
  } catch (e) {
    console.warn('[GIF] Failed to load gif.js.optimized:', e);
  }
}

// GIF output dimensions (4:5 aspect ratio)
const GIF_WIDTH = 240;
const GIF_HEIGHT = 300;
const FPS = 8;
const MAX_DURATION_SEC = 10;

interface CropParams {
  cropScale: number;
  cropTranslateX: number;
  cropTranslateY: number;
}

/**
 * Generate an animated GIF from a video with crop transform applied.
 *
 * @param videoUrl - URL of the source video
 * @param crop - Crop transform values (scale, translateX, translateY)
 * @param onProgress - Optional progress callback (0-1)
 * @returns Blob of the generated GIF, or null if generation fails
 */
export async function generateCroppedGif(
  videoUrl: string,
  crop: CropParams,
  onProgress?: (progress: number) => void,
): Promise<Blob | null> {
  if (Platform.OS !== 'web') return null;

  try {
    if (!GIFConstructor) {
      console.error('[GIF] GIF encoder not available');
      return null;
    }

    // Create a hidden video element to capture frames from
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = videoUrl;

    // Wait for video metadata to load
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => {
        resolve();
      };
      video.onerror = () => {
        console.error('[GIF] Video load error:', video.error?.message);
        reject(new Error('Failed to load video: ' + (video.error?.message || 'unknown')));
      };
      setTimeout(() => reject(new Error('Video load timeout')), 15000);
    });

    // Wait for enough data to seek
    await new Promise<void>((resolve) => {
      if (video.readyState >= 3) {
        resolve();
        return;
      }
      video.oncanplaythrough = () => {
        resolve();
      };
      video.load();
      setTimeout(() => {
        resolve();
      }, 5000);
    });

    const videoDuration = Math.min(video.duration, MAX_DURATION_SEC);
    const totalFrames = Math.ceil(videoDuration * FPS);
    const frameInterval = 1 / FPS;

    // Create canvas for frame capture
    const canvas = document.createElement('canvas');
    canvas.width = GIF_WIDTH;
    canvas.height = GIF_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');

    // Calculate the crop drawing parameters
    const videoW = video.videoWidth;
    const videoH = video.videoHeight;
    const frameAspect = 4 / 5;
    const videoAspect = videoW / videoH;

    // Step 1: Calculate the "cover" fit dimensions on our GIF canvas
    let drawW: number, drawH: number;
    if (videoAspect > frameAspect) {
      // Video wider than 4:5 — match height, overflow width
      drawH = GIF_HEIGHT;
      drawW = drawH * videoAspect;
    } else {
      // Video taller than 4:5 — match width, overflow height
      drawW = GIF_WIDTH;
      drawH = drawW / videoAspect;
    }

    // Step 2: Apply the user's crop transform (scale)
    drawW *= crop.cropScale;
    drawH *= crop.cropScale;

    // Center offset (where the video starts drawing)
    let drawX = (GIF_WIDTH - drawW) / 2;
    let drawY = (GIF_HEIGHT - drawH) / 2;

    // Apply translate — scale proportionally from crop modal frame to GIF canvas
    // The crop modal frame is approximately screenWidth - 48 pixels wide
    const REFERENCE_FRAME_WIDTH = 345;
    const REFERENCE_FRAME_HEIGHT = REFERENCE_FRAME_WIDTH * (5 / 4);
    const scaleRatioX = GIF_WIDTH / REFERENCE_FRAME_WIDTH;
    const scaleRatioY = GIF_HEIGHT / REFERENCE_FRAME_HEIGHT;

    drawX += crop.cropTranslateX * scaleRatioX * crop.cropScale;
    drawY += crop.cropTranslateY * scaleRatioY * crop.cropScale;

    // Test canvas draw before starting GIF encoding
    video.currentTime = 0;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
      setTimeout(resolve, 2000);
    });

    try {
      ctx.drawImage(video, drawX, drawY, drawW, drawH);
      const testPixel = ctx.getImageData(GIF_WIDTH / 2, GIF_HEIGHT / 2, 1, 1);
    } catch (canvasErr: any) {
      console.error('[GIF] Canvas tainted by CORS:', canvasErr.message);
      video.src = '';
      video.remove();
      return null;
    }

    // Create GIF encoder
    const gif = new GIFConstructor({
      workers: 2,
      quality: 10,
      width: GIF_WIDTH,
      height: GIF_HEIGHT,
      workerScript: '/gif.worker.js',
    });

    // Capture frames by seeking through the video
    for (let i = 0; i < totalFrames; i++) {
      const time = i * frameInterval;

      // Seek to the target time
      video.currentTime = time;
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        setTimeout(resolve, 500);
      });

      // Draw the video frame with crop transform applied
      ctx.clearRect(0, 0, GIF_WIDTH, GIF_HEIGHT);
      ctx.drawImage(video, drawX, drawY, drawW, drawH);

      // Add frame to GIF
      gif.addFrame(ctx.getImageData(0, 0, GIF_WIDTH, GIF_HEIGHT), {
        delay: Math.round(1000 / FPS),
        copy: true,
      });

      // Report progress (frame capture is ~70% of total work)
      if (onProgress) {
        onProgress((i / totalFrames) * 0.7);
      }

    }

    // Encode the GIF
    const blob = await new Promise<Blob>((resolve, reject) => {
      gif.on('finished', (b: Blob) => {
        resolve(b);
      });
      gif.on('progress', (p: number) => {
        if (onProgress) {
          onProgress(0.7 + p * 0.3);
        }
      });
      gif.render();

      // Timeout after 60 seconds (increased for longer videos)
      setTimeout(() => reject(new Error('GIF encoding timeout')), 60000);
    });

    // Cleanup
    video.src = '';
    video.remove();

    return blob;
  } catch (error) {
    console.error('[generateCroppedGif] Error:', error);
    return null;
  }
}
