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
 * Returns:
 *   { url, text }   — generation succeeded; caller writes both to Firestore
 *   { url: null }   — generation failed; caller should clear voiceUrl so the
 *                     player falls back to Web Speech instead of speaking the
 *                     stale clip's old movement name.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { normalizeTtsText, hashTtsText } from './normalizeTtsText';

export interface GenerateMovementVoiceResult {
  /** Public download URL of the generated MP3, or null if generation failed. */
  url: string | null;
  /** The normalized text actually sent to OpenAI (and used for the cache key). */
  text: string;
}

/**
 * Generate a voice clip for a movement name via OpenAI TTS.
 *
 * The caller is responsible for the Firestore write so the same path can
 * write both `voiceUrl` (on success) or clear it (on failure) — see
 * MovementForm and BulkMovementUpload for the canonical pattern.
 */
export async function generateMovementVoice(
  movementId: string,
  movementName: string,
): Promise<GenerateMovementVoiceResult> {
  const normalized = normalizeTtsText(movementName);

  if (!normalized) {
    return { url: null, text: '' };
  }

  try {
    const functions = getFunctions(undefined, 'us-central1');
    const generateVoice = httpsCallable<
      { text: string; voice: string; storagePath: string },
      { url: string; path: string }
    >(functions, 'generateVoice');

    const textHash = hashTtsText(normalized);
    const storagePath = `voice_cache/movements/${movementId}-${textHash}.mp3`;

    const result = await generateVoice({
      text: normalized,
      voice: 'onyx',
      storagePath,
    });

    return { url: result.data.url, text: normalized };
  } catch (err) {
    console.warn('[generateMovementVoice] Failed:', err);
    return { url: null, text: normalized };
  }
}
