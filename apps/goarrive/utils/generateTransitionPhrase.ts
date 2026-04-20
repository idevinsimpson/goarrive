/**
 * generateTransitionPhrase.ts
 *
 * Generates combined transition phrase clips that stitch the "3, 2, 1"
 * countdown together with the following cue word(s) into a SINGLE Voicemaker
 * ai3-Aria clip. This replaces the old pattern of queueing
 *   [countdown_3] → [rest] → [next-up phrase]
 * which sounded like three separate clips stitched together.
 *
 * Two phrase kinds:
 *   1. workRestNext(name)
 *      "<break 200ms/>3<break 700ms/>2<break 700ms/>1<break 400ms/>Rest.
 *       <break 400ms/>Next up: <break 100ms/>{name}."
 *   2. restGo()
 *      "<break 200ms/>3<break 700ms/>2<break 700ms/>1<break 400ms/>Go."
 *
 * Break tags are SSML that Voicemaker honors — they control pacing so the
 * clip plays as one coached breath.
 *
 * Storage path: voice_cache/phrases/transition-{providerSlug}-{textHash}.mp3
 *   Hash covers slug + template version + kind + full SSML text, so any
 *   timing tweak or voice swap busts the cache. Kind is in the hash so the
 *   single "restGo" clip and per-movement "workRestNext" clips never collide.
 *
 * On failure or while waiting: returns { url: null, ... }. The caller
 * (useTransitionPhrases) keeps the URL unset; useWorkoutTTS falls back to
 * the original countdown_3 + rest/go + next-up sequence.
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

/** Bump to invalidate cached transition clips after a pacing/template change. */
export const TRANSITION_PHRASE_TEMPLATE_V = 'v1';

/**
 * Shared "3, 2, 1" prefix with Devin-approved pacing. 200ms lead so the "3"
 * doesn't hit at the same instant as enqueue; 700ms between digits matches
 * the one-per-second visual countdown; 400ms after "1" before the following
 * word (Rest / Go) sits in the natural pause before the transition word.
 */
const COUNTDOWN_PREFIX =
  '<break time="200ms"/>3<break time="700ms"/>2<break time="700ms"/>1<break time="400ms"/>';

export type TransitionPhraseKind = 'workRestNext' | 'restGo';

export interface TransitionPhraseResult {
  url: string | null;
  phrase: string;
  path: string | null;
  cached?: boolean;
}

export function buildTransitionPhrase(
  kind: TransitionPhraseKind,
  movementName?: string,
): string {
  if (kind === 'restGo') {
    return `${COUNTDOWN_PREFIX}Go.`;
  }
  const normalized = normalizeTtsText(movementName || '');
  if (!normalized) return '';
  return `${COUNTDOWN_PREFIX}Rest. <break time="400ms"/>Next up: <break time="100ms"/>${normalized}.`;
}

export function buildTransitionStoragePath(
  kind: TransitionPhraseKind,
  movementName?: string,
): string | null {
  const phrase = buildTransitionPhrase(kind, movementName);
  if (!phrase) return null;
  const cacheKey = `${TTS_VOICE_SLUG}|${TRANSITION_PHRASE_TEMPLATE_V}|${kind}|${phrase}`;
  const hash = hashTtsText(cacheKey);
  return `voice_cache/phrases/transition-${TTS_VOICE_SLUG}-${hash}.mp3`;
}

export async function generateTransitionPhrase(
  kind: TransitionPhraseKind,
  movementName?: string,
): Promise<TransitionPhraseResult> {
  const phrase = buildTransitionPhrase(kind, movementName);
  const storagePath = buildTransitionStoragePath(kind, movementName);
  if (!phrase || !storagePath) {
    console.warn('[VOICE-AUDIT] generateTransitionPhrase skipped — empty phrase', {
      kind,
      movementName,
    });
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

    console.info('[VOICE-AUDIT] generateTransitionPhrase calling generateVoice', {
      kind,
      movementName,
      phrase,
      provider: TTS_PROVIDER,
      voice: TTS_VOICE_ID,
      effect: TTS_VOICE_EFFECT,
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
    console.info('[VOICE-AUDIT] generateTransitionPhrase resolved', {
      kind,
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
    console.warn('[VOICE-AUDIT] generateTransitionPhrase THREW', {
      kind,
      movementName,
      code: err?.code,
      message: err?.message,
      layer,
      details,
    });
    return { url: null, phrase, path: storagePath };
  }
}
