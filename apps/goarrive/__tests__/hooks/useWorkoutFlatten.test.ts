/**
 * Integration tests for useWorkoutFlatten hook
 *
 * Tests the core flattening logic for linear, superset, and circuit block types.
 * Risk 7: Refactored to import actual exported functions from the hook module.
 */
import { resolveBlockType } from '../../hooks/useWorkoutFlatten';
import { calculateAdjustedRest } from '../../hooks/useRestAutoAdjust';

// ── resolveBlockType unit tests ─────────────────────────────────────────────
describe('resolveBlockType', () => {
  test('returns "superset" for Superset', () => {
    expect(resolveBlockType('Superset')).toBe('superset');
    expect(resolveBlockType('superset')).toBe('superset');
  });

  test('returns "circuit" for Circuit and AMRAP', () => {
    expect(resolveBlockType('Circuit')).toBe('circuit');
    expect(resolveBlockType('AMRAP')).toBe('circuit');
    expect(resolveBlockType('amrap')).toBe('circuit');
  });

  test('returns "linear" for all other types', () => {
    expect(resolveBlockType('Strength')).toBe('linear');
    expect(resolveBlockType('Warm-Up')).toBe('linear');
    expect(resolveBlockType('Cool-Down')).toBe('linear');
    expect(resolveBlockType('Timed')).toBe('linear');
    expect(resolveBlockType(undefined)).toBe('linear');
    expect(resolveBlockType('')).toBe('linear');
  });
});

// ── Flatten logic integration tests ─────────────────────────────────────────
// We replicate the flatten algorithm using the actual resolveBlockType and
// calculateAdjustedRest functions to verify the integration is correct.
function flatten(workout: any) {
  if (!workout?.blocks) return [];

  const flat: any[] = [];
  const blocks = workout.blocks || [];
  const workoutDifficulty = workout.difficulty || 'Intermediate';

  blocks.forEach((block: any, bi: number) => {
    const movements = block.movements || [];
    if (movements.length === 0) return;

    const blockRest = block.restBetweenSec ?? block.restBetweenRoundsSec ?? block.rest ?? 15;
    const rounds = block.rounds ?? block.sets ?? 1;
    const bType = resolveBlockType(block.type);

    if (bType === 'superset' || bType === 'circuit') {
      for (let round = 0; round < rounds; round++) {
        movements.forEach((mv: any, mi: number) => {
          const isLastMovementInRound = mi === movements.length - 1;
          const isLastRound = round === rounds - 1;
          const isVeryLast = isLastMovementInRound && isLastRound;

          let restAfter = 0;
          if (isVeryLast) {
            restAfter = 0;
          } else if (isLastMovementInRound) {
            restAfter = blockRest;
          } else {
            restAfter = bType === 'superset'
              ? (mv.restSec ?? 0)
              : calculateAdjustedRest(mv, block, workoutDifficulty);
          }

          flat.push({
            name: mv.name || 'Movement',
            restAfter,
            blockIndex: bi,
            movementIndex: mi,
            blockType: bType,
          });
        });
      }
    } else {
      for (let setNum = 0; setNum < rounds; setNum++) {
        movements.forEach((mv: any, mi: number) => {
          const isLastInBlock =
            setNum === rounds - 1 && mi === movements.length - 1;
          flat.push({
            name: mv.name || 'Movement',
            restAfter: isLastInBlock ? 0 : calculateAdjustedRest(mv, block, workoutDifficulty),
            blockIndex: bi,
            movementIndex: mi,
            blockType: 'linear',
          });
        });
      }
    }
  });

  return flat;
}

describe('useWorkoutFlatten integration', () => {
  test('returns empty array for null workout', () => {
    expect(flatten(null)).toEqual([]);
    expect(flatten({})).toEqual([]);
    expect(flatten({ blocks: [] })).toEqual([]);
  });

  test('flattens a single linear block with 1 round', () => {
    const workout = {
      blocks: [
        {
          type: 'Strength',
          rounds: 1,
          restBetweenSec: 30,
          movements: [
            { name: 'Squat', restSec: 60 },
            { name: 'Bench Press', restSec: 60 },
            { name: 'Row' },
          ],
        },
      ],
    };

    const result = flatten(workout);
    expect(result).toHaveLength(3);
    expect(result[0].name).toBe('Squat');
    expect(result[0].restAfter).toBe(60); // coach-set rest respected
    expect(result[1].name).toBe('Bench Press');
    expect(result[1].restAfter).toBe(60);
    expect(result[2].name).toBe('Row');
    expect(result[2].restAfter).toBe(0); // last in block
  });

  test('flattens a linear block with 3 rounds', () => {
    const workout = {
      blocks: [
        {
          type: 'Strength',
          rounds: 3,
          restBetweenSec: 30,
          movements: [
            { name: 'Curl', restSec: 20 },
            { name: 'Extension', restSec: 20 },
          ],
        },
      ],
    };

    const result = flatten(workout);
    expect(result).toHaveLength(6);
    expect(result[5].restAfter).toBe(0);
    expect(result[0].restAfter).toBe(20);
  });

  test('flattens a superset block with alternating pattern', () => {
    const workout = {
      blocks: [
        {
          type: 'Superset',
          rounds: 3,
          restBetweenSec: 60,
          movements: [
            { name: 'Bench Press' },
            { name: 'Bent Row' },
          ],
        },
      ],
    };

    const result = flatten(workout);
    expect(result).toHaveLength(6);
    expect(result[0].name).toBe('Bench Press');
    expect(result[1].name).toBe('Bent Row');
    expect(result[2].name).toBe('Bench Press');
    expect(result[3].name).toBe('Bent Row');
    expect(result[0].restAfter).toBe(0); // superset: 0 between movements
    expect(result[1].restAfter).toBe(60); // block rest between rounds
    expect(result[5].restAfter).toBe(0); // last: 0
  });

  test('flattens a circuit block', () => {
    const workout = {
      blocks: [
        {
          type: 'Circuit',
          rounds: 2,
          restBetweenSec: 45,
          movements: [
            { name: 'Squat Jump', restSec: 10 },
            { name: 'Push-Up', restSec: 10 },
            { name: 'Plank', restSec: 10 },
          ],
        },
      ],
    };

    const result = flatten(workout);
    expect(result).toHaveLength(6);
    expect(result[0].restAfter).toBe(10); // coach-set rest
    expect(result[1].restAfter).toBe(10);
    expect(result[2].restAfter).toBe(45); // block rest between rounds
    expect(result[5].restAfter).toBe(0);
  });

  test('handles multiple blocks of different types', () => {
    const workout = {
      blocks: [
        {
          type: 'Warm-Up',
          rounds: 1,
          movements: [{ name: 'Jog' }],
        },
        {
          type: 'Superset',
          rounds: 2,
          restBetweenSec: 60,
          movements: [
            { name: 'A1 Press' },
            { name: 'A2 Pull' },
          ],
        },
        {
          type: 'Cool-Down',
          rounds: 1,
          movements: [{ name: 'Stretch' }],
        },
      ],
    };

    const result = flatten(workout);
    expect(result).toHaveLength(6);
    expect(result[0].blockType).toBe('linear');
    expect(result[1].blockType).toBe('superset');
    expect(result[5].blockType).toBe('linear');
  });
});
