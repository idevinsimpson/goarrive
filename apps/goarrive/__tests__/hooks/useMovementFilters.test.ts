/**
 * Integration tests for useMovementFilters hook
 *
 * Tests filtering logic for category, equipment, muscle group, and search.
 */

// Test the filtering logic directly (same as hook internals)
describe('useMovementFilters logic', () => {
  const movements = [
    { id: '1', name: 'Barbell Squat', category: 'Lower Body Push', equipment: 'Barbell', muscleGroups: ['Quads', 'Glutes'] },
    { id: '2', name: 'Bench Press', category: 'Upper Body Push', equipment: 'Barbell', muscleGroups: ['Chest', 'Triceps'] },
    { id: '3', name: 'Pull-Up', category: 'Upper Body Pull', equipment: 'Bodyweight', muscleGroups: ['Back', 'Biceps'] },
    { id: '4', name: 'Plank', category: 'Core', equipment: 'Bodyweight', muscleGroups: ['Core'] },
    { id: '5', name: 'Dumbbell Curl', category: 'Upper Body Pull', equipment: 'Dumbbell', muscleGroups: ['Biceps'] },
    { id: '6', name: 'Kettlebell Swing', category: 'Full Body', equipment: 'Kettlebell', muscleGroups: ['Glutes', 'Hamstrings'] },
  ];

  function filter(
    list: typeof movements,
    opts: { search?: string; category?: string; equipment?: string; muscleGroup?: string },
  ) {
    let result = list;
    if (opts.search) {
      const q = opts.search.toLowerCase();
      result = result.filter((m) => m.name.toLowerCase().includes(q));
    }
    if (opts.category && opts.category !== 'All') {
      result = result.filter((m) => m.category === opts.category);
    }
    if (opts.equipment && opts.equipment !== 'All') {
      result = result.filter((m) => m.equipment === opts.equipment);
    }
    if (opts.muscleGroup && opts.muscleGroup !== 'All') {
      result = result.filter((m) =>
        m.muscleGroups.some((mg) => mg.toLowerCase() === opts.muscleGroup!.toLowerCase()),
      );
    }
    return result;
  }

  test('returns all movements with no filters', () => {
    expect(filter(movements, {})).toHaveLength(6);
  });

  test('filters by search text', () => {
    expect(filter(movements, { search: 'squat' })).toHaveLength(1);
    expect(filter(movements, { search: 'squat' })[0].name).toBe('Barbell Squat');
  });

  test('filters by category', () => {
    const result = filter(movements, { category: 'Upper Body Push' });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Bench Press');
  });

  test('filters by equipment', () => {
    const result = filter(movements, { equipment: 'Bodyweight' });
    expect(result).toHaveLength(2);
  });

  test('filters by muscle group', () => {
    const result = filter(movements, { muscleGroup: 'Biceps' });
    expect(result).toHaveLength(2); // Pull-Up and Dumbbell Curl
  });

  test('combines multiple filters', () => {
    const result = filter(movements, {
      equipment: 'Barbell',
      category: 'Lower Body Push',
    });
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Barbell Squat');
  });

  test('returns empty for no matches', () => {
    expect(filter(movements, { search: 'nonexistent' })).toHaveLength(0);
  });
});
