/**
 * generateCountdownPhrase.ts
 *
 * Generates the three combined countdown cues — "3, 2, 1. Rest.",
 * "3, 2, 1. Go.", and "3, 2, 1. Swap sides." — as single gpt-4o-mini-tts
 * clips via the generateVoice Cloud Function. Every cue pulls voice + model +
 * style version + delivery brief from coachStyleInstructions.ts so the whole
 * player sounds like the same coach.
 *
 * Why one combined clip per cue and not countdown.mp3 + rest.mp3:
 *   The old flow enqueued two static MP3s back-to-back (countdown_3 →
 *   rest / go) with a queue gap between them. The seam was audible and the
 *   static rest/go voice did not match the OpenAI "Next up" delivery. One
 *   clip removes the seam and lets the model inflect the whole phrase as
 *   one breath with the same voice/style as every other cue.
 *
 * Why the phrase text uses line breaks ("3.\n2.\n1.\nRest."):
 *   gpt-4o-mini-tts respects line breaks as paragraph-level pauses. Combined
 *   with the "count one number per second, full beat of silence between each
 *   number" instruction in COUNTDOWN_STYLE_INSTRUCTIONS, the model produces
 *   a real workout countdown cadence instead of running "3, 2, 1" together
 *   as one quick phrase. Previous versions used "3, 2, 1. Rest." (commas +
 *   period) which the model chained into one breath — too rushed.
 *
 * Storage path:  voice_cache/phrases/countdown-{voice}-{textHash}.mp3
 *   Phrase-keyed (no movement / workout id): every workout shares the same
 *   three clips. The hash is over voice + model + style version + phrase
 *   text, so a style-version bump produces fresh paths and fresh clips.
 *
 * Generation idempotency:
 *   The Cloud Function checks Storage existence at the path before calling
 *   OpenAI; a cached clip returns immediately. These three phrases are
 *   global — they cache after the very first workout load and stay cached
 *   for the life of the current style version.
 *
 * On failure or while waiting:
 *   Returns { url: null, ... }. The caller (useCountdownPhrases) leaves
 *   the URL unset, and useWorkoutTTS falls back to the legacy static
 *   countdown_3 + rest / go / switch_sides MP3s — first-ever-load graceful
 *   degradation only.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { hashTtsText } from './normalizeTtsText';
import {
  COACH_MODEL,
  COACH_STYLE_V,
  COACH_VOICE,
  COUNTDOWN_STYLE_INSTRUCTIONS,
} from './coachStyleInstructions';

/**
 * Countdown phrase variants the workout player needs.
 *   • rest — plays in the last seconds of a work phase to land "Rest" as
 *     the rest phase begins.
 *   • go   — plays in the last seconds of a rest phase to land "Go" as the
 *     next work phase begins.
 *   • swap — plays in the last seconds of the L-side work phase to land
 *     "Swap sides" as the bilateral swap phase begins.
 */
export type CountdownVariant = 'rest' | 'go' | 'swap';

// Line breaks + periods push the model into a real countdown cadence; the
// instruction in COUNTDOWN_STYLE_INSTRUCTIONS is the authoritative pacing
// lever, but the formatted text reinforces it at the input layer.
const COUNTDOWN_PHRASE: Record<CountdownVariant, string> = {
  rest: '3.\n2.\n1.\nRest.',
  go: '3.\n2.\n1.\nGo.',
  swap: '3.\n2.\n1.\nSwap sides.',
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
  const cacheKey = `${COACH_VOICE}|${COACH_MODEL}|${COACH_STYLE_V}|${phrase}`;
  const hash = hashTtsText(cacheKey);
  return `voice_cache/phrases/countdown-${COACH_VOICE}-${hash}.mp3`;
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
      variant, phrase, voice: COACH_VOICE, model: COACH_MODEL, storagePath,
    });
    const result = await generateVoice({
      text: phrase,
      voice: COACH_VOICE,
      model: COACH_MODEL,
      instructions: COUNTDOWN_STYLE_INSTRUCTIONS,
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
