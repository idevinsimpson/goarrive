/**
 * generateMovementVoice.ts
 *
 * Calls the generateVoice Cloud Function (OpenAI TTS) to create a voice clip
 * for a movement name, stored in Firebase Storage.
 *
 * Storage path: voice_cache/movements/{movementId}-{textHash}.mp3
 *
 * The text-hash suffix is the cache-busting key. When a coach renames a
 * movement, the new normalized text produces a new hash, which produces a
 * new storage path, which forces a new voiceUrl. The player can never speak
 * the old name after a rename because the old URL is no longer associated
 * with the movement document.
 *
 * The cache key is derived from the *normalized* spoken text so abbreviation
 * fixes ("DB" → "dumbbell") don't generate two clips for the same phrase.
 *
 * We pass `movementId` to the Cloud Function so it writes voiceUrl/voiceText
 * back to /movements/{id} with admin creds. Member-session lazy backfill from
 * useMovementHydrate depends on this — members can't update /movements from
 * the client. Coach write paths still updateDoc themselves (to handle the
 * failure-clear branch and to stay atomic with other field updates), and the
 * server write is idempotent with whatever the coach writes.
 *
 * Returns:
 *   { url, text }   — generation succeeded; server has already persisted
 *                     voiceUrl/voiceText. Coach callers may still updateDoc
 *                     to bundle with other field writes.
 *   { url: null }   — generation failed; caller should clear voiceUrl so the
 *                     player stays silent for that movement instead of
 *                     speaking a stale clip.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { normalizeTtsText, hashTtsText } from './normalizeTtsText';

export interface GenerateMovementVoiceResult {
  /** Public download URL of the generated MP3, or null if generation failed. */
  url: string | null;
  /** The normalized text actually sent to OpenAI (and used for the cache key). */
  text: string;
}

export async function generateMovementVoice(
  movementId: string,
  movementName: string,
): Promise<GenerateMovementVoiceResult> {
  const normalized = normalizeTtsText(movementName);

  if (!normalized) {
    console.warn('[VOICE-AUDIT] generateMovementVoice skipped — empty normalized text', { movementId, movementName });
    return { url: null, text: '' };
  }

  try {
    const functions = getFunctions(undefined, 'us-central1');
    const generateVoice = httpsCallable<
      { text: string; voice: string; storagePath: string; movementId: string },
      { url: string; path: string }
    >(functions, 'generateVoice');

    const textHash = hashTtsText(normalized);
    const storagePath = `voice_cache/movements/${movementId}-${textHash}.mp3`;

    console.info('[VOICE-AUDIT] generateMovementVoice calling generateVoice', {
      movementId, movementName, normalized, storagePath,
    });
    const result = await generateVoice({
      text: normalized,
      voice: 'onyx',
      storagePath,
      movementId,
    });
    console.info('[VOICE-AUDIT] generateMovementVoice resolved', {
      movementId, movementName, urlPresent: !!result.data?.url, urlLen: result.data?.url?.length ?? 0,
    });

    return { url: result.data.url, text: normalized };
  } catch (err: any) {
    console.warn('[VOICE-AUDIT] generateMovementVoice THREW', {
      movementId, movementName, code: err?.code, message: err?.message,
    });
    return { url: null, text: normalized };
  }
}
