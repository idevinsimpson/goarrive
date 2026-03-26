/**
 * useWorkoutTemplates — Load workout templates for the template-plus-tweak workflow
 *
 * Queries workouts where isTemplate === true for the current coach,
 * plus shared templates. Returns a list the coach can pick from to
 * pre-fill WorkoutForm fields.
 *
 * Usage:
 *   const { templates, loading, loadTemplates } = useWorkoutTemplates(coachId);
 */
import { useState, useCallback } from 'react';
import { db } from '../lib/firebase';
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
} from 'firebase/firestore';

export interface WorkoutTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  difficulty: string;
  estimatedDurationMin: number | null;
  tags: string[];
  blocks: any[];
  isShared?: boolean;
}

export function useWorkoutTemplates(coachId: string) {
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  const loadTemplates = useCallback(async () => {
    if (!coachId || loading) return;
    setLoading(true);
    try {
      // Query coach's own templates
      const coachQ = query(
        collection(db, 'workouts'),
        where('coachId', '==', coachId),
        where('isTemplate', '==', true),
        orderBy('createdAt', 'desc'),
      );

      // Query shared templates
      const sharedQ = query(
        collection(db, 'workouts'),
        where('isTemplate', '==', true),
        where('isShared', '==', true),
      );

      const [coachSnap, sharedSnap] = await Promise.all([
        getDocs(coachQ),
        getDocs(sharedQ),
      ]);

      const seen = new Set<string>();
      const result: WorkoutTemplate[] = [];

      // Coach templates first
      coachSnap.docs.forEach((doc) => {
        if (seen.has(doc.id)) return;
        seen.add(doc.id);
        const d = doc.data();
        result.push({
          id: doc.id,
          name: d.name || 'Untitled Template',
          description: d.description || '',
          category: d.category || '',
          difficulty: d.difficulty || 'Intermediate',
          estimatedDurationMin: d.estimatedDurationMin || null,
          tags: d.tags || [],
          blocks: d.blocks || [],
          isShared: false,
        });
      });

      // Shared templates (skip duplicates)
      sharedSnap.docs.forEach((doc) => {
        if (seen.has(doc.id)) return;
        seen.add(doc.id);
        const d = doc.data();
        result.push({
          id: doc.id,
          name: d.name || 'Untitled Template',
          description: d.description || '',
          category: d.category || '',
          difficulty: d.difficulty || 'Intermediate',
          estimatedDurationMin: d.estimatedDurationMin || null,
          tags: d.tags || [],
          blocks: d.blocks || [],
          isShared: true,
        });
      });

      setTemplates(result);
    } catch (err) {
      console.error('[useWorkoutTemplates] Load error:', err);
    } finally {
      setLoading(false);
    }
  }, [coachId, loading]);

  return { templates, loading, loadTemplates };
}
