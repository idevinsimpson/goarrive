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
 *
 * IMPORTANT: share-link viewers get workout data through the resolveShareToken
 * cloud function, which strips fields via an explicit allowlist in
 * functions/src/workoutPlayerSanitizer.ts. If you read a NEW block/movement/
 * workout field here (or in WorkoutPlayer/useWorkoutTimer/useWorkoutTTS), add
 * it to that allowlist too — otherwise share links silently lose it.
 */
import { useMemo } from 'react';
import { calculateAdjustedRest } from './useRestAutoAdjust';

// ── Special block types that don't contain movements ──────────────────
const SPECIAL_BLOCK_TYPES = new Set([
  'Intro', 'Outro', 'Demo', 'Transition', 'Water Break', 'Grab Equipment', 'Follow-Along Video',
]);

// ── Types ─────────────────────────────────────────────────────────────
export type StepType =
  | 'exercise'
  | 'intro'
  | 'outro'
  | 'demo'
  | 'transition'
  | 'waterBreak'
  | 'grabEquipment'
  | 'followAlongVideo';

export interface FlatMovement {
  name: string;
  duration: number;
  restAfter: number;
  blockName: string;
  blockIndex: number;
  movementIndex: number;
  swapSides: boolean;
  swapMode?: 'split' | 'duplicate';
  swapWindowSec?: number;
  showOnPreview?: boolean;
  description?: string;
  sets?: number;
  reps?: string;
  weight?: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  posterUrl?: string;
  coachingCues?: string;
  movementId?: string;
  supersetLabel?: string;
  blockType?: 'linear' | 'superset' | 'circuit';
  cropScale?: number;
  cropTranslateX?: number;
  cropTranslateY?: number;
  /** GoArrive Coach voice clip URL for this movement name (OpenAI TTS generated) */
  voiceUrl?: string;
  /** Prescription voice clip URL — generated per-workout-build when weight/reps are set. Preferred over voiceUrl when present. */
  prescriptionVoiceUrl?: string;
  /** Primary muscles from the canonical movement doc (merged in by useMovementHydrate — block snapshots don't store muscles). */
  primaryMuscles?: string[];

  // ── Phase 3: Special block fields ───────────────────────────────
  /** What kind of step this is — determines which player screen renders */
  stepType: StepType;
  /** For Demo blocks: array of upcoming movement names to preview */
  demoMovements?: { name: string; thumbnailUrl?: string; posterUrl?: string; videoUrl?: string; movementId?: string }[];
  /** For Transition blocks: instruction text from coach */
  instructionText?: string;
  /** For Grab Equipment blocks: equipment list text from coach */
  grabEquipmentText?: string;
  /** For Grab Equipment blocks: AI-generated background image URL */
  grabEquipmentImageUrl?: string;
  /** For Intro/Outro: whether this is full-screen cinematic */
  isFullScreen?: boolean;
  /** Original block type string (e.g., 'Warm-Up', 'Circuit') */
  originalBlockType?: string;
  /** Follow-Along Video: whether the video's audio plays through (default true) */
  soundEnabled?: boolean;
  /** Follow-Along Video: original frame width used during cropping (for accurate translate scaling) */
  cropFrameWidth?: number;
  /** Follow-Along Video: original frame height used during cropping */
  cropFrameHeight?: number;
  /** Number of movements in the parent block — 1 means this is a Tabata-style single-movement block */
  blockMovCount?: number;
  /** 0-indexed round number within the parent block — used to suppress repeated movement announcements */
  blockRound?: number;
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

/**
 * Display-only helper for pre-play previews. Groups adjacent exercise
 * blocks into visual sections; a Water Break or Transition block splits
 * sections. Does not affect playback timing or step ordering.
 */
export interface PreviewSectionBlock {
  block: any;
  /** Index in the flatten-ordered block list */
  bi: number;
}
export function buildPreviewSections(workout: any): PreviewSectionBlock[][] {
  const rawBlocks = workout?.blocks || [];
  const introBlocks = rawBlocks.filter((b: any) => (b.type || '') === 'Intro');
  const outroBlocks = rawBlocks.filter((b: any) => (b.type || '') === 'Outro');
  const middleBlocks = rawBlocks.filter((b: any) => (b.type || '') !== 'Intro' && (b.type || '') !== 'Outro');
  if (introBlocks.length === 0 && workout?.introVideoUrl) introBlocks.push({ type: 'Intro' });
  if (outroBlocks.length === 0 && workout?.outroVideoUrl) outroBlocks.push({ type: 'Outro' });
  const ordered = [...introBlocks, ...middleBlocks, ...outroBlocks];

  const sections: PreviewSectionBlock[][] = [];
  let current: PreviewSectionBlock[] | null = null;
  ordered.forEach((b: any, bi: number) => {
    const t = b.type || '';
    if (t === 'Water Break' || t === 'Transition') {
      current = null;
      return;
    }
    if (['Intro', 'Outro', 'Demo', 'Grab Equipment', 'Follow-Along Video'].includes(t)) return;
    if ((b.movements || []).length === 0) return;
    if (!current) {
      current = [];
      sections.push(current);
    }
    current.push({ block: b, bi });
  });
  return sections;
}

const MEANINGFUL_SECTION_TYPES = ['Tabata', 'Interval', 'Timed', 'AMRAP', 'EMOM', 'For Time', 'Cardio'];
const GENERIC_BLOCK_LABELS = new Set(['', 'circuit', 'strength', 'block', 'exercise', 'work']);

// Single-movement work blocks default to "Tabata" — matches the ready
// screen's long-standing heuristic and how coaches author tabata-style
// blocks (real data uses type "Circuit" with one movement per block).
function sectionDescriptor(block: any): string {
  if ((block.movements || []).length >= 2) return 'Superset';
  const t = String(block.type || '').trim();
  const meaningful = MEANINGFUL_SECTION_TYPES.find((m) => m.toLowerCase() === t.toLowerCase());
  if (meaningful) return meaningful;
  const label = String(block.name || block.label || '').trim();
  if (label && !GENERIC_BLOCK_LABELS.has(label.toLowerCase()) && !/^block\s*\d*$/i.test(label)) {
    return label;
  }
  return 'Tabata';
}

/** Composite preview-section title, e.g. "Superset + Tabata". */
export function sectionTitle(section: PreviewSectionBlock[]): string {
  const descriptors: string[] = [];
  section.forEach(({ block }) => {
    const d = sectionDescriptor(block);
    if (!descriptors.includes(d)) descriptors.push(d);
  });
  return descriptors.join(' + ') || 'Workout';
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
    case 'Follow-Along Video': return 'followAlongVideo';
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
        const duration =
          blockType === 'Follow-Along Video'
            ? (block.videoDurationSec ?? block.durationSec ?? 0)
            : (block.durationSec ?? (blockType === 'Intro' || blockType === 'Outro' ? 10 : (workout.restDurationSeconds ?? 30)));

        // For Demo blocks, look ahead to find the next exercise block's movements
        let demoMovements: FlatMovement['demoMovements'] = undefined;
        if (blockType === 'Demo') {
          for (let j = bi + 1; j < blocks.length; j++) {
            const nextBlock = blocks[j];
            if (!SPECIAL_BLOCK_TYPES.has(nextBlock.type || 'Circuit') && nextBlock.movements?.length > 1) {
              demoMovements = (nextBlock.movements || []).map((m: any) => ({
                name: m.movementName || m.name || 'Movement',
                thumbnailUrl: m.thumbnailUrl || '',
                posterUrl: m.posterUrl || '',
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
          grabEquipmentText: block.grabEquipmentText || '',
          grabEquipmentImageUrl: block.grabEquipmentImageUrl || undefined,
          isFullScreen: blockType === 'Intro' || blockType === 'Outro' || blockType === 'Follow-Along Video',
          originalBlockType: blockType,
          // Follow-Along Video: propagate sound + crop transform for the player
          ...(blockType === 'Follow-Along Video'
            ? {
                soundEnabled: block.soundEnabled !== false, // default ON
                cropScale: block.cropScale,
                cropTranslateX: block.cropTranslateX,
                cropTranslateY: block.cropTranslateY,
                cropFrameWidth: block.cropFrameWidth,
                cropFrameHeight: block.cropFrameHeight,
              }
            : {}),
        });
        return;
      }

      // ── Auto-insert pre-sequence phases (demo and/or grabEquipment) ─────────
      // blockPreSequence controls the order; defaults to ['demo', 'grabEquipment'].
      // Only emits a phase for entries whose toggle is on.
      // circuitStartRestSec is intentionally excluded here — it fires after demo/grabEquipment.
      {
        const preSequence: ('demo' | 'grabEquipment')[] =
          (block.blockPreSequence && block.blockPreSequence.length > 0)
            ? block.blockPreSequence
            : ['demo', 'grabEquipment'];

        for (const entry of preSequence) {
          if (entry === 'demo' && block.showDemo) {
            const demoMvs = (block.movements || []).map((m: any) => ({
              name: m.movementName || m.name || 'Movement',
              thumbnailUrl: m.thumbnailUrl || '',
              posterUrl: m.posterUrl || '',
              videoUrl: m.videoUrl || m.mediaUrl || '',
              movementId: m.movementId || '',
            }));
            flat.push({
              name: block.label || block.name || `Block ${bi + 1}`,
              duration: block.demoDurationSec ?? 20,
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
          } else if (entry === 'grabEquipment' && block.showGrabEquipment) {
            flat.push({
              name: block.label || block.name || 'Grab Equipment',
              duration: block.grabEquipmentDurationSec ?? 15,
              restAfter: 0,
              blockName: block.label || block.name || `Block ${bi + 1}`,
              blockIndex: bi,
              movementIndex: 0,
              swapSides: false,
              description: '',
              stepType: 'grabEquipment',
              grabEquipmentText: block.grabEquipmentText || '',
              grabEquipmentImageUrl: block.grabEquipmentImageUrl || undefined,
              isFullScreen: false,
              originalBlockType: blockType,
            });
          }
        }
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

          // Insert a prep rest before the first movement of this round.
          // - If the previous flat step is a normal exercise step, attach prep to
          //   its restAfter (rest-shift pattern — what was "rest on the next
          //   movement" becomes "restAfter on the previous movement").
          // - If there's no previous step OR the previous step is a special-block
          //   phase (demo/intro/transition/etc.), those phases IGNORE restAfter and
          //   just auto-advance. Attaching prep there would silently drop it. In
          //   that case, insert a synthetic "Get Ready" prep step so the beginning
          //   rest plays as its own phase.
          const prevStep = flat.length > 0 ? flat[flat.length - 1] : null;
          const prevIsSpecial = !!prevStep && prevStep.stepType !== 'exercise';
          if (prepDuration > 0 && prevStep && !prevIsSpecial) {
            prevStep.restAfter = prepDuration;
          } else if (prepDuration > 0 && (!prevStep || prevIsSpecial)) {
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
              posterUrl: firstMv?.posterUrl || '',
              movementId: '',
              blockType: bType,
              supersetLabel: '',
              cropScale: 1,
              cropTranslateX: 0,
              cropTranslateY: 0,
              cropFrameWidth: 0,
              cropFrameHeight: 0,
              voiceUrl: '',
              blockMovCount: movements.length,
              blockRound: round,
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
              swapMode: mv.swapMode,
              swapWindowSec: mv.swapWindowSec,
              showOnPreview: mv.showOnPreview,
              description: mv.description || mv.coachingCues || mv.notes || '',
              sets: mv.sets,
              reps: mv.reps,
              weight: mv.weight,
              videoUrl: mv.videoUrl || mv.mediaUrl || '',
              thumbnailUrl: mv.thumbnailUrl || '',
              posterUrl: mv.posterUrl || '',
              coachingCues: mv.coachingCues || mv.notes || '',
              movementId: mv.movementId || '',
              supersetLabel: makeLabel(bi, mi),
              blockType: bType,
              stepType: 'exercise',
              originalBlockType: blockType,
              cropScale: mv.cropScale ?? 1,
              cropTranslateX: mv.cropTranslateX ?? 0,
              cropTranslateY: mv.cropTranslateY ?? 0,
              cropFrameWidth: mv.cropFrameWidth ?? 0,
              cropFrameHeight: mv.cropFrameHeight ?? 0,
              voiceUrl: mv.voiceUrl || '',
              prescriptionVoiceUrl: mv.prescriptionVoiceUrl || '',
              blockMovCount: movements.length,
              blockRound: round,
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

          // Prep rest before first movement of this set.
          // Same rule as circuit/superset: if previous step is a special-block
          // phase (demo/intro/etc.), insert a synthetic Get Ready instead of
          // attaching restAfter — special phases ignore restAfter.
          const firstPrep = ownRests[0] ?? 0;
          const prevStep = flat.length > 0 ? flat[flat.length - 1] : null;
          const prevIsSpecial = !!prevStep && prevStep.stepType !== 'exercise';
          if (firstPrep > 0 && prevStep && !prevIsSpecial) {
            prevStep.restAfter = firstPrep;
          } else if (firstPrep > 0 && (!prevStep || prevIsSpecial)) {
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
              posterUrl: firstMv?.posterUrl || '',
              movementId: '',
              blockType: 'linear',
              supersetLabel: '',
              cropScale: 1,
              cropTranslateX: 0,
              cropTranslateY: 0,
              cropFrameWidth: 0,
              cropFrameHeight: 0,
              voiceUrl: '',
              blockMovCount: movements.length,
              blockRound: setNum,
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
              swapMode: mv.swapMode,
              swapWindowSec: mv.swapWindowSec,
              showOnPreview: mv.showOnPreview,
              description: mv.description || mv.coachingCues || mv.notes || '',
              sets: mv.sets,
              reps: mv.reps,
              weight: mv.weight,
              videoUrl: mv.videoUrl || mv.mediaUrl || '',
              thumbnailUrl: mv.thumbnailUrl || '',
              posterUrl: mv.posterUrl || '',
              coachingCues: mv.coachingCues || mv.notes || '',
              movementId: mv.movementId || '',
              blockType: 'linear',
              stepType: 'exercise',
              originalBlockType: blockType,
              cropScale: mv.cropScale ?? 1,
              cropTranslateX: mv.cropTranslateX ?? 0,
              cropTranslateY: mv.cropTranslateY ?? 0,
              cropFrameWidth: mv.cropFrameWidth ?? 0,
              cropFrameHeight: mv.cropFrameHeight ?? 0,
              voiceUrl: mv.voiceUrl || '',
              prescriptionVoiceUrl: mv.prescriptionVoiceUrl || '',
              blockMovCount: movements.length,
              blockRound: setNum,
            });
          });
        }
      }
    });


    return flat;
  }, [workout]);
}
