/**
 * generateMovementVoice.ts
 *
 * Calls the generateVoice Cloud Function (provider-pluggable TTS) to create a
 * voice clip for a movement name, stored in Firebase Storage.
 *
 * Provider/voice selection lives in ttsProviderConfig.ts so the callers
 * (movement names, next-up phrases, static cues) all stay in lockstep — any
 * mismatch would cache-collide or trigger the wrong-voice regeneration loop.
 *
 * Storage path: voice_cache/movements/{movementId}-{providerSlug}-{textHash}.mp3
 *   The slug includes provider + voiceId + effect so Voicemaker clips can never
 *   collide with old OpenAI nova clips at the same movementId. The text-hash
 *   suffix is the rename-cache-busting key — when a coach renames a movement,
 *   the new normalized text produces a new hash, which produces a new path,
 *   which forces a new voiceUrl. The player can never speak the old name after
 *   a rename because the old URL is no longer associated with the movement doc.
 *
 * The cache key is derived from the *normalized* spoken text so abbreviation
 * fixes ("DB" → "dumbbell") don't generate two clips for the same phrase.
 *
 * We pass `movementId` to the Cloud Function so it writes voiceUrl/voiceText/
 * voiceName/ttsProvider/voiceId/voiceEffect back to /movements/{id} with admin
 * creds. Member-session lazy backfill from useMovementHydrate depends on this
 * — members can't update /movements from the client. Coach write paths still
 * updateDoc themselves (to handle the failure-clear branch and to stay atomic
 * with other field updates), and the server write is idempotent with whatever
 * the coach writes.
 *
 * Returns:
 *   { url, text, voiceName }   — generation succeeded; server has already
 *                                 persisted voiceUrl/voiceText/voiceName/etc.
 *                                 Coach callers may still updateDoc to bundle
 *                                 with other field writes.
 *   { url: null, ... }         — generation failed; caller should clear
 *                                 voiceUrl so the player stays silent for that
 *                                 movement instead of speaking a stale clip.
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

/**
 * Canonical voice name for workout-player movement-name audio. Kept exported
 * for back-compat with useMovementHydrate's wrong-voice guard, but the new
 * authoritative check is provider+voiceId+effect (see useMovementHydrate).
 */
export const MOVEMENT_VOICE_NAME = TTS_VOICE_ID;

export interface GenerateMovementVoiceResult {
  /** Public download URL of the generated MP3, or null if generation failed. */
  url: string | null;
  /** The normalized text actually sent to the provider (and used for the cache key). */
  text: string;
  /** The voice id used to generate the clip (e.g. "ai3-Aria"). */
  voiceName: string;
}

export async function generateMovementVoice(
  movementId: string,
  movementName: string,
): Promise<GenerateMovementVoiceResult> {
  const normalized = normalizeTtsText(movementName);

  if (!normalized) {
    console.warn('[VOICE-AUDIT] generateMovementVoice skipped — empty normalized text', { movementId, movementName });
    return { url: null, text: '', voiceName: MOVEMENT_VOICE_NAME };
  }

  try {
    const functions = getFunctions(undefined, 'us-central1');
    const generateVoice = httpsCallable<
      {
        text: string;
        voice: string;
        storagePath: string;
        movementId: string;
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
      {
        url: string;
        path: string;
        provider?: string;
        writeback?: 'ok' | 'skipped' | 'missing_doc' | 'failed' | 'no_id';
        writebackError?: string | null;
      }
    >(functions, 'generateVoice');

    // Cache key inputs: provider + voiceId + effect + the normalized text.
    // Movement names don't carry SSML break tags so hashing the bare text is fine.
    const textHash = hashTtsText(`${TTS_VOICE_SLUG}|${normalized}`);
    const storagePath = `voice_cache/movements/${movementId}-${TTS_VOICE_SLUG}-${textHash}.mp3`;

    console.info('[VOICE-AUDIT] generateMovementVoice calling generateVoice', {
      movementId, movementName, normalized,
      provider: TTS_PROVIDER, voice: TTS_VOICE_ID, effect: TTS_VOICE_EFFECT, storagePath,
    });
    const result = await generateVoice({
      text: normalized,
      voice: TTS_VOICE_ID,
      storagePath,
      movementId,
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
    console.info('[VOICE-AUDIT] generateMovementVoice resolved', {
      movementId,
      movementName,
      provider: result.data?.provider ?? TTS_PROVIDER,
      voice: TTS_VOICE_ID,
      urlPresent: !!result.data?.url,
      urlLen: result.data?.url?.length ?? 0,
      writeback: result.data?.writeback ?? null,
      writebackError: result.data?.writebackError ?? null,
    });

    return { url: result.data.url, text: normalized, voiceName: MOVEMENT_VOICE_NAME };
  } catch (err: any) {
    // Firebase callable SDK surfaces server-side HttpsError details on err.details.
    // Our server throws structured details like { layer, status, message, ... }
    // so the in-app VOICE-AUDIT panel shows the exact failing layer instead of
    // the generic "internal" message.
    const details = err?.details ?? null;
    const layer = details && typeof details === 'object' ? (details as any).layer : null;
    console.warn('[VOICE-AUDIT] generateMovementVoice THREW', {
      movementId,
      movementName,
      code: err?.code,
      message: err?.message,
      layer,
      details,
    });
    return { url: null, text: normalized, voiceName: MOVEMENT_VOICE_NAME };
  }
}
