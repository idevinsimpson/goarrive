// R10-REPLAY-1 — the exact counter-operation stream emitted by SessionR5's observer seam, plus
// per-side signal info for the MATCHED subject. Pure TS, no DOM.
import { DEFAULT_MIN_VISIBILITY } from '../core/geometry';
import type { Pose } from '../core/types';
import type { Reject, Stage } from '../r6/naturalCounter';
import type { RuleDecision } from './decision';

export type TraceOp =
  | { k: 'feed'; t: number; depth: number | null; torso: number | null; replay: boolean; reps: number | null; event: 'rep' | 'partial' | null; reject: Reject | null; stage: Stage | null; dec: RuleDecision | null }
  | { k: 'skip'; t: number }
  | { k: 'interrupt' }
  | { k: 'reset' }
  /** r14 tracker continuity decision (diagnostics only; rule re-runners ignore it). */
  | { k: 'cont'; t: number; ev: string };

export interface SideStat { ratio: number | null; vis: number }
export interface SideInfo {
  /** bit0 = left measurable, bit1 = right measurable (hip, knee, ankle all ≥ visibility threshold). */
  mask: number;
  left: SideStat | null;
  right: SideStat | null;
}

/** Same measurability and per-side ratio rule as core geometry's squatRatio (which averages the sides). */
export function sideInfo(pose: Pose, minVis = DEFAULT_MIN_VISIBILITY): SideInfo {
  let mask = 0;
  const one = (side: 'left' | 'right', bit: number): SideStat | null => {
    const hip = pose[`${side}Hip`], knee = pose[`${side}Knee`], ankle = pose[`${side}Ankle`];
    if (!hip || !knee || !ankle) return null;
    const vis = Math.min(hip.visibility, knee.visibility, ankle.visibility);
    if (vis < minVis) return { ratio: null, vis };
    mask |= bit;
    const shin = ankle.y - knee.y;
    return { ratio: shin > 0.01 ? (ankle.y - hip.y) / shin : null, vis };
  };
  const left = one('left', 1), right = one('right', 2);
  return { mask, left, right };
}
