/**
 * generateCountdownPhrase.ts
 *
 * Generates the end-of-phase countdown cues ("3, 2, 1. Rest." and
 * "3, 2, 1. Go.") as single combined gpt-4o-mini-tts clips via the same
 * generateVoice Cloud Function the "Next up" phrase uses. Shares the coach
 * style brief so the countdown matches the delivery of the rest of the
 * player instead of sounding like the older static MP3.
 *
 * Why one combined clip per cue and not countdown.mp3 + rest.mp3:
 *   The old flow enqueued two static MP3s back-to-back (countdown_3 →
 *   rest / go) with a queue gap between them. The seam was audible and the
 *   static rest/go voice did not match the OpenAI "Next up" delivery. One
 *   clip removes the seam and lets the model inflect the whole phrase as
 *   one breath with the same voice/style as every other cue.
 *
 * Storage path:  voice_cache/phrases/countdown-{voice}-{textHash}.mp3
 *   Phrase-keyed (no movement / workout id): every workout shares the same
 *   two clips. The hash is over voice + model + style version + phrase
 *   text, so a style-version bump produces fresh paths and fresh clips.
 *
 * Generation idempotency:
 *   The Cloud Function checks Storage existence at the path before calling
 *   OpenAI; a cached clip returns immediately. These two phrases are global
 *   — they cache after the very first workout load and stay cached for the
 *   life of this style version.
 *
 * On failure or while waiting:
 *   Returns { url: null, ... }. The caller (useCountdownPhrases) leaves
 *   the URL unset, and useWorkoutTTS falls back to the static countdown_3
 *   + rest / go MP3s — first-ever-load graceful degradation only.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { hashTtsText } from './normalizeTtsText';
import { COACH_STYLE_V, COUNTDOWN_STYLE_INSTRUCTIONS } from './coachStyleInstructions';

/** OpenAI voice — must match NEXT_UP_VOICE / MOVEMENT_VOICE_NAME for cohesion. */
export const COUNTDOWN_VOICE = 'nova' as const;

/** Only model that honours `instructions` — must match NEXT_UP_MODEL. */
export const COUNTDOWN_MODEL = 'gpt-4o-mini-tts' as const;

/** Cache-invalidation version — derived from the shared coach style version. */
export const COUNTDOWN_INSTRUCTIONS_V = COACH_STYLE_V;

export const COUNTDOWN_INSTRUCTIONS = COUNTDOWN_STYLE_INSTRUCTIONS;

/**
 * Countdown phrase variants the workout player needs.
 *   • rest — plays in the last seconds of a work phase to land "Rest" as the
 *     rest phase begins.
 *   • go   — plays in the last seconds of a rest phase to land "Go" as the
 *     next work phase begins.
 */
export type CountdownVariant = 'rest' | 'go';

const COUNTDOWN_PHRASE: Record<CountdownVariant, string> = {
  rest: '3, 2, 1. Rest.',
  go: '3, 2, 1. Go.',
};

export interface CountdownPhraseResult {
  variant: CountdownVariant;
  url: string | null;
  phrase: string;
  path: string | null;
  cached?: boolean;
}

/** Spoken phrase for a countdown variant. */
export function buildCountdownPhrase(variant: CountdownVariant): string {
  return COUNTDOWN_PHRASE[variant];
}

/** Storage path for a countdown variant's combined clip. */
export function buildCountdownStoragePath(variant: CountdownVariant): string {
  const phrase = COUNTDOWN_PHRASE[variant];
  const cacheKey = `${COUNTDOWN_VOICE}|${COUNTDOWN_MODEL}|${COUNTDOWN_INSTRUCTIONS_V}|${phrase}`;
  const hash = hashTtsText(cacheKey);
  return `voice_cache/phrases/countdown-${COUNTDOWN_VOICE}-${hash}.mp3`;
}

export async function generateCountdownPhrase(
  variant: CountdownVariant,
): Promise<CountdownPhraseResult> {
  const phrase = COUNTDOWN_PHRASE[variant];
  const storagePath = buildCountdownStoragePath(variant);

  try {
    const functions = getFunctions(undefined, 'us-central1');
    const generateVoice = httpsCallable<
      { text: string; voice: string; storagePath: string; model: string; instructions: string },
      { url: string; path: string; cached?: boolean }
    >(functions, 'generateVoice');

    console.info('[VOICE-AUDIT] generateCountdownPhrase calling generateVoice', {
      variant, phrase, voice: COUNTDOWN_VOICE, model: COUNTDOWN_MODEL, storagePath,
    });
    const result = await generateVoice({
      text: phrase,
      voice: COUNTDOWN_VOICE,
      model: COUNTDOWN_MODEL,
      instructions: COUNTDOWN_INSTRUCTIONS,
      storagePath,
    });
    console.info('[VOICE-AUDIT] generateCountdownPhrase resolved', {
      variant, urlPresent: !!result.data?.url, cached: result.data?.cached === true,
    });
    return {
      variant,
      url: result.data.url,
      phrase,
      path: storagePath,
      cached: result.data.cached === true,
    };
  } catch (err: any) {
    const details = err?.details ?? null;
    const layer = details && typeof details === 'object' ? (details as any).layer : null;
    console.warn('[VOICE-AUDIT] generateCountdownPhrase THREW', {
      variant, code: err?.code, message: err?.message, layer, details,
    });
    return { variant, url: null, phrase, path: storagePath };
  }
}
