/**
 * Tests for computePlayerCanvas — the 9:16 artboard scale math.
 *
 * Regression focus (2026-07-21): the naive min(w/360, h/640) fit pillarboxed
 * portrait phones whenever the viewport was shorter than 16:9 — Safari with
 * toolbars rendered the player at 92% width, in-app webviews at 74%. Rule:
 * in portrait, width always wins; short viewports shrink the media slot
 * (cover-crop) instead of shrinking the whole canvas.
 */

import { describe, it, expect } from 'vitest';
import {
  computePlayerCanvas,
  CANVAS_BASE_W,
  CANVAS_BASE_H,
  CANVAS_BASE_CHROME_H,
  CANVAS_BASE_MEDIA_H,
  CANVAS_BASE_MEDIA_MIN_H,
  CANVAS_MAX_FRAME_W,
  CANVAS_MAX_SCALE,
} from '../WorkoutPlayer.helpers';

// Web platform safe-area constants used by WorkoutPlayer.
const SAFE_TOP = 0;
const SAFE_BOTTOM = 24;

const canvas = (w: number, h: number) => computePlayerCanvas(w, h, SAFE_TOP, SAFE_BOTTOM);

describe('computePlayerCanvas — portrait keeps full width (below cap)', () => {
  const portraitViewports: Array<[string, number, number]> = [
    ['iPhone bare / PWA fullscreen', 390, 844],
    ['iPhone Safari with toolbars', 390, 664],
    ['iPhone in-app webview (Slack)', 390, 540],
    ['iPhone Pro Max Safari', 430, 700],
    ['small Android', 360, 640],
    ['small Android with chrome', 360, 560],
  ];

  it.each(portraitViewports)('%s (%ix%i): frame is full width', (_name, w, h) => {
    const c = canvas(w, h);
    expect(c.frameW).toBeCloseTo(w, 5);
    expect(c.scale).toBeCloseTo(w / CANVAS_BASE_W, 5);
  });

  it.each(portraitViewports)('%s (%ix%i): frame fits available height', (_name, w, h) => {
    const c = canvas(w, h);
    expect(c.frameH).toBeLessThanOrEqual(h - SAFE_TOP - SAFE_BOTTOM + 1e-6);
  });

  it.each(portraitViewports)('%s (%ix%i): media slot exactly fills leftover height', (_name, w, h) => {
    const c = canvas(w, h);
    // chrome + media (BASE units) scaled must equal frameH (media never
    // overflows the canvas, and never leaves a gap unless at full 380).
    const usedH = (CANVAS_BASE_CHROME_H + c.baseMediaH) * c.scale;
    expect(usedH).toBeLessThanOrEqual(c.frameH + 1e-6);
    if (c.baseMediaH < CANVAS_BASE_MEDIA_H) {
      expect(usedH).toBeCloseTo(c.frameH, 5);
    }
  });

  it('tall viewport keeps full design media slot (no crop)', () => {
    const c = canvas(390, 844);
    expect(c.baseMediaH).toBe(CANVAS_BASE_MEDIA_H);
    expect(c.frameH).toBeCloseTo(CANVAS_BASE_H * c.scale, 5);
  });

  it('short viewport crops media instead of shrinking width', () => {
    const c = canvas(390, 540); // the reported 74%-width regression case
    expect(c.frameW).toBeCloseTo(390, 5);
    expect(c.baseMediaH).toBeLessThan(CANVAS_BASE_MEDIA_H);
    expect(c.baseMediaH).toBeGreaterThanOrEqual(CANVAS_BASE_MEDIA_MIN_H);
  });

  it('degenerate tiny height falls back to uniform fit (no layout explosion)', () => {
    const c = canvas(390, 300);
    expect(c.frameW).toBeLessThanOrEqual(390);
    expect(c.frameH).toBeLessThanOrEqual(300 - SAFE_BOTTOM + 1e-6);
    expect(c.baseMediaH).toBeGreaterThanOrEqual(CANVAS_BASE_MEDIA_MIN_H);
  });
});

describe('computePlayerCanvas — landscape keeps designed 9:16 pillarbox', () => {
  it('desktop landscape centers a 9:16 canvas capped by max scale', () => {
    const c = canvas(1440, 900);
    const availH = 900 - SAFE_TOP - SAFE_BOTTOM;
    // Scale is min(widthScale-capped, heightScale). widthScale-capped =
    // CANVAS_MAX_SCALE (~1.333); heightScale = availH/640 (~1.369). Cap wins.
    expect(c.scale).toBeCloseTo(CANVAS_MAX_SCALE, 5);
    expect(c.frameW).toBeCloseTo(CANVAS_MAX_FRAME_W, 5);
    expect(c.frameH).toBeCloseTo(CANVAS_BASE_H * CANVAS_MAX_SCALE, 5);
    expect(c.frameH).toBeLessThanOrEqual(availH + 1e-6);
    expect(c.baseMediaH).toBe(CANVAS_BASE_MEDIA_H);
  });

  it('phone landscape never overflows the viewport', () => {
    const c = canvas(844, 390);
    expect(c.frameW).toBeLessThanOrEqual(844);
    expect(c.frameH).toBeLessThanOrEqual(390 - SAFE_BOTTOM + 1e-6);
  });
});

// Regression coverage 2026-08-06 (iPad): without the cap, iPad portrait
// (810px) grew the artboard to scale 2.25 — the countdown badge ballooned
// to 297×252 and overlapped GRAB EQUIPMENT. Cap must hold on every tablet
// and desktop viewport.
describe('computePlayerCanvas — frame width capped on tablet & desktop', () => {
  const wideViewports: Array<[string, number, number]> = [
    ['iPad Air portrait', 820, 1180],
    ['iPad mini portrait', 744, 1133],
    ['iPad Pro 11 portrait', 834, 1194],
    ['iPad Pro 12.9 portrait', 1024, 1366],
    ['iPad Air landscape', 1180, 820],
    ['iPad Pro 12.9 landscape', 1366, 1024],
    ['desktop 1440', 1440, 900],
    ['desktop 1920', 1920, 1080],
    ['ultrawide 2560', 2560, 1440],
    ['generic tablet portrait', 768, 1024],
  ];

  it.each(wideViewports)('%s (%ix%i): frame width capped at max', (_name, w, h) => {
    const c = canvas(w, h);
    expect(c.frameW).toBeLessThanOrEqual(CANVAS_MAX_FRAME_W + 1e-6);
    expect(c.scale).toBeLessThanOrEqual(CANVAS_MAX_SCALE + 1e-6);
  });

  it.each(wideViewports)('%s (%ix%i): frame fits available height', (_name, w, h) => {
    const c = canvas(w, h);
    expect(c.frameH).toBeLessThanOrEqual(h - SAFE_TOP - SAFE_BOTTOM + 1e-6);
  });

  it('iPad portrait uses the cap (no longer full width)', () => {
    const c = canvas(820, 1180);
    expect(c.frameW).toBeCloseTo(CANVAS_MAX_FRAME_W, 5);
    expect(c.scale).toBeCloseTo(CANVAS_MAX_SCALE, 5);
    // Countdown badge is fs(132); at capped scale it stays ≤ 176px wide
    // instead of ballooning to 297px (the pre-cap iPad regression).
    expect(132 * c.scale).toBeLessThanOrEqual(176 + 1e-6);
  });

  it('iPad landscape stays inside the cap (no phone-narrow blowup either)', () => {
    const c = canvas(1180, 820);
    expect(c.frameW).toBeLessThanOrEqual(CANVAS_MAX_FRAME_W + 1e-6);
    // Countdown digit fs(96) capped so it can't overflow the title row.
    expect(96 * c.scale).toBeLessThanOrEqual(96 * CANVAS_MAX_SCALE + 1e-6);
  });
});

describe('computePlayerCanvas — invariants', () => {
  it('scale is always positive and media never below the floor', () => {
    for (const [w, h] of [[390, 844], [390, 540], [320, 480], [1, 1], [2560, 1440]]) {
      const c = computePlayerCanvas(w, h, SAFE_TOP, SAFE_BOTTOM);
      expect(c.scale).toBeGreaterThan(0);
      expect(c.baseMediaH).toBeGreaterThanOrEqual(CANVAS_BASE_MEDIA_MIN_H);
      expect(c.baseMediaH).toBeLessThanOrEqual(CANVAS_BASE_MEDIA_H);
    }
  });
});
