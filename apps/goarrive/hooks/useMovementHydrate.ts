/**
 * useMovementHydrate — Enriches flat movements with the canonical movement doc.
 *
 * Workout blocks store a snapshot of each movement (movementId, movementName,
 * videoUrl, voiceUrl, etc.) at the time the workout was built. After a coach
 * renames or re-records a movement, that snapshot goes stale — but the player
 * needs the current name and the current voiceUrl so it never speaks the old
 * name or plays an MP3 that's been replaced.
 *
 * For every unique movementId in the flat list, this hook fetches
 * `movements/{id}` once and merges canonical fields back into the flat
 * sequence. Two merge strategies:
 *
 *   • Identity / audio fields (name, voiceUrl, voiceText): canonical ALWAYS
 *     wins. These must reflect the current movement doc — the visual title
 *     and the spoken audio have to come from the same source of truth.
 *   • Media / coaching fields (videoUrl, thumbnailUrl, description, etc.):
 *     block snapshot wins; canonical is the fallback. This preserves any
 *     workout-specific overrides the coach set when building the workout.
 */
import { useEffect, useState, useRef } from 'react';
import { db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
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
  const fetchedRef = useRef<Set<string>>(new Set());
  const cacheRef = useRef<Record<string, any>>({});

  useEffect(() => {
    if (flatMovements.length === 0) {
      setHydrated([]);
      return;
    }

    // Collect unique movementIds we haven't fetched yet. Always fetch the
    // canonical doc once per movementId (the previous `!fm.videoUrl` gate
    // skipped the fetch entirely for workouts where blocks already had a
    // videoUrl, which meant voiceUrl/name could never refresh after a rename).
    const idsToFetch: string[] = [];
    for (const fm of flatMovements) {
      if (fm.movementId && !fetchedRef.current.has(fm.movementId)) {
        idsToFetch.push(fm.movementId);
      }
    }

    if (idsToFetch.length === 0) {
      const merged = flatMovements.map((fm) =>
        fm.movementId && cacheRef.current[fm.movementId]
          ? mergeFromCache(fm, cacheRef.current[fm.movementId])
          : fm,
      );
      setHydrated(merged);
      return;
    }

    const uniqueIds = [...new Set(idsToFetch)];

    let cancelled = false;

    (async () => {
      const results = await Promise.allSettled(
        uniqueIds.map(async (id) => {
          const snap = await getDoc(doc(db, 'movements', id));
          return { id, data: snap.exists() ? snap.data() : null };
        })
      );

      if (cancelled) return;

      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.data) {
          cacheRef.current[r.value.id] = r.value.data;
          fetchedRef.current.add(r.value.id);
        } else if (r.status === 'fulfilled') {
          // Document doesn't exist, mark as fetched to avoid retrying
          fetchedRef.current.add(r.value.id);
        }
      }

      const merged = flatMovements.map((fm) =>
        fm.movementId && cacheRef.current[fm.movementId]
          ? mergeFromCache(fm, cacheRef.current[fm.movementId])
          : fm,
      );

      setHydrated(merged);
    })();

    return () => { cancelled = true; };
  }, [flatMovements]);

  return hydrated;
}
