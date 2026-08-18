// Pure canvas draw helpers for the PiP canvas-stream overlay.
// No React, no side effects — all functions take a CanvasRenderingContext2D
// and paint synchronously.
//
// pipCosmetic=1 canvas=540x960 (pass-22 mini-workout-player skin).
// Layout mirrors WorkoutPlayer's BASE 360×640 artboard scaled ×1.5 so the
// PiP tile is a pixel-faithful mini of the player. Slot heights:
//   logo 56 + gap 4 + title 112 + gap 12 + media 380 + gap 12 + next-up 64 = 640
// × TILE_SCALE (1.5) → 540×960.

// ── Cosmetics constants (BASE units × TILE_SCALE = pixels) ─────────────
export const TILE_SCALE = 1.5;
export const TILE_W = Math.round(360 * TILE_SCALE); // 540
export const TILE_H = Math.round(640 * TILE_SCALE); // 960

const BASE_LOGO_H = 56;
const BASE_GAP_LOGO = 4;
const BASE_TITLE_H = 112;
const BASE_GAP_TITLE = 12;
const BASE_MEDIA_H = 380;
const BASE_MEDIA_W = 304;
const BASE_GAP_MEDIA = 12;
const BASE_NEXTUP_H = 64;
const BASE_TIMER_W = 132;
const BASE_LOGO_W = 260;
const BASE_LOGO_IMG_H = 52;

export const fsPx = (n: number): number => Math.round(n * TILE_SCALE);

export interface TileLayout {
  W: number;
  H: number;
  logoX: number;
  logoY: number;
  logoW: number;
  logoH: number;
  logoSlotH: number;
  titleRowX: number;
  titleRowY: number;
  titleRowW: number;
  titleRowH: number;
  titleColX: number;
  titleColW: number;
  titleColPadX: number;
  timerX: number;
  timerY: number;
  timerW: number;
  timerH: number;
  timerRadius: number;
  mediaX: number;
  mediaY: number;
  mediaW: number;
  mediaH: number;
  mediaRadius: number;
  nextUpX: number;
  nextUpY: number;
  nextUpW: number;
  nextUpH: number;
  nextUpRadius: number;
  nextUpPadX: number;
  nextUpPadY: number;
  nextUpThumbSize: number;
  nextUpThumbRadius: number;
  progressY: number;
  progressH: number;
  progressPadX: number;
  progressRadius: number;
  baseMediaW: number; // BASE units — feed into pickNameTier
  baseTitleInnerWithTimer: number; // BASE units
  baseTitleInnerNoTimer: number; // BASE units
}

export function computeTileLayout(): TileLayout {
  const logoSlotH = fsPx(BASE_LOGO_H);
  const gapLogo = fsPx(BASE_GAP_LOGO);
  const titleRowH = fsPx(BASE_TITLE_H);
  const gapTitle = fsPx(BASE_GAP_TITLE);
  const mediaH = fsPx(BASE_MEDIA_H);
  const mediaW = fsPx(BASE_MEDIA_W);
  const gapMedia = fsPx(BASE_GAP_MEDIA);
  const nextUpH = fsPx(BASE_NEXTUP_H);
  const timerW = fsPx(BASE_TIMER_W);
  const timerH = titleRowH;
  const logoImgW = fsPx(BASE_LOGO_W);
  const logoImgH = fsPx(BASE_LOGO_IMG_H);
  const mediaX = Math.round((TILE_W - mediaW) / 2);
  const titleRowX = mediaX;
  const titleRowW = mediaW;
  const titleColPadX = fsPx(8);
  const titleColRightMargin = fsPx(4);
  const titleColX = titleRowX;
  const titleColW = titleRowW - timerW - titleColRightMargin;
  const timerX = titleRowX + titleRowW - timerW;
  // Vertical stack top→bottom
  const logoY = 0;
  const titleRowY = logoY + logoSlotH + gapLogo;
  const mediaY = titleRowY + titleRowH + gapTitle;
  const nextUpY = mediaY + mediaH + gapMedia;
  return {
    W: TILE_W,
    H: TILE_H,
    logoSlotH,
    logoX: Math.round((TILE_W - logoImgW) / 2),
    logoY: Math.round((logoSlotH - logoImgH) / 2),
    logoW: logoImgW,
    logoH: logoImgH,
    titleRowX,
    titleRowY,
    titleRowW,
    titleRowH,
    titleColX,
    titleColW,
    titleColPadX,
    timerX,
    timerY: titleRowY,
    timerW,
    timerH,
    timerRadius: fsPx(12),
    mediaX,
    mediaY,
    mediaW,
    mediaH,
    mediaRadius: fsPx(12),
    nextUpX: mediaX,
    nextUpY,
    nextUpW: mediaW,
    nextUpH,
    nextUpRadius: fsPx(12),
    nextUpPadX: fsPx(12),
    nextUpPadY: fsPx(8),
    nextUpThumbSize: fsPx(40),
    nextUpThumbRadius: fsPx(8),
    progressY: TILE_H - fsPx(3),
    progressH: fsPx(3),
    progressPadX: fsPx(20),
    progressRadius: fsPx(2),
    baseMediaW: BASE_MEDIA_W,
    baseTitleInnerWithTimer: Math.max(0, BASE_MEDIA_W - BASE_TIMER_W - 4 - 16),
    baseTitleInnerNoTimer: Math.max(0, BASE_MEDIA_W - 16),
  };
}

// ── Font-family stack — mirrors lib/theme.ts on web
export const FONT_HEADLINE = "'Space Grotesk', system-ui, -apple-system, sans-serif";
export const FONT_BODY = "'DM Sans', system-ui, -apple-system, sans-serif";

// ── Media video/fallback (rounded-clip mask matches player mediaInner) ─
function withRoundedMediaClip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  paint: () => void,
): void {
  ctx.save();
  ctx.beginPath();
  (ctx as any).roundRect(x, y, w, h, r);
  ctx.clip();
  paint();
  ctx.restore();
}

export function drawVideoFrame(
  ctx: CanvasRenderingContext2D,
  videoEl: HTMLVideoElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
  iconImg: HTMLImageElement | null,
  radius: number = fsPx(12),
): void {
  // Pass-22: rounded-clip the media region so the tile matches the player's
  // mediaInner (radius 12 BASE). Pass-16 semantics unchanged — a paused
  // rs>=2 element still paints its decoded frame. Pass-22b: fallback is
  // the icon placeholder (never a name-text gradient) to match the player.
  if (videoEl && videoEl.readyState >= 2) {
    const srcW = videoEl.videoWidth || videoEl.clientWidth || w;
    const srcH = videoEl.videoHeight || videoEl.clientHeight || h;
    const srcAspect = srcW / srcH;
    const dstAspect = w / h;
    let sx = 0;
    let sy = 0;
    let sw = srcW;
    let sh = srcH;
    if (srcAspect > dstAspect) {
      sw = srcH * dstAspect;
      sx = (srcW - sw) / 2;
    } else {
      sh = srcW / dstAspect;
      sy = (srcH - sh) / 2;
    }
    try {
      withRoundedMediaClip(ctx, x, y, w, h, radius, () => {
        ctx.fillStyle = '#000000';
        ctx.fillRect(x, y, w, h);
        ctx.drawImage(videoEl as CanvasImageSource, sx, sy, sw, sh, x, y, w, h);
      });
    } catch {
      drawPlaceholderIcon(ctx, iconImg, x, y, w, h, radius);
    }
  } else {
    drawPlaceholderIcon(ctx, iconImg, x, y, w, h, radius);
  }
}

// Pass-22b: match WorkoutPlayer's st.placeholderLogo/placeholderLogoFrame —
// a flat #0E1117 media frame with goarrive-icon.png cover-fit at 100%×100%.
// The movement name lives in the title band, never mid-media.
export function drawPlaceholderIcon(
  ctx: CanvasRenderingContext2D,
  iconImg: HTMLImageElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number = fsPx(12),
): void {
  withRoundedMediaClip(ctx, x, y, w, h, radius, () => {
    ctx.fillStyle = '#0E1117';
    ctx.fillRect(x, y, w, h);
    if (!iconImg || !iconImg.complete || iconImg.naturalWidth <= 0) return;
    try {
      const iAsp = iconImg.naturalWidth / iconImg.naturalHeight;
      const dAsp = w / h;
      let sx = 0; let sy = 0; let sw = iconImg.naturalWidth; let sh = iconImg.naturalHeight;
      if (iAsp > dAsp) {
        sw = iconImg.naturalHeight * dAsp;
        sx = (iconImg.naturalWidth - sw) / 2;
      } else {
        sh = iconImg.naturalWidth / dAsp;
        sy = (iconImg.naturalHeight - sh) / 2;
      }
      ctx.drawImage(iconImg, sx, sy, sw, sh, x, y, w, h);
    } catch {}
  });
}

// ── Timer BOX (chrome layer) — colored rounded rect, no digit ──────────
export function drawTimerBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  isRest: boolean,
): void {
  ctx.save();
  ctx.fillStyle = isRest ? '#1A2035' : '#F5A623';
  ctx.beginPath();
  (ctx as any).roundRect(x, y, w, h, fsPx(12));
  ctx.fill();
  ctx.restore();
}

// Per-frame timer digit (paints over the pre-drawn box).
export function drawTimerDigit(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  isRest: boolean,
  fontsLoaded: 'full' | 'partial' | 'none',
): void {
  const len = (text || '').length;
  const baseSize = len <= 2 ? 96 : len === 3 ? 64 : 48;
  const size = fsPx(baseSize);
  const letterSpacing = len <= 2 ? fsPx(-2) : len === 3 ? fsPx(-1) : 0;
  const weight = fontsLoaded === 'full' ? '800' : '700';
  ctx.save();
  ctx.fillStyle = isRest ? '#FFFFFF' : '#0E1117';
  ctx.font = `${weight} ${size}px ${FONT_HEADLINE}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (letterSpacing !== 0 && 'letterSpacing' in ctx) {
    try { (ctx as any).letterSpacing = `${letterSpacing}px`; } catch {}
  }
  ctx.fillText(text, x + w / 2, y + h / 2);
  if ('letterSpacing' in ctx) {
    try { (ctx as any).letterSpacing = '0px'; } catch {}
  }
  ctx.restore();
}

// ── Title text — wraps via ctx.measureText, ≤maxLines, centered ────────
export function drawWrappedTitle(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  h: number,
  fontSizePx: number,
  lineHeightPx: number,
  maxLines: number,
  color: string,
  fontsLoaded: 'full' | 'partial' | 'none',
): void {
  if (!text) return;
  const weight = fontsLoaded === 'full' ? '800' : '700';
  ctx.save();
  ctx.fillStyle = color;
  ctx.font = `${weight} ${fontSizePx}px ${FONT_HEADLINE}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (ctx.measureText(candidate).width > w && cur) {
      lines.push(cur);
      cur = word;
      if (lines.length >= maxLines) break;
    } else {
      cur = candidate;
    }
  }
  if (cur && lines.length < maxLines) lines.push(cur);
  // Ellipsize if we chopped extra words
  if (words.join(' ') !== lines.join(' ') && lines.length > 0) {
    const last = lines[lines.length - 1];
    let trimmed = last;
    while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > w) {
      trimmed = trimmed.slice(0, -1);
    }
    lines[lines.length - 1] = `${trimmed}…`;
  }
  const total = lines.length * lineHeightPx;
  const startY = y + (h - total) / 2 + lineHeightPx / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], x + w / 2, startY + i * lineHeightPx);
  }
  ctx.restore();
}

// ── Rest phase label — small tracking above title ─────────────────────
export function drawRestLabel(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  w: number,
  fontsLoaded: 'full' | 'partial' | 'none',
): void {
  const weight = fontsLoaded === 'full' ? '700' : '600';
  ctx.save();
  ctx.fillStyle = '#8A95A3';
  ctx.font = `${weight} ${fsPx(18)}px ${FONT_HEADLINE}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  if ('letterSpacing' in ctx) {
    try { (ctx as any).letterSpacing = `${fsPx(2)}px`; } catch {}
  }
  ctx.fillText(text, x + w / 2, y);
  if ('letterSpacing' in ctx) {
    try { (ctx as any).letterSpacing = '0px'; } catch {}
  }
  ctx.restore();
}

// ── Next-up card frame + text + thumb ─────────────────────────────────
export function drawNextUpCard(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  padX: number,
  padY: number,
  thumbSize: number,
  thumbRadius: number,
  nextName: string,
  nextMeta: string,
  thumbImg: HTMLImageElement | null,
  fontsLoaded: 'full' | 'partial' | 'none',
): void {
  ctx.save();
  // Card bg
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.beginPath();
  (ctx as any).roundRect(x, y, w, h, radius);
  ctx.fill();
  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  (ctx as any).roundRect(x + 0.5, y + 0.5, w - 1, h - 1, radius);
  ctx.stroke();

  const thumbX = x + w - padX - thumbSize;
  const thumbY = y + (h - thumbSize) / 2;
  // Thumb clip + draw or slate fallback
  ctx.save();
  ctx.beginPath();
  (ctx as any).roundRect(thumbX, thumbY, thumbSize, thumbSize, thumbRadius);
  ctx.clip();
  if (thumbImg && thumbImg.complete && thumbImg.naturalWidth > 0) {
    try {
      const iAsp = thumbImg.naturalWidth / thumbImg.naturalHeight;
      let sx = 0; let sy = 0; let sw = thumbImg.naturalWidth; let sh = thumbImg.naturalHeight;
      if (iAsp > 1) { sw = thumbImg.naturalHeight; sx = (thumbImg.naturalWidth - sw) / 2; }
      else { sh = thumbImg.naturalWidth; sy = (thumbImg.naturalHeight - sh) / 2; }
      ctx.drawImage(thumbImg, sx, sy, sw, sh, thumbX, thumbY, thumbSize, thumbSize);
    } catch {
      ctx.fillStyle = '#1A2035';
      ctx.fillRect(thumbX, thumbY, thumbSize, thumbSize);
    }
  } else {
    ctx.fillStyle = '#1A2035';
    ctx.fillRect(thumbX, thumbY, thumbSize, thumbSize);
  }
  ctx.restore();

  // Text block: "NEXT UP" label + name + meta stacked left
  const textX = x + padX;
  const textW = thumbX - fsPx(12) - textX;
  const labelSize = fsPx(11);
  const nameSize = fsPx(15);
  const metaSize = fsPx(11);
  const labelWeight = fontsLoaded === 'full' ? '700' : '600';
  const nameWeight = fontsLoaded === 'full' ? '600' : '500';
  // Vertical stack: label (top), name (middle), meta (bottom)
  let cy = y + padY;
  // Label
  ctx.fillStyle = '#8A95A3';
  ctx.font = `${labelWeight} ${labelSize}px ${FONT_HEADLINE}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  if ('letterSpacing' in ctx) {
    try { (ctx as any).letterSpacing = `${fsPx(1)}px`; } catch {}
  }
  ctx.fillText('NEXT UP', textX, cy);
  if ('letterSpacing' in ctx) {
    try { (ctx as any).letterSpacing = '0px'; } catch {}
  }
  cy += labelSize + fsPx(3);
  // Name (single line, ellipsize)
  ctx.fillStyle = '#F0F4F8';
  ctx.font = `${nameWeight} ${nameSize}px ${FONT_HEADLINE}`;
  const nameStr = ellipsize(ctx, nextName, textW);
  ctx.fillText(nameStr, textX, cy);
  cy += nameSize + fsPx(2);
  // Meta (single line, ellipsize) — DM Sans
  ctx.fillStyle = '#8A95A3';
  ctx.font = `500 ${metaSize}px ${FONT_BODY}`;
  const metaStr = ellipsize(ctx, nextMeta, textW);
  ctx.fillText(metaStr, textX, cy);
  ctx.restore();
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (!text) return '';
  if (ctx.measureText(text).width <= maxW) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxW) {
    cut = cut.slice(0, -1);
  }
  return `${cut}…`;
}

// ── Progress bar — track (chrome) + fill (per-frame) ──────────────────
export function drawProgressTrack(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  ctx.save();
  ctx.fillStyle = '#1A1E26';
  ctx.beginPath();
  (ctx as any).roundRect(x, y, w, h, radius);
  ctx.fill();
  ctx.restore();
}

export function drawProgressFill(
  ctx: CanvasRenderingContext2D,
  pct: number,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): void {
  const clamped = Math.max(0, Math.min(1, pct));
  if (clamped <= 0) return;
  ctx.save();
  ctx.fillStyle = '#F5A623';
  ctx.beginPath();
  (ctx as any).roundRect(x, y, Math.max(1, w * clamped), h, radius);
  ctx.fill();
  ctx.restore();
}

// ── Logo — contain-fit an <img> into the logo slot rect ───────────────
export function drawLogoContain(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | null,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  if (!img || !img.complete || img.naturalWidth <= 0) return;
  try {
    const iAsp = img.naturalWidth / img.naturalHeight;
    const bAsp = w / h;
    let dW = w;
    let dH = h;
    if (iAsp > bAsp) { dH = w / iAsp; } else { dW = h * iAsp; }
    const dX = x + (w - dW) / 2;
    const dY = y + (h - dH) / 2;
    ctx.drawImage(img, dX, dY, dW, dH);
  } catch {}
}
