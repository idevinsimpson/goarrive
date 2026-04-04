/**
 * Integration tests for useMovementFilters / filterMovements / sortMovements
 *
 * Tests the actual exported functions from the hook module.
 * Uses the shared fixture to keep test data consistent with real Firestore schema.
 */
import { filterMovements, sortMovements } from '../../hooks/useMovementFilters';
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
    expect(result).toHaveLength(4);
  });

  test('filters by equipment', () => {
    const result = filterMovements(mockMovements, { equipment: 'Bodyweight' });
    expect(result).toHaveLength(3);
  });

  test('filters by muscle group', () => {
    const result = filterMovements(mockMovements, { muscleGroup: 'Chest' });
    expect(result).toHaveLength(2); // Bench Press, Push-Up
  });

  test('filters by difficulty', () => {
    const result = filterMovements(mockMovements, { difficulty: 'Beginner' });
    expect(result).toHaveLength(3); // Plank, Push-Up, Dumbbell Curl
  });

  test('difficulty filter is case-insensitive', () => {
    const result = filterMovements(mockMovements, { difficulty: 'beginner' });
    expect(result).toHaveLength(3);
  });

  test('"All" difficulty returns everything', () => {
    expect(filterMovements(mockMovements, { difficulty: 'All' })).toHaveLength(7);
  });

  test('combines difficulty with other filters', () => {
    const result = filterMovements(mockMovements, { difficulty: 'Intermediate', category: 'Upper Body' });
    expect(result).toHaveLength(2); // Bench Press, Pull Up
  });

  test('combines multiple filters', () => {
    const result = filterMovements(mockMovements, {
      equipment: 'Barbell',
      category: 'Lower Body',
    });
    expect(result).toHaveLength(2);
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

describe('sortMovements', () => {
  test('sorts by name ascending', () => {
    const result = sortMovements(mockMovements, 'name-asc');
    expect(result[0].name).toBe('Barbell Squat');
    expect(result[result.length - 1].name).toBe('Romanian Deadlift');
  });

  test('sorts by name descending', () => {
    const result = sortMovements(mockMovements, 'name-desc');
    expect(result[0].name).toBe('Romanian Deadlift');
    expect(result[result.length - 1].name).toBe('Barbell Squat');
  });

  test('sorts by newest (highest createdAt.seconds first)', () => {
    const result = sortMovements(mockMovements, 'newest');
    expect(result[0].name).toBe('Pull Up');       // seconds: 7000
    expect(result[1].name).toBe('Dumbbell Curl');  // seconds: 6000
  });

  test('sorts by oldest (lowest createdAt.seconds first)', () => {
    const result = sortMovements(mockMovements, 'oldest');
    expect(result[0].name).toBe('Bench Press');    // seconds: 1000
    expect(result[1].name).toBe('Barbell Squat');  // seconds: 2000
  });

  test('sorts by recently edited (uses updatedAt when available)', () => {
    const result = sortMovements(mockMovements, 'recently-edited');
    // Push-Up has updatedAt: 6000, Dumbbell Curl has createdAt: 6000
    // Pull Up has createdAt: 7000 (no updatedAt, falls back to createdAt)
    expect(result[0].name).toBe('Pull Up');        // createdAt: 7000
    expect(result[1].name).toBe('Push-Up');        // updatedAt: 6000
  });

  test('does not mutate the original array', () => {
    const original = [...mockMovements];
    sortMovements(mockMovements, 'name-asc');
    expect(mockMovements.map(m => m.id)).toEqual(original.map(m => m.id));
  });
});
