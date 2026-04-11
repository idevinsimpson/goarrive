/**
 * generateContactSheet — Extract evenly spaced frames from a cropped video
 * and composite them into a single JPEG contact sheet for AI analysis.
 *
 * Default: 12 frames in a 4×3 grid (one frame every ~0.83s of a 10s clip).
 * Dense mode: 24 frames in a 6×4 grid (fallback for low-confidence analysis).
 *
 * Each cell is 240×300 (4:5 ratio matching the crop frame).
 * Output: base64 data URL (JPEG, 0.85 quality).
 *
 * Web-only — returns null on native platforms.
 */

import { Platform } from 'react-native';

// Cell dimensions match existing GIF output (4:5 ratio)
const CELL_WIDTH = 240;
const CELL_HEIGHT = 300;
const MAX_DURATION_SEC = 10;

interface CropParams {
  cropScale: number;
  cropTranslateX: number;
  cropTranslateY: number;
}

interface ContactSheetOptions {
  /** Number of frames to extract (default 12) */
  frameCount?: number;
  /** Grid columns (default 4) */
  columns?: number;
  /** JPEG quality 0-1 (default 0.85) */
  quality?: number;
}

/**
 * Generate a contact sheet from a cropped video.
 *
 * @param videoUrl - URL of the source video
 * @param crop - Crop transform values from VideoCropModal
 * @param options - Grid layout and quality options
 * @returns base64 data URL of the JPEG contact sheet, or null on failure
 */
export async function generateContactSheet(
  videoUrl: string,
  crop: CropParams,
  options: ContactSheetOptions = {},
): Promise<string | null> {
  if (Platform.OS !== 'web') return null;

  const frameCount = options.frameCount ?? 12;
  const columns = options.columns ?? 4;
  const quality = options.quality ?? 0.85;
  const rows = Math.ceil(frameCount / columns);

  try {
    // Create hidden video element
    const video = document.createElement('video');
    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = videoUrl;

    // Wait for metadata
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () =>
        reject(new Error('Failed to load video: ' + (video.error?.message || 'unknown')));
      setTimeout(() => reject(new Error('Video load timeout')), 15000);
    });

    // Wait for enough data to seek
    await new Promise<void>((resolve) => {
      if (video.readyState >= 3) {
        resolve();
        return;
      }
      video.oncanplaythrough = () => resolve();
      video.load();
      setTimeout(resolve, 5000);
    });

    const videoDuration = Math.min(video.duration, MAX_DURATION_SEC);

    // Calculate crop drawing parameters (same logic as generateCroppedGif)
    const videoW = video.videoWidth;
    const videoH = video.videoHeight;
    const frameAspect = 4 / 5;
    const videoAspect = videoW / videoH;

    let drawW: number, drawH: number;
    if (videoAspect > frameAspect) {
      drawH = CELL_HEIGHT;
      drawW = drawH * videoAspect;
    } else {
      drawW = CELL_WIDTH;
      drawH = drawW / videoAspect;
    }

    drawW *= crop.cropScale;
    drawH *= crop.cropScale;

    let drawX = (CELL_WIDTH - drawW) / 2;
    let drawY = (CELL_HEIGHT - drawH) / 2;

    const REFERENCE_FRAME_WIDTH = 345;
    const REFERENCE_FRAME_HEIGHT = REFERENCE_FRAME_WIDTH * (5 / 4);
    const scaleRatioX = CELL_WIDTH / REFERENCE_FRAME_WIDTH;
    const scaleRatioY = CELL_HEIGHT / REFERENCE_FRAME_HEIGHT;

    drawX += crop.cropTranslateX * scaleRatioX * crop.cropScale;
    drawY += crop.cropTranslateY * scaleRatioY * crop.cropScale;

    // Create the composite canvas
    const sheetWidth = columns * CELL_WIDTH;
    const sheetHeight = rows * CELL_HEIGHT;
    const canvas = document.createElement('canvas');
    canvas.width = sheetWidth;
    canvas.height = sheetHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context unavailable');

    // Fill background (black) so empty cells aren't transparent
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, sheetWidth, sheetHeight);

    // Extract frames at evenly spaced intervals
    for (let i = 0; i < frameCount; i++) {
      const time = (i / (frameCount - 1)) * videoDuration;

      video.currentTime = time;
      await new Promise<void>((resolve) => {
        const onSeeked = () => {
          video.removeEventListener('seeked', onSeeked);
          resolve();
        };
        video.addEventListener('seeked', onSeeked);
        setTimeout(resolve, 500);
      });

      // Calculate grid position
      const col = i % columns;
      const row = Math.floor(i / columns);
      const offsetX = col * CELL_WIDTH;
      const offsetY = row * CELL_HEIGHT;

      // Draw the cropped frame into its grid cell
      ctx.save();
      ctx.beginPath();
      ctx.rect(offsetX, offsetY, CELL_WIDTH, CELL_HEIGHT);
      ctx.clip();
      ctx.drawImage(video, offsetX + drawX, offsetY + drawY, drawW, drawH);
      ctx.restore();
    }

    // Export as JPEG base64
    const dataUrl = canvas.toDataURL('image/jpeg', quality);

    // Cleanup
    video.src = '';
    video.remove();

    return dataUrl;
  } catch (error) {
    console.error('[generateContactSheet] Error:', error);
    return null;
  }
}

/**
 * Generate a dense contact sheet (24 frames, 6×4 grid) for fallback analysis.
 */
export async function generateDenseContactSheet(
  videoUrl: string,
  crop: CropParams,
): Promise<string | null> {
  return generateContactSheet(videoUrl, crop, {
    frameCount: 24,
    columns: 6,
    quality: 0.85,
  });
}
