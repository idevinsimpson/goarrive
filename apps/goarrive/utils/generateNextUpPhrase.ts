/**
 * generateNextUpPhrase.ts
 *
 * Generates a single combined "Next up, {movement name}." TTS clip via the
 * generateVoice Cloud Function. Uses gpt-4o-mini-tts so the OpenAI request
 * can carry style `instructions` (tts-1 ignores them), giving the phrase a
 * cohesive female-fitness-instructor delivery instead of two robotic clips.
 *
 * Why a phrase clip and not next_up MP3 + movement-name MP3:
 *   The old player enqueued the static "Next up" cue then the movement-name
 *   voiceUrl as two separate items. There was an unavoidable gap between
 *   them and they sounded like two sentences ("Next up." [pause] "Barbell
 *   Curl."). One clip removes the gap and lets OpenAI inflect the whole
 *   phrase as one breath.
 *
 * Storage path:  voice_cache/phrases/nextup-{voice}-{textHash}.mp3
 *   Phrase-keyed (no movementId): two movements with the same name share the
 *   same clip. The hash is over voice + model + instructions-version + the
 *   normalized phrase, so any of those changing produces a fresh path and a
 *   fresh clip — bump NEXT_UP_INSTRUCTIONS_V to invalidate the cache.
 *
 * Generation idempotency:
 *   The Cloud Function checks Storage existence at the path before calling
 *   OpenAI; a cached clip returns immediately. So pre-warming every movement
 *   on workout-open is cheap on subsequent loads of the same workout.
 *
 * On failure or while waiting:
 *   Returns { url: null, ... }. The caller (useNextUpPhrases) will keep the
 *   movement's nextUpVoiceUrl unset, and the player stays silent for that
 *   first encounter rather than falling back to device speech.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { normalizeTtsText, hashTtsText } from './normalizeTtsText';
import { COACH_STYLE_V, NEXT_UP_STYLE_INSTRUCTIONS } from './coachStyleInstructions';

/** OpenAI voice — must match MOVEMENT_VOICE_NAME for cohesion across the player. */
export const NEXT_UP_VOICE = 'nova' as const;

/**
 * gpt-4o-mini-tts is the smallest OpenAI TTS model that honors `instructions`
 * for style/delivery control. tts-1 / tts-1-hd ignore instructions entirely.
 */
export const NEXT_UP_MODEL = 'gpt-4o-mini-tts' as const;

/**
 * Cache-invalidation version for the "Next up" clip path. Derived from the
 * shared COACH_STYLE_V so tweaks to the base style brief invalidate every
 * phrase clip across the player in one move.
 */
export const NEXT_UP_INSTRUCTIONS_V = COACH_STYLE_V;

/**
 * Delivery instructions sent to gpt-4o-mini-tts for the "Next up" phrase.
 * Shared coach style brief + "Next up"-specific pacing, so this phrase
 * matches the delivery of the countdown phrase and every other cue.
 */
export const NEXT_UP_INSTRUCTIONS = NEXT_UP_STYLE_INSTRUCTIONS;

export interface NextUpPhraseResult {
  url: string | null;
  phrase: string;
  path: string | null;
  cached?: boolean;
}

/** Build the spoken phrase from a movement name. Empty string on bad input. */
export function buildNextUpPhrase(movementName: string): string {
  const normalized = normalizeTtsText(movementName);
  if (!normalized) return '';
  return `Next up, ${normalized}.`;
}

/** Build the storage path for the phrase clip. Null on bad input. */
export function buildNextUpStoragePath(movementName: string): string | null {
  const phrase = buildNextUpPhrase(movementName);
  if (!phrase) return null;
  const cacheKey = `${NEXT_UP_VOICE}|${NEXT_UP_MODEL}|${NEXT_UP_INSTRUCTIONS_V}|${phrase}`;
  const hash = hashTtsText(cacheKey);
  return `voice_cache/phrases/nextup-${NEXT_UP_VOICE}-${hash}.mp3`;
}

export async function generateNextUpPhrase(
  movementName: string,
): Promise<NextUpPhraseResult> {
  const phrase = buildNextUpPhrase(movementName);
  const storagePath = buildNextUpStoragePath(movementName);
  if (!phrase || !storagePath) {
    console.warn('[VOICE-AUDIT] generateNextUpPhrase skipped — empty phrase', { movementName });
    return { url: null, phrase, path: null };
  }

  try {
    const functions = getFunctions(undefined, 'us-central1');
    const generateVoice = httpsCallable<
      { text: string; voice: string; storagePath: string; model: string; instructions: string },
      { url: string; path: string; cached?: boolean }
    >(functions, 'generateVoice');

    console.info('[VOICE-AUDIT] generateNextUpPhrase calling generateVoice', {
      movementName, phrase, voice: NEXT_UP_VOICE, model: NEXT_UP_MODEL, storagePath,
    });
    const result = await generateVoice({
      text: phrase,
      voice: NEXT_UP_VOICE,
      model: NEXT_UP_MODEL,
      instructions: NEXT_UP_INSTRUCTIONS,
      storagePath,
    });
    console.info('[VOICE-AUDIT] generateNextUpPhrase resolved', {
      movementName, urlPresent: !!result.data?.url, cached: result.data?.cached === true,
    });
    return {
      url: result.data.url,
      phrase,
      path: storagePath,
      cached: result.data.cached === true,
    };
  } catch (err: any) {
    const details = err?.details ?? null;
    const layer = details && typeof details === 'object' ? (details as any).layer : null;
    console.warn('[VOICE-AUDIT] generateNextUpPhrase THREW', {
      movementName, code: err?.code, message: err?.message, layer, details,
    });
    return { url: null, phrase, path: storagePath };
  }
}
