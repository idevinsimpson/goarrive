/**
 * coachStyleInstructions — Single source of truth for every spoken workout-
 * player cue generated via OpenAI gpt-4o-mini-tts.
 *
 * Every phrase clip (countdown, next-up, halfway, water, demo) reads voice +
 * model + instructions version + delivery brief from this file so the whole
 * player sounds like one coach — same voice, same vibe, same pacing, same
 * energy — instead of each cue drifting into its own take.
 *
 * How cache busting works:
 *   The storagePath for every generated clip is hashed over
 *   voice + model + COACH_STYLE_V + phrase text. Bumping COACH_STYLE_V
 *   changes every hash and forces a fresh OpenAI generation on next workout
 *   load. Bump on any delivery-brief edit — otherwise old rushed or
 *   off-style clips stay in Storage and get replayed forever.
 *
 * Consistency levers baked into the base brief:
 *   • "same coach in a series of identical-style cues" — tells the model not
 *     to vary delivery from one cue to the next, which was the main cause of
 *     the random "upbeat take / flat take" drift between movements.
 *   • Explicit rejects (no ascending excitement, no question-like upturn, no
 *     sing-song, no whispered meditation) remove the specific failure modes
 *     that came back in early takes.
 *   • Pacing adjectives are concrete ("medium, steady, grounded") instead of
 *     vague ("upbeat"), because vague adjectives read as "be more animated"
 *     and invite emphasis drift.
 */

/** OpenAI voice shared by every generated cue. */
export const COACH_VOICE = 'nova' as const;

/**
 * Only OpenAI TTS model that honours `instructions`. tts-1 / tts-1-hd ignore
 * them entirely, so every generated cue must use this model to pick up the
 * delivery brief.
 */
export const COACH_MODEL = 'gpt-4o-mini-tts' as const;

/**
 * Bump on ANY edit to any style string below to force every cached clip to
 * regenerate. Version is embedded in the storage path hash for every phrase
 * so old clips with the wrong pacing/style are never reused.
 *
 * History:
 *   v1 — initial style brief
 *   v2 — tightened phrase-level pacing after "Banded Pushups" upbeat drift
 *   v3 — one-count-per-second countdown pacing + unified cue coverage
 *         (halfway / water / demo / swap-sides all move to OpenAI)
 */
export const COACH_STYLE_V = 'v3';

const COACH_STYLE_BASE = [
  'Voice: a female fitness instructor — premium online coach running a structured workout.',
  'Delivery: even, predictable, and grounded. Treat this as one line in a long series of identical-style cues throughout the workout; do not emphasise any single movement name or phrase more than the others.',
  'Tone: clear, confident, warm, steady. Not hype. Not dramatic. Not sing-song. Not cheerleading.',
  'Pacing: medium and steady. Do not accelerate. Do not trail off.',
  'Avoid: robotic, flat, exaggerated enthusiasm, ascending excitement, question-like upward inflection, meditation-narrator softness, whisper, breathy.',
].join(' ');

/**
 * Countdown pacing brief for the combined "3, 2, 1. {Rest|Go|Swap sides}."
 * clips. The phrase text for these cues is deliberately formatted as four
 * short lines (one number per line) because gpt-4o-mini-tts respects line
 * breaks as paragraph-level pauses, but the instruction below is the main
 * lever — it tells the model the cadence must feel like a real trainer
 * counting down to a transition, not one quick run-together phrase.
 */
export const COUNTDOWN_STYLE_INSTRUCTIONS =
  COACH_STYLE_BASE +
  ' Phrase pacing: this is a real workout countdown, not a single phrase.'
  + ' Count one number per second. Say "3", pause a full beat of silence, say "2", pause a full beat of silence, say "1", then one more natural beat and land the final word ("Rest", "Go", or "Swap sides") firmly and cleanly.'
  + ' Do NOT run "3, 2, 1" together as one quick phrase. Do NOT rush. Do NOT drag. Do NOT shout the final word.'
  + ' Every number gets the same weight and the same one-second spacing.';

/** Style brief for the combined "Next up, {movement name}." phrase clip. */
export const NEXT_UP_STYLE_INSTRUCTIONS =
  COACH_STYLE_BASE +
  ' Phrase pacing: speak "Next up," then the movement name as one smooth phrase with no hard pause between them. End with a firm, natural stop.';

/** Style brief for the "That's halfway." mid-set check-in. */
export const HALFWAY_STYLE_INSTRUCTIONS =
  COACH_STYLE_BASE +
  ' Phrase pacing: a quick, matter-of-fact mid-set check-in. One smooth phrase, firm stop at the end. Not celebratory, not hyped — just the same coach noting the halfway mark.';

/** Style brief for the "Grab some water." rest-block cue. */
export const WATER_STYLE_INSTRUCTIONS =
  COACH_STYLE_BASE +
  ' Phrase pacing: one calm, grounded instruction. Short and clean, natural stop at the end. No softness or meditation vibe — still the same coach, just in a recovery moment.';

/** Style brief for the "Here's what's coming up." demo-block prelude. */
export const DEMO_STYLE_INSTRUCTIONS =
  COACH_STYLE_BASE +
  ' Phrase pacing: one composed, informational phrase introducing what the member is about to see. Firm stop at the end. Not dramatic, not a teaser — the same coach setting up the next block.';
