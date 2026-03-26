/**
 * useMovementFilters — Category and equipment filter hook (Suggestion 5)
 *
 * Provides filter state and a filtered list of movements based on:
 *   - Text search (name)
 *   - Category filter (compound, isolation, plyometric, mobility, etc.)
 *   - Equipment filter (barbell, dumbbell, bodyweight, cable, machine, band)
 *   - Muscle group filter
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

export function useMovementFilters(movements: MovementFilterable[]) {
  const [searchText, setSearchText] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [equipmentFilter, setEquipmentFilter] = useState('All');
  const [muscleGroupFilter, setMuscleGroupFilter] = useState('All');

  const filtered = useMemo(() => {
    let list = movements;

    // Text search
    if (searchText.trim()) {
      const q = searchText.toLowerCase().trim();
      list = list.filter((m) => m.name.toLowerCase().includes(q));
    }

    // Category filter
    if (categoryFilter !== 'All') {
      list = list.filter((m) => m.category === categoryFilter);
    }

    // Equipment filter
    if (equipmentFilter !== 'All') {
      list = list.filter((m) => m.equipment === equipmentFilter);
    }

    // Muscle group filter
    if (muscleGroupFilter !== 'All') {
      list = list.filter((m) =>
        (m.muscleGroups || []).some(
          (mg) => mg.toLowerCase() === muscleGroupFilter.toLowerCase(),
        ),
      );
    }

    return list;
  }, [movements, searchText, categoryFilter, equipmentFilter, muscleGroupFilter]);

  const resetFilters = useCallback(() => {
    setSearchText('');
    setCategoryFilter('All');
    setEquipmentFilter('All');
    setMuscleGroupFilter('All');
  }, []);

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (searchText.trim()) count++;
    if (categoryFilter !== 'All') count++;
    if (equipmentFilter !== 'All') count++;
    if (muscleGroupFilter !== 'All') count++;
    return count;
  }, [searchText, categoryFilter, equipmentFilter, muscleGroupFilter]);

  return {
    searchText,
    setSearchText,
    categoryFilter,
    setCategoryFilter,
    equipmentFilter,
    setEquipmentFilter,
    muscleGroupFilter,
    setMuscleGroupFilter,
    filtered,
    resetFilters,
    activeFilterCount,
  };
}
