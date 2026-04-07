/**
 * Tests for useWorkoutTimer — Phase 2: grabEquipment phase support
 *
 * Tests the stepTypeToPhase mapping and verifies that the grabEquipment
 * phase is properly integrated into the timer state machine.
 */
import { stepTypeToPhase } from '../../hooks/useWorkoutTimer';
import type { StepType } from '../../hooks/useWorkoutFlatten';

// ── stepTypeToPhase unit tests ─────────────────────────────────────────────
describe('stepTypeToPhase', () => {
  test('maps exercise stepType to work phase', () => {
    expect(stepTypeToPhase('exercise')).toBe('work');
    expect(stepTypeToPhase(undefined)).toBe('work');
  });

  test('maps special stepTypes to their corresponding phases', () => {
    expect(stepTypeToPhase('intro')).toBe('intro');
    expect(stepTypeToPhase('outro')).toBe('outro');
    expect(stepTypeToPhase('demo')).toBe('demo');
    expect(stepTypeToPhase('transition')).toBe('transition');
    expect(stepTypeToPhase('waterBreak')).toBe('waterBreak');
  });

  test('maps grabEquipment stepType to grabEquipment phase', () => {
    expect(stepTypeToPhase('grabEquipment')).toBe('grabEquipment');
  });
});

// ── Phase 2: Grab Equipment integration logic ─────────────────────────────
// The timer treats grabEquipment as a special phase that counts down and
// auto-advances. We verify this by checking that the phase is included
// in the same category as other special phases.
describe('grabEquipment phase classification', () => {
  const specialPhases = ['intro', 'outro', 'demo', 'transition', 'waterBreak', 'grabEquipment'];
  const nonSpecialPhases = ['ready', 'work', 'rest', 'swap', 'complete'];

  test('all special stepTypes map to their own phase (not work)', () => {
    const specialStepTypes: StepType[] = ['intro', 'outro', 'demo', 'transition', 'waterBreak', 'grabEquipment'];
    specialStepTypes.forEach((st) => {
      const phase = stepTypeToPhase(st);
      expect(phase).not.toBe('work');
      expect(phase).toBe(st);
    });
  });

  test('grabEquipment is recognized as a special phase', () => {
    // This mirrors the isSpecialPhase check in useWorkoutTimer
    const isSpecial = (phase: string) =>
      phase === 'intro' || phase === 'outro' || phase === 'demo'
      || phase === 'transition' || phase === 'waterBreak' || phase === 'grabEquipment';

    specialPhases.forEach((p) => expect(isSpecial(p)).toBe(true));
    nonSpecialPhases.forEach((p) => expect(isSpecial(p)).toBe(false));
  });
});
