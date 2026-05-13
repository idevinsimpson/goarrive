/**
 * generateTransitionPhrase.ts
 *
 * Generates the single SHARED rest→work transition clip used by the workout
 * player: "3, 2, 1. Go." (kind: 'restGo'). One Voicemaker ai3-Aria clip with
 * SSML break-tag pacing, stitched into a single coached breath so it sounds
 * intentional instead of a 3-clip ladder.
 *
 * The phrase kind is parameterized only because earlier iterations
 * pre-warmed additional shapes (workRestNext / workNext / nextUp /
 * workSwapOtherSide / per-window swap clips). Those were all dropped — when
 * a per-name or per-window combined clip failed to load/decode/play, the
 * suppression flag set at enqueue time silently blocked the static fallback
 * cues, leaving transitions silent for the rest of the workout. Static
 * countdown_3 + rest/go/other_side/switch_sides MP3s plus per-movement
 * OpenAI voiceUrl clips carry every other transition; each clip succeeds
 * or fails on its own with no shared point of failure.
 *
 * Storage path: voice_cache/phrases/transition-{providerSlug}-{textHash}.mp3
 *   Hash covers slug + template version + kind + full SSML text, so any
 *   timing tweak or voice swap busts the cache.
 *
 * On failure or while waiting: returns { url: null, ... }. The caller
 * (useTransitionPhrases) keeps the URL unset; useWorkoutTTS falls back to
 * the countdown_3 + go static cues.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { hashTtsText } from './normalizeTtsText';
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
 * "3, 2, 1" prefix with Devin-approved pacing. 200ms lead so the "3" doesn't
 * hit at the same instant as enqueue; 700ms between digits matches the
 * one-per-second visual countdown; 400ms after "1" before "Go" sits in the
 * natural pause before the transition word.
 */
const COUNTDOWN_PREFIX =
  '<break time="200ms"/>3<break time="700ms"/>2<break time="700ms"/>1<break time="400ms"/>';

export type TransitionPhraseKind = 'restGo';

export interface TransitionPhraseResult {
  url: string | null;
  phrase: string;
  path: string | null;
  cached?: boolean;
}

export function buildTransitionPhrase(kind: TransitionPhraseKind): string {
  if (kind === 'restGo') {
    return `${COUNTDOWN_PREFIX}Go.`;
  }
  return '';
}

export function buildTransitionStoragePath(kind: TransitionPhraseKind): string | null {
  const phrase = buildTransitionPhrase(kind);
  if (!phrase) return null;
  const cacheKey = `${TTS_VOICE_SLUG}|${TRANSITION_PHRASE_TEMPLATE_V}|${kind}|${phrase}`;
  const hash = hashTtsText(cacheKey);
  return `voice_cache/phrases/transition-${TTS_VOICE_SLUG}-${hash}.mp3`;
}

export async function generateTransitionPhrase(
  kind: TransitionPhraseKind,
): Promise<TransitionPhraseResult> {
  const phrase = buildTransitionPhrase(kind);
  const storagePath = buildTransitionStoragePath(kind);
  if (!phrase || !storagePath) {
    console.warn('[VOICE-AUDIT] generateTransitionPhrase skipped — empty phrase', {
      kind,
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
      code: err?.code,
      message: err?.message,
      layer,
      details,
    });
    return { url: null, phrase, path: storagePath };
  }
}
