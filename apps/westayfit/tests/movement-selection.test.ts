import { describe, expect, it } from 'vitest';

import { ACTIVITY_GUIDES, normalizeActivityKey } from '../src/activityGuides';
import {
  hasCountingGuide,
  mapMovementSelection,
  MOVEMENTS,
  normalizeSelection,
  toggleMovement,
  UNIT_MAX_LENGTH,
} from '../src/movementSelection';

/**
 * MOVEMENT-PILLS-1: the selection → contract mapping, tested as plain
 * functions. The screen only renders what these return.
 */

describe('the movement catalog', () => {
  it('lists only movements the app already has a counting guide for', () => {
    for (const m of MOVEMENTS) {
      expect(hasCountingGuide(m.key), m.key).toBe(true);
      // The recorded unit resolves back to the same guide on the contribution screen.
      expect(normalizeActivityKey(m.unit)).toBe(m.key);
      expect(ACTIVITY_GUIDES[m.key]).toBeDefined();
    }
  });

  it('is not the prototype’s squat-only sample', () => {
    expect(MOVEMENTS.length).toBeGreaterThan(1);
    expect(new Set(MOVEMENTS.map((m) => m.countKind)).size).toBeGreaterThan(1);
  });

  it('keeps every single-movement unit within the server’s limit', () => {
    for (const m of MOVEMENTS) expect(m.unit.length).toBeLessThanOrEqual(UNIT_MAX_LENGTH);
  });
});

describe('selection bookkeeping', () => {
  it('drops unknown keys and duplicates, and reports catalog order, not tap order', () => {
    expect(normalizeSelection(['sit-ups', 'burpees', 'squats', 'sit-ups', 7])).toEqual(['squats', 'sit-ups']);
  });

  it('toggles on and off without ever duplicating', () => {
    let s = toggleMovement([], 'push-ups');
    s = toggleMovement(s, 'squats');
    expect(s).toEqual(['squats', 'push-ups']);
    s = toggleMovement(s, 'push-ups');
    expect(s).toEqual(['squats']);
    s = toggleMovement(s, 'squats');
    expect(s).toEqual([]);
  });
});

describe('mapMovementSelection', () => {
  it('nothing picked leaves the free-text unit in charge', () => {
    expect(mapMovementSelection([])).toEqual({ kind: 'none' });
    expect(mapMovementSelection(['not-a-movement'])).toEqual({ kind: 'none' });
  });

  it('one movement maps onto one wsfCreateGoal with its own unit and guide', () => {
    expect(mapMovementSelection(['steps'])).toEqual({
      kind: 'individual',
      movements: ['steps'],
      unit: 'steps',
      activityGuideKey: 'steps',
      shared: false,
      countSentence: 'Every step counts once.',
    });
  });

  it('several repetition movements map onto ONE goal, said plainly, with a guide that exists', () => {
    const c = mapMovementSelection(['push-ups', 'squats']);
    expect(c).toEqual({
      kind: 'individual',
      movements: ['squats', 'push-ups'],
      unit: 'squats + push-ups',
      activityGuideKey: 'reps',
      shared: true,
      countSentence: 'Every squat and push-up counts once toward the same total.',
    });
    expect(ACTIVITY_GUIDES.reps).toBeDefined();
  });

  it('the largest same-kind group still fits the server’s unit limit', () => {
    const c = mapMovementSelection(['squats', 'push-ups', 'sit-ups']);
    expect(c.kind).toBe('individual');
    if (c.kind !== 'individual') return;
    expect(c.unit).toBe('squats + push-ups + sit-ups');
    expect(c.unit.length).toBeLessThanOrEqual(UNIT_MAX_LENGTH);
    expect(c.countSentence).toBe('Every squat, push-up and sit-up counts once toward the same total.');
  });

  it('never adds repetitions to steps or laps — it refuses and says why', () => {
    const c = mapMovementSelection(['squats', 'steps']);
    expect(c.kind).toBe('mixed');
    if (c.kind !== 'mixed') return;
    expect(c.kinds).toEqual(['repetitions', 'steps']);
    expect(c.message).toBe(
      'Squats and steps are counted differently, so they can’t share one total. Choose movements counted the same way, or start a separate goal for each.'
    );
    // No payload field exists on a refusal.
    expect(c).not.toHaveProperty('unit');
    expect(c).not.toHaveProperty('activityGuideKey');
  });

  it('refuses every cross-kind pair in the catalog', () => {
    for (const a of MOVEMENTS) {
      for (const b of MOVEMENTS) {
        if (a.key === b.key) continue;
        const kind = mapMovementSelection([a.key, b.key]).kind;
        expect(kind, `${a.key}+${b.key}`).toBe(a.countKind === b.countKind ? 'individual' : 'mixed');
      }
    }
  });
});
