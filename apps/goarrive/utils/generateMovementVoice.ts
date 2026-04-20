/**
 * generateMovementVoice.ts
 *
 * Calls the generateVoice Cloud Function (OpenAI TTS) to create a voice clip
 * for a movement name, stored in Firebase Storage.
 *
 * Storage path: voice_cache/movements/{movementId}.mp3
 *
 * Falls back silently — if generation fails for any reason (network, quota),
 * the movement saves normally and the player falls back to Web Speech.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';

/**
 * Generate a voice clip for a movement name via OpenAI TTS.
 * Returns the public download URL, or null if generation failed.
 */
export async function generateMovementVoice(
  movementId: string,
  movementName: string,
): Promise<string | null> {
  try {
    const functions = getFunctions(undefined, 'us-central1');
    const generateVoice = httpsCallable<
      { text: string; voice: string; storagePath: string },
      { url: string; path: string }
    >(functions, 'generateVoice');

    const result = await generateVoice({
      text: movementName,
      voice: 'nova',
      storagePath: `voice_cache/movements/${movementId}.mp3`,
    });

    return result.data.url;
  } catch (err) {
    console.warn('[generateMovementVoice] Failed silently:', err);
    return null;
  }
}
