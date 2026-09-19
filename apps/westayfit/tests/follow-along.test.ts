import { describe, expect, it } from 'vitest';

import { GUIDE_BANNED_WORDS, SELF_COUNT_NOTE } from '../src/activityGuides';
import {
  buildFollowAlongPlan,
  clockElapsed,
  clockRunning,
  COUNTDOWN_SECONDS,
  DEMO_MEDIA_LABEL,
  ILLUSTRATED_FALLBACK_LABEL,
  INTERRUPTED_NOTICE,
  LENGTH_LABELS,
  LONG_ROUND_SECONDS,
  mediaPresentation,
  pauseClock,
  pausesForInterruption,
  resetClock,
  ROUND_SECONDS,
  secondsLeft,
  startClock,
  stepAt,
} from '../src/followAlong';

const LENGTHS = ['short', 'full'] as const;
const UNITS = ['squats', 'miles', 'push-ups', '', '   ', 'burpees at the expo'];

describe('buildFollowAlongPlan', () => {
  // CHANGED FROM THE 5+20+10 PLAN. The Director's correction (19 Sep) replaced
  // the timed "get ready" step and the move/rest pair with an EXPLICIT Ready
  // state that waits for the person, a 3-second countdown, and one 60-second
  // round. Ready is not on the clock, which is why it is not in `steps`.
  it('runs an explicit ready, then a countdown, then one round, then done', () => {
    const plan = buildFollowAlongPlan({ unit: 'squats' });
    expect(plan.steps.map((s) => s.kind)).toEqual(['countdown', 'round', 'done']);
    expect(plan.ready.title).toBeTruthy();
    expect(plan.ready.detail).toBeTruthy();
    // The ready state is not a step that elapses: nothing in the timeline is
    // called "ready", so no round can be consumed by simply waiting.
    expect(plan.steps.some((s) => s.id === 'ready')).toBe(false);
  });

  it('counts in for 3 seconds and runs the round for 60', () => {
    const plan = buildFollowAlongPlan({ unit: 'squats' });
    expect(COUNTDOWN_SECONDS).toBe(3);
    expect(ROUND_SECONDS).toBe(60);
    expect(plan.countdownSeconds).toBe(3);
    expect(plan.roundSeconds).toBe(60);
    expect(plan.steps[0].seconds).toBe(3);
    expect(plan.steps[1].seconds).toBe(60);
    expect(plan.totalSeconds).toBe(63);
  });

  it('is 60 seconds by default and 2 minutes on the longer choice', () => {
    expect(buildFollowAlongPlan({ unit: 'squats' }).roundSeconds).toBe(ROUND_SECONDS);
    expect(buildFollowAlongPlan({ unit: 'squats', length: 'short' }).roundSeconds).toBe(60);
    expect(buildFollowAlongPlan({ unit: 'squats', length: 'full' }).roundSeconds).toBe(
      LONG_ROUND_SECONDS
    );
    expect(buildFollowAlongPlan({ unit: 'squats', length: 'full' }).totalSeconds).toBe(123);
    expect(LENGTH_LABELS.short).toBe('60 seconds');
    expect(LENGTH_LABELS.full).toBe('2 minutes');
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
          plan.ready.title,
          plan.ready.detail,
          INTERRUPTED_NOTICE,
          mediaPresentation(plan.media).label,
          mediaPresentation(plan.media).note,
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

// THE HONEST DEFAULT STATE. There is no movement video catalog here. The
// screen calls what it shows a MOVEMENT GUIDE, and its one line tells the
// person the only thing that changes what they do — that nothing on the screen
// is counting. What it must never do is name a video, in either case.
describe('mediaPresentation', () => {
  it('calls the drawing a movement guide when no media exists', () => {
    const m = mediaPresentation({ kind: 'none' });
    expect(m.kind).toBe('fallback');
    expect(m.label).toBe(ILLUSTRATED_FALLBACK_LABEL);
    expect(m.label).toBe('Movement guide');
    expect(m.note).toBe('Demonstration only — count your own reps.');
    expect(m.posterUri).toBeNull();
    expect(m.clipUri).toBeNull();
  });

  // The words on the screen got shorter; the rule they live under did not.
  // Neither case may imply a recording was delivered, is loading, or failed.
  it('names no video in either case, however short the line got', () => {
    for (const m of [
      mediaPresentation({ kind: 'none' }),
      mediaPresentation({ kind: 'poster', posterUri: 'https://example/p.png' }),
    ]) {
      for (const word of ['video', 'loading', 'failed', 'unavailable', 'missing']) {
        expect(`${m.label} ${m.note}`.toLowerCase()).not.toContain(word);
      }
    }
  });

  it('shows a supplied poster, and a clip only when one is given', () => {
    const poster = mediaPresentation({ kind: 'poster', posterUri: 'https://example/p.png' });
    expect(poster.kind).toBe('supplied');
    expect(poster.label).toBe(DEMO_MEDIA_LABEL);
    expect(poster.posterUri).toBe('https://example/p.png');
    expect(poster.clipUri).toBeNull();
    const withClip = mediaPresentation({
      kind: 'poster',
      posterUri: 'https://example/p.png',
      clipUri: 'https://example/c.mp4',
    });
    expect(withClip.clipUri).toBe('https://example/c.mp4');
  });

  it('treats an empty poster as no media at all rather than a broken one', () => {
    expect(mediaPresentation({ kind: 'poster', posterUri: '   ' }).kind).toBe('fallback');
  });

  // The fallback wording may never suggest that a video exists, arrived, is
  // arriving, or failed. It states the asset gap and stops.
  /**
   * WHAT CHANGED HERE, AND WHAT DID NOT.
   *
   * This used to require the fallback note to SAY "no movement video exists" —
   * the asset gap stated in words, on the screen, every time. The 03:12 ET
   * creative review replaced that paragraph with one short line, because at an
   * event it was the largest thing next to the movement and it explained the
   * repository's problem to somebody trying to do squats.
   *
   * So the positive requirement is gone and is not being quietly preserved
   * somewhere else: a sighted person at a screen is no longer told, in words,
   * that no video exists. What remains is the rule that actually protects
   * them — nothing may imply a recording was delivered, is loading, or failed
   * — plus the figure's own "Diagram:" accessibility label and the honest
   * `kind: 'fallback'`. That is a real reduction in what the screen discloses,
   * made deliberately and on instruction, not an oversight.
   */
  it('never implies a video was delivered', () => {
    const fallback = mediaPresentation({ kind: 'none' });
    const text = `${fallback.label} ${fallback.note}`.toLowerCase();
    expect(text).not.toContain('video');
    for (const forbidden of [
      'loading',
      'buffering',
      'playing',
      'could not load',
      'unavailable',
      'failed',
      'missing',
    ]) {
      expect(text.includes(forbidden), `fallback note says "${forbidden}"`).toBe(false);
    }
    // And it still tells the person the one thing that changes what they do.
    expect(fallback.note.toLowerCase()).toContain('count your own reps');
  });
});

describe('stepAt', () => {
  const plan = buildFollowAlongPlan({ unit: 'squats', length: 'short' });

  // CHANGED: the first timed step is the countdown, not a "get ready" step.
  it('starts on the countdown', () => {
    const at = stepAt(plan, 0);
    expect(at.step.kind).toBe('countdown');
    expect(at.finished).toBe(false);
    expect(secondsLeft(at.remainingMs)).toBe(3);
  });

  // CHANGED: ready → countdown, move → round, and there is no rest step.
  it('walks the steps in order as time passes', () => {
    const countdown = plan.steps[0].seconds * 1000;
    const round = plan.steps[1].seconds * 1000;
    expect(stepAt(plan, countdown - 1).step.kind).toBe('countdown');
    expect(stepAt(plan, countdown).step.kind).toBe('round');
    expect(stepAt(plan, countdown + round - 1).step.kind).toBe('round');
    expect(stepAt(plan, countdown + round).step.kind).toBe('done');
    expect(stepAt(plan, countdown + round).finished).toBe(true);
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
  // CHANGED: the same jump now lands on `done`, because the plan the Director
  // corrected has no rest step after the round.
  it('lands correctly from a single large jump, exactly as from many small ones', () => {
    const target = plan.steps[0].seconds * 1000 + plan.steps[1].seconds * 1000 + 500;
    expect(stepAt(plan, target).step.id).toBe(stepAt(plan, target).step.id);
    expect(stepAt(plan, target).step.kind).toBe('done');
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

// PAUSE AND RESUME ARE ELAPSED TIMESTAMPS, never a decremented counter. These
// are the exact arithmetic the screen runs, tested without a screen.
describe('the clock', () => {
  it('accrues nothing before it starts', () => {
    const idle = resetClock();
    expect(clockRunning(idle)).toBe(false);
    expect(clockElapsed(idle, 10_000)).toBe(0);
  });

  it('measures from the start timestamp, not from ticks', () => {
    const running = startClock(resetClock(), 1_000);
    expect(clockRunning(running)).toBe(true);
    expect(clockElapsed(running, 1_000)).toBe(0);
    expect(clockElapsed(running, 4_500)).toBe(3_500);
    // A tab that was asleep for a minute lands a minute further on, in one
    // read, rather than losing the time it could not tick through.
    expect(clockElapsed(running, 61_000)).toBe(60_000);
  });

  it('banks elapsed time on pause and accrues nothing while paused', () => {
    const paused = pauseClock(startClock(resetClock(), 1_000), 21_000);
    expect(clockRunning(paused)).toBe(false);
    expect(paused.heldMs).toBe(20_000);
    expect(clockElapsed(paused, 21_000)).toBe(20_000);
    expect(clockElapsed(paused, 999_000)).toBe(20_000);
  });

  it('resumes from exactly where it paused', () => {
    const paused = pauseClock(startClock(resetClock(), 1_000), 21_000);
    const resumed = startClock(paused, 500_000);
    expect(clockElapsed(resumed, 500_000)).toBe(20_000);
    expect(clockElapsed(resumed, 505_000)).toBe(25_000);
  });

  it('is idempotent: starting twice and pausing twice change nothing', () => {
    const running = startClock(resetClock(), 1_000);
    expect(startClock(running, 9_999)).toBe(running);
    const paused = pauseClock(running, 5_000);
    expect(pauseClock(paused, 9_999)).toBe(paused);
  });

  it('reset leaves nothing behind', () => {
    expect(resetClock()).toEqual({ startedAt: null, heldMs: 0 });
  });
});

// A ROUND NOBODY CAN SEE IS NOT A ROUND. A hidden tab or an interrupted media
// element pauses it; it is never silently consumed.
describe('pausesForInterruption', () => {
  it('pauses for a hidden tab, a page going away, and media stopping', () => {
    expect(pausesForInterruption('hidden')).toBe(true);
    expect(pausesForInterruption('pagehide')).toBe(true);
    expect(pausesForInterruption('mediaPause')).toBe(true);
    expect(pausesForInterruption('mediaStalled')).toBe(true);
  });

  it('does not pause on focus alone, which a station screen loses for no reason', () => {
    expect(pausesForInterruption('blur')).toBe(false);
  });

  it('refuses anything it does not recognise', () => {
    for (const nonsense of [undefined, null, '', 'visible', 42, {}]) {
      expect(pausesForInterruption(nonsense)).toBe(false);
    }
  });
});
