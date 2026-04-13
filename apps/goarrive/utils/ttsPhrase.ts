/**
 * ttsPhrase.ts — Deterministic phrase system for workout TTS
 *
 * Generates a complete script of spoken cues from the flattened workout
 * timeline. No AI decides what to say — every phrase is deterministic
 * from the player state and movement data.
 *
 * Phrase types:
 *   PREP_NEXT        → "Next up, {movement}."
 *   GO               → "Go."
 *   HALFWAY          → "That's halfway."
 *   SWAP_SIDES       → "Swap sides."
 *   DEMO             → "Here's what's coming up."
 *   WATER_BREAK      → "Rest. Grab some water."
 *   TRANSITION       → "{instructionText}" or "Get ready."
 *   WORKOUT_COMPLETE → "Your GoArrive workout is complete. Great job."
 */

import { normalizeForSpeech, buildMovementPhrase } from './normalizeForSpeech';

// ── Event types ─────────────────────────────────────────────────────
export type TTSEvent =
  | 'PREP_NEXT'
  | 'GO'
  | 'HALFWAY'
  | 'SWAP_SIDES'
  | 'DEMO'
  | 'WATER_BREAK'
  | 'TRANSITION'
  | 'WORKOUT_COMPLETE';

// ── Phrase entry ────────────────────────────────────────────────────
export interface TTSPhrase {
  /** Which event triggers this phrase */
  event: TTSEvent;
  /** The exact text to send to OpenAI TTS */
  text: string;
  /** Deterministic cache key (content-addressable) */
  cacheKey: string;
}

// ── Static phrases (same every time) ────────────────────────────────
const STATIC_PHRASES: Record<string, string> = {
  GO: 'Go.',
  HALFWAY: "That's halfway.",
  SWAP_SIDES: 'Swap sides.',
  WATER_BREAK: 'Rest. Grab some water.',
  WORKOUT_COMPLETE: 'Your GoArrive workout is complete. Great job.',
  DEMO: "Here's what's coming up.",
};

// ── Cache key generation ────────────────────────────────────────────
// Simple deterministic hash — same text always produces the same key.
function hashText(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32-bit integer
  }
  // Convert to positive hex string
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function makeCacheKey(text: string): string {
  return `phrase_${hashText(text)}`;
}

// ── Phrase builders ─────────────────────────────────────────────────

/** Build the "Next up, {movement}" phrase */
export function buildPrepNextPhrase(
  movementName: string,
  weight?: string | number,
): TTSPhrase {
  const spoken = buildMovementPhrase(movementName, weight);
  const text = `Next up, ${spoken}.`;
  return { event: 'PREP_NEXT', text, cacheKey: makeCacheKey(text) };
}

/** Build a static phrase (GO, HALFWAY, etc.) */
export function buildStaticPhrase(event: TTSEvent): TTSPhrase {
  const text = STATIC_PHRASES[event] || '';
  return { event, text, cacheKey: makeCacheKey(text) };
}

/** Build a transition/equipment phrase from instruction text */
export function buildTransitionPhrase(instructionText?: string): TTSPhrase {
  const text = instructionText
    ? normalizeForSpeech(instructionText)
    : 'Get ready.';
  return { event: 'TRANSITION', text, cacheKey: makeCacheKey(text) };
}

// ── Full workout script generation ──────────────────────────────────

export interface FlatStep {
  name: string;
  stepType: string;
  swapSides?: boolean;
  duration?: number;
  instructionText?: string;
  demoMovements?: { name: string }[];
  weight?: string | number;
  [key: string]: any;
}

/**
 * Generate the complete set of unique phrases needed for a workout.
 * Returns a deduplicated list — each cacheKey appears only once.
 */
export function generateWorkoutPhrases(steps: FlatStep[]): TTSPhrase[] {
  const seen = new Set<string>();
  const phrases: TTSPhrase[] = [];

  function add(phrase: TTSPhrase) {
    if (!phrase.text || seen.has(phrase.cacheKey)) return;
    seen.add(phrase.cacheKey);
    phrases.push(phrase);
  }

  // Static phrases always needed
  add(buildStaticPhrase('GO'));
  add(buildStaticPhrase('HALFWAY'));
  add(buildStaticPhrase('SWAP_SIDES'));
  add(buildStaticPhrase('WATER_BREAK'));
  add(buildStaticPhrase('WORKOUT_COMPLETE'));
  add(buildStaticPhrase('DEMO'));

  // Dynamic phrases per step
  for (const step of steps) {
    if (step.stepType === 'exercise' && step.name && step.name !== 'Get Ready') {
      add(buildPrepNextPhrase(step.name, step.weight));
    }
    if (step.stepType === 'transition' || step.stepType === 'grabEquipment') {
      add(buildTransitionPhrase(step.instructionText));
    }
  }

  return phrases;
}

/**
 * Get the phrase that should play for a given player event.
 * Returns the TTSPhrase with the cacheKey needed to look up the audio clip.
 */
export function getPhraseForEvent(
  event: TTSEvent,
  movementName?: string,
  weight?: string | number,
  instructionText?: string,
): TTSPhrase {
  if (event === 'PREP_NEXT' && movementName) {
    return buildPrepNextPhrase(movementName, weight);
  }
  if (event === 'TRANSITION') {
    return buildTransitionPhrase(instructionText);
  }
  return buildStaticPhrase(event);
}
