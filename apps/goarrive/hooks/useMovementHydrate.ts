/**
 * useMovementHydrate — Enriches flat movements with the canonical movement doc.
 *
 * Workout blocks store a snapshot of each movement (movementId, movementName,
 * videoUrl, voiceUrl, etc.) at the time the workout was built. After a coach
 * renames or re-records a movement, that snapshot goes stale — but the player
 * needs the current name and the current voiceUrl so it never speaks the old
 * name or plays an MP3 that's been replaced.
 *
 * For every unique movementId in the flat list, this hook subscribes to
 * `movements/{id}` via onSnapshot and merges canonical fields back into the
 * flat sequence. Live subscription (not getDoc) is the whole point: when a
 * coach renames a movement, generateMovementVoice writes the new voiceUrl to
 * Firestore asynchronously (2-5s after rename for the OpenAI round trip).
 * onSnapshot pushes that update to the player so the next phase that reads
 * voiceUrl gets the freshly-generated MP3 instead of the cleared/stale value.
 *
 * Two merge strategies:
 *   • Identity / audio fields (name, voiceUrl, voiceText): canonical ALWAYS
 *     wins. These must reflect the current movement doc — the visual title
 *     and the spoken audio have to come from the same source of truth.
 *   • Media / coaching fields (videoUrl, thumbnailUrl, description, etc.):
 *     block snapshot wins; canonical is the fallback. This preserves any
 *     workout-specific overrides the coach set when building the workout.
 */
import { useEffect, useState, useRef } from 'react';
import { db } from '../lib/firebase';
import { doc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import type { FlatMovement } from './useWorkoutFlatten';

function mergeFromCache(fm: FlatMovement, cached: any): FlatMovement {
  // Canonical wins for identity + audio so a rename always propagates.
  // For voiceUrl specifically: if the canonical doc has been cleared (e.g.
  // mid-regeneration after a rename), we WANT '' so the player falls back
  // to fresh Web Speech instead of speaking the stale block snapshot's clip.
  const canonicalName = typeof cached.name === 'string' && cached.name.trim()
    ? cached.name
    : fm.name;
  const canonicalVoiceUrl = typeof cached.voiceUrl === 'string'
    ? cached.voiceUrl
    : (fm.voiceUrl || '');
  return {
    ...fm,
    name: canonicalName,
    voiceUrl: canonicalVoiceUrl,
    videoUrl: fm.videoUrl || cached.videoUrl || '',
    thumbnailUrl: fm.thumbnailUrl || cached.thumbnailUrl || '',
    description: fm.description || cached.description || '',
    coachingCues: fm.coachingCues || cached.coachingCues || '',
    cropScale: fm.cropScale ?? cached.cropScale ?? 1,
    cropTranslateX: fm.cropTranslateX ?? cached.cropTranslateX ?? 0,
    cropTranslateY: fm.cropTranslateY ?? cached.cropTranslateY ?? 0,
  };
}

export function useMovementHydrate(flatMovements: FlatMovement[]): FlatMovement[] {
  const [hydrated, setHydrated] = useState<FlatMovement[]>(flatMovements);
  const cacheRef = useRef<Record<string, any>>({});
  const subsRef = useRef<Map<string, Unsubscribe>>(new Map());
  const flatRef = useRef<FlatMovement[]>(flatMovements);

  // Always have the latest flat list available to the snapshot callback so
  // updates merge against the right source array even between renders.
  useEffect(() => { flatRef.current = flatMovements; }, [flatMovements]);

  useEffect(() => {
    if (flatMovements.length === 0) {
      setHydrated([]);
      return;
    }

    const recomputeMerged = () => {
      const merged = flatRef.current.map((fm) =>
        fm.movementId && cacheRef.current[fm.movementId]
          ? mergeFromCache(fm, cacheRef.current[fm.movementId])
          : fm,
      );
      setHydrated(merged);
    };

    // Render synchronously with whatever's already cached so the UI doesn't
    // flash empty data on flatMovements changes (e.g. swap).
    recomputeMerged();

    const desiredIds = new Set<string>();
    for (const fm of flatMovements) {
      if (fm.movementId) desiredIds.add(fm.movementId);
    }

    // Subscribe to any new movement docs we don't already watch. We never
    // tear down on flatMovements changes here — only at unmount — because
    // the same movement can disappear and reappear (swap/un-swap) and we
    // want to keep the live update flowing through that.
    for (const id of desiredIds) {
      if (subsRef.current.has(id)) continue;
      const unsub = onSnapshot(
        doc(db, 'movements', id),
        (snap) => {
          if (snap.exists()) {
            cacheRef.current[id] = snap.data();
            recomputeMerged();
          }
        },
        (err) => {
          console.warn('[useMovementHydrate] onSnapshot error for', id, err);
        },
      );
      subsRef.current.set(id, unsub);
    }
  }, [flatMovements]);

  // Final cleanup on unmount. Snapshot the refs into locals up-front so the
  // cleanup doesn't read .current after a future render swapped in a new Map
  // (the lint warning that flags this pattern).
  useEffect(() => {
    const subs = subsRef.current;
    const cache = cacheRef.current;
    return () => {
      for (const unsub of subs.values()) unsub();
      subs.clear();
      for (const k of Object.keys(cache)) delete cache[k];
    };
  }, []);

  return hydrated;
}
