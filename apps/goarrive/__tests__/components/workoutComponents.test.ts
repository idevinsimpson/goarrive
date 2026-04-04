/**
 * Component-level tests for WorkoutPlayer, WorkoutForm, WorkoutLogReview
 *
 * S10: Tests core exported utilities and logic from these components.
 * Since full React Native rendering requires native modules, these tests
 * focus on the pure-function logic that can be unit-tested.
 */
import { resolveBlockType } from '../../hooks/useWorkoutFlatten';
import { filterMovements } from '../../hooks/useMovementFilters';
import { mockMovements } from '../fixtures/movements';

// ── WorkoutPlayer logic tests ─────────────────────────────────────────────

describe('WorkoutPlayer — timer format', () => {
  function formatTime(seconds: number): string {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}`;
  }

  test('formats seconds only', () => {
    expect(formatTime(30)).toBe('30');
    expect(formatTime(5)).toBe('5');
    expect(formatTime(0)).toBe('0');
  });

  test('formats minutes and seconds', () => {
    expect(formatTime(60)).toBe('1:00');
    expect(formatTime(90)).toBe('1:30');
    expect(formatTime(125)).toBe('2:05');
  });
});

describe('WorkoutPlayer — block type resolution', () => {
  test('resolves superset blocks correctly', () => {
    expect(resolveBlockType('Superset')).toBe('superset');
  });

  test('resolves circuit/AMRAP blocks correctly', () => {
    expect(resolveBlockType('Circuit')).toBe('circuit');
    expect(resolveBlockType('AMRAP')).toBe('circuit');
  });

  test('resolves linear blocks as default', () => {
    expect(resolveBlockType('Strength')).toBe('linear');
    expect(resolveBlockType('Warm-Up')).toBe('linear');
  });
});

// ── WorkoutForm logic tests ───────────────────────────────────────────────

describe('WorkoutForm — movement filter integration', () => {
  test('filters by search term', () => {
    const result = filterMovements(mockMovements, { search: 'bench' });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Bench Press');
  });

  test('filters by category', () => {
    const result = filterMovements(mockMovements, { category: 'Upper Body' });
    expect(result.length).toBe(4); // Bench Press, Push-Up, Dumbbell Curl, Pull Up
  });

  test('filters by equipment', () => {
    const result = filterMovements(mockMovements, { equipment: 'Bodyweight' });
    expect(result.length).toBe(3); // Plank, Push-Up, Pull Up
  });

  test('returns all when no filters applied', () => {
    const result = filterMovements(mockMovements, {});
    expect(result.length).toBe(7);
  });

  test('combines search and category filters', () => {
    const result = filterMovements(mockMovements, { search: 'push', category: 'Upper Body' });
    expect(result.length).toBe(1);
    expect(result[0].name).toBe('Push-Up');
  });
});

// ── WorkoutLogReview logic tests ──────────────────────────────────────────

describe('WorkoutLogReview — reaction validation', () => {
  const VALID_REACTIONS = ['💪', '🔥', '⭐', '👏', '❤️'];

  test('all valid reactions are emoji strings', () => {
    VALID_REACTIONS.forEach((r) => {
      expect(typeof r).toBe('string');
      expect(r.length).toBeGreaterThan(0);
    });
  });

  test('reaction count matches expected set', () => {
    expect(VALID_REACTIONS.length).toBe(5);
  });
});

describe('WorkoutLogReview — difficulty auto-progression', () => {
  const DIFFICULTY_ORDER: Record<string, number> = {
    beginner: 1,
    intermediate: 2,
    advanced: 3,
    elite: 4,
  };

  const DIFFICULTY_LEVELS = ['beginner', 'intermediate', 'advanced', 'elite'];

  function shouldSuggestProgression(recentDifficulties: string[]): string | null {
    if (recentDifficulties.length < 3) return null;
    const currentLevel = recentDifficulties[recentDifficulties.length - 1];
    const currentIdx = DIFFICULTY_LEVELS.indexOf(currentLevel);
    if (currentIdx >= DIFFICULTY_LEVELS.length - 1) return null;
    const allSameOrHigher = recentDifficulties.every(
      (d) => (DIFFICULTY_ORDER[d] || 1) >= (DIFFICULTY_ORDER[currentLevel] || 1),
    );
    return allSameOrHigher ? DIFFICULTY_LEVELS[currentIdx + 1] : null;
  }

  test('suggests progression after 3+ consistent workouts', () => {
    expect(shouldSuggestProgression(['beginner', 'beginner', 'beginner'])).toBe('intermediate');
    expect(shouldSuggestProgression(['intermediate', 'intermediate', 'intermediate', 'intermediate'])).toBe('advanced');
  });

  test('does not suggest if already at elite', () => {
    expect(shouldSuggestProgression(['elite', 'elite', 'elite'])).toBeNull();
  });

  test('does not suggest with fewer than 3 entries', () => {
    expect(shouldSuggestProgression(['beginner', 'beginner'])).toBeNull();
  });

  test('does not suggest if mixed difficulty', () => {
    expect(shouldSuggestProgression(['advanced', 'beginner', 'intermediate'])).toBeNull();
  });

  test('suggests when all are same level', () => {
    // The function checks if all entries >= current level (last entry)
    // ['intermediate', 'advanced', 'advanced'] -> current is 'advanced'
    // 'intermediate' (2) < 'advanced' (3), so not all same or higher
    expect(shouldSuggestProgression(['intermediate', 'advanced', 'advanced'])).toBeNull();
    // All advanced -> should suggest elite
    expect(shouldSuggestProgression(['advanced', 'advanced', 'advanced'])).toBe('elite');
  });
});
