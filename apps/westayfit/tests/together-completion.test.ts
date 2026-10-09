import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  TOGETHER_PAYOFF_CLOSER,
  TOGETHER_PAYOFF_CROSSED,
  togetherPresentation,
  type ContributeReceipt,
} from '../src/contributionFlow';
import { heightFractionForFill, LIVING_WE_ASPECT, livingWeCalibration } from '../src/ui/livingWeCalibration';
import {
  buildPieces,
  easeOutCubic,
  fillRatioAt,
  pieceCount,
  pulseKeyframes,
  TOGETHER_COLORS,
  TOGETHER_TIMING,
} from '../src/ui/togetherMotion';

/** A confirmed receipt with every shared field the server returns. */
function receipt(over: Partial<ContributeReceipt> = {}): ContributeReceipt {
  return {
    addedCount: 20,
    ownCredit: 20,
    alreadyRecorded: false,
    sharedTotal: 3720,
    target: 5000,
    unit: 'squats',
    status: 'active',
    ...over,
  };
}

const fresh = { communityName: 'Fixture Community', fresh: true, sharedBefore: 3700, beforeTarget: 5000 };

describe('Together timeline: the donor’s numbers, exactly', () => {
  it('keeps the selected timing', () => {
    expect(TOGETHER_TIMING.fillStartMs).toBe(1450);
    expect(TOGETHER_TIMING.fillDurationMs).toBe(700);
    expect(TOGETHER_TIMING.waveDelaysMs).toEqual([1460, 1640]);
    expect(TOGETHER_TIMING.crossingWaveDelayMs).toBe(1810);
    expect(TOGETHER_TIMING.canvasEndMs).toBe(2900);
    expect(TOGETHER_TIMING.settleMs).toBe(3400);
  });

  it('keeps the selected receipt palette', () => {
    expect(TOGETHER_COLORS).toEqual({
      background: '#091B30',
      unfilled: '#314C65',
      fill: '#91CB7D',
      text: '#F6F9FD',
      muted: '#ADC0D7',
    });
  });

  it('gathers to 94% and rebounds once to 110%, or 113% on a crossing', () => {
    const scale = (k: Keyframe) => String(k.transform);
    expect(pulseKeyframes(false).map(scale)).toContain('scale(0.94)');
    expect(pulseKeyframes(false).map(scale)).toContain('scale(1.1)');
    expect(pulseKeyframes(false).map(scale)).not.toContain('scale(1.13)');
    expect(pulseKeyframes(true).map(scale)).toContain('scale(1.13)');
    expect(pulseKeyframes(true).at(-1)).toEqual({ transform: 'scale(1)', offset: 1 });
  });

  it('draws 24 decorative pieces, or 28 on a crossing — light, never a count of people', () => {
    expect(pieceCount(false)).toBe(24);
    expect(pieceCount(true)).toBe(28);
    const pieces = buildPieces({ crossed: true, width: 390, height: 420, centerX: 195, centerY: 220, markWidth: 300, markHeight: 146 });
    expect(pieces).toHaveLength(28);
    // Every piece ends ON the measured mark.
    for (const piece of pieces) {
      expect(Math.abs(piece.points[3].x - 195)).toBeLessThanOrEqual(300 * 0.22 + 1e-9);
      expect(Math.abs(piece.points[3].y - 220)).toBeLessThanOrEqual(146 * 0.16 + 1e-9);
    }
  });

  it('eases the confirmed ratio with 1 − (1 − p)³ over 700 ms from 1,450 ms, and never overshoots', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeCloseTo(0.875, 10);
    expect(fillRatioAt(0, 0.74, 0.744)).toBe(0.74);
    expect(fillRatioAt(1449, 0.74, 0.744)).toBe(0.74);
    expect(fillRatioAt(1450 + 350, 0.74, 0.744)).toBeCloseTo(0.74 + 0.004 * 0.875, 12);
    expect(fillRatioAt(2150, 0.74, 0.744)).toBe(0.744);
    expect(fillRatioAt(9999, 0.74, 0.744)).toBe(0.744);
    // Monotonic between two confirmed totals: progress never moves backward.
    let last = -1;
    for (let ms = 0; ms <= 2500; ms += 10) {
      const r = fillRatioAt(ms, 0.2, 0.9);
      expect(r).toBeGreaterThanOrEqual(last);
      last = r;
    }
  });
});

describe('the canonical mark keeps its own calibration', () => {
  it('is the locked 1200×583 owner-derived pair, mapped by its own area table', () => {
    expect(livingWeCalibration.width).toBe(1200);
    expect(livingWeCalibration.height).toBe(583);
    expect(LIVING_WE_ASPECT).toBeCloseTo(1200 / 583, 12);
    // Every intermediate tween ratio goes through THIS table: monotonic, 0 → 1.
    let last = -1;
    for (let i = 0; i <= 1000; i += 1) {
      const h = heightFractionForFill(i / 1000);
      expect(h).toBeGreaterThanOrEqual(last);
      last = h;
    }
    expect(heightFractionForFill(0)).toBe(0);
    expect(heightFractionForFill(1)).toBe(1);
  });

  it('never carries the donor’s 1282×609 CDF', () => {
    const src = readFileSync(nodePath.resolve(__dirname, '../src/ui/togetherMotion.ts'), 'utf8');
    // No donor table or donor mapping function in code (its size is named in a comment only).
    expect(src).not.toMatch(/WE_AREA|calibratedFillInset/);
    expect(src).not.toMatch(/\[(\s*[0-9.e-]+,){50}/);
  });
});

describe('Together presentation: receipt truth and fresh presentation are separate', () => {
  it('ordinary fresh contribution: animates from the reliable before; “You moved us closer.” on two lines', () => {
    const p = togetherPresentation(receipt(), fresh);
    expect(p.variant).toBe('ordinary');
    expect(p.payoff).toBe(TOGETHER_PAYOFF_CLOSER);
    expect(p.payoffLines).toEqual(['You moved', 'us closer.']);
    expect(p.headline).toBe('You added 20 squats.');
    expect(p.animate).toBe(true);
    expect(p.before).toBe(3700);
    expect(p.fromRatio).toBeCloseTo(0.74, 12);
    expect(p.toRatio).toBeCloseTo(0.744, 12);
    expect(p.crossed).toBe(false);
  });

  it('a small contribution is its true small change, never a reset from zero', () => {
    const p = togetherPresentation(receipt({ addedCount: 1, sharedTotal: 3701 }), fresh);
    expect(p.fromRatio).toBeCloseTo(0.74, 12);
    expect(p.toRatio).toBeCloseTo(0.7402, 12);
  });

  it('authoritative crossing: only the server signal makes it; communal payoff; 113% motion is the component’s', () => {
    const r = receipt({ addedCount: 35, ownCredit: 35, sharedTotal: 5015, crossedTarget: true });
    const p = togetherPresentation(r, { ...fresh, sharedBefore: 4980 });
    expect(p.variant).toBe('crossed');
    expect(p.crossed).toBe(true);
    expect(p.payoff).toBe(TOGETHER_PAYOFF_CROSSED);
    expect(p.payoffLines).toEqual(['WE did it.', 'Together.']);
    expect(p.animate).toBe(true);
    // Visual fill is capped; the exact total and overshoot stay in the text.
    expect(p.toRatio).toBe(1);
    expect(p.standing).toContain('5,015 of 5,000 squats');
    expect(p.payoff).not.toMatch(/took us past|you won|winner/i);
  });

  it('at or beyond target WITHOUT the signal is never a crossing: static, truthful reached standing', () => {
    const r = receipt({ addedCount: 35, ownCredit: 35, sharedTotal: 5015 });
    const p = togetherPresentation(r, { ...fresh, sharedBefore: 4980 });
    expect(p.variant).toBe('reached');
    expect(p.crossed).toBe(false);
    expect(p.payoff).toBe('Our goal is reached.');
    expect(p.payoff).not.toBe(TOGETHER_PAYOFF_CLOSER);
    expect(p.animate).toBe(false);
  });

  it('already past the target before this write: post-target standing, static', () => {
    const r = receipt({ sharedTotal: 5030 });
    const p = togetherPresentation(r, { ...fresh, sharedBefore: 5010 });
    expect(p.variant).toBe('postTarget');
    expect(p.animate).toBe(false);
    expect(p.payoff).not.toBe(TOGETHER_PAYOFF_CLOSER);
  });

  it('a crossing receipt reopened, reconciled or replayed keeps its fact, counts once, and does not move', () => {
    const r = receipt({ addedCount: 35, ownCredit: 35, sharedTotal: 5015, crossedTarget: true, alreadyRecorded: true });
    for (const opts of [
      { ...fresh, sharedBefore: 4980 }, // even a "fresh" flag cannot animate a replay
      { communityName: 'Fixture Community', fresh: false },
      { communityName: 'Fixture Community', fresh: false, sharedBefore: null },
    ]) {
      const p = togetherPresentation(r, opts);
      expect(p.crossed).toBe(true);
      expect(p.payoff).toBe(TOGETHER_PAYOFF_CROSSED);
      expect(p.headline).toBe('This contribution was already recorded.');
      expect(p.standing).toMatch(/^It counted once\. /);
      expect(p.animate).toBe(false);
    }
  });

  it('not fresh — reconcile, restored pending, reload, reopen — is static with the same truth', () => {
    const a = togetherPresentation(receipt(), { ...fresh, fresh: false });
    const b = togetherPresentation(receipt(), fresh);
    expect(a.animate).toBe(false);
    expect({ ...a, animate: true }).toEqual(b);
  });

  it('no reliable before: shows the final WE at once and invents no tween', () => {
    for (const opts of [
      { ...fresh, sharedBefore: null }, // unknown: reconcile / reload
      { ...fresh, beforeTarget: 4000 }, // a different target
      { ...fresh, beforeTarget: null },
      { ...fresh, sharedBefore: 3800 }, // above the confirmed after
      { ...fresh, sharedBefore: Number.NaN },
    ]) {
      const p = togetherPresentation(receipt(), opts);
      expect(p.before).toBeNull();
      expect(p.animate).toBe(false);
      expect(p.fromRatio).toBe(p.toRatio);
    }
  });

  it('never infers the before from sharedTotal − addedCount', () => {
    const p = togetherPresentation(receipt(), { communityName: null, fresh: true });
    expect(p.before).toBeNull();
    expect(p.animate).toBe(false);
  });

  it('own-only receipt (shared visibility lost): no WE, no motion, its own exact facts', () => {
    const r: ContributeReceipt = { addedCount: 20, ownCredit: 60, alreadyRecorded: false };
    const p = togetherPresentation(r, fresh);
    expect(p.variant).toBe('ownOnly');
    expect(p.animate).toBe(false);
    expect(p.before).toBeNull();
    expect(p.standing).toBeNull();
    // No unit on an own-only receipt and none hinted: the number alone, exactly.
    expect(p.headline).toBe('You added 20.');
  });

  it('a second movement keeps its own unit throughout', () => {
    const p = togetherPresentation(receipt({ unit: 'push-ups' }), fresh);
    expect(p.headline).toBe('You added 20 push-ups.');
    expect(p.standing).toContain('push-ups');
    expect(p.standing).not.toContain('squats');
  });
});
