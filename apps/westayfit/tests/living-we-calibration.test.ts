// The Living WE fills an irregular letterform from the bottom. A rectangle
// clip at 48.2% of the height does not paint 48.2% of the shape, so the fill
// height comes from a table derived from the silhouette's alpha channel. These
// tests pin the properties that make the visual fill agree with the number.

import { describe, expect, it } from 'vitest';

import {
  LIVING_WE_ASPECT,
  heightFractionForFill,
  livingWeCalibration,
} from '../src/ui/livingWeCalibration';

describe('Living WE calibration table', () => {
  it('has one entry per 0.1% of fill, from empty to full', () => {
    expect(livingWeCalibration.steps).toBe(1000);
    expect(livingWeCalibration.heightFractionByFill).toHaveLength(1001);
    expect(livingWeCalibration.direction).toBe('bottom-up');
  });

  it('starts at 0 and ends at 1', () => {
    const t = livingWeCalibration.heightFractionByFill;
    expect(t[0]).toBe(0);
    expect(t[t.length - 1]).toBe(1);
  });

  it('is monotonic non-decreasing: more progress never lowers the fill', () => {
    const t = livingWeCalibration.heightFractionByFill;
    for (let i = 1; i < t.length; i += 1) {
      expect(t[i]).toBeGreaterThanOrEqual(t[i - 1]!);
    }
  });

  it('stays within the silhouette height', () => {
    for (const v of livingWeCalibration.heightFractionByFill) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('interpolates and clamps the lookup', () => {
    expect(heightFractionForFill(0)).toBe(0);
    expect(heightFractionForFill(-1)).toBe(0);
    expect(heightFractionForFill(1)).toBe(1);
    expect(heightFractionForFill(7)).toBe(1);
    expect(heightFractionForFill(Number.NaN)).toBe(0);
    const t = livingWeCalibration.heightFractionByFill;
    expect(heightFractionForFill(0.482)).toBeCloseTo(t[482]!, 12);
    const mid = heightFractionForFill(0.4825);
    expect(mid).toBeGreaterThanOrEqual(t[482]!);
    expect(mid).toBeLessThanOrEqual(t[483]!);
  });

  it('is strictly increasing at every state the checkpoint shows', () => {
    const states = [0, 0.482, 0.522, 0.9, 0.9998, 1];
    for (let i = 1; i < states.length; i += 1) {
      expect(heightFractionForFill(states[i]!)).toBeGreaterThan(
        heightFractionForFill(states[i - 1]!)
      );
    }
  });

  it('keeps the silhouette proportions the derivation recorded', () => {
    expect(LIVING_WE_ASPECT).toBeCloseTo(
      livingWeCalibration.width / livingWeCalibration.height,
      12
    );
    expect(LIVING_WE_ASPECT).toBeGreaterThan(1.5);
    expect(LIVING_WE_ASPECT).toBeLessThan(3);
  });
});
