/**
 * generateTransitionPhrase.ts
 *
 * Generates combined transition phrase clips that stitch the "3, 2, 1"
 * countdown together with the following cue word(s) into a SINGLE Voicemaker
 * ai3-Aria clip. This replaces the old pattern of queueing
 *   [countdown_3] → [rest] → [next-up phrase]
 * which sounded like three separate clips stitched together.
 *
 * Phrase kinds:
 *   1. workRestNext(name)  — work end, rest > 0
 *      "<break 200ms/>3<break 700ms/>2<break 700ms/>1<break 400ms/>Rest.
 *       <break 400ms/>Next up: <break 100ms/>{name}."
 *   2. restGo()  — rest end
 *      "<break 200ms/>3<break 700ms/>2<break 700ms/>1<break 400ms/>Go."
 *   3. workNext(name)  — work end, rest === 0 (no "rest", no "go")
 *      "<break 200ms/>3<break 700ms/>2<break 700ms/>1<break 400ms/>Next up:
 *       <break 100ms/>{name}."
 *   4. swapSidesCountdownGo()  — swap window 4–6s, fired at swap entry
 *      "<break 100ms/>Switch sides.<break 400ms/>3<break 700ms/>2
 *       <break 700ms/>1<break 400ms/>Go."
 *   5. countdownSwapSidesGo()  — swap window 1–3s, fired at swap entry
 *      "<break 100ms/>3<break 300ms/>2<break 300ms/>1<break 300ms/>
 *       Swap sides.<break 200ms/>Go."
 *      Faster pacing fits the tight window.
 *   6. workSwapOtherSide()  — swap window === 0, fired during work-L last 4s
 *      "<break 200ms/>3<break 700ms/>2<break 700ms/>1<break 400ms/>
 *       Go on the other side."
 *      The swap visual phase is skipped entirely; sides flip the instant
 *      work-L hits zero.
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

export type TransitionPhraseKind =
  | 'workRestNext'
  | 'restGo'
  | 'workNext'
  | 'swapSidesCountdownGo'
  | 'countdownSwapSidesGo'
  | 'workSwapOtherSide';

/**
 * Faster prefix for the tight 1–3s swap window, where the standard 200ms +
 * 700ms-per-digit pacing wouldn't fit. Compressed gaps still read as a
 * countdown but pack the digits into ~1.2s instead of ~2.5s.
 */
const COUNTDOWN_PREFIX_FAST =
  '<break time="100ms"/>3<break time="300ms"/>2<break time="300ms"/>1<break time="300ms"/>';

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
  if (kind === 'swapSidesCountdownGo') {
    return `<break time="100ms"/>Switch sides.<break time="400ms"/>3<break time="700ms"/>2<break time="700ms"/>1<break time="400ms"/>Go.`;
  }
  if (kind === 'countdownSwapSidesGo') {
    return `${COUNTDOWN_PREFIX_FAST}Swap sides.<break time="200ms"/>Go.`;
  }
  if (kind === 'workSwapOtherSide') {
    return `${COUNTDOWN_PREFIX}Go on the other side.`;
  }
  const normalized = normalizeTtsText(movementName || '');
  if (!normalized) return '';
  if (kind === 'workNext') {
    return `${COUNTDOWN_PREFIX}Next up: <break time="100ms"/>${normalized}.`;
  }
  // workRestNext
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
