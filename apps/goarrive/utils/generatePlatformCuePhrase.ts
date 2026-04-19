/**
 * generatePlatformCuePhrase.ts
 *
 * Generates the remaining core workout-player cues — "That's halfway.",
 * "Grab some water.", and "Here's what's coming up." — as single OpenAI
 * gpt-4o-mini-tts clips via the same generateVoice Cloud Function used by
 * the countdown and next-up phrases. Every cue pulls voice + model + style
 * version + delivery brief from coachStyleInstructions.ts so the whole
 * player sounds like one consistent coach.
 *
 * Before this helper existed, these three cues lived in voice_cache/platform/
 * as pre-recorded static MP3s (or, for demo, were silent). Those static
 * clips were a different voice and a different vibe from the OpenAI-
 * generated "Next up" / countdown phrases, so the player cycled between two
 * coaches across a workout. This helper closes that gap — the fallback
 * path (useWorkoutTTS) still uses the old static MP3s for first-ever load
 * before the Cloud Function returns, but every subsequent play uses the
 * generated clip.
 *
 * Storage path:  voice_cache/phrases/cue-{variant}-{voice}-{textHash}.mp3
 *   Phrase-keyed: one clip per cue variant. The hash is over
 *   voice + model + style version + phrase text, so bumping COACH_STYLE_V
 *   produces fresh paths and fresh clips for every cue in one move.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { hashTtsText } from './normalizeTtsText';
import {
  COACH_MODEL,
  COACH_STYLE_V,
  COACH_VOICE,
  DEMO_STYLE_INSTRUCTIONS,
  HALFWAY_STYLE_INSTRUCTIONS,
  WATER_STYLE_INSTRUCTIONS,
} from './coachStyleInstructions';

/**
 * Platform cue variants generated through OpenAI. Kept small on purpose —
 * every addition is a fresh cache entry and a new pre-warm path.
 */
export type PlatformCueVariant = 'halfway' | 'water' | 'demo';

const CUE_PHRASE: Record<PlatformCueVariant, string> = {
  halfway: "That's halfway.",
  water: 'Grab some water.',
  demo: "Here's what's coming up.",
};

const CUE_INSTRUCTIONS: Record<PlatformCueVariant, string> = {
  halfway: HALFWAY_STYLE_INSTRUCTIONS,
  water: WATER_STYLE_INSTRUCTIONS,
  demo: DEMO_STYLE_INSTRUCTIONS,
};

export interface PlatformCuePhraseResult {
  variant: PlatformCueVariant;
  url: string | null;
  phrase: string;
  path: string | null;
  cached?: boolean;
}

export function buildPlatformCuePhrase(variant: PlatformCueVariant): string {
  return CUE_PHRASE[variant];
}

export function buildPlatformCueStoragePath(variant: PlatformCueVariant): string {
  const phrase = CUE_PHRASE[variant];
  const cacheKey = `${COACH_VOICE}|${COACH_MODEL}|${COACH_STYLE_V}|${phrase}`;
  const hash = hashTtsText(cacheKey);
  return `voice_cache/phrases/cue-${variant}-${COACH_VOICE}-${hash}.mp3`;
}

export async function generatePlatformCuePhrase(
  variant: PlatformCueVariant,
): Promise<PlatformCuePhraseResult> {
  const phrase = CUE_PHRASE[variant];
  const storagePath = buildPlatformCueStoragePath(variant);

  try {
    const functions = getFunctions(undefined, 'us-central1');
    const generateVoice = httpsCallable<
      { text: string; voice: string; storagePath: string; model: string; instructions: string },
      { url: string; path: string; cached?: boolean }
    >(functions, 'generateVoice');

    console.info('[VOICE-AUDIT] generatePlatformCuePhrase calling generateVoice', {
      variant, phrase, voice: COACH_VOICE, model: COACH_MODEL, storagePath,
    });
    const result = await generateVoice({
      text: phrase,
      voice: COACH_VOICE,
      model: COACH_MODEL,
      instructions: CUE_INSTRUCTIONS[variant],
      storagePath,
    });
    console.info('[VOICE-AUDIT] generatePlatformCuePhrase resolved', {
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
    console.warn('[VOICE-AUDIT] generatePlatformCuePhrase THREW', {
      variant, code: err?.code, message: err?.message, layer, details,
    });
    return { variant, url: null, phrase, path: storagePath };
  }
}
