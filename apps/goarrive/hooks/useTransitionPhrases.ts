/**
 * useTransitionPhrases — Pre-warms combined transition phrase clips so the
 * workout player can enqueue ONE Voicemaker ai3-Aria clip per transition
 * instead of stitching separate countdown + rest/go + next-up clips at
 * playback time (the old flow that Devin described as "separate clips
 * stitched together").
 *
 * Per-name clips (one per unique upcoming exercise movement):
 *   - workRestNext: "3, 2, 1. Rest. Next up, {name}." — for rest > 0.
 *   - workNext:     "3, 2, 1. Next up, {name}." — for rest === 0 (no "rest",
 *     no "go" — the next movement begins instantly).
 *   Injected onto each FlatMovement as `workRestNextUpVoiceUrl` and
 *   `workNextVoiceUrl`. The player reads `next.<field>` when the CURRENT
 *   movement's work phase ends, picking the field that matches the current
 *   movement's `restAfter`.
 *
 * Shared static clips (no movement name):
 *   - restGo:               "3, 2, 1. Go." (rest → next exercise)
 *   - swapSidesCountdownGo: "Switch sides. 3, 2, 1. Go." (swap window 4–6s)
 *   - countdownSwapSidesGo: "3, 2, 1. Swap sides. Go." (swap window 1–3s, fast pacing)
 *   - workSwapOtherSide:    "3, 2, 1. Go on the other side." (swap window 0s,
 *      fired during work-L last 4s; the swap visual phase is skipped)
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
  swapSidesCountdownGoVoiceUrl: string | null;
  countdownSwapSidesGoVoiceUrl: string | null;
  workSwapOtherSideVoiceUrl: string | null;
}

export function useTransitionPhrases(
  flatMovements: FlatMovement[],
): UseTransitionPhrasesResult {
  const [workRestNextUrls, setWorkRestNextUrls] = useState<Record<string, string>>({});
  const [workNextUrls, setWorkNextUrls] = useState<Record<string, string>>({});
  const [restGoVoiceUrl, setRestGoVoiceUrl] = useState<string | null>(null);
  const [swapSidesCountdownGoVoiceUrl, setSwapSidesCountdownGoVoiceUrl] =
    useState<string | null>(null);
  const [countdownSwapSidesGoVoiceUrl, setCountdownSwapSidesGoVoiceUrl] =
    useState<string | null>(null);
  const [workSwapOtherSideVoiceUrl, setWorkSwapOtherSideVoiceUrl] =
    useState<string | null>(null);
  const startedWorkRestNamesRef = useRef<Set<string>>(new Set());
  const startedWorkNextNamesRef = useRef<Set<string>>(new Set());
  const startedStaticRef = useRef<boolean>(false);

  useEffect(() => {
    if (!startedStaticRef.current) {
      startedStaticRef.current = true;
      generateTransitionPhrase('restGo')
        .then(({ url }) => {
          if (!url) return;
          setRestGoVoiceUrl((prev) => (prev === url ? prev : url));
        })
        .catch((err) => {
          console.warn('[VOICE-AUDIT] useTransitionPhrases restGo REJECTED', { err });
        });
      generateTransitionPhrase('swapSidesCountdownGo')
        .then(({ url }) => {
          if (!url) return;
          setSwapSidesCountdownGoVoiceUrl((prev) => (prev === url ? prev : url));
        })
        .catch((err) => {
          console.warn('[VOICE-AUDIT] useTransitionPhrases swapSidesCountdownGo REJECTED', { err });
        });
      generateTransitionPhrase('countdownSwapSidesGo')
        .then(({ url }) => {
          if (!url) return;
          setCountdownSwapSidesGoVoiceUrl((prev) => (prev === url ? prev : url));
        })
        .catch((err) => {
          console.warn('[VOICE-AUDIT] useTransitionPhrases countdownSwapSidesGo REJECTED', { err });
        });
      generateTransitionPhrase('workSwapOtherSide')
        .then(({ url }) => {
          if (!url) return;
          setWorkSwapOtherSideVoiceUrl((prev) => (prev === url ? prev : url));
        })
        .catch((err) => {
          console.warn('[VOICE-AUDIT] useTransitionPhrases workSwapOtherSide REJECTED', { err });
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
      if (!startedWorkRestNamesRef.current.has(name)) {
        startedWorkRestNamesRef.current.add(name);
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
      if (!startedWorkNextNamesRef.current.has(name)) {
        startedWorkNextNamesRef.current.add(name);
        generateTransitionPhrase('workNext', name)
          .then(({ url }) => {
            if (!url) return;
            setWorkNextUrls((prev) =>
              prev[name] === url ? prev : { ...prev, [name]: url },
            );
          })
          .catch((err) => {
            console.warn('[VOICE-AUDIT] useTransitionPhrases workNext REJECTED', {
              name,
              err,
            });
          });
      }
    }
  }, [flatMovements]);

  const enrichedFlatMovements = useMemo(() => {
    const haveWorkRest = Object.keys(workRestNextUrls).length > 0;
    const haveWorkNext = Object.keys(workNextUrls).length > 0;
    if (!haveWorkRest && !haveWorkNext) return flatMovements;
    return flatMovements.map((fm) => {
      const name = (fm.name || '').trim();
      if (!name) return fm;
      const wrnUrl = workRestNextUrls[name];
      const wnUrl = workNextUrls[name];
      const wrnChanged = wrnUrl && fm.workRestNextUpVoiceUrl !== wrnUrl;
      const wnChanged = wnUrl && fm.workNextVoiceUrl !== wnUrl;
      if (!wrnChanged && !wnChanged) return fm;
      const next: FlatMovement = { ...fm };
      if (wrnChanged) next.workRestNextUpVoiceUrl = wrnUrl;
      if (wnChanged) next.workNextVoiceUrl = wnUrl;
      return next;
    });
  }, [flatMovements, workRestNextUrls, workNextUrls]);

  return {
    flatMovements: enrichedFlatMovements,
    restGoVoiceUrl,
    swapSidesCountdownGoVoiceUrl,
    countdownSwapSidesGoVoiceUrl,
    workSwapOtherSideVoiceUrl,
  };
}
