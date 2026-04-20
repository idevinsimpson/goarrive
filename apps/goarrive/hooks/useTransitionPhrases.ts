/**
 * useTransitionPhrases — Pre-warms combined transition phrase clips so the
 * workout player can enqueue ONE Voicemaker ai3-Aria clip per transition
 * instead of stitching separate countdown + rest/go + next-up clips at
 * playback time (the old flow that Devin described as "separate clips
 * stitched together").
 *
 * Two clip kinds:
 *   1. workRestNext: "3, 2, 1. Rest. Next up, {name}." — one clip per
 *      unique upcoming exercise movement name. Injected onto each
 *      FlatMovement as `workRestNextUpVoiceUrl`, keyed on that movement's
 *      own name. The player reads `next.workRestNextUpVoiceUrl` when the
 *      CURRENT movement's work phase ends.
 *   2. restGo: "3, 2, 1. Go." — a single shared clip, no movement name.
 *      Returned separately and passed down to useWorkoutTTS.
 *
 * Pre-warm timing: kicks off at workout-open so clips are (usually) cached
 * by the time playback reaches the first transition. On a fresh first
 * encounter, the combined clip may not be ready in time; the player falls
 * back to the original countdown_3 + rest/go + next-up sequence for that
 * one transition, and subsequent transitions get the combined clip.
 *
 * Cache hits (subsequent loads) skip the Voicemaker call server-side —
 * generateVoice checks Storage existence first.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FlatMovement } from './useWorkoutFlatten';
import { generateTransitionPhrase } from '../utils/generateTransitionPhrase';

export interface UseTransitionPhrasesResult {
  flatMovements: FlatMovement[];
  restGoVoiceUrl: string | null;
}

export function useTransitionPhrases(
  flatMovements: FlatMovement[],
): UseTransitionPhrasesResult {
  const [workRestNextUrls, setWorkRestNextUrls] = useState<Record<string, string>>({});
  const [restGoVoiceUrl, setRestGoVoiceUrl] = useState<string | null>(null);
  const startedNamesRef = useRef<Set<string>>(new Set());
  const startedRestGoRef = useRef<boolean>(false);

  useEffect(() => {
    if (!startedRestGoRef.current) {
      startedRestGoRef.current = true;
      generateTransitionPhrase('restGo')
        .then(({ url }) => {
          if (!url) return;
          setRestGoVoiceUrl((prev) => (prev === url ? prev : url));
        })
        .catch((err) => {
          console.warn('[VOICE-AUDIT] useTransitionPhrases restGo REJECTED', { err });
        });
    }

    const uniqueNames = new Set<string>();
    for (const fm of flatMovements) {
      if (fm.stepType !== 'exercise') continue;
      if (fm.movementIndex === -1) continue;
      const name = (fm.name || '').trim();
      if (!name) continue;
      uniqueNames.add(name);
    }

    for (const name of uniqueNames) {
      if (startedNamesRef.current.has(name)) continue;
      startedNamesRef.current.add(name);
      generateTransitionPhrase('workRestNext', name)
        .then(({ url }) => {
          if (!url) return;
          setWorkRestNextUrls((prev) =>
            prev[name] === url ? prev : { ...prev, [name]: url },
          );
        })
        .catch((err) => {
          console.warn('[VOICE-AUDIT] useTransitionPhrases workRestNext REJECTED', {
            name,
            err,
          });
        });
    }
  }, [flatMovements]);

  const enrichedFlatMovements = useMemo(() => {
    if (Object.keys(workRestNextUrls).length === 0) return flatMovements;
    return flatMovements.map((fm) => {
      const name = (fm.name || '').trim();
      if (!name) return fm;
      const url = workRestNextUrls[name];
      if (!url) return fm;
      if (fm.workRestNextUpVoiceUrl === url) return fm;
      return { ...fm, workRestNextUpVoiceUrl: url };
    });
  }, [flatMovements, workRestNextUrls]);

  return { flatMovements: enrichedFlatMovements, restGoVoiceUrl };
}
