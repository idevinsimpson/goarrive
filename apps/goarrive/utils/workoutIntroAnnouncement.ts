/**
 * workoutIntroAnnouncement — AI-generated spoken welcome for the workout player.
 *
 * When a member taps Play, the player speaks a short intro before the first
 * movement: what the workout focuses on, muscle groups worked, and a summary
 * of blocks/rounds/movements. The coach can edit the script or disable it per
 * workout (three-dots menu → Intro Announcement).
 *
 * Workout doc fields (camelCase, coach-writable via Firestore rules):
 *   introAnnouncementEnabled   boolean — default true when absent
 *   introAnnouncementText      string  — coach-edited script; '' = use default
 *   introAnnouncementVoiceUrl  string  — cached TTS MP3 download URL
 *   introAnnouncementVoiceHash string  — hash of the script the URL was
 *                                        generated from (regenerate on change)
 *
 * Audio reuses the generateVoice callable + voice_cache Storage caching used
 * for movement-name clips. The cache path is keyed by workoutId + voice slug
 * + text hash, so an unchanged script never re-hits the TTS provider — the
 * callable returns the cached URL. This is what lets the member-side player
 * lazily generate the default intro without write access to the workout doc.
 */

import { getFunctions, httpsCallable } from 'firebase/functions';
import { hashTtsText } from './normalizeTtsText';
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
export const INTRO_ANNOUNCEMENT_MAX_CHARS = 750;

/** Block types that never contribute movements to the spoken summary. */
const NON_WORK_BLOCK_TYPES = new Set([
  'Intro', 'Outro', 'Demo', 'Transition', 'Water Break',
  'Grab Equipment', 'Follow-Along Video',
]);

function joinList(items: string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

/**
 * Builds the default spoken script from workout metadata. Pure + deterministic
 * so the builder (coach preview) and the player (member lazy generation)
 * produce the same text — and therefore the same cache hash — for the same
 * workout state.
 *
 * musclesByMovementId: primaryMuscles keyed by movementId (block snapshots
 * don't store muscles; callers source them from the movement library or the
 * hydrated player movements). Omitted/empty ⇒ the muscle sentence is skipped.
 */
export function buildDefaultIntroScript(
  workout: { name?: string; blocks?: any[] } | null | undefined,
  musclesByMovementId?: Record<string, string[] | undefined>,
): string {
  const rawName = (workout?.name || '').trim();
  // Untitled workouts skip the name entirely — the member just hears
  // "Welcome to your workout."
  const isUntitled = !rawName || /^untitled(\s+workout)?$/i.test(rawName);
  const greeting = isUntitled
    ? 'Welcome to your workout.'
    : `Welcome to your ${rawName}${/workout\s*$/i.test(rawName) ? '' : ' Workout'}.`;
  const workBlocks = (workout?.blocks || []).filter(
    (b: any) => b && !NON_WORK_BLOCK_TYPES.has(b.type) && (b.movements || []).length > 0,
  );

  const muscles: string[] = [];
  let totalMovements = 0;
  for (const b of workBlocks) {
    for (const m of b.movements || []) {
      if (!m || m.hidden) continue;
      totalMovements += 1;
      const mMuscles = (m.movementId && musclesByMovementId?.[m.movementId]) || [];
      for (const raw of mMuscles) {
        const muscle = String(raw || '').trim().toLowerCase();
        if (muscle && !muscles.includes(muscle)) muscles.push(muscle);
      }
    }
  }

  const parts: string[] = [greeting];
  if (muscles.length > 0) {
    parts.push(`Today you'll be working your ${joinList(muscles.slice(0, 4))}.`);
  }
  if (totalMovements > 0) {
    const roundsList = workBlocks.map((b: any) => Number(b.rounds ?? b.sets ?? 1) || 1);
    const maxRounds = Math.max(0, ...roundsList);
    const blockPart = workBlocks.length > 1 ? ` across ${workBlocks.length} blocks` : '';
    const roundsPart = maxRounds > 1 ? `, with up to ${maxRounds} rounds` : '';
    parts.push(
      `You've got ${totalMovements} ${totalMovements === 1 ? 'movement' : 'movements'}${blockPart}${roundsPart}.`,
    );
  }
  parts.push(`Let's get started!`);

  let script = parts.join(' ');
  if (script.length > INTRO_ANNOUNCEMENT_MAX_CHARS) {
    script = `${script.slice(0, INTRO_ANNOUNCEMENT_MAX_CHARS - 1).replace(/[,;\s]+\S*$/, '')}.`;
  }
  return script;
}

/**
 * Cache hash for an intro script. Includes the voice slug so a provider/voice
 * switch busts the cache the same way movement clips do.
 */
export function introAnnouncementHash(text: string): string {
  return hashTtsText(`${TTS_VOICE_SLUG}|${text.trim()}`);
}

export function introAnnouncementStoragePath(workoutId: string, hash: string): string {
  return `voice_cache/workouts/${workoutId}-intro-${TTS_VOICE_SLUG}-${hash}.mp3`;
}

export interface IntroAnnouncementVoiceResult {
  /** Download URL of the MP3, or null when generation failed. */
  url: string | null;
  /** Hash of the text the URL corresponds to (store alongside the URL). */
  hash: string;
  /** The exact text sent to the provider. */
  text: string;
}

/**
 * Generates (or fetches from cache) the intro announcement MP3 via the
 * existing generateVoice callable. Requires an authenticated user — callers
 * on unauthenticated surfaces (share links) should only rely on a stored
 * introAnnouncementVoiceUrl. Never throws; returns url: null on failure.
 */
export async function generateIntroAnnouncementVoice(
  workoutId: string,
  text: string,
): Promise<IntroAnnouncementVoiceResult> {
  const trimmed = text.trim().slice(0, 800);
  const hash = introAnnouncementHash(trimmed);
  if (!trimmed || !workoutId) return { url: null, hash, text: trimmed };

  try {
    const functions = getFunctions(undefined, 'us-central1');
    const generateVoice = httpsCallable<Record<string, unknown>, { url: string | null }>(
      functions,
      'generateVoice',
    );
    const result = await generateVoice({
      text: trimmed,
      voice: TTS_VOICE_ID,
      storagePath: introAnnouncementStoragePath(workoutId, hash),
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
    return { url: result.data?.url || null, hash, text: trimmed };
  } catch (err: any) {
    console.warn('[INTRO-ANNOUNCE] generateVoice failed', {
      workoutId,
      code: err?.code,
      message: err?.message,
    });
    return { url: null, hash, text: trimmed };
  }
}
