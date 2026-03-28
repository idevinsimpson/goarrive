/**
 * useMovementFilters — Category, equipment, muscle group, difficulty filter + sorting hook
 *
 * Provides filter state and a filtered + sorted list of movements based on:
 *   - Text search (name)
 *   - Category filter
 *   - Equipment filter
 *   - Muscle group filter
 *   - Difficulty filter
 *   - Sort order
 *
 * Designed for use in both the movement library page and the movement
 * picker within the workout builder.
 */
import { useState, useMemo, useCallback } from 'react';

export interface MovementFilterable {
  id: string;
  name: string;
  category?: string;
  equipment?: string;
  muscleGroups?: string[];
  difficulty?: string;
  createdAt?: any;
  updatedAt?: any;
  [key: string]: any;
}

export const EQUIPMENT_FILTER_OPTIONS = [
  'All',
  'Bodyweight',
  'Dumbbell',
  'Barbell',
  'Kettlebell',
  'Band',
  'Cable',
  'Machine',
] as const;

export const CATEGORY_FILTER_OPTIONS = [
  'All',
  'Upper Body Push',
  'Upper Body Pull',
  'Lower Body Push',
  'Lower Body Pull',
  'Core',
  'Cardio',
  'Mobility',
] as const;

export const MUSCLE_GROUP_FILTER_OPTIONS = [
  'All',
  'Chest',
  'Back',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Quads',
  'Hamstrings',
  'Glutes',
  'Calves',
  'Core',
  'Full Body',
] as const;

export const DIFFICULTY_FILTER_OPTIONS = [
  'All',
  'Beginner',
  'Intermediate',
  'Advanced',
] as const;

export type SortOption =
  | 'name-asc'
  | 'name-desc'
  | 'newest'
  | 'oldest'
  | 'recently-edited';

export const SORT_OPTIONS: { value: SortOption; label: string }[] = [
  { value: 'name-asc', label: 'Name A–Z' },
  { value: 'name-desc', label: 'Name Z–A' },
  { value: 'newest', label: 'Newest Added' },
  { value: 'oldest', label: 'Oldest Added' },
  { value: 'recently-edited', label: 'Recently Edited' },
];

/** Standalone filter function — can be tested without React hooks */
export function filterMovements(
  movements: MovementFilterable[],
  opts: {
    search?: string;
    category?: string;
    equipment?: string;
    muscleGroup?: string;
    difficulty?: string;
  },
): MovementFilterable[] {
  let list = movements;

  if (opts.search?.trim()) {
    const q = opts.search.toLowerCase().trim();
    list = list.filter((m) => m.name.toLowerCase().includes(q));
  }
  if (opts.category && opts.category !== 'All') {
    list = list.filter((m) => m.category === opts.category);
  }
  if (opts.equipment && opts.equipment !== 'All') {
    list = list.filter((m) => m.equipment === opts.equipment);
  }
  if (opts.muscleGroup && opts.muscleGroup !== 'All') {
    list = list.filter((m) =>
      (m.muscleGroups || []).some(
        (mg) => mg.toLowerCase() === opts.muscleGroup!.toLowerCase(),
      ),
    );
  }
  if (opts.difficulty && opts.difficulty !== 'All') {
    list = list.filter(
      (m) =>
        (m.difficulty || '').toLowerCase() === opts.difficulty!.toLowerCase(),
    );
  }
  return list;
}

/** Sort movements by the given option */
function sortMovements(
  movements: MovementFilterable[],
  sortBy: SortOption,
): MovementFilterable[] {
  const sorted = [...movements];
  switch (sortBy) {
    case 'name-asc':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'name-desc':
      return sorted.sort((a, b) => b.name.localeCompare(a.name));
    case 'newest':
      return sorted.sort((a, b) => {
        const at = a.createdAt?.seconds ?? 0;
        const bt = b.createdAt?.seconds ?? 0;
        return bt - at;
      });
    case 'oldest':
      return sorted.sort((a, b) => {
        const at = a.createdAt?.seconds ?? 0;
        const bt = b.createdAt?.seconds ?? 0;
        return at - bt;
      });
    case 'recently-edited':
      return sorted.sort((a, b) => {
        const at = a.updatedAt?.seconds ?? a.createdAt?.seconds ?? 0;
        const bt = b.updatedAt?.seconds ?? b.createdAt?.seconds ?? 0;
        return bt - at;
      });
    default:
      return sorted;
  }
}

export function useMovementFilters(movements: MovementFilterable[]) {
  const [searchText, setSearchText] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [equipmentFilter, setEquipmentFilter] = useState('All');
  const [muscleGroupFilter, setMuscleGroupFilter] = useState('All');
  const [difficultyFilter, setDifficultyFilter] = useState('All');
  const [sortBy, setSortBy] = useState<SortOption>('newest');

  const filtered = useMemo(() => {
    const f = filterMovements(movements, {
      search: searchText,
      category: categoryFilter,
      equipment: equipmentFilter,
      muscleGroup: muscleGroupFilter,
      difficulty: difficultyFilter,
    });
    return sortMovements(f, sortBy);
  }, [
    movements,
    searchText,
    categoryFilter,
    equipmentFilter,
    muscleGroupFilter,
    difficultyFilter,
    sortBy,
  ]);

  const resetFilters = useCallback(() => {
    setSearchText('');
    setCategoryFilter('All');
    setEquipmentFilter('All');
    setMuscleGroupFilter('All');
    setDifficultyFilter('All');
  }, []);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (categoryFilter !== 'All') count++;
    if (equipmentFilter !== 'All') count++;
    if (muscleGroupFilter !== 'All') count++;
    if (difficultyFilter !== 'All') count++;
    return count;
  }, [categoryFilter, equipmentFilter, muscleGroupFilter, difficultyFilter]);

  return {
    searchText,
    setSearchText,
    categoryFilter,
    setCategoryFilter,
    equipmentFilter,
    setEquipmentFilter,
    muscleGroupFilter,
    setMuscleGroupFilter,
    difficultyFilter,
    setDifficultyFilter,
    sortBy,
    setSortBy,
    filtered,
    resetFilters,
    activeFilterCount,
  };
}
