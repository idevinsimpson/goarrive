/**
 * ttsProviderConfig — Single source of truth for the workout-player TTS provider.
 *
 * Changing any of these constants is a cache-busting change: the cache key
 * scheme `voice_cache/.../{provider}-{voiceId}-{effect}-{textHash}.mp3` includes
 * provider + voiceId + effect, so a switch generates fresh clips at fresh
 * paths and the wrong-provider/wrong-voice/wrong-effect guard in
 * useMovementHydrate regenerates any movement whose stored metadata diverges.
 *
 * Why a shared config: the player consumes Storage URLs only — it doesn't know
 * or care which provider made them. But generateMovementVoice / generateNextUpPhrase
 * / static-cue generation must all use the *same* defaults, otherwise clips
 * collide on cache keys or the hydrate guard incorrectly invalidates.
 */

export type TtsProvider = 'openai' | 'voicemaker';

/** Active provider for the workout-player audio. */
export const TTS_PROVIDER: TtsProvider = 'voicemaker';

/** VoiceId — Voicemaker uses ai3-Aria (female, en-US, neural engine). */
export const TTS_VOICE_ID = 'ai3-Aria' as const;

/** Voicemaker effect — `friendly` gives the warm female-coach delivery. */
export const TTS_VOICE_EFFECT = 'friendly' as const;

/** Voicemaker engine — neural is required for ai3-* voices. */
export const TTS_ENGINE = 'neural' as const;

/** Voicemaker language code. */
export const TTS_LANGUAGE_CODE = 'en-US' as const;

/** Voicemaker sample rate (string, per API spec). 48 kHz max for MP3. */
export const TTS_SAMPLE_RATE = '48000' as const;

/** Voicemaker master adjustments — start neutral; tune per Devin's feedback. */
export const TTS_MASTER_SPEED = '0' as const;
export const TTS_MASTER_PITCH = '0' as const;
export const TTS_MASTER_VOLUME = '0' as const;

/**
 * How many hours Voicemaker keeps the temporary URL alive. We download
 * immediately so this only matters during transient retry latency. 24h is
 * generous; max is 240h.
 */
export const TTS_FILE_STORE_HOURS = 24;

/**
 * Slug for the cache-path / writeback metadata. Lowercase the voice id so the
 * Storage path is consistent, but preserve the canonical spelling for the API
 * call and for the writeback metadata field.
 */
export const TTS_VOICE_SLUG = `${TTS_PROVIDER}-${TTS_VOICE_ID.toLowerCase()}-${TTS_VOICE_EFFECT}`;
