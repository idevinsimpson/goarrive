/**
 * useWorkoutFlatten — Flattens workout blocks into a linear movement sequence
 *
 * Extracted from WorkoutPlayer to keep the component focused on rendering.
 * Returns a stable array of FlatMovement objects.
 *
 * Suggestion 2: Now supports blockType for superset and circuit patterns:
 *   - "linear" / default: movements run sequentially per set
 *   - "superset": A1→A2→A1→A2 alternating pattern for 2+ movements
 *   - "circuit": A1→A2→A3→A1→A2→A3 rotating pattern for 3+ movements
 *
 * The block.type field (from WorkoutForm) maps to these patterns:
 *   "Superset" → superset
 *   "Circuit" / "AMRAP" → circuit
 *   Everything else → linear
 */
import { useMemo } from 'react';
import { calculateAdjustedRest } from './useRestAutoAdjust';

export interface FlatMovement {
  name: string;
  duration: number;
  restAfter: number;
  blockName: string;
  blockIndex: number;
  movementIndex: number;
  swapSides: boolean;
  description?: string;
  sets?: number;
  reps?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  coachingCues?: string;
  /** Label shown in player (e.g., "A1", "A2" for supersets) */
  supersetLabel?: string;
  /** The block pattern type for UI display */
  blockType?: 'linear' | 'superset' | 'circuit';
}

export function resolveBlockType(blockType: string | undefined): 'linear' | 'superset' | 'circuit' {
  const t = (blockType || '').toLowerCase();
  if (t === 'superset') return 'superset';
  if (t === 'circuit' || t === 'amrap') return 'circuit';
  return 'linear';
}

/** Generate a superset/circuit label like A1, A2, B1, B2 */
function makeLabel(blockIndex: number, movementIndex: number): string {
  const letter = String.fromCharCode(65 + blockIndex); // A, B, C...
  return `${letter}${movementIndex + 1}`;
}

export function useWorkoutFlatten(workout: any): FlatMovement[] {
  return useMemo(() => {
    if (!workout?.blocks) return [];

    const flat: FlatMovement[] = [];
    const blocks = workout.blocks || [];

    blocks.forEach((block: any, bi: number) => {
      const movements = block.movements || [];
      if (movements.length === 0) return;

      const blockRest = block.restBetweenSec ?? block.restBetweenRoundsSec ?? block.rest ?? 15;
      const workoutDifficulty = workout.difficulty || 'Intermediate';
      const rounds = block.rounds ?? block.sets ?? 1;
      const bType = resolveBlockType(block.type);

      if (bType === 'superset' || bType === 'circuit') {
        // ── Superset / Circuit: alternate movements across rounds ──────
        // Pattern: round 1 → [A1, A2, A3], round 2 → [A1, A2, A3], ...
        for (let round = 0; round < rounds; round++) {
          movements.forEach((mv: any, mi: number) => {
            const isLastMovementInRound = mi === movements.length - 1;
            const isLastRound = round === rounds - 1;
            const isVeryLast = isLastMovementInRound && isLastRound;

            // Rest logic:
            // - Between movements within a round: short rest (movement's restSec or 0 for supersets)
            // - Between rounds: block rest
            // - After last movement of last round: no rest
            let restAfter = 0;
            if (isVeryLast) {
              restAfter = 0;
            } else if (isLastMovementInRound) {
              restAfter = blockRest;
            } else {
              // For supersets, minimal rest between A1→A2; for circuits, use auto-adjusted rest
              restAfter = bType === 'superset'
                ? (mv.restSec ?? 0)
                : calculateAdjustedRest(mv, block, workoutDifficulty);
            }

            flat.push({
              name: mv.name || 'Movement',
              duration: mv.duration || mv.workSec || 30,
              restAfter,
              blockName: block.name || `Block ${bi + 1}`,
              blockIndex: bi,
              movementIndex: mi,
              swapSides: mv.swapSides ?? false,
              description: mv.description || mv.coachingCues || '',
              sets: mv.sets,
              reps: mv.reps,
              videoUrl: mv.videoUrl || mv.mediaUrl || '',
              thumbnailUrl: mv.thumbnailUrl || '',
              coachingCues: mv.coachingCues || '',
              supersetLabel: makeLabel(bi, mi),
              blockType: bType,
            });
          });
        }
      } else {
        // ── Linear: sequential movements, each repeated for its sets ──
        for (let setNum = 0; setNum < rounds; setNum++) {
          movements.forEach((mv: any, mi: number) => {
            const isLastInBlock =
              setNum === rounds - 1 && mi === movements.length - 1;
            flat.push({
              name: mv.name || 'Movement',
              duration: mv.duration || mv.workSec || 30,
              restAfter: isLastInBlock ? 0 : calculateAdjustedRest(mv, block, workoutDifficulty),
              blockName: block.name || `Block ${bi + 1}`,
              blockIndex: bi,
              movementIndex: mi,
              swapSides: mv.swapSides ?? false,
              description: mv.description || mv.coachingCues || '',
              sets: mv.sets,
              reps: mv.reps,
              videoUrl: mv.videoUrl || mv.mediaUrl || '',
              thumbnailUrl: mv.thumbnailUrl || '',
              coachingCues: mv.coachingCues || '',
              blockType: 'linear',
            });
          });
        }
      }
    });

    return flat;
  }, [workout]);
}
