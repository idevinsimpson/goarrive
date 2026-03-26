/**
 * useRestAutoAdjust — Auto-adjust rest timer based on intensity (Suggestion 6)
 *
 * Provides a function that calculates an adjusted rest duration based on:
 *   - Block type (circuit → shorter, strength → longer)
 *   - Movement category (compound → longer rest, isolation → shorter)
 *   - Workout difficulty (advanced → shorter rest, beginner → longer)
 *   - Coach override (if coach set explicit rest, respect it)
 *
 * Usage:
 *   const { getAdjustedRest } = useRestAutoAdjust({ difficulty: 'Intermediate' });
 *   const rest = getAdjustedRest(movement, block);
 *
 * The hook returns a pure function — no side effects, no state.
 * Can also be used as a standalone utility outside of React.
 */
import { useCallback } from 'react';

interface RestAutoAdjustOptions {
  /** Workout-level difficulty: Beginner, Intermediate, Advanced */
  difficulty?: string;
}

// ── Intensity multipliers ──────────────────────────────────────────────────
const DIFFICULTY_MULTIPLIER: Record<string, number> = {
  beginner: 1.3,
  intermediate: 1.0,
  advanced: 0.8,
};

const BLOCK_TYPE_BASE_REST: Record<string, number> = {
  circuit: 10,
  superset: 5,
  amrap: 0,
  emom: 0,
  interval: 15,
  strength: 60,
  'warm-up': 10,
  'cool-down': 10,
  timed: 15,
  rest: 0,
};

/**
 * Heuristic: compound movements (squat, deadlift, bench, press, row)
 * need more rest than isolation movements (curl, extension, raise).
 */
const COMPOUND_KEYWORDS = [
  'squat', 'deadlift', 'bench', 'press', 'row', 'clean', 'snatch',
  'thruster', 'lunge', 'pull-up', 'pullup', 'chin-up', 'dip',
];

function isCompound(movementName: string): boolean {
  const lower = movementName.toLowerCase();
  return COMPOUND_KEYWORDS.some((kw) => lower.includes(kw));
}

export function calculateAdjustedRest(
  movement: { name?: string; restSec?: number; [key: string]: any },
  block: { type?: string; restBetweenRoundsSec?: number; [key: string]: any },
  difficulty: string = 'Intermediate',
): number {
  // If coach explicitly set rest on the movement, respect it
  if (movement.restSec !== undefined && movement.restSec !== null && movement.restSec > 0) {
    return movement.restSec;
  }

  // Base rest from block type
  const blockType = (block.type || 'strength').toLowerCase();
  let baseRest = BLOCK_TYPE_BASE_REST[blockType] ?? 30;

  // Compound movement bonus
  if (isCompound(movement.name || '')) {
    baseRest = Math.max(baseRest, 45); // At least 45s for compounds
    baseRest += 15; // Extra 15s for compound recovery
  }

  // Difficulty multiplier
  const diffKey = difficulty.toLowerCase();
  const multiplier = DIFFICULTY_MULTIPLIER[diffKey] ?? 1.0;
  let adjusted = Math.round(baseRest * multiplier);

  // Clamp to reasonable range
  adjusted = Math.max(5, Math.min(adjusted, 180));

  return adjusted;
}

export function useRestAutoAdjust({ difficulty = 'Intermediate' }: RestAutoAdjustOptions = {}) {
  const getAdjustedRest = useCallback(
    (
      movement: { name?: string; restSec?: number; [key: string]: any },
      block: { type?: string; restBetweenRoundsSec?: number; [key: string]: any },
    ) => {
      return calculateAdjustedRest(movement, block, difficulty);
    },
    [difficulty],
  );

  return { getAdjustedRest };
}
