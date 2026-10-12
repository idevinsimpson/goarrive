// REP-COUNTER-PROOF-1-r6 body-relative torso measure (wrapper geometry; core/geometry.ts unchanged).
// torso = (mean hip y − mean shoulder y) / mean shin length, using only visible landmarks.
// Standing ≈ 1.4; an upright-to-moderately-leaning squat bottom stays well above 0.5; a bend-over
// (shoulders dropping to or below hip height) approaches 0 or goes negative. Null if unmeasurable.
import { visiblePoint } from '../core/geometry';
import type { Pose } from '../core/types';

export function torsoRatio(pose: Pose): number | null {
  const ys = (keys: ('leftShoulder' | 'rightShoulder' | 'leftHip' | 'rightHip')[]) => {
    const v = keys.map((k) => visiblePoint(pose, k)).filter((p): p is NonNullable<typeof p> => !!p);
    return v.length ? v.reduce((a, p) => a + p.y, 0) / v.length : null;
  };
  const sh = ys(['leftShoulder', 'rightShoulder']);
  const hip = ys(['leftHip', 'rightHip']);
  const shins: number[] = [];
  for (const side of ['left', 'right'] as const) {
    const k = visiblePoint(pose, `${side}Knee`);
    const a = visiblePoint(pose, `${side}Ankle`);
    if (k && a && a.y - k.y > 0.01) shins.push(a.y - k.y);
  }
  if (sh === null || hip === null || !shins.length) return null;
  return (hip - sh) / (shins.reduce((x, y) => x + y, 0) / shins.length);
}
