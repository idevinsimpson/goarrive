/**
 * useMovementHydrate — Enriches flat movements with video/thumbnail data
 *
 * Workout blocks store only movementId, movementName, reps, and sets.
 * The actual videoUrl, thumbnailUrl, coachingCues, and description live
 * in the top-level "movements" Firestore collection.
 *
 * This hook fetches those documents once (batched) and merges the data
 * into the flat movement array so the WorkoutPlayer can display videos.
 */
import { useEffect, useState, useRef } from 'react';
import { db } from '../lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { FlatMovement } from './useWorkoutFlatten';

export function useMovementHydrate(flatMovements: FlatMovement[]): FlatMovement[] {
  const [hydrated, setHydrated] = useState<FlatMovement[]>(flatMovements);
  const fetchedRef = useRef<Set<string>>(new Set());
  const cacheRef = useRef<Record<string, any>>({});

  useEffect(() => {
    if (flatMovements.length === 0) {
      setHydrated([]);
      return;
    }

    // Collect unique movementIds that need fetching
    const idsToFetch: string[] = [];
    for (const fm of flatMovements) {
      if (fm.movementId && !fetchedRef.current.has(fm.movementId) && !fm.videoUrl) {
        idsToFetch.push(fm.movementId);
      }
    }

    // If all movements already have video data or no IDs to fetch, just apply cache
    if (idsToFetch.length === 0) {
      const merged = flatMovements.map((fm) => {
        if (fm.movementId && cacheRef.current[fm.movementId]) {
          const cached = cacheRef.current[fm.movementId];
          return {
            ...fm,
            videoUrl: fm.videoUrl || cached.videoUrl || '',
            thumbnailUrl: fm.thumbnailUrl || cached.thumbnailUrl || '',
            description: fm.description || cached.description || '',
            coachingCues: fm.coachingCues || cached.coachingCues || '',
            cropScale: fm.cropScale ?? cached.cropScale ?? 1,
            cropTranslateX: fm.cropTranslateX ?? cached.cropTranslateX ?? 0,
            cropTranslateY: fm.cropTranslateY ?? cached.cropTranslateY ?? 0,
          };
        }
        return fm;
      });
      setHydrated(merged);
      return;
    }

    // Deduplicate
    const uniqueIds = [...new Set(idsToFetch)];

    let cancelled = false;

    (async () => {
      // Fetch all movement docs in parallel
      const results = await Promise.allSettled(
        uniqueIds.map(async (id) => {
          const snap = await getDoc(doc(db, 'movements', id));
          return { id, data: snap.exists() ? snap.data() : null };
        })
      );

      if (cancelled) return;

      // Cache results
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value.data) {
          cacheRef.current[r.value.id] = r.value.data;
          fetchedRef.current.add(r.value.id);
        } else if (r.status === 'fulfilled') {
          // Document doesn't exist, mark as fetched to avoid retrying
          fetchedRef.current.add(r.value.id);
        }
      }

      // Merge into flat movements
      const merged = flatMovements.map((fm) => {
        if (fm.movementId && cacheRef.current[fm.movementId]) {
          const cached = cacheRef.current[fm.movementId];
          return {
            ...fm,
            videoUrl: fm.videoUrl || cached.videoUrl || '',
            thumbnailUrl: fm.thumbnailUrl || cached.thumbnailUrl || '',
            description: fm.description || cached.description || '',
            coachingCues: fm.coachingCues || cached.coachingCues || '',
            cropScale: fm.cropScale ?? cached.cropScale ?? 1,
            cropTranslateX: fm.cropTranslateX ?? cached.cropTranslateX ?? 0,
            cropTranslateY: fm.cropTranslateY ?? cached.cropTranslateY ?? 0,
          };
        }
        return fm;
      });

      setHydrated(merged);
    })();

    return () => { cancelled = true; };
  }, [flatMovements]);

  return hydrated;
}
