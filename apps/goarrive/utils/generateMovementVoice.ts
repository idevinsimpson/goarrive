/**
 * generateMovementVoice.ts
 *
 * Calls the generateVoice Cloud Function (OpenAI TTS) to create a voice clip
 * for a movement name, stored in Firebase Storage.
 *
 * Voice: OpenAI "nova" — fitness-instructor vibe. The voice name is part of
 * the storage path so any clip generated with a different voice (e.g. legacy
 * "onyx" clips) cannot be reused by accident — a voice change produces a new
 * path, which forces a fresh generation.
 *
 * Storage path: voice_cache/movements/{movementId}-{voiceName}-{textHash}.mp3
 *
 * The text-hash suffix is the rename-cache-busting key. When a coach renames a
 * movement, the new normalized text produces a new hash, which produces a
 * new storage path, which forces a new voiceUrl. The player can never speak
 * the old name after a rename because the old URL is no longer associated
 * with the movement document.
 *
 * The cache key is derived from the *normalized* spoken text so abbreviation
 * fixes ("DB" → "dumbbell") don't generate two clips for the same phrase.
 *
 * We pass `movementId` to the Cloud Function so it writes voiceUrl/voiceText/
 * voiceName back to /movements/{id} with admin creds. Member-session lazy
 * backfill from useMovementHydrate depends on this — members can't update
 * /movements from the client. Coach write paths still updateDoc themselves
 * (to handle the failure-clear branch and to stay atomic with other field
 * updates), and the server write is idempotent with whatever the coach writes.
 *
 * Returns:
 *   { url, text, voiceName }   — generation succeeded; server has already
 *                                 persisted voiceUrl/voiceText/voiceName.
 *                                 Coach callers may still updateDoc to
 *                                 bundle with other field writes.
 *   { url: null, ... }         — generation failed; caller should clear
 *                                 voiceUrl so the player stays silent for
 *                                 that movement instead of speaking a stale
 *                                 clip.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { normalizeTtsText, hashTtsText } from './normalizeTtsText';

/**
 * Canonical OpenAI voice for workout-player movement-name audio.
 * Changing this value is a breaking cache-key change — every new clip will
 * be written to a new path, and useMovementHydrate will auto-regenerate any
 * movement whose stored voiceName differs from this constant.
 */
export const MOVEMENT_VOICE_NAME = 'nova' as const;

export interface GenerateMovementVoiceResult {
  /** Public download URL of the generated MP3, or null if generation failed. */
  url: string | null;
  /** The normalized text actually sent to OpenAI (and used for the cache key). */
  text: string;
  /** The OpenAI voice used to generate the clip (e.g. "nova"). */
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
      { text: string; voice: string; storagePath: string; movementId: string },
      {
        url: string;
        path: string;
        writeback?: 'ok' | 'skipped' | 'missing_doc' | 'failed' | 'no_id';
        writebackError?: string | null;
      }
    >(functions, 'generateVoice');

    const textHash = hashTtsText(normalized);
    const storagePath = `voice_cache/movements/${movementId}-${MOVEMENT_VOICE_NAME}-${textHash}.mp3`;

    console.info('[VOICE-AUDIT] generateMovementVoice calling generateVoice', {
      movementId, movementName, normalized, voice: MOVEMENT_VOICE_NAME, storagePath,
    });
    const result = await generateVoice({
      text: normalized,
      voice: MOVEMENT_VOICE_NAME,
      storagePath,
      movementId,
    });
    console.info('[VOICE-AUDIT] generateMovementVoice resolved', {
      movementId,
      movementName,
      voice: MOVEMENT_VOICE_NAME,
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
