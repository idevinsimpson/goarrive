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
import { useState, useCallback, useMemo, useRef } from 'react';
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
  muscleGroup?: string;
  movementId?: string;
  blockLabel?: string;
  roundLabel?: string;
}

export interface SwapLogEntry {
  originalName: string;
  originalId?: string;
  swappedName: string;
  swappedId: string;
  category: string;
  reason?: string;
  timestamp: number;
}

export function useMovementSwap(
  flatMovements: FlatMovement[],
  currentIndex: number,
  onSwap?: (updatedFlat: FlatMovement[]) => void,
) {
  const [showSwap, setShowSwap] = useState(false);
  const [alternatives, setAlternatives] = useState<Alternative[]>([]);
  const [loadingAlts, setLoadingAlts] = useState(false);
  const swapLogRef = useRef<SwapLogEntry[]>([]);

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

      // Fallback 1: if no same-category alternatives, try same muscle group
      if (alts.length === 0 && currentMovement.muscleGroup) {
        const muscleQ = query(
          collection(db, 'movements'),
          where('muscleGroup', '==', currentMovement.muscleGroup),
          limit(10),
        );
        const muscleSnap = await getDocs(muscleQ);
        muscleSnap.docs.forEach((doc) => {
          const d = doc.data();
          if (d.name === currentMovement.name) return;
          alts.push({
            id: doc.id,
            name: d.name || 'Unknown',
            category: d.category || 'General',
            mediaUrl: d.mediaUrl || null,
            videoUrl: d.videoUrl || null,
          });
        });
      }

      // Fallback 2: if still no alternatives, broaden to all movements
      if (alts.length === 0) {
        const fallbackQ = query(
          collection(db, 'movements'),
          limit(10),
        );
        const fallbackSnap = await getDocs(fallbackQ);
        fallbackSnap.docs.forEach((doc) => {
          const d = doc.data();
          if (d.name === currentMovement.name) return;
          alts.push({
            id: doc.id,
            name: d.name || 'Unknown',
            category: d.category || 'General',
            mediaUrl: d.mediaUrl || null,
            videoUrl: d.videoUrl || null,
          });
        });
      }

      // Sort by relevance: same muscle group first, then same equipment, then alphabetical
      const curMuscle = (currentMovement.muscleGroup || '').toLowerCase();
      alts.sort((a, b) => {
        // Score: higher is more relevant
        const scoreA = (a.category === (currentMovement.category || '') ? 2 : 0);
        const scoreB = (b.category === (currentMovement.category || '') ? 2 : 0);
        if (scoreA !== scoreB) return scoreB - scoreA;
        // Alphabetical tiebreaker
        return a.name.localeCompare(b.name);
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
    (alt: Alternative, reason?: string) => {
      if (!onSwap || currentIndex < 0 || currentIndex >= flatMovements.length) return;

      // Create updated flat list with the swapped movement
      const updated = [...flatMovements];
      const original = updated[currentIndex];

      // Log the swap (capped at 50 entries to prevent unbounded growth)
      if (swapLogRef.current.length < 50) {
        swapLogRef.current.push({
          originalName: original.name,
          originalId: original.movementId,
          swappedName: alt.name,
          swappedId: alt.id,
          category: alt.category,
          reason: reason || undefined,
          timestamp: Date.now(),
        });
      }

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

  /** Get all swaps made during this session */
  const getSwapLog = useCallback((): SwapLogEntry[] => {
    return [...swapLogRef.current];
  }, []);

  /** Reset swap log (e.g. when starting a new workout) */
  const resetSwapLog = useCallback(() => {
    swapLogRef.current = [];
  }, []);

  return {
    showSwap,
    alternatives,
    loadingAlts,
    openSwap,
    closeSwap,
    swapMovement,
    currentMovement,
    getSwapLog,
    resetSwapLog,
  };
}
