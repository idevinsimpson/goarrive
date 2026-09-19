/**
 * Maps a fill ratio (share of the WE's AREA that should be green) to the
 * height, as a fraction of the silhouette's height from its bottom edge, at
 * which a bottom-anchored clip must stop.
 *
 * The letterform is irregular: a rectangle clip at 48.2% of the height does
 * not paint 48.2% of the shape. The table is generated from the silhouette's
 * alpha channel by scripts/westayfit/brand/derive-brand-assets.py, one entry
 * per 0.1% of fill, and is what makes the visual fill agree with the number.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const calibration = require('../../assets/brand/derived/living-we-calibration.json') as {
  width: number;
  height: number;
  steps: number;
  direction: 'bottom-up';
  heightFractionByFill: number[];
};

export const LIVING_WE_ASPECT = calibration.width / calibration.height;

/** Height fraction from the bottom for a fill ratio in [0, 1]. Interpolated. */
export function heightFractionForFill(ratio: number): number {
  const table = calibration.heightFractionByFill;
  const steps = calibration.steps;
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  if (ratio >= 1) return 1;
  const pos = ratio * steps;
  const lo = Math.floor(pos);
  const hi = Math.min(steps, lo + 1);
  const t = pos - lo;
  return table[lo]! + (table[hi]! - table[lo]!) * t;
}

export const livingWeCalibration = calibration;
