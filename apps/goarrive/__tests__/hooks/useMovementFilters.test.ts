/**
 * Integration tests for useMovementFilters / filterMovements
 *
 * Tests the actual exported filterMovements function from the hook module.
 * Uses the shared fixture to keep test data consistent with real Firestore schema.
 */
import { filterMovements } from '../../hooks/useMovementFilters';
import { mockMovements } from '../fixtures/movements';

describe('filterMovements', () => {
  test('returns all movements with no filters', () => {
    expect(filterMovements(mockMovements, {})).toHaveLength(7);
  });

  test('filters by search text', () => {
    const result = filterMovements(mockMovements, { search: 'squat' });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Barbell Squat');
  });

  test('filters by category', () => {
    const result = filterMovements(mockMovements, { category: 'Upper Body' });
    expect(result).toHaveLength(4); // Bench Press, Push-Up, Dumbbell Curl, Pull Up
  });

  test('filters by equipment', () => {
    const result = filterMovements(mockMovements, { equipment: 'Bodyweight' });
    expect(result).toHaveLength(3); // Plank, Push-Up, Pull Up
  });

  test('filters by muscle group', () => {
    const result = filterMovements(mockMovements, { muscleGroup: 'Chest' });
    expect(result).toHaveLength(2); // Bench Press, Push-Up
  });

  test('combines multiple filters', () => {
    const result = filterMovements(mockMovements, {
      equipment: 'Barbell',
      category: 'Lower Body',
    });
    expect(result).toHaveLength(2); // Barbell Squat, Romanian Deadlift
  });

  test('returns empty for no matches', () => {
    expect(filterMovements(mockMovements, { search: 'nonexistent' })).toHaveLength(0);
  });

  test('search is case-insensitive', () => {
    expect(filterMovements(mockMovements, { search: 'BENCH' })).toHaveLength(1);
  });

  test('"All" category returns everything', () => {
    expect(filterMovements(mockMovements, { category: 'All' })).toHaveLength(7);
  });
});
