/**
 * grabEquipmentVoice — Pre-generated TTS for "Grab Equipment" block instructions.
 *
 * Share-link viewers authenticate anonymously; the generateVoice callable
 * rejects them downstream, so the runtime lazy-gen path in useWorkoutTTS
 * falls back to a static "Get ready." MP3 instead of speaking the coach's
 * equipment text. To fix that we pre-generate the audio at save time (in
 * WorkoutFolderPage) and persist the URL + hash on the block, exactly the
 * way workoutIntroAnnouncement.ts handles the workout-level intro clip.
 *
 * Block fields (camelCase, coach-writable via Firestore rules):
 *   grabEquipmentText        string — coach-authored instruction ("Grab a 40 lb bar…")
 *   grabEquipmentVoiceUrl    string — cached TTS MP3 download URL
 *   grabEquipmentVoiceHash   string — hash of the text the URL was generated
 *                                     from (regenerate on change)
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { hashTtsText, normalizeTtsText } from './normalizeTtsText';
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

/** generateVoice rejects text over 800 chars; leave headroom for edits. */
export const GRAB_EQUIPMENT_MAX_CHARS = 750;

/**
 * Cache hash for the equipment script. Includes the voice slug so a
 * provider/voice switch busts the cache the same way movement clips do.
 * Normalizes the text first so cosmetic edits ("40 lb" vs "40lb") that
 * produce the same spoken phrase share a cache entry.
 */
export function grabEquipmentHash(text: string): string {
  const normalized = normalizeTtsText(text.trim());
  return hashTtsText(`${TTS_VOICE_SLUG}|${normalized}`);
}

export function grabEquipmentStoragePath(hash: string): string {
  return `voice_cache/movements/grab-equip-${TTS_VOICE_SLUG}-${hash}.mp3`;
}

export interface GrabEquipmentVoiceResult {
  /** Download URL of the MP3, or null when generation failed. */
  url: string | null;
  /** Hash of the text the URL corresponds to (store alongside the URL). */
  hash: string;
  /** The exact (normalized) text sent to the provider. */
  text: string;
}

/**
 * Generates (or fetches from cache) the grab-equipment MP3 via the existing
 * generateVoice callable. Requires an authenticated user — the coach's save
 * flow calls this; share-link viewers only rely on the stored voice URL.
 * Never throws; returns url: null on failure so the caller can save the
 * text/toggle without blocking on TTS.
 */
export async function generateGrabEquipmentVoice(
  text: string,
): Promise<GrabEquipmentVoiceResult> {
  const normalized = normalizeTtsText(text.trim()).slice(0, 800);
  const hash = grabEquipmentHash(text);
  if (!normalized) return { url: null, hash, text: normalized };

  try {
    const functions = getFunctions(undefined, 'us-central1');
    const generateVoice = httpsCallable<Record<string, unknown>, { url: string | null }>(
      functions,
      'generateVoice',
    );
    const result = await generateVoice({
      text: normalized,
      voice: TTS_VOICE_ID,
      storagePath: grabEquipmentStoragePath(hash),
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
    return { url: result.data?.url || null, hash, text: normalized };
  } catch (err: any) {
    console.warn('[GRAB-EQUIP-VOICE] generateVoice failed', {
      code: err?.code,
      message: err?.message,
    });
    return { url: null, hash, text: normalized };
  }
}
