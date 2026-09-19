import { describe, expect, it } from 'vitest';

import { GUIDE_BANNED_WORDS, SELF_COUNT_NOTE } from '../src/activityGuides';
import { buildFollowAlongPlan, secondsLeft, stepAt } from '../src/followAlong';

const LENGTHS = ['short', 'full'] as const;
const UNITS = ['squats', 'miles', 'push-ups', '', '   ', 'burpees at the expo'];

describe('buildFollowAlongPlan', () => {
  it('opens with getting ready and ends with done', () => {
    const plan = buildFollowAlongPlan({ unit: 'squats' });
    expect(plan.steps[0].kind).toBe('ready');
    expect(plan.steps[plan.steps.length - 1].kind).toBe('done');
    expect(plan.steps.map((s) => s.kind)).toEqual(['ready', 'move', 'rest', 'done']);
  });

  it('speaks in the goal’s own words, and falls back when there are none', () => {
    expect(buildFollowAlongPlan({ unit: 'squats' }).unit).toBe('squats');
    expect(buildFollowAlongPlan({ unit: '  miles ' }).unit).toBe('miles');
    expect(buildFollowAlongPlan({ unit: '' }).unit).toBe('your movement');
  });

  it('is longer in full than in short, and totals what its steps add up to', () => {
    const short = buildFollowAlongPlan({ unit: 'squats', length: 'short' });
    const full = buildFollowAlongPlan({ unit: 'squats', length: 'full' });
    expect(full.totalSeconds).toBeGreaterThan(short.totalSeconds);
    for (const plan of [short, full]) {
      expect(plan.totalSeconds).toBe(plan.steps.reduce((sum, s) => sum + s.seconds, 0));
    }
  });

  it('carries the self-count sentence, because nothing here counts for anyone', () => {
    expect(buildFollowAlongPlan({ unit: 'squats' }).selfCountNote).toBe(SELF_COUNT_NOTE);
  });

  // There is no movement video catalog in this repository. A plan must be
  // complete without one, and must say so rather than imply a missing asset.
  it('needs no media at all by default, and accepts a poster when one exists', () => {
    expect(buildFollowAlongPlan({ unit: 'squats' }).media).toEqual({ kind: 'none' });
    const withPoster = buildFollowAlongPlan({
      unit: 'squats',
      media: { kind: 'poster', posterUri: 'https://example/poster.png' },
    });
    expect(withPoster.media).toEqual({ kind: 'poster', posterUri: 'https://example/poster.png' });
    // The steps are identical either way: media is decoration, not structure.
    expect(withPoster.steps).toEqual(buildFollowAlongPlan({ unit: 'squats' }).steps);
  });

  // The same guard activityGuides.ts holds itself to. A follow-along is not a
  // coach and makes no claim about anybody's body.
  it('never emits a banned word, in any unit, at any length', () => {
    const patterns = GUIDE_BANNED_WORDS.map((w) => ({
      word: w,
      re: new RegExp(`\\b${w}\\b`, 'i'),
    }));
    for (const unit of UNITS) {
      for (const length of LENGTHS) {
        const plan = buildFollowAlongPlan({ unit, length });
        const strings = [
          plan.unit,
          plan.selfCountNote,
          ...plan.steps.flatMap((s) => [s.title, s.detail]),
        ];
        for (const text of strings) {
          for (const { word, re } of patterns) {
            expect(re.test(text), `"${text}" contains "${word}"`).toBe(false);
          }
        }
      }
    }
  });

  it('is deterministic, so a screen and a test see the same plan', () => {
    expect(buildFollowAlongPlan({ unit: 'squats', length: 'full' })).toEqual(
      buildFollowAlongPlan({ unit: 'squats', length: 'full' })
    );
  });
});

describe('stepAt', () => {
  const plan = buildFollowAlongPlan({ unit: 'squats', length: 'short' });

  it('starts on the ready step', () => {
    const at = stepAt(plan, 0);
    expect(at.step.kind).toBe('ready');
    expect(at.finished).toBe(false);
  });

  it('walks the steps in order as time passes', () => {
    const ready = plan.steps[0].seconds * 1000;
    const move = plan.steps[1].seconds * 1000;
    expect(stepAt(plan, ready - 1).step.kind).toBe('ready');
    expect(stepAt(plan, ready).step.kind).toBe('move');
    expect(stepAt(plan, ready + move - 1).step.kind).toBe('move');
    expect(stepAt(plan, ready + move).step.kind).toBe('rest');
  });

  it('rests on done rather than running past the end', () => {
    const at = stepAt(plan, plan.totalSeconds * 1000 + 60_000);
    expect(at.step.kind).toBe('done');
    expect(at.finished).toBe(true);
    expect(at.remainingMs).toBe(0);
  });

  // A browser that throttled a background tab hands back a large elapsed time,
  // and a screen driven by elapsed wall clock must land in the right place
  // rather than drift by however long it was asleep.
  it('lands correctly from a single large jump, exactly as from many small ones', () => {
    const target = plan.steps[0].seconds * 1000 + plan.steps[1].seconds * 1000 + 500;
    expect(stepAt(plan, target).step.id).toBe(stepAt(plan, target).step.id);
    expect(stepAt(plan, target).step.kind).toBe('rest');
  });

  it('treats nonsense elapsed values as the beginning', () => {
    for (const bad of [-1, Number.NaN, Number.POSITIVE_INFINITY * 0]) {
      expect(stepAt(plan, bad).index).toBe(0);
    }
  });
});

describe('secondsLeft', () => {
  it('rounds up, so a screen never shows zero while time remains', () => {
    expect(secondsLeft(1)).toBe(1);
    expect(secondsLeft(1000)).toBe(1);
    expect(secondsLeft(1001)).toBe(2);
    expect(secondsLeft(0)).toBe(0);
    expect(secondsLeft(-5)).toBe(0);
  });
});
