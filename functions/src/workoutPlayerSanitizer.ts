/**
 * Canonical allowlist serializer for workout data sent to share-link viewers.
 *
 * This is the SINGLE source of truth for which block/movement fields the
 * WorkoutPlayer pipeline consumes. It is a security sanitizer: share links are
 * served to unauthenticated viewers, so fields must be explicitly listed here
 * — never spread the raw Firestore doc.
 *
 * Consumers of these fields live in the app:
 *   - apps/goarrive/hooks/useWorkoutFlatten.ts  (reads block + movement fields)
 *   - apps/goarrive/components/WorkoutPlayer.tsx (+ useWorkoutTimer/useWorkoutTTS)
 * If you add a field read in the flattener or player, add it here too —
 * otherwise share-link viewers silently lose it (coach preview and member play
 * pass the full doc, so the bug only shows on share links).
 */

export interface CanonicalMovement {
  voiceUrl: string;
  name: string;
}

export function sanitizePlayerMovement(
  m: any,
  canonical?: CanonicalMovement,
): Record<string, any> {
  // Canonical voiceUrl + name win for audio/identity so a rename or
  // re-recording in the library propagates to share-link viewers.
  const resolvedName = (canonical?.name && canonical.name.trim())
    || m.movementName
    || m.name
    || '';
  const resolvedVoiceUrl = canonical?.voiceUrl || m.voiceUrl || null;
  return {
    movementId: m.movementId || '',
    movementName: resolvedName,
    name: resolvedName,
    category: m.category || '',
    muscleGroup: m.muscleGroup || '',
    videoUrl: m.videoUrl || null,
    mediaUrl: m.mediaUrl || null,
    thumbnailUrl: m.thumbnailUrl || null,
    posterUrl: m.posterUrl || null,
    voiceUrl: resolvedVoiceUrl,
    nextUpVoiceUrl: m.nextUpVoiceUrl || null,
    prescriptionVoiceUrl: m.prescriptionVoiceUrl || null,
    sets: m.sets || 0,
    reps: m.reps || '',
    weight: m.weight || '',
    duration: m.duration || 0,
    durationSec: m.durationSec || 0,
    workSec: m.workSec || 0,
    restSec: m.restSec || 0,
    restSeconds: m.restSeconds || 0,
    swapSides: m.swapSides ?? false,
    swapMode: m.swapMode ?? 'split',
    swapWindowSec: m.swapWindowSec ?? 5,
    showOnPreview: m.showOnPreview ?? true,
    description: m.description || '',
    coachingCues: m.coachingCues || '',
    notes: m.notes || '',
    cropScale: m.cropScale ?? 1,
    cropTranslateX: m.cropTranslateX ?? 0,
    cropTranslateY: m.cropTranslateY ?? 0,
  };
}

export function sanitizePlayerBlock(
  block: any,
  movementCanonical: Record<string, CanonicalMovement>,
): Record<string, any> {
  return {
    type: block.type || 'Block',
    name: block.name || '',
    label: block.label || '',
    description: block.description || '',
    movements: (block.movements || []).map((m: any) =>
      sanitizePlayerMovement(m, m.movementId ? movementCanonical[m.movementId] : undefined),
    ),
    restBetweenSets: block.restBetweenSets || 0,
    restBetweenSec: block.restBetweenSec || 0,
    restBetweenRoundsSec: block.restBetweenRoundsSec || 0,
    restBetweenMovementsSec: block.restBetweenMovementsSec || 0,
    circuitStartRestSec: block.circuitStartRestSec || 0,
    rest: block.rest ?? null,
    rounds: block.rounds || 1,
    sets: block.sets ?? null,
    showDemo: block.showDemo ?? false,
    demoDurationSec: block.demoDurationSec || 0,
    showGrabEquipment: block.showGrabEquipment ?? false,
    grabEquipmentDurationSec: block.grabEquipmentDurationSec ?? null,
    blockPreSequence: Array.isArray(block.blockPreSequence) ? block.blockPreSequence : null,
    // Special blocks (Intro/Outro/Transition/Water Break/Grab Equipment/
    // Follow-Along Video) — durations, media, and instruction fields.
    // durationSec stays null (not 0) when unset so the flattener's
    // `?? default` fallbacks still apply.
    durationSec: block.durationSec ?? null,
    videoDurationSec: block.videoDurationSec ?? null,
    videoUrl: block.videoUrl || null,
    instructionText: block.instructionText || '',
    grabEquipmentText: block.grabEquipmentText || '',
    grabEquipmentImageUrl: block.grabEquipmentImageUrl || null,
    // Follow-Along Video: audio + crop transform
    soundEnabled: block.soundEnabled !== false,
    cropScale: block.cropScale ?? null,
    cropTranslateX: block.cropTranslateX ?? null,
    cropTranslateY: block.cropTranslateY ?? null,
    cropFrameWidth: block.cropFrameWidth ?? null,
    cropFrameHeight: block.cropFrameHeight ?? null,
  };
}

/** Workout-level fields the player pipeline reads (beyond blocks). */
export function sanitizePlayerWorkout(
  workout: any,
  movementCanonical: Record<string, CanonicalMovement>,
): Record<string, any> {
  return {
    name: workout.name || 'Workout',
    description: workout.description || '',
    category: workout.category || null,
    difficulty: workout.difficulty || null,
    estimatedDurationMin: workout.estimatedDurationMin || null,
    tags: workout.tags || [],
    introVideoUrl: workout.introVideoUrl || null,
    outroVideoUrl: workout.outroVideoUrl || null,
    restDurationSeconds: workout.restDurationSeconds ?? null,
    blocks: (workout.blocks || []).map((b: any) => sanitizePlayerBlock(b, movementCanonical)),
  };
}
