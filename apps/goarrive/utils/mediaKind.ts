/**
 * mediaKind — shared helpers for telling still images apart from videos.
 *
 * Movements and workout intro/outro store their primary media URL in the
 * existing `videoUrl` fields (kept for backwards compatibility). New docs
 * also write a `mediaType: 'image' | 'video'` field; for legacy docs and
 * flattened player items the kind is inferred from the URL extension
 * (Firebase Storage download URLs keep the encoded file path, so the
 * extension survives).
 */

import { Platform } from 'react-native';

const IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|heic|heif|avif|bmp)$/i;

/** True when the URL points at a still (or animated GIF) image file. */
export function isImageUrl(url?: string | null): boolean {
  if (!url) return false;
  try {
    const path = decodeURIComponent(url.split('?')[0].split('#')[0]);
    return IMAGE_EXT_RE.test(path);
  } catch {
    return false;
  }
}

/** Resolve media kind from an explicit mediaType field, falling back to URL inference. */
export function getMediaKind(
  mediaType?: string | null,
  url?: string | null,
): 'image' | 'video' {
  if (mediaType === 'image') return 'image';
  if (mediaType === 'video') return 'video';
  return isImageUrl(url) ? 'image' : 'video';
}

/** Map an image mime type to a storage file extension. */
export function imageExtFromMime(mime?: string | null): string {
  switch (mime) {
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'image/gif': return 'gif';
    case 'image/heic': return 'heic';
    case 'image/heif': return 'heif';
    case 'image/avif': return 'avif';
    default: return 'jpg';
  }
}

/**
 * Cover-crop an image into a 240×300 JPEG thumbnail (same dimensions the
 * video derivative pipeline produces). Web-only — returns null on native
 * or on any failure, in which case callers should fall back to using the
 * original image URL as the thumbnail.
 */
export async function generateImageThumbnailBlob(imageUrl: string): Promise<Blob | null> {
  if (Platform.OS !== 'web') return null;
  const W = 240;
  const H = 300;
  try {
    const img = document.createElement('img');
    img.crossOrigin = 'anonymous';
    img.src = imageUrl;
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Image load failed'));
      setTimeout(() => reject(new Error('Image load timeout')), 15000);
    });

    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    const imgAspect = img.naturalWidth / img.naturalHeight;
    const frameAspect = W / H;
    let drawW: number;
    let drawH: number;
    if (imgAspect > frameAspect) {
      drawH = H;
      drawW = H * imgAspect;
    } else {
      drawW = W;
      drawH = W / imgAspect;
    }
    ctx.drawImage(img, (W - drawW) / 2, (H - drawH) / 2, drawW, drawH);

    return await new Promise<Blob | null>((resolve) => {
      canvas.toBlob((blob) => resolve(blob), 'image/jpeg', 0.8);
    });
  } catch (err) {
    console.warn('[mediaKind] Image thumbnail generation failed:', err);
    return null;
  }
}
