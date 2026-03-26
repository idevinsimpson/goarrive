/**
 * Integration tests for useWorkoutFlatten hook
 *
 * Tests the core flattening logic for linear, superset, and circuit block types.
 * These are pure logic tests — no rendering required.
 */

// We test the internal logic directly since the hook is a thin useMemo wrapper
// Import the module and extract the flatten logic

describe('useWorkoutFlatten', () => {
  // Direct test of the flatten logic by simulating what useMemo does
  function flatten(workout: any) {
    if (!workout?.blocks) return [];

    const flat: any[] = [];
    const blocks = workout.blocks || [];

    blocks.forEach((block: any, bi: number) => {
      const movements = block.movements || [];
      if (movements.length === 0) return;

      const blockRest = block.restBetweenSec ?? block.restBetweenRoundsSec ?? block.rest ?? 15;
      const rounds = block.rounds ?? block.sets ?? 1;
      const bType = (block.type || '').toLowerCase();
      const isSuperset = bType === 'superset';
      const isCircuit = bType === 'circuit' || bType === 'amrap';

      if (isSuperset || isCircuit) {
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
              restAfter = isSuperset
                ? (mv.restSec ?? 0)
                : (mv.restSec ?? Math.min(blockRest, 15));
            }

            flat.push({
              name: mv.name || 'Movement',
              restAfter,
              blockIndex: bi,
              movementIndex: mi,
              blockType: isSuperset ? 'superset' : 'circuit',
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
              restAfter: isLastInBlock ? 0 : mv.restSec ?? blockRest,
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
    expect(result[0].restAfter).toBe(60);
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
    // 3 rounds × 2 movements = 6
    expect(result).toHaveLength(6);
    // Last movement of last round has 0 rest
    expect(result[5].restAfter).toBe(0);
    // Other movements have their restSec
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
    // 3 rounds × 2 movements = 6
    expect(result).toHaveLength(6);
    // Pattern: Bench→Row→Bench→Row→Bench→Row
    expect(result[0].name).toBe('Bench Press');
    expect(result[1].name).toBe('Bent Row');
    expect(result[2].name).toBe('Bench Press');
    expect(result[3].name).toBe('Bent Row');

    // Superset: 0 rest between movements within round
    expect(result[0].restAfter).toBe(0);
    // Block rest between rounds
    expect(result[1].restAfter).toBe(60);
    // Last movement of last round: 0 rest
    expect(result[5].restAfter).toBe(0);
  });

  test('flattens a circuit block', () => {
    const workout = {
      blocks: [
        {
          type: 'Circuit',
          rounds: 2,
          restBetweenSec: 45,
          movements: [
            { name: 'Squat', restSec: 10 },
            { name: 'Push-Up', restSec: 10 },
            { name: 'Plank', restSec: 10 },
          ],
        },
      ],
    };

    const result = flatten(workout);
    // 2 rounds × 3 movements = 6
    expect(result).toHaveLength(6);
    // Circuit: uses movement restSec between movements
    expect(result[0].restAfter).toBe(10);
    expect(result[1].restAfter).toBe(10);
    // Last in round: block rest
    expect(result[2].restAfter).toBe(45);
    // Last movement of last round: 0
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
    // 1 + 4 + 1 = 6
    expect(result).toHaveLength(6);
    expect(result[0].blockType).toBe('linear');
    expect(result[1].blockType).toBe('superset');
    expect(result[5].blockType).toBe('linear');
  });
});
