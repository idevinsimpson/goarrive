/**
 * useNextUpPhrases — Pre-warms and injects combined "Next up, {name}." clips.
 *
 * For each unique exercise movement in the flat list, kicks off generation of
 * a single OpenAI TTS clip via generateNextUpPhrase (cached at
 * voice_cache/phrases/nextup-{voice}-{hash}.mp3) and injects the resulting
 * URL onto each FlatMovement as `nextUpVoiceUrl`.
 *
 * Pre-warm timing:
 *   Generation kicks off as soon as the workout opens, not when each rest
 *   begins. By the time the player reaches the first rest, most phrases are
 *   already cached / hydrated. If a phrase isn't ready in time, the player
 *   stays silent for that one cue (per product decision); the URL still
 *   arrives via state and is available for the next rest.
 *
 * Cache hits (subsequent loads of the same workout, or movements shared
 * across workouts) skip the OpenAI call server-side — generateVoice checks
 * Storage existence first.
 *
 * Phrase-keyed (no movementId): two movements with identical names share the
 * same clip. That's correct — the spoken phrase is the same.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FlatMovement } from './useWorkoutFlatten';
import { generateNextUpPhrase } from '../utils/generateNextUpPhrase';

export function useNextUpPhrases(flatMovements: FlatMovement[]): FlatMovement[] {
  // Map of movement name → resolved phrase clip URL.
  const [phraseUrls, setPhraseUrls] = useState<Record<string, string>>({});
  // Names we've already kicked off generation for in this session.
  const startedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const uniqueNames = new Set<string>();
    for (const fm of flatMovements) {
      // Only real exercises get a "Next up" cue. Skip prep-rest sentinels
      // (movementIndex === -1) and special-block steps (intro/outro/demo/etc).
      if (fm.stepType !== 'exercise') continue;
      if (fm.movementIndex === -1) continue;
      const name = (fm.name || '').trim();
      if (!name) continue;
      uniqueNames.add(name);
    }

    for (const name of uniqueNames) {
      if (startedRef.current.has(name)) continue;
      startedRef.current.add(name);
      generateNextUpPhrase(name)
        .then(({ url }) => {
          if (!url) return;
          setPhraseUrls((prev) => (prev[name] === url ? prev : { ...prev, [name]: url }));
        })
        .catch((err) => {
          console.warn('[VOICE-AUDIT] useNextUpPhrases generation REJECTED', { name, err });
        });
    }
  }, [flatMovements]);

  return useMemo(() => {
    if (Object.keys(phraseUrls).length === 0) return flatMovements;
    return flatMovements.map((fm) => {
      const name = (fm.name || '').trim();
      if (!name) return fm;
      const url = phraseUrls[name];
      if (!url) return fm;
      if (fm.nextUpVoiceUrl === url) return fm;
      return { ...fm, nextUpVoiceUrl: url };
    });
  }, [flatMovements, phraseUrls]);
}
