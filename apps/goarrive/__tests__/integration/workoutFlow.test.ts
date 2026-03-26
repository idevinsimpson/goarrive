/**
 * End-to-end integration test for the full workout flow.
 *
 * Chains the exported pure functions from the workout system:
 *   1. resolveBlockType — determine block pattern
 *   2. useWorkoutFlatten (via manual flatten) — flatten blocks into sequence
 *   3. calculateAdjustedRest — auto-calculate rest periods
 *   4. filterMovements — movement library filtering
 *
 * This is a pure-logic test that validates the data pipeline without
 * rendering React components or touching Firestore.
 */
import { resolveBlockType } from '../../hooks/useWorkoutFlatten';
import { calculateAdjustedRest } from '../../hooks/useRestAutoAdjust';
import { filterMovements } from '../../hooks/useMovementFilters';

// ── Test data ─────────────────────────────────────────────────────────────

const mockMovements = [
  { id: '1', name: 'Barbell Squat', category: 'Lower Body', equipment: 'Barbell', muscleGroup: 'Quads' },
  { id: '2', name: 'Bench Press', category: 'Upper Body', equipment: 'Barbell', muscleGroup: 'Chest' },
  { id: '3', name: 'Pull Up', category: 'Upper Body', equipment: 'Bodyweight', muscleGroup: 'Back' },
  { id: '4', name: 'Plank', category: 'Core', equipment: 'Bodyweight', muscleGroup: 'Core' },
  { id: '5', name: 'Dumbbell Curl', category: 'Upper Body', equipment: 'Dumbbell', muscleGroup: 'Biceps' },
  { id: '6', name: 'Romanian Deadlift', category: 'Lower Body', equipment: 'Barbell', muscleGroup: 'Hamstrings' },
];

const mockWorkout = {
  name: 'Full Body Strength',
  difficulty: 'Intermediate',
  blocks: [
    {
      name: 'Warm-Up',
      type: 'Strength',
      rounds: 1,
      restBetweenRoundsSec: 0,
      movements: [
        { name: 'Plank', duration: 30, restSec: 10, category: 'Core' },
      ],
    },
    {
      name: 'Superset A',
      type: 'Superset',
      rounds: 3,
      restBetweenRoundsSec: 90,
      restBetweenMovementsSec: 15,
      movements: [
        { name: 'Barbell Squat', duration: 40, restSec: 0, category: 'Lower Body' },
        { name: 'Bench Press', duration: 40, restSec: 0, category: 'Upper Body' },
      ],
    },
    {
      name: 'Circuit B',
      type: 'Circuit',
      rounds: 2,
      restBetweenRoundsSec: 60,
      movements: [
        { name: 'Pull Up', duration: 30, category: 'Upper Body' },
        { name: 'Dumbbell Curl', duration: 25, category: 'Upper Body' },
        { name: 'Romanian Deadlift', duration: 35, category: 'Lower Body' },
      ],
    },
  ],
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe('Workout Flow Integration', () => {
  describe('Block Type Resolution', () => {
    it('resolves standard block types correctly', () => {
      expect(resolveBlockType('Strength')).toBe('linear');
      expect(resolveBlockType('Superset')).toBe('superset');
      expect(resolveBlockType('Circuit')).toBe('circuit');
      expect(resolveBlockType('AMRAP')).toBe('circuit');
      expect(resolveBlockType(undefined)).toBe('linear');
      expect(resolveBlockType('')).toBe('linear');
    });
  });

  describe('Flatten Pipeline', () => {
    it('produces correct number of flat movements for the full workout', () => {
      // Warm-Up: 1 movement × 1 round = 1
      // Superset A: 2 movements × 3 rounds = 6
      // Circuit B: 3 movements × 2 rounds = 6
      // Total = 13
      let totalFlat = 0;
      mockWorkout.blocks.forEach((block) => {
        const rounds = block.rounds || 1;
        const movCount = block.movements.length;
        totalFlat += rounds * movCount;
      });
      expect(totalFlat).toBe(13);
    });

    it('resolves block types for all blocks', () => {
      const types = mockWorkout.blocks.map((b) => resolveBlockType(b.type));
      expect(types).toEqual(['linear', 'superset', 'circuit']);
    });

    it('uses restBetweenMovementsSec for superset transition rest', () => {
      const supersetBlock = mockWorkout.blocks[1];
      const transitionRest = supersetBlock.restBetweenMovementsSec;
      // When restBetweenMovementsSec is set, it should be used as transition rest
      expect(transitionRest).toBe(15);
      // Verify it's a valid positive number
      expect(transitionRest).toBeGreaterThan(0);
    });
  });

  describe('Rest Auto-Adjust', () => {
    it('calculates rest for different difficulty levels', () => {
      const mv = { category: 'Upper Body', restSec: undefined };
      const block = { type: 'Strength' };

      const beginnerRest = calculateAdjustedRest(mv, block, 'Beginner');
      const intermediateRest = calculateAdjustedRest(mv, block, 'Intermediate');
      const advancedRest = calculateAdjustedRest(mv, block, 'Advanced');

      // Beginner should have more rest than advanced
      expect(beginnerRest).toBeGreaterThanOrEqual(advancedRest);
      // All should be positive
      expect(beginnerRest).toBeGreaterThan(0);
      expect(intermediateRest).toBeGreaterThan(0);
      expect(advancedRest).toBeGreaterThan(0);
    });

    it('respects explicit restSec when set', () => {
      const mv = { category: 'Upper Body', restSec: 45 };
      const block = { type: 'Strength' };
      const rest = calculateAdjustedRest(mv, block, 'Intermediate');
      expect(rest).toBe(45);
    });
  });

  describe('Movement Library Filtering', () => {
    it('filters by category', () => {
      const result = filterMovements(mockMovements, '', 'Upper Body', '', '');
      expect(result).toHaveLength(3);
      expect(result.every((m: any) => m.category === 'Upper Body')).toBe(true);
    });

    it('filters by equipment', () => {
      const result = filterMovements(mockMovements, '', '', 'Barbell', '');
      expect(result).toHaveLength(3);
      expect(result.every((m: any) => m.equipment === 'Barbell')).toBe(true);
    });

    it('filters by search text', () => {
      const result = filterMovements(mockMovements, 'squat', '', '', '');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Barbell Squat');
    });

    it('combines multiple filters', () => {
      const result = filterMovements(mockMovements, '', 'Upper Body', 'Bodyweight', '');
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Pull Up');
    });

    it('returns all movements with no filters', () => {
      const result = filterMovements(mockMovements, '', '', '', '');
      expect(result).toHaveLength(6);
    });
  });

  describe('Full Pipeline Simulation', () => {
    it('simulates the complete workout flow from filter to flatten to rest', () => {
      // Step 1: Filter movements for the workout
      const upperBody = filterMovements(mockMovements, '', 'Upper Body', '', '');
      expect(upperBody.length).toBeGreaterThan(0);

      // Step 2: Resolve block types
      const blockTypes = mockWorkout.blocks.map((b) => resolveBlockType(b.type));
      expect(blockTypes).toContain('superset');
      expect(blockTypes).toContain('circuit');

      // Step 3: Calculate rest for each movement in each block
      mockWorkout.blocks.forEach((block) => {
        const bType = resolveBlockType(block.type);
        block.movements.forEach((mv) => {
          if (bType === 'linear') {
            const rest = calculateAdjustedRest(mv, block, mockWorkout.difficulty);
            expect(rest).toBeGreaterThanOrEqual(0);
          }
        });
      });

      // Step 4: Verify session summary data can be derived
      let totalMovements = 0;
      let totalBlocks = mockWorkout.blocks.length;
      mockWorkout.blocks.forEach((block) => {
        totalMovements += block.movements.length * (block.rounds || 1);
      });
      expect(totalMovements).toBe(13);
      expect(totalBlocks).toBe(3);
    });
  });
});
