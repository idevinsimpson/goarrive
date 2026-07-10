"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizePlayerMovement = sanitizePlayerMovement;
exports.sanitizePlayerBlock = sanitizePlayerBlock;
exports.sanitizePlayerWorkout = sanitizePlayerWorkout;
function sanitizePlayerMovement(m, canonical) {
    var _a, _b, _c, _d, _e, _f, _g;
    // Canonical voiceUrl + name win for audio/identity so a rename or
    // re-recording in the library propagates to share-link viewers.
    const resolvedName = ((canonical === null || canonical === void 0 ? void 0 : canonical.name) && canonical.name.trim())
        || m.movementName
        || m.name
        || '';
    const resolvedVoiceUrl = (canonical === null || canonical === void 0 ? void 0 : canonical.voiceUrl) || m.voiceUrl || null;
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
        swapSides: (_a = m.swapSides) !== null && _a !== void 0 ? _a : false,
        swapMode: (_b = m.swapMode) !== null && _b !== void 0 ? _b : 'split',
        swapWindowSec: (_c = m.swapWindowSec) !== null && _c !== void 0 ? _c : 5,
        showOnPreview: (_d = m.showOnPreview) !== null && _d !== void 0 ? _d : true,
        description: m.description || '',
        coachingCues: m.coachingCues || '',
        notes: m.notes || '',
        cropScale: (_e = m.cropScale) !== null && _e !== void 0 ? _e : 1,
        cropTranslateX: (_f = m.cropTranslateX) !== null && _f !== void 0 ? _f : 0,
        cropTranslateY: (_g = m.cropTranslateY) !== null && _g !== void 0 ? _g : 0,
    };
}
function sanitizePlayerBlock(block, movementCanonical) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    return {
        type: block.type || 'Block',
        name: block.name || '',
        label: block.label || '',
        description: block.description || '',
        movements: (block.movements || []).map((m) => sanitizePlayerMovement(m, m.movementId ? movementCanonical[m.movementId] : undefined)),
        restBetweenSets: block.restBetweenSets || 0,
        restBetweenSec: block.restBetweenSec || 0,
        restBetweenRoundsSec: block.restBetweenRoundsSec || 0,
        restBetweenMovementsSec: block.restBetweenMovementsSec || 0,
        circuitStartRestSec: block.circuitStartRestSec || 0,
        rest: (_a = block.rest) !== null && _a !== void 0 ? _a : null,
        rounds: block.rounds || 1,
        sets: (_b = block.sets) !== null && _b !== void 0 ? _b : null,
        showDemo: (_c = block.showDemo) !== null && _c !== void 0 ? _c : false,
        demoDurationSec: block.demoDurationSec || 0,
        showGrabEquipment: (_d = block.showGrabEquipment) !== null && _d !== void 0 ? _d : false,
        grabEquipmentDurationSec: (_e = block.grabEquipmentDurationSec) !== null && _e !== void 0 ? _e : null,
        blockPreSequence: Array.isArray(block.blockPreSequence) ? block.blockPreSequence : null,
        // Special blocks (Intro/Outro/Transition/Water Break/Grab Equipment/
        // Follow-Along Video) — durations, media, and instruction fields.
        // durationSec stays null (not 0) when unset so the flattener's
        // `?? default` fallbacks still apply.
        durationSec: (_f = block.durationSec) !== null && _f !== void 0 ? _f : null,
        videoDurationSec: (_g = block.videoDurationSec) !== null && _g !== void 0 ? _g : null,
        videoUrl: block.videoUrl || null,
        instructionText: block.instructionText || '',
        grabEquipmentText: block.grabEquipmentText || '',
        grabEquipmentImageUrl: block.grabEquipmentImageUrl || null,
        // Follow-Along Video: audio + crop transform
        soundEnabled: block.soundEnabled !== false,
        cropScale: (_h = block.cropScale) !== null && _h !== void 0 ? _h : null,
        cropTranslateX: (_j = block.cropTranslateX) !== null && _j !== void 0 ? _j : null,
        cropTranslateY: (_k = block.cropTranslateY) !== null && _k !== void 0 ? _k : null,
        cropFrameWidth: (_l = block.cropFrameWidth) !== null && _l !== void 0 ? _l : null,
        cropFrameHeight: (_m = block.cropFrameHeight) !== null && _m !== void 0 ? _m : null,
    };
}
/** Workout-level fields the player pipeline reads (beyond blocks). */
function sanitizePlayerWorkout(workout, movementCanonical) {
    var _a;
    return {
        name: workout.name || 'Workout',
        description: workout.description || '',
        category: workout.category || null,
        difficulty: workout.difficulty || null,
        estimatedDurationMin: workout.estimatedDurationMin || null,
        tags: workout.tags || [],
        introVideoUrl: workout.introVideoUrl || null,
        outroVideoUrl: workout.outroVideoUrl || null,
        restDurationSeconds: (_a = workout.restDurationSeconds) !== null && _a !== void 0 ? _a : null,
        blocks: (workout.blocks || []).map((b) => sanitizePlayerBlock(b, movementCanonical)),
    };
}
//# sourceMappingURL=workoutPlayerSanitizer.js.map