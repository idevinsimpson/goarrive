/**
 * generateMovementPrescriptionVoice.ts
 *
 * Per-workout-build voice clip that speaks the coach's prescribed weight and/or
 * reps for a movement — e.g. "Cable Curls. 75 pounds, 15 reps."
 *
 * Distinct from generateMovementVoice (which speaks only the movement name and
 * persists to /movements/{id}). This helper builds a clip keyed off the
 * (movementId, normalizedName, weight, reps) tuple and stores it under
 * voice_cache/movements/prescription/. The returned URL is meant to be written
 * to the block-movement on the workout (as prescriptionVoiceUrl), NOT back to
 * the base movement doc — so the function call deliberately omits movementId
 * (which would trigger the server-side writeback).
 *
 * Player precedence: prescriptionVoiceUrl ?? voiceUrl. When weight/reps are
 * cleared, the block-movement's prescriptionVoiceUrl gets cleared and the
 * player falls back to the base name-only clip.
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

export interface GeneratePrescriptionVoiceResult {
  url: string | null;
  text: string;
  /** Cache key string so callers can detect when the prescription changed. */
  cacheKey: string;
}

/**
 * Build the spoken phrase from movement name + weight + reps. Returns null when
 * neither weight nor reps is set (caller should skip generation in that case).
 *
 * Numeric values get the unit appended ("75" → "75 pounds"). Freeform values
 * ("bodyweight", "AMRAP") get spoken as-is so the coach can override pronunciation.
 */
export function buildPrescriptionPhrase(
  movementName: string,
  weight?: string,
  reps?: string,
): string | null {
  const w = (weight || '').trim();
  const r = (reps || '').trim();
  if (!w && !r) return null;

  const parts: string[] = [];
  if (w) parts.push(/^\d+(\.\d+)?$/.test(w) ? `${w} pounds` : w);
  if (r) parts.push(/^\d+$/.test(r) ? `${r} reps` : r);

  const normalizedName = normalizeTtsText(movementName);
  return `${normalizedName}. ${parts.join(', ')}.`;
}

/**
 * Stable cache key for a (movementId, name, weight, reps) tuple. Used both for
 * the Storage path AND as a dedup signal on the block-movement so the client
 * can detect "prescription changed → regenerate."
 */
// Bump PATH_VERSION when the storagePath layout changes so existing stored
// cacheKeys are invalidated and the watcher regenerates with the new path.
// v2: moved from subfolder `prescription/` to flat `prescription-*` because
//     the subfolder didn't match the single-segment storage rule wildcard.
const PATH_VERSION = 'v2';

export function prescriptionCacheKey(
  movementName: string,
  weight?: string,
  reps?: string,
): string {
  const w = (weight || '').trim();
  const r = (reps || '').trim();
  const normalized = normalizeTtsText(movementName);
  return hashTtsText(`${PATH_VERSION}|${TTS_VOICE_SLUG}|${normalized}|w=${w}|r=${r}`);
}

export async function generateMovementPrescriptionVoice(
  movementId: string,
  movementName: string,
  weight: string | undefined,
  reps: string | undefined,
): Promise<GeneratePrescriptionVoiceResult> {
  const phrase = buildPrescriptionPhrase(movementName, weight, reps);
  const cacheKey = prescriptionCacheKey(movementName, weight, reps);

  if (!phrase) {
    return { url: null, text: '', cacheKey };
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
      {
        url: string;
        path: string;
        provider?: string;
      }
    >(functions, 'generateVoice');

    // Flat path (no `prescription/` subfolder) so Storage Rule
    // `match /voice_cache/movements/{fileName}` covers it — that wildcard
    // matches one path segment, so a subfolder would fall through to the
    // default-deny rule and the browser would get 403 on read.
    const storagePath = `voice_cache/movements/prescription-${movementId}-${TTS_VOICE_SLUG}-${cacheKey}.mp3`;

    console.info('[VOICE-AUDIT] generateMovementPrescriptionVoice calling generateVoice', {
      movementId, movementName, weight, reps, phrase, storagePath,
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

    return { url: result.data.url, text: phrase, cacheKey };
  } catch (err: any) {
    console.warn('[VOICE-AUDIT] generateMovementPrescriptionVoice THREW', {
      movementId, movementName, weight, reps,
      code: err?.code, message: err?.message, details: err?.details ?? null,
    });
    return { url: null, text: phrase, cacheKey };
  }
}
