/**
 * Tests for pickNameTier — the auto-fit title tier picker used by
 * renderAutoFitTitle in WorkoutPlayer.
 *
 * Regression focus: the grabEquipment header passes maxLines=4 + maxHeight=78
 * so long coach instruction text ("Grab a U-handle & Adjust to lowest setting
 * on the cable tower") renders in full instead of ellipsizing at 2 lines.
 */

import { pickNameTier, NAME_TIERS, NAME_CHAR_W_FACTOR } from '../WorkoutPlayer.helpers';

// Full-width (no timer column) inner width in BASE units: 360 - 16 padding.
const NO_TIMER_WIDTH = 344;
// With-timer inner width: 360-ish media width minus 132 timer minus margins.
const WITH_TIMER_WIDTH = 208;

// Greedy-wrap line counter mirroring the implementation, used to assert the
// picked tier actually fits the constraints.
function countLines(text: string, tierSize: number, width: number): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const charW = tierSize * NAME_CHAR_W_FACTOR;
  const maxChars = Math.max(1, Math.floor(width / charW));
  let lines = 1;
  let curr = 0;
  for (const w of words) {
    if (curr === 0) curr = w.length;
    else if (curr + 1 + w.length <= maxChars) curr += 1 + w.length;
    else { lines += 1; curr = w.length; }
  }
  return lines;
}

describe('pickNameTier — basic behavior (unchanged for other phases)', () => {
  test('empty text returns the largest tier', () => {
    expect(pickNameTier('', NO_TIMER_WIDTH, 3)).toEqual(NAME_TIERS[0]);
  });

  test('empty text respects maxFontSize', () => {
    expect(pickNameTier('', NO_TIMER_WIDTH, 3, 24)).toEqual({ size: 24, line: 28 });
  });

  test('short name picks the largest tier', () => {
    expect(pickNameTier('Squats', WITH_TIMER_WIDTH, 3)).toEqual(NAME_TIERS[0]);
  });

  test('maxFontSize caps the tier', () => {
    const t = pickNameTier('Squats', WITH_TIMER_WIDTH, 2, 34);
    expect(t.size).toBeLessThanOrEqual(34);
  });

  test('falls back to smallest tier when nothing fits', () => {
    const veryLong = 'word '.repeat(200).trim();
    expect(pickNameTier(veryLong, WITH_TIMER_WIDTH, 2)).toEqual(NAME_TIERS[NAME_TIERS.length - 1]);
  });
});

describe('pickNameTier — maxHeight constraint (grabEquipment header)', () => {
  const GRAB_TEXT = 'Grab a U-handle & Adjust to lowest setting on the cable tower';

  test('the reported truncating instruction fits fully within 4 lines / 78 height', () => {
    const t = pickNameTier(GRAB_TEXT, NO_TIMER_WIDTH, 4, 28, 78);
    const lines = countLines(GRAB_TEXT, t.size, NO_TIMER_WIDTH);
    expect(lines).toBeLessThanOrEqual(4);
    expect(lines * t.line).toBeLessThanOrEqual(78);
    // Should stay readable — not collapse to the smallest tier.
    expect(t.size).toBeGreaterThanOrEqual(17);
  });

  test('maxHeight rejects tiers whose wrapped block would overflow the slot', () => {
    // Without maxHeight this text picks a tier whose lines*line exceeds 78;
    // with maxHeight the picked tier's block height must fit.
    const t = pickNameTier(GRAB_TEXT, NO_TIMER_WIDTH, 4, 28, 78);
    const unconstrained = pickNameTier(GRAB_TEXT, NO_TIMER_WIDTH, 4, 28);
    const linesUnconstrained = countLines(GRAB_TEXT, unconstrained.size, NO_TIMER_WIDTH);
    expect(linesUnconstrained * unconstrained.line).toBeGreaterThan(78);
    expect(countLines(GRAB_TEXT, t.size, NO_TIMER_WIDTH) * t.line).toBeLessThanOrEqual(78);
  });

  test('very long instruction still avoids the ellipsis path (≤4 lines at some tier)', () => {
    const long = 'Grab two medium dumbbells and a resistance band then set the bench to a forty five degree incline';
    const t = pickNameTier(long, NO_TIMER_WIDTH, 4, 28, 78);
    const lines = countLines(long, t.size, NO_TIMER_WIDTH);
    expect(lines).toBeLessThanOrEqual(4);
    expect(lines * t.line).toBeLessThanOrEqual(78);
  });

  test('no maxHeight behaves exactly as before (back-compat)', () => {
    const t = pickNameTier('Kettlebell Goblet Squats', WITH_TIMER_WIDTH, 3);
    const lines = countLines('Kettlebell Goblet Squats', t.size, WITH_TIMER_WIDTH);
    expect(lines).toBeLessThanOrEqual(3);
  });
});
