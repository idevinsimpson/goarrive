/**
 * useTransitionPhrases — Pre-warms the TWO shared combined transition phrase
 * clips used by the workout player:
 *
 *   - restGoVoiceUrl:           "3, 2, 1. Go." (rest → next exercise)
 *   - workSwapOtherSideVoiceUrl: "3, 2, 1. Go on the other side."
 *      (swap window === 0; fired during work-L last 4s, swap visual phase
 *      is skipped entirely)
 *
 * Both clips are SHARED across every transition in the workout — one URL each,
 * pre-warmed once at workout-open, so cache hits are guaranteed for the rest
 * of the session. They are the only combined-clip survivors of the earlier
 * per-movement pre-warm architecture (workRestNext/workNext/nextUp), which
 * was dropped because per-name clips were a failure surface: any generation
 * failure or playback stall on a per-movement clip silently suppressed
 * fallback cues at the player level, producing dead-air transitions for the
 * remainder of the workout.
 *
 * Static MP3 cues (countdown_3, rest, go, switch_sides, other_side, next_up)
 * plus per-movement OpenAI voiceUrl clips now carry the bulk of the audio
 * coaching path. Static cues are preloaded at module load and never re-fetch.
 */
import { useEffect, useRef, useState } from 'react';
import type { FlatMovement } from './useWorkoutFlatten';
import { generateTransitionPhrase } from '../utils/generateTransitionPhrase';

export interface UseTransitionPhrasesResult {
  restGoVoiceUrl: string | null;
  workSwapOtherSideVoiceUrl: string | null;
}

export function useTransitionPhrases(
  _flatMovements: FlatMovement[],
): UseTransitionPhrasesResult {
  const [restGoVoiceUrl, setRestGoVoiceUrl] = useState<string | null>(null);
  const [workSwapOtherSideVoiceUrl, setWorkSwapOtherSideVoiceUrl] =
    useState<string | null>(null);
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
    generateTransitionPhrase('workSwapOtherSide')
      .then(({ url }) => {
        if (!url) return;
        setWorkSwapOtherSideVoiceUrl((prev) => (prev === url ? prev : url));
      })
      .catch((err) => {
        console.warn('[VOICE-AUDIT] useTransitionPhrases workSwapOtherSide REJECTED', { err });
      });
  }, []);

  return {
    restGoVoiceUrl,
    workSwapOtherSideVoiceUrl,
  };
}
