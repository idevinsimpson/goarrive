/**
 * generateMovementVoice.ts
 *
 * Calls the ElevenLabs API to generate a voice clip for a movement name,
 * uploads it to Firebase Storage, and returns the download URL.
 *
 * Called from MovementForm on save (create + edit) so every movement
 * gets a GoArrive Coach voice clip that the WorkoutPlayer can play.
 *
 * Storage path: voice_cache/movements/{movementId}.mp3
 *
 * Falls back silently — if generation fails for any reason (network, quota),
 * the movement saves normally and the player falls back to Web Speech.
 */

import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';

const ELEVENLABS_API_KEY = 'sk_06b086aee920c26097612ff9c7cdc64fc52c55cd72d0c084';
const VOICE_ID = 'c0QwBEyhBnPC8sSJAqhM'; // GoArrive Coach
const MODEL_ID = 'eleven_multilingual_v2';

const VOICE_SETTINGS = {
  stability: 0.55,
  similarity_boost: 0.80,
  style: 0.35,
  use_speaker_boost: true,
};

/**
 * Generate a voice clip for a movement name and upload to Firebase Storage.
 * Returns the public download URL, or null if generation failed.
 */
export async function generateMovementVoice(
  movementId: string,
  movementName: string,
): Promise<string | null> {
  try {
    // Generate audio via ElevenLabs
    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': ELEVENLABS_API_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: movementName,
          model_id: MODEL_ID,
          voice_settings: VOICE_SETTINGS,
        }),
      },
    );

    if (!response.ok) {
      console.warn('[generateMovementVoice] ElevenLabs error:', response.status);
      return null;
    }

    const audioBuffer = await response.arrayBuffer();
    const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });

    // Upload to Firebase Storage
    const storage = getStorage();
    const storageRef = ref(storage, `voice_cache/movements/${movementId}.mp3`);
    await uploadBytes(storageRef, audioBlob, { contentType: 'audio/mpeg' });

    const downloadUrl = await getDownloadURL(storageRef);
    return downloadUrl;
  } catch (err) {
    console.warn('[generateMovementVoice] Failed silently:', err);
    return null;
  }
}
