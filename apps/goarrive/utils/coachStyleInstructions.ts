/**
 * coachStyleInstructions — Shared gpt-4o-mini-tts delivery brief.
 *
 * Used by every phrase clip the workout player generates (Next up, countdown)
 * so the voice sounds like the same coach in the same workout instead of
 * randomly hyped on one phrase and flat on another.
 *
 * Keep this single-source. Bump COACH_STYLE_V on any edit to invalidate every
 * cached clip across the player.
 *
 * Consistency levers:
 *   • "same coach in a series of identical-style cues" tells the model not to
 *     vary delivery between movements — the biggest cause of the random
 *     "Banded Pushups" upbeat take vs. flat "Bulgarian Split Squat" take.
 *   • Explicit rejects (no ascending excitement, no question-like upturn,
 *     no sing-song) remove the specific inflection failure modes we saw.
 *   • Pacing is spelled out as "medium, steady" not just "upbeat" — adjectives
 *     like "upbeat" read as "be more animated" and invite emphasis drift.
 */

/** Bump on any edit to COACH_STYLE_BASE to force every phrase clip to regenerate. */
export const COACH_STYLE_V = 'v2';

const COACH_STYLE_BASE = [
  'Voice: a female fitness instructor — premium online coach running a structured workout.',
  'Delivery: even, predictable, and consistent from one cue to the next. Treat this as one line in a long series of identical-style cues throughout the workout; do not emphasise any single movement name or phrase more than the others.',
  'Tone: clear, confident, warm, steady. Not hype. Not dramatic. Not sing-song. Not cheerleading.',
  'Pacing: medium and steady. Do not accelerate. Do not trail off.',
  'Avoid: robotic, flat, exaggerated enthusiasm, ascending excitement, question-like upward inflection, meditation-narrator softness, whisper, breathy.',
].join(' ');

/** Style brief for the combined "Next up, {movement name}." phrase clip. */
export const NEXT_UP_STYLE_INSTRUCTIONS =
  COACH_STYLE_BASE +
  ' Phrase pacing: speak "Next up," then the movement name as one smooth phrase with no hard pause between them. End with a firm, natural stop.';

/** Style brief for the combined "3, 2, 1. Rest." / "3, 2, 1. Go." countdown clip. */
export const COUNTDOWN_STYLE_INSTRUCTIONS =
  COACH_STYLE_BASE +
  ' Phrase pacing: count "3, 2, 1" at a steady one-per-second cadence, short natural beat, then land the final word ("Rest" or "Go") firmly and cleanly. Do not rush. Do not drag. Do not shout the final word.';
