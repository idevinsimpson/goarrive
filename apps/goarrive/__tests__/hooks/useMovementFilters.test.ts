/**
 * Integration tests for useMovementFilters / filterMovements
 *
 * Tests the actual exported filterMovements function from the hook module.
 * Risk 7: Refactored to import real logic instead of duplicating it.
 */
import { filterMovements } from '../../hooks/useMovementFilters';

const movements = [
  { id: '1', name: 'Barbell Squat', category: 'Lower Body Push', equipment: 'Barbell', muscleGroups: ['Quads', 'Glutes'] },
  { id: '2', name: 'Bench Press', category: 'Upper Body Push', equipment: 'Barbell', muscleGroups: ['Chest', 'Triceps'] },
  { id: '3', name: 'Pull-Up', category: 'Upper Body Pull', equipment: 'Bodyweight', muscleGroups: ['Back', 'Biceps'] },
  { id: '4', name: 'Plank', category: 'Core', equipment: 'Bodyweight', muscleGroups: ['Core'] },
  { id: '5', name: 'Dumbbell Curl', category: 'Upper Body Pull', equipment: 'Dumbbell', muscleGroups: ['Biceps'] },
  { id: '6', name: 'Kettlebell Swing', category: 'Full Body', equipment: 'Kettlebell', muscleGroups: ['Glutes', 'Hamstrings'] },
];

describe('filterMovements', () => {
  test('returns all movements with no filters', () => {
    expect(filterMovements(movements, {})).toHaveLength(6);
  });

  test('filters by search text', () => {
    const result = filterMovements(movements, { search: 'squat' });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Barbell Squat');
  });

  test('filters by category', () => {
    const result = filterMovements(movements, { category: 'Upper Body Push' });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Bench Press');
  });

  test('filters by equipment', () => {
    const result = filterMovements(movements, { equipment: 'Bodyweight' });
    expect(result).toHaveLength(2);
  });

  test('filters by muscle group', () => {
    const result = filterMovements(movements, { muscleGroup: 'Biceps' });
    expect(result).toHaveLength(2); // Pull-Up and Dumbbell Curl
  });

  test('combines multiple filters', () => {
    const result = filterMovements(movements, {
      equipment: 'Barbell',
      category: 'Lower Body Push',
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Barbell Squat');
  });

  test('returns empty for no matches', () => {
    expect(filterMovements(movements, { search: 'nonexistent' })).toHaveLength(0);
  });

  test('search is case-insensitive', () => {
    expect(filterMovements(movements, { search: 'BENCH' })).toHaveLength(1);
  });

  test('"All" category returns everything', () => {
    expect(filterMovements(movements, { category: 'All' })).toHaveLength(6);
  });
});
