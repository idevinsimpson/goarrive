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
import { useState, useCallback, useMemo } from 'react';
import { db } from '../lib/firebase';
import {
  collection,
  query,
  where,
  orderBy,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
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
  version?: number;
  lastModifiedAt?: any;
  changelog?: string[];
}

export function useWorkoutTemplates(coachId: string) {
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [tagFilter, setTagFilter] = useState<string>('');

  /** All unique categories across loaded templates */
  const availableCategories = (() => {
    const cats = new Set<string>();
    templates.forEach((t) => {
      if (t.category) cats.add(t.category);
    });
    return ['All', ...Array.from(cats).sort()];
  })();

  /** All unique tags across loaded templates */
  const availableTags = (() => {
    const tags = new Set<string>();
    templates.forEach((t) => {
      (t.tags || []).forEach((tag) => {
        if (tag) tags.add(tag);
      });
    });
    return Array.from(tags).sort();
  })();

  /** Filtered templates based on current category and tag filters (R4: memoized) */
  const filteredTemplates = useMemo(() => templates.filter((t) => {
    if (categoryFilter !== 'All' && t.category !== categoryFilter) return false;
    if (tagFilter && !(t.tags || []).includes(tagFilter)) return false;
    return true;
  }), [templates, categoryFilter, tagFilter]);

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
          version: d.version || 1,
          lastModifiedAt: d.lastModifiedAt || d.createdAt || null,
          changelog: d.changelog || [],
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
          version: d.version || 1,
          lastModifiedAt: d.lastModifiedAt || d.createdAt || null,
          changelog: d.changelog || [],
        });
      });

      setTemplates(result);
      setError(null);
    } catch (err) {
      console.error('[useWorkoutTemplates] Load error:', err);
      setError('Failed to load templates. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [coachId, loading]);

  /** Rename a template */
  const renameTemplate = useCallback(
    async (templateId: string, newName: string) => {
      if (!templateId || !newName.trim()) return;
      try {
        const ref = doc(db, 'workouts', templateId);
        const current = templates.find((t) => t.id === templateId);
        const newVersion = (current?.version || 1) + 1;
        const changeEntry = `v${newVersion}: Renamed to "${newName.trim()}"`;
        await updateDoc(ref, {
          name: newName.trim(),
          version: newVersion,
          lastModifiedAt: new Date(),
          changelog: [...(current?.changelog || []), changeEntry],
        });
        setTemplates((prev) =>
          prev.map((t) =>
            t.id === templateId
              ? { ...t, name: newName.trim(), version: (t.version || 1) + 1, lastModifiedAt: new Date() }
              : t,
          ),
        );
      } catch (err) {
        console.error('[useWorkoutTemplates] Rename error:', err);
        throw err;
      }
    },
    [],
  );

  /** Delete a template — checks for active assignments first */
  const deleteTemplate = useCallback(
    async (templateId: string, force = false): Promise<{ blocked: boolean; assignmentCount?: number }> => {
      if (!templateId) return { blocked: false };
      try {
        // Cascade check: see if any active assignments reference this workout
        if (!force) {
          const assignQ = query(
            collection(db, 'workout_assignments'),
            where('workoutId', '==', templateId),
            where('status', 'in', ['assigned', 'in_progress']),
          );
          const assignSnap = await getDocs(assignQ);
          if (!assignSnap.empty) {
            return { blocked: true, assignmentCount: assignSnap.size };
          }
        }

        await deleteDoc(doc(db, 'workouts', templateId));
        setTemplates((prev) => prev.filter((t) => t.id !== templateId));
        return { blocked: false };
      } catch (err) {
        console.error('[useWorkoutTemplates] Delete error:', err);
        throw err;
      }
    },
    [],
  );

  /** Toggle shared status of a template */
  const toggleShareTemplate = useCallback(
    async (templateId: string, isShared: boolean) => {
      if (!templateId) return;
      try {
        await updateDoc(doc(db, 'workouts', templateId), { isShared });
        setTemplates((prev) =>
          prev.map((t) => (t.id === templateId ? { ...t, isShared } : t)),
        );
      } catch (err) {
        console.error('[useWorkoutTemplates] Share toggle error:', err);
        throw err;
      }
    },
    [],
  );

  return {
    templates,
    filteredTemplates,
    loading,
    error,
    loadTemplates,
    renameTemplate,
    deleteTemplate,
    toggleShareTemplate,
    categoryFilter,
    setCategoryFilter,
    tagFilter,
    setTagFilter,
    availableCategories,
    availableTags,
  };
}
