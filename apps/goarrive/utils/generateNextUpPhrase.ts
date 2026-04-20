/**
 * generateNextUpPhrase.ts
 *
 * Generates a single combined "Next up, {movement name}." TTS clip via the
 * generateVoice Cloud Function. Provider/voice/effect come from
 * ttsProviderConfig (currently Voicemaker ai3-Aria, friendly effect).
 *
 * Why a single phrase clip and not next_up MP3 + movement-name MP3:
 *   The old player enqueued the static "Next up" cue then the movement-name
 *   voiceUrl as two separate items. There was an unavoidable gap between
 *   them and they sounded like two sentences ("Next up." [pause] "Barbell
 *   Curl."). One clip removes the gap and lets the provider inflect the
 *   whole phrase as one breath.
 *
 * Break-tag pacing (Voicemaker only):
 *   `Next up, <break time="100ms"/>{movement name}.`
 *   The 100ms pause keeps the comma feel without splitting the cue into two
 *   sentences. If it sounds too separated, drop to 50ms or remove the break.
 *   Break tags are passed through to Voicemaker unmodified — they're SSML the
 *   provider honors. They are NOT sent on the OpenAI fallback path (OpenAI's
 *   tts-1 / gpt-4o-mini-tts don't honor break tags and would speak them out
 *   loud or strip them silently).
 *
 * Storage path: voice_cache/phrases/nextup-{providerSlug}-{textHash}.mp3
 *   Provider+voiceId+effect baked into the slug so swapping any of them
 *   produces a fresh path and a fresh clip — Voicemaker phrases never collide
 *   with old OpenAI nova phrases. The hash covers the slug + the *full TTS
 *   input* (including break tags), so any timing tweak invalidates old clips.
 *
 * Generation idempotency:
 *   The Cloud Function checks Storage existence at the path before calling
 *   the provider; a cached clip returns immediately. So pre-warming every
 *   movement on workout-open is cheap on subsequent loads of the same workout.
 *
 * On failure or while waiting:
 *   Returns { url: null, ... }. The caller (useNextUpPhrases) will keep the
 *   movement's nextUpVoiceUrl unset, and the player stays silent for that
 *   first encounter rather than falling back to device speech.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { normalizeTtsText, hashTtsText } from './normalizeTtsText';
import {
  TTS_PROVIDER,
  TTS_VOICE_ID,
  TTS_VOICE_EFFECT,
  TTS_VOICE_SLUG,
  TTS_ENGINE,
  TTS_LANGUAGE_CODE,
  TTS_SAMPLE_RATE,
  TTS_MASTER_SPEED,
  TTS_MASTER_PITCH,
  TTS_MASTER_VOLUME,
  TTS_FILE_STORE_HOURS,
} from './ttsProviderConfig';

/** Voice id used for the next-up phrase. Mirrors MOVEMENT_VOICE_NAME for cohesion. */
export const NEXT_UP_VOICE = TTS_VOICE_ID;

/**
 * Bump on any change to NEXT_UP_PHRASE_TEMPLATE_V to force a cache refresh.
 * Old clips remain in storage at their old hash but are no longer referenced.
 */
export const NEXT_UP_PHRASE_TEMPLATE_V = 'v2';

/**
 * Pause inserted between "Next up," and the movement name. 100ms reads as a
 * natural comma without making the two halves feel disconnected.
 */
const NEXT_UP_BREAK_MS = 100;

export interface NextUpPhraseResult {
  url: string | null;
  phrase: string;
  path: string | null;
  cached?: boolean;
}

/**
 * Build the spoken phrase from a movement name. Returns the *full TTS input*
 * including the SSML break tag — that's what Voicemaker speaks and what we
 * hash for the cache key. Empty string on bad input.
 */
export function buildNextUpPhrase(movementName: string): string {
  const normalized = normalizeTtsText(movementName);
  if (!normalized) return '';
  return `Next up, <break time="${NEXT_UP_BREAK_MS}ms"/>${normalized}.`;
}

/** Build the storage path for the phrase clip. Null on bad input. */
export function buildNextUpStoragePath(movementName: string): string | null {
  const phrase = buildNextUpPhrase(movementName);
  if (!phrase) return null;
  const cacheKey = `${TTS_VOICE_SLUG}|${NEXT_UP_PHRASE_TEMPLATE_V}|${phrase}`;
  const hash = hashTtsText(cacheKey);
  return `voice_cache/phrases/nextup-${TTS_VOICE_SLUG}-${hash}.mp3`;
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
      {
        text: string;
        voice: string;
        storagePath: string;
        provider: string;
        engine: string;
        languageCode: string;
        sampleRate: string;
        effect: string;
        masterSpeed: string;
        masterPitch: string;
        masterVolume: string;
        fileStore: number;
      },
      { url: string; path: string; cached?: boolean; provider?: string }
    >(functions, 'generateVoice');

    console.info('[VOICE-AUDIT] generateNextUpPhrase calling generateVoice', {
      movementName, phrase,
      provider: TTS_PROVIDER, voice: TTS_VOICE_ID, effect: TTS_VOICE_EFFECT,
      storagePath,
    });
    const result = await generateVoice({
      text: phrase,
      voice: TTS_VOICE_ID,
      storagePath,
      provider: TTS_PROVIDER,
      engine: TTS_ENGINE,
      languageCode: TTS_LANGUAGE_CODE,
      sampleRate: TTS_SAMPLE_RATE,
      effect: TTS_VOICE_EFFECT,
      masterSpeed: TTS_MASTER_SPEED,
      masterPitch: TTS_MASTER_PITCH,
      masterVolume: TTS_MASTER_VOLUME,
      fileStore: TTS_FILE_STORE_HOURS,
    });
    console.info('[VOICE-AUDIT] generateNextUpPhrase resolved', {
      movementName,
      provider: result.data?.provider ?? TTS_PROVIDER,
      urlPresent: !!result.data?.url,
      cached: result.data?.cached === true,
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
