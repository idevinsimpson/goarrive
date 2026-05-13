/**
 * useTransitionPhrases — Pre-warms the single shared combined transition clip
 * still in use: restGoVoiceUrl ("3, 2, 1. Go." for rest → next exercise).
 *
 * One URL pre-warmed once at workout-open, then cache-hit for the rest of the
 * session. Static `countdown_3` + `go` MP3s are the fallback if the URL isn't
 * ready in time (first-encounter, generation in flight).
 *
 * Previously also pre-warmed `workSwapOtherSide` (window=0 swap transition).
 * That clip was dropped because the swap path is short enough that a single
 * static `other_side` cue carries it cleanly — and any combined-clip layer
 * here had the same failure-surface problem as the dropped per-movement
 * clips (when the clip didn't play, suppression silently blocked the static
 * fallback).
 */
import { useEffect, useRef, useState } from 'react';
import type { FlatMovement } from './useWorkoutFlatten';
import { generateTransitionPhrase } from '../utils/generateTransitionPhrase';

export interface UseTransitionPhrasesResult {
  restGoVoiceUrl: string | null;
}

export function useTransitionPhrases(
  _flatMovements: FlatMovement[],
): UseTransitionPhrasesResult {
  const [restGoVoiceUrl, setRestGoVoiceUrl] = useState<string | null>(null);
  const startedRef = useRef<boolean>(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    generateTransitionPhrase('restGo')
      .then(({ url }) => {
        if (!url) return;
        setRestGoVoiceUrl((prev) => (prev === url ? prev : url));
      })
      .catch((err) => {
        console.warn('[VOICE-AUDIT] useTransitionPhrases restGo REJECTED', { err });
      });
  }, []);

  return {
    restGoVoiceUrl,
  };
}
