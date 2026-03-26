/**
 * Integration tests for useRestAutoAdjust / calculateAdjustedRest
 *
 * Tests the rest auto-adjust logic for different block types,
 * movement categories, and difficulty levels.
 */
import { calculateAdjustedRest } from '../../hooks/useRestAutoAdjust';

describe('calculateAdjustedRest', () => {
  test('respects explicit coach-set rest on movement', () => {
    const result = calculateAdjustedRest(
      { name: 'Squat', restSec: 90 },
      { type: 'Strength' },
      'Intermediate',
    );
    expect(result).toBe(90);
  });

  test('returns shorter rest for circuit blocks', () => {
    const result = calculateAdjustedRest(
      { name: 'Jumping Jack' },
      { type: 'Circuit' },
      'Intermediate',
    );
    expect(result).toBeLessThanOrEqual(15);
    expect(result).toBeGreaterThan(0);
  });

  test('returns minimal rest for superset blocks', () => {
    const result = calculateAdjustedRest(
      { name: 'Lateral Raise' },
      { type: 'Superset' },
      'Intermediate',
    );
    expect(result).toBeLessThanOrEqual(10);
  });

  test('returns longer rest for compound movements in strength blocks', () => {
    const compound = calculateAdjustedRest(
      { name: 'Barbell Squat' },
      { type: 'Strength' },
      'Intermediate',
    );
    const isolation = calculateAdjustedRest(
      { name: 'Bicep Curl' },
      { type: 'Strength' },
      'Intermediate',
    );
    expect(compound).toBeGreaterThan(isolation);
  });

  test('beginner difficulty gets more rest', () => {
    const beginner = calculateAdjustedRest(
      { name: 'Push-Up' },
      { type: 'Strength' },
      'Beginner',
    );
    const advanced = calculateAdjustedRest(
      { name: 'Push-Up' },
      { type: 'Strength' },
      'Advanced',
    );
    expect(beginner).toBeGreaterThan(advanced);
  });

  test('rest is clamped between 5 and 180 seconds', () => {
    const result = calculateAdjustedRest(
      { name: 'Heavy Deadlift' },
      { type: 'Strength' },
      'Beginner',
    );
    expect(result).toBeGreaterThanOrEqual(5);
    expect(result).toBeLessThanOrEqual(180);
  });

  test('AMRAP blocks return 0 rest', () => {
    const result = calculateAdjustedRest(
      { name: 'Burpee' },
      { type: 'AMRAP' },
      'Intermediate',
    );
    expect(result).toBe(5); // Clamped minimum
  });
});
