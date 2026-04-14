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
  'Intro', 'Outro', 'Demo', 'Transition', 'Water Break', 'Grab Equipment',
]);

// ── Types ─────────────────────────────────────────────────────────────
export type StepType =
  | 'exercise'
  | 'intro'
  | 'outro'
  | 'demo'
  | 'transition'
  | 'waterBreak'
  | 'grabEquipment';

export interface FlatMovement {
  name: string;
  duration: number;
  restAfter: number;
  blockName: string;
  blockIndex: number;
  movementIndex: number;
  swapSides: boolean;
  showOnPreview?: boolean;
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
  /** Voice clip URL for this movement name (if pre-generated) */
  voiceUrl?: string;

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
export function toStepType(blockType: string): StepType {
  switch (blockType) {
    case 'Intro': return 'intro';
    case 'Outro': return 'outro';
    case 'Demo': return 'demo';
    case 'Transition': return 'transition';
    case 'Water Break': return 'waterBreak';
    case 'Grab Equipment': return 'grabEquipment';
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

    // Synthesize Intro/Outro blocks from workout-level video URLs if no explicit blocks exist
    if (introBlocks.length === 0 && workout.introVideoUrl) {
      introBlocks.push({ type: 'Intro', label: 'Intro', durationSec: 10, videoUrl: workout.introVideoUrl });
    }
    if (outroBlocks.length === 0 && workout.outroVideoUrl) {
      outroBlocks.push({ type: 'Outro', label: 'Outro', durationSec: 10, videoUrl: workout.outroVideoUrl });
    }

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
          videoUrl: block.videoUrl || '',
          stepType,
          demoMovements,
          instructionText: block.instructionText || '',
          isFullScreen: blockType === 'Intro' || blockType === 'Outro',
          originalBlockType: blockType,
        });
        return;
      }

      // ── Auto-insert demo step when block.showDemo is true ─────────
      if (block.showDemo) {
        const demoMvs = (block.movements || []).map((m: any) => ({
          name: m.movementName || m.name || 'Movement',
          thumbnailUrl: m.thumbnailUrl || '',
          videoUrl: m.videoUrl || m.mediaUrl || '',
          movementId: m.movementId || '',
        }));
        flat.push({
          name: block.label || block.name || `Block ${bi + 1}`,
          duration: block.circuitStartRestSec ?? 20,
          restAfter: 0,
          blockName: block.label || block.name || `Block ${bi + 1}`,
          blockIndex: bi,
          movementIndex: 0,
          swapSides: false,
          description: '',
          stepType: 'demo',
          demoMovements: demoMvs,
          instructionText: '',
          isFullScreen: false,
          originalBlockType: blockType,
        });
      }

      // ── Exercise blocks ─────────────────────────────────────────────
      const movements = block.movements || [];
      if (movements.length === 0) return;

      const blockRest = block.restBetweenSec ?? block.restBetweenRoundsSec ?? block.rest ?? 15;
      const workoutDifficulty = workout.difficulty || 'Intermediate';
      const rounds = block.rounds ?? block.sets ?? 1;
      const bType = resolveBlockType(block.type);
      if (bType === 'superset' || bType === 'circuit') {
        // ── Rest-shift fix ────────────────────────────────────────────
        // Coach mental model: rest on a movement = prep time BEFORE that
        // movement starts. But `restAfter` fires AFTER a movement ends.
        //
        // Strategy: compute each movement's "own rest" (what the coach set),
        // then shift forward so movement[N]'s rest becomes movement[N-1]'s
        // restAfter. Movement[0]'s rest becomes a prep rest inserted before
        // the round starts.
        // ──────────────────────────────────────────────────────────────

        for (let round = 0; round < rounds; round++) {
          // 1. Compute each movement's "own rest" (prep time the coach intended)
          const ownRests: number[] = movements.map((mv: any, mi: number) => {
            const transitionRest = block.restBetweenMovementsSec;
            if (transitionRest != null && transitionRest > 0) return transitionRest;
            return bType === 'superset'
              ? (mv.restSec ?? 0)
              : calculateAdjustedRest(mv, block, workoutDifficulty);
          });

          // 2. Determine the prep rest before the first movement of this round
          const firstMovementPrep = ownRests[0] ?? 0;

          // For the very first round, use circuitStartRestSec if set,
          // otherwise fall back to the first movement's own rest
          const circuitStartRest = block.circuitStartRestSec;
          const prepDuration = (round === 0 && circuitStartRest != null && circuitStartRest > 0)
            ? circuitStartRest
            : firstMovementPrep;

          // Insert a prep rest on the previous step if one exists,
          // otherwise the ready screen / previous block's last step handles it.
          // We set restAfter on the step that was just pushed (the last item in flat)
          // so the player shows rest with "Next: [first movement name]".
          if (prepDuration > 0 && flat.length > 0) {
            // Attach prep rest to the previous step in the flat array
            flat[flat.length - 1].restAfter = prepDuration;
          } else if (prepDuration > 0 && flat.length === 0) {
            // Very first step of the entire workout — no previous step exists.
            // Insert a synthetic prep step so the player shows a rest screen first.
            const firstMv = movements[0];
            flat.push({
              name: 'Get Ready',
              duration: 0, // no work phase — just rest
              restAfter: prepDuration,
              blockName: block.name || block.label || `Block ${bi + 1}`,
              blockIndex: bi,
              movementIndex: -1,
              swapSides: false,
              description: '',
              stepType: 'exercise',
              originalBlockType: blockType,
              videoUrl: firstMv?.videoUrl || firstMv?.mediaUrl || '',
              thumbnailUrl: firstMv?.thumbnailUrl || '',
              movementId: '',
              blockType: bType,
              supersetLabel: '',
              cropScale: 1,
              cropTranslateX: 0,
              cropTranslateY: 0,
              voiceUrl: '',
            });
          }

          // 3. Push each movement with shifted restAfter
          movements.forEach((mv: any, mi: number) => {
            const isLastMovementInRound = mi === movements.length - 1;
            const isLastRound = round === rounds - 1;
            const isVeryLast = isLastMovementInRound && isLastRound;

            // restAfter = the NEXT movement's prep rest (shifted forward)
            let restAfter = 0;
            if (isVeryLast) {
              restAfter = 0; // nothing after the very last movement
            } else if (isLastMovementInRound) {
              // Between rounds: use the block-level between-rounds rest
              restAfter = blockRest;
            } else {
              // Next movement's own rest = prep before the next movement
              restAfter = ownRests[mi + 1] ?? 0;
            }

            flat.push({
              name: mv.movementName || mv.name || 'Movement',
              duration: mv.duration || mv.durationSec || mv.workSec || 30,
              restAfter,
              blockName: block.name || block.label || `Block ${bi + 1}`,
              blockIndex: bi,
              movementIndex: mi,
              swapSides: mv.swapSides ?? false,
              showOnPreview: mv.showOnPreview,
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
              voiceUrl: mv.voiceUrl || '',
            });
          });
        }
      } else {
        // ── Linear blocks: same rest-shift logic ──────────────────────
        for (let setNum = 0; setNum < rounds; setNum++) {
          // Compute each movement's "own rest" (prep before it)
          const ownRests: number[] = movements.map((mv: any) =>
            calculateAdjustedRest(mv, block, workoutDifficulty),
          );

          // Prep rest before first movement of this set
          const firstPrep = ownRests[0] ?? 0;
          if (firstPrep > 0 && flat.length > 0) {
            flat[flat.length - 1].restAfter = firstPrep;
          } else if (firstPrep > 0 && flat.length === 0) {
            const firstMv = movements[0];
            flat.push({
              name: 'Get Ready',
              duration: 0,
              restAfter: firstPrep,
              blockName: block.name || block.label || `Block ${bi + 1}`,
              blockIndex: bi,
              movementIndex: -1,
              swapSides: false,
              description: '',
              stepType: 'exercise',
              originalBlockType: blockType,
              videoUrl: firstMv?.videoUrl || firstMv?.mediaUrl || '',
              thumbnailUrl: firstMv?.thumbnailUrl || '',
              movementId: '',
              blockType: 'linear',
              supersetLabel: '',
              cropScale: 1,
              cropTranslateX: 0,
              cropTranslateY: 0,
              voiceUrl: '',
            });
          }

          movements.forEach((mv: any, mi: number) => {
            const isLastInBlock =
              setNum === rounds - 1 && mi === movements.length - 1;

            // Shifted rest: next movement's prep rest
            let restAfter = 0;
            if (isLastInBlock) {
              restAfter = 0;
            } else if (mi < movements.length - 1) {
              restAfter = ownRests[mi + 1] ?? 0;
            } else {
              // Last in this set but more sets remain — between-set rest
              restAfter = blockRest;
            }

            flat.push({
              name: mv.movementName || mv.name || 'Movement',
              duration: mv.duration || mv.durationSec || mv.workSec || 30,
              restAfter,
              blockName: block.name || block.label || `Block ${bi + 1}`,
              blockIndex: bi,
              movementIndex: mi,
              swapSides: mv.swapSides ?? false,
              showOnPreview: mv.showOnPreview,
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
              voiceUrl: mv.voiceUrl || '',
            });
          });
        }
      }
    });


    return flat;
  }, [workout]);
}
