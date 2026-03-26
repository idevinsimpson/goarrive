/**
 * useMovementSwap — In-player movement substitution
 *
 * Allows a member to swap the current movement for an alternative during
 * a workout. Queries the movement library for same-category alternatives
 * and provides a swap handler that updates the flat movement list.
 *
 * Usage in WorkoutPlayer:
 *   const { alternatives, showSwap, openSwap, closeSwap, swapMovement } =
 *     useMovementSwap(flatMovements, currentIndex, setFlatOverride);
 */
import { useState, useCallback, useMemo } from 'react';
import { db } from '../lib/firebase';
import {
  collection,
  query,
  where,
  limit,
  getDocs,
} from 'firebase/firestore';

interface Alternative {
  id: string;
  name: string;
  category: string;
  mediaUrl?: string | null;
  videoUrl?: string | null;
}

interface FlatMovement {
  name: string;
  duration: number;
  restAfter: number;
  mediaUrl?: string | null;
  videoUrl?: string | null;
  imageUrl?: string | null;
  isRepBased?: boolean;
  reps?: number;
  sets?: number;
  swapSide?: boolean;
  coachingCues?: string;
  category?: string;
  movementId?: string;
  blockLabel?: string;
  roundLabel?: string;
}

export function useMovementSwap(
  flatMovements: FlatMovement[],
  currentIndex: number,
  onSwap?: (updatedFlat: FlatMovement[]) => void,
) {
  const [showSwap, setShowSwap] = useState(false);
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const [loadingAlts, setLoadingAlts] = useState(false);

  const currentMovement = useMemo(
    () => flatMovements[currentIndex] || null,
    [flatMovements, currentIndex],
  );

  const openSwap = useCallback(async () => {
    if (!currentMovement) return;
    setShowSwap(true);
    setLoadingAlts(true);

    try {
      const category = currentMovement.category || '';
      if (!category) {
        setAlternatives([]);
        return;
      }

      // Query same-category movements (limit 10)
      const q = query(
        collection(db, 'movements'),
        where('category', '==', category),
        limit(10),
      );
      const snap = await getDocs(q);

      const alts: Alternative[] = [];
      snap.docs.forEach((doc) => {
        const d = doc.data();
        // Exclude the current movement
        if (d.name === currentMovement.name) return;
        alts.push({
          id: doc.id,
          name: d.name || 'Unknown',
          category: d.category || category,
          mediaUrl: d.mediaUrl || null,
          videoUrl: d.videoUrl || null,
        });
      });

      setAlternatives(alts);
    } catch (err) {
      console.error('[useMovementSwap] Error loading alternatives:', err);
      setAlternatives([]);
    } finally {
      setLoadingAlts(false);
    }
  }, [currentMovement]);

  const closeSwap = useCallback(() => {
    setShowSwap(false);
    setAlternatives([]);
  }, []);

  const swapMovement = useCallback(
    (alt: Alternative) => {
      if (!onSwap || currentIndex < 0 || currentIndex >= flatMovements.length) return;

      // Create updated flat list with the swapped movement
      const updated = [...flatMovements];
      const original = updated[currentIndex];
      updated[currentIndex] = {
        ...original,
        name: alt.name,
        mediaUrl: alt.mediaUrl,
        videoUrl: alt.videoUrl,
        movementId: alt.id,
        category: alt.category,
      };

      onSwap(updated);
      closeSwap();
    },
    [flatMovements, currentIndex, onSwap, closeSwap],
  );

  return {
    showSwap,
    alternatives,
    loadingAlts,
    openSwap,
    closeSwap,
    swapMovement,
    currentMovement,
  };
}
