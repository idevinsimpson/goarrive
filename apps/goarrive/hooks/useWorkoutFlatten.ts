/**
 * useWorkoutFlatten — Flattens workout blocks into a linear playback sequence
 *
 * Phase 3 upgrade: Now handles ALL block types including special blocks:
 *   - Intro / Outro: full-screen cinematic moments (~10s default)
 *   - Demo: previews upcoming multi-movement block's movements
 *   - Transition: instruction text + duration for equipment/location changes
 *   - Water Break: hydration pause with media area active
 *   - Exercise blocks: Warm-Up, Circuit, Superset, Interval, Strength,
 *     Timed, AMRAP, EMOM, Cool-Down, Rest
 *
 * Special blocks become FlatStep objects with `stepType` set to the block type.
 * Exercise movements become FlatStep objects with `stepType: 'exercise'`.
 *
 * The player reads `stepType` to decide which render screen to show.
 */
import { useMemo } from 'react';
import { calculateAdjustedRest } from './useRestAutoAdjust';

// ── Special block types that don't contain movements ──────────────────
const SPECIAL_BLOCK_TYPES = new Set([
  'Intro', 'Outro', 'Demo', 'Transition', 'Water Break',
]);

// ── Types ─────────────────────────────────────────────────────────────
export type StepType =
  | 'exercise'
  | 'intro'
  | 'outro'
  | 'demo'
  | 'transition'
  | 'waterBreak';

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
  movementId?: string;
  supersetLabel?: string;
  blockType?: 'linear' | 'superset' | 'circuit';
  cropScale?: number;
  cropTranslateX?: number;
  cropTranslateY?: number;

  // ── Phase 3: Special block fields ───────────────────────────────
  /** What kind of step this is — determines which player screen renders */
  stepType: StepType;
  /** For Demo blocks: array of upcoming movement names to preview */
  demoMovements?: { name: string; thumbnailUrl?: string; videoUrl?: string; movementId?: string }[];
  /** For Transition blocks: instruction text from coach */
  instructionText?: string;
  /** For Intro/Outro: whether this is full-screen cinematic */
  isFullScreen?: boolean;
  /** Original block type string (e.g., 'Warm-Up', 'Circuit') */
  originalBlockType?: string;
}

export function resolveBlockType(blockType: string | undefined): 'linear' | 'superset' | 'circuit' {
  const t = (blockType || '').toLowerCase();
  if (t === 'superset') return 'superset';
  if (t === 'circuit' || t === 'amrap') return 'circuit';
  return 'linear';
}

function makeLabel(blockIndex: number, movementIndex: number): string {
  const letter = String.fromCharCode(65 + blockIndex);
  return `${letter}${movementIndex + 1}`;
}

/** Map block type string to StepType */
function toStepType(blockType: string): StepType {
  switch (blockType) {
    case 'Intro': return 'intro';
    case 'Outro': return 'outro';
    case 'Demo': return 'demo';
    case 'Transition': return 'transition';
    case 'Water Break': return 'waterBreak';
    default: return 'exercise';
  }
}

export function useWorkoutFlatten(workout: any): FlatMovement[] {
  return useMemo(() => {
    if (!workout?.blocks) return [];

    const flat: FlatMovement[] = [];
    const rawBlocks = workout.blocks || [];

    // ── Reorder: Intro first, Outro last, everything else in original order ──
    const introBlocks = rawBlocks.filter((b: any) => (b.type || '') === 'Intro');
    const outroBlocks = rawBlocks.filter((b: any) => (b.type || '') === 'Outro');
    const middleBlocks = rawBlocks.filter((b: any) => (b.type || '') !== 'Intro' && (b.type || '') !== 'Outro');
    const blocks = [...introBlocks, ...middleBlocks, ...outroBlocks];

    blocks.forEach((block: any, bi: number) => {
      const blockType = block.type || 'Circuit';

      // ── Special blocks ──────────────────────────────────────────────
      if (SPECIAL_BLOCK_TYPES.has(blockType)) {
        const stepType = toStepType(blockType);
        const duration = block.durationSec ?? (blockType === 'Intro' || blockType === 'Outro' ? 10 : 30);

        // For Demo blocks, look ahead to find the next exercise block's movements
        let demoMovements: FlatMovement['demoMovements'] = undefined;
        if (blockType === 'Demo') {
          for (let j = bi + 1; j < blocks.length; j++) {
            const nextBlock = blocks[j];
            if (!SPECIAL_BLOCK_TYPES.has(nextBlock.type || 'Circuit') && nextBlock.movements?.length > 1) {
              demoMovements = (nextBlock.movements || []).map((m: any) => ({
                name: m.movementName || m.name || 'Movement',
                thumbnailUrl: m.thumbnailUrl || '',
                videoUrl: m.videoUrl || m.mediaUrl || '',
                movementId: m.movementId || '',
              }));
              break;
            }
          }
        }

        flat.push({
          name: block.label || block.name || blockType,
          duration,
          restAfter: 0,
          blockName: block.label || block.name || blockType,
          blockIndex: bi,
          movementIndex: 0,
          swapSides: false,
          description: block.instructionText || block.description || '',
          stepType,
          demoMovements,
          instructionText: block.instructionText || '',
          isFullScreen: blockType === 'Intro' || blockType === 'Outro',
          originalBlockType: blockType,
        });
        return;
      }

      // ── Exercise blocks ─────────────────────────────────────────────
      const movements = block.movements || [];
      if (movements.length === 0) return;

      const blockRest = block.restBetweenSec ?? block.restBetweenRoundsSec ?? block.rest ?? 15;
      const workoutDifficulty = workout.difficulty || 'Intermediate';
      const rounds = block.rounds ?? block.sets ?? 1;
      const bType = resolveBlockType(block.type);
      const firstMovePrepSec = block.firstMovementPrepSec ?? 0;

      // If there's a first-movement prep time, insert a prep step before the block
      if (firstMovePrepSec > 0) {
        flat.push({
          name: `Get Ready: ${block.label || block.name || blockType}`,
          duration: firstMovePrepSec,
          restAfter: 0,
          blockName: block.label || block.name || `Block ${bi + 1}`,
          blockIndex: bi,
          movementIndex: -1,
          swapSides: false,
          description: `Prepare for ${movements[0]?.movementName || movements[0]?.name || 'first movement'}`,
          stepType: 'transition',
          instructionText: `Get ready for ${movements[0]?.movementName || movements[0]?.name || 'the first movement'}`,
          originalBlockType: blockType,
        });
      }

      if (bType === 'superset' || bType === 'circuit') {
        for (let round = 0; round < rounds; round++) {
          movements.forEach((mv: any, mi: number) => {
            const isLastMovementInRound = mi === movements.length - 1;
            const isLastRound = round === rounds - 1;
            const isVeryLast = isLastMovementInRound && isLastRound;

            const transitionRest = block.restBetweenMovementsSec;
            let restAfter = 0;
            if (isVeryLast) {
              restAfter = 0;
            } else if (isLastMovementInRound) {
              restAfter = blockRest;
            } else if (transitionRest != null && transitionRest > 0) {
              restAfter = transitionRest;
            } else {
              restAfter = bType === 'superset'
                ? (mv.restSec ?? 0)
                : calculateAdjustedRest(mv, block, workoutDifficulty);
            }

            flat.push({
              name: mv.movementName || mv.name || 'Movement',
              duration: mv.duration || mv.durationSec || mv.workSec || 30,
              restAfter,
              blockName: block.name || block.label || `Block ${bi + 1}`,
              blockIndex: bi,
              movementIndex: mi,
              swapSides: mv.swapSides ?? false,
              description: mv.description || mv.coachingCues || mv.notes || '',
              sets: mv.sets,
              reps: mv.reps,
              videoUrl: mv.videoUrl || mv.mediaUrl || '',
              thumbnailUrl: mv.thumbnailUrl || '',
              coachingCues: mv.coachingCues || mv.notes || '',
              movementId: mv.movementId || '',
              supersetLabel: makeLabel(bi, mi),
              blockType: bType,
              stepType: 'exercise',
              originalBlockType: blockType,
              cropScale: mv.cropScale ?? 1,
              cropTranslateX: mv.cropTranslateX ?? 0,
              cropTranslateY: mv.cropTranslateY ?? 0,
            });
          });
        }
      } else {
        for (let setNum = 0; setNum < rounds; setNum++) {
          movements.forEach((mv: any, mi: number) => {
            const isLastInBlock =
              setNum === rounds - 1 && mi === movements.length - 1;
            flat.push({
              name: mv.movementName || mv.name || 'Movement',
              duration: mv.duration || mv.durationSec || mv.workSec || 30,
              restAfter: isLastInBlock ? 0 : calculateAdjustedRest(mv, block, workoutDifficulty),
              blockName: block.name || block.label || `Block ${bi + 1}`,
              blockIndex: bi,
              movementIndex: mi,
              swapSides: mv.swapSides ?? false,
              description: mv.description || mv.coachingCues || mv.notes || '',
              sets: mv.sets,
              reps: mv.reps,
              videoUrl: mv.videoUrl || mv.mediaUrl || '',
              thumbnailUrl: mv.thumbnailUrl || '',
              coachingCues: mv.coachingCues || mv.notes || '',
              movementId: mv.movementId || '',
              blockType: 'linear',
              stepType: 'exercise',
              originalBlockType: blockType,
              cropScale: mv.cropScale ?? 1,
              cropTranslateX: mv.cropTranslateX ?? 0,
              cropTranslateY: mv.cropTranslateY ?? 0,
            });
          });
        }
      }
    });


    return flat;
  }, [workout]);
}
