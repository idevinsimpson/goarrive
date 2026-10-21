import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { togetherPresentation, type ContributeReceipt } from '../src/contributionFlow';
import {
  buildPieces,
  glowAlphaAt,
  glowRadius,
  pieceFrameAt,
  pulseKeyframes,
  pulseStops,
  TOGETHER_GLOW,
  TOGETHER_PULSE_EASING,
  TOGETHER_PULSE_EASING_CSS,
  TOGETHER_TIMING,
  togetherTimeline,
  togetherWaves,
  waveAt,
} from '../src/ui/togetherMotion';
import {
  buildNativeTogetherTimeline,
  createNativeTogetherRun,
  glowBands,
  glowProfile,
  stackedAlpha,
  startTogetherNativeMotion,
  unwrapAngle,
  type Track,
  type TogetherGeometry,
} from '../src/ui/togetherMotionNative';
import {
  decideTogetherPhase,
  isMeasured,
  MIN_MEASURED_PX,
  NATIVE_START_DEADLINE_MS,
  nextTogetherPhase,
  settlesAtDeadline,
  settlesOnAppState,
  type TogetherPhaseInput,
} from '../src/ui/togetherPhase';

/**
 * NATIVE-MOTION-1 — the pure half of the native Together motion: the one
 * decision, and a native timeline that is the web's timeline sampled.
 * (Device rendering is not provable here; these prove the numbers and rules.)
 */

function receipt(over: Partial<ContributeReceipt> = {}): ContributeReceipt {
  return {
    addedCount: 20,
    ownCredit: 20,
    alreadyRecorded: false,
    sharedTotal: 3720,
    target: 5000,
    unit: 'squats',
    status: 'active',
    ...over,
  };
}
const freshOpts = { communityName: 'Fixture Community', fresh: true, sharedBefore: 3700, beforeTarget: 5000 };

const ordinary: TogetherGeometry = { crossed: false, width: 390, height: 420, centerX: 195, centerY: 220, markWidth: 300, markHeight: 146 };
const crossing: TogetherGeometry = { ...ordinary, crossed: true };

const eligible: TogetherPhaseInput = { fresh: true, animate: true, reducedKnown: true, reduced: false, platform: 'ios' };

describe('one decision at mount: decideTogetherPhase', () => {
  it('the web decision is unchanged: fresh ∧ animate ∧ ¬reduced plays, and the web never waits', () => {
    expect(decideTogetherPhase({ ...eligible, platform: 'web' })).toBe('playing');
    // The web reads the media query synchronously; `reducedKnown` cannot hold it back.
    expect(decideTogetherPhase({ ...eligible, platform: 'web', reducedKnown: false })).toBe('playing');
    expect(decideTogetherPhase({ ...eligible, platform: 'web', reduced: true })).toBe('settled');
    expect(decideTogetherPhase({ ...eligible, platform: 'web', fresh: false })).toBe('settled');
    expect(decideTogetherPhase({ ...eligible, platform: 'web', animate: false })).toBe('settled');
    // appActive is a native input only.
    expect(decideTogetherPhase({ ...eligible, platform: 'web', appActive: false })).toBe('playing');
  });

  for (const platform of ['ios', 'android']) {
    it(`${platform}: waits for the reduced-motion answer, then plays or settles`, () => {
      expect(decideTogetherPhase({ ...eligible, platform, reducedKnown: false })).toBe('pending');
      expect(decideTogetherPhase({ ...eligible, platform })).toBe('playing');
      expect(decideTogetherPhase({ ...eligible, platform, reduced: true })).toBe('settled');
      // A reduced answer settles even if it arrived through the cache before `known` flipped.
      expect(decideTogetherPhase({ ...eligible, platform, reduced: true, reducedKnown: false })).toBe('settled');
      // A receipt that appears while the app is not in the foreground never plays.
      expect(decideTogetherPhase({ ...eligible, platform, appActive: false })).toBe('settled');
    });
  }

  it('a preference query that definitely failed settles at once on native, instead of waiting out the deadline', () => {
    for (const platform of ['ios', 'android']) {
      expect(decideTogetherPhase({ ...eligible, platform, reducedKnown: false, reducedFailed: true })).toBe('settled');
      expect(nextTogetherPhase('pending', { ...eligible, platform, reducedKnown: false, reducedFailed: true })).toBe('settled');
      // A later real answer is what counts once it exists.
      expect(decideTogetherPhase({ ...eligible, platform, reducedKnown: true, reducedFailed: false })).toBe('playing');
    }
    // The web never reads this input.
    expect(decideTogetherPhase({ ...eligible, platform: 'web', reducedKnown: false, reducedFailed: true })).toBe('playing');
  });

  it('a pending receipt whose app left the foreground settles instead of starting', () => {
    expect(nextTogetherPhase('pending', { ...eligible, appActive: false })).toBe('settled');
  });

  it('a zero or near-zero box is not a measurement', () => {
    expect(MIN_MEASURED_PX).toBe(1);
    expect(isMeasured({ width: 390, height: 420 })).toBe(true);
    expect(isMeasured({ width: 1, height: 1 })).toBe(true);
    for (const box of [{ width: 0, height: 420 }, { width: 390, height: 0.4 }, { width: Number.NaN, height: 10 }, null, undefined]) {
      expect(isMeasured(box)).toBe(false);
    }
  });

  it('reduced motion settles at once on every platform', () => {
    for (const platform of ['web', 'ios', 'android']) {
      expect(decideTogetherPhase({ ...eligible, platform, reduced: true })).toBe('settled');
    }
  });

  it('no replay: a remount, a reopen or a retry already recorded is settled before it is anything else', () => {
    for (const platform of ['web', 'ios', 'android']) {
      // Remount / reopen: the owner consumed `fresh` on the first mount.
      expect(decideTogetherPhase({ ...eligible, platform, fresh: false })).toBe('settled');
      expect(decideTogetherPhase({ ...eligible, platform, fresh: false, reducedKnown: false })).toBe('settled');
      // A retry the server reports as already recorded: `animate` is false even with a fresh flag.
      const replay = togetherPresentation(receipt({ alreadyRecorded: true }), freshOpts);
      expect(replay.animate).toBe(false);
      expect(decideTogetherPhase({ ...eligible, platform, animate: replay.animate })).toBe('settled');
      // A crossing receipt reopened keeps its fact but does not celebrate again.
      const reopened = togetherPresentation(
        receipt({ sharedTotal: 5015, crossedTarget: true, alreadyRecorded: true }),
        { ...freshOpts, sharedBefore: 4980 }
      );
      expect(reopened.crossed).toBe(true);
      expect(decideTogetherPhase({ ...eligible, platform, animate: reopened.animate })).toBe('settled');
    }
  });

  it('no invented before total — but a fresh receipt still plays its acknowledgment, with the fill held at after/target (MO-01)', () => {
    for (const opts of [
      { ...freshOpts, sharedBefore: null },
      { ...freshOpts, beforeTarget: 4000 },
      { communityName: null, fresh: true }, // never sharedTotal − addedCount
    ]) {
      const p = togetherPresentation(receipt(), opts);
      expect(p.before).toBeNull();
      expect(p.fromRatio).toBe(p.toRatio); // nothing to tween from: the fill holds
      expect(p.animate).toBe(true);
      for (const platform of ['web', 'ios', 'android']) {
        expect(decideTogetherPhase({ ...eligible, platform, animate: p.animate })).toBe('playing');
        // Reduced motion at mount still settles it.
        expect(decideTogetherPhase({ ...eligible, platform, animate: p.animate, reduced: true })).toBe('settled');
      }
    }
    // A replay, or a receipt that is not fresh, stays static without a before too.
    const replay = togetherPresentation(receipt({ alreadyRecorded: true }), { ...freshOpts, sharedBefore: null });
    const notFresh = togetherPresentation(receipt(), { ...freshOpts, sharedBefore: null, fresh: false });
    for (const p of [replay, notFresh]) {
      expect(p.animate).toBe(false);
      for (const platform of ['web', 'ios', 'android']) {
        expect(decideTogetherPhase({ ...eligible, platform, animate: p.animate })).toBe('settled');
      }
    }
    // The communal payoff is the server's crossing signal's alone.
    const before = togetherPresentation(receipt({ sharedTotal: 5015, crossedTarget: true }), { ...freshOpts, sharedBefore: null });
    expect(before.crossed).toBe(true);
    expect(before.animate).toBe(true);
    const unsignalled = togetherPresentation(receipt({ sharedTotal: 5015 }), { ...freshOpts, sharedBefore: null });
    expect(unsignalled.crossed).toBe(false);
    expect(unsignalled.payoff).not.toBe('WE did it. Together.');
    expect(unsignalled.animate).toBe(false);
  });

  it('only pending can move, so a settled or playing instance never re-decides', () => {
    for (const platform of ['ios', 'android', 'web']) {
      expect(nextTogetherPhase('settled', { ...eligible, platform })).toBe('settled');
      expect(nextTogetherPhase('playing', { ...eligible, platform, reduced: true })).toBe('playing');
    }
    expect(nextTogetherPhase('pending', { ...eligible, reducedKnown: false })).toBe('pending');
    expect(nextTogetherPhase('pending', eligible)).toBe('playing');
    expect(nextTogetherPhase('pending', { ...eligible, reduced: true })).toBe('settled');
  });

  it('the start deadline settles anything not yet moving; leaving the foreground settles', () => {
    expect(NATIVE_START_DEADLINE_MS).toBeGreaterThan(0);
    expect(NATIVE_START_DEADLINE_MS).toBeLessThan(TOGETHER_TIMING.fillStartMs);
    expect(settlesAtDeadline('pending', false)).toBe(true);
    expect(settlesAtDeadline('playing', false)).toBe(true); // eligible but never measured
    expect(settlesAtDeadline('playing', true)).toBe(false);
    expect(settlesAtDeadline('settled', false)).toBe(false);
    expect(settlesOnAppState('background')).toBe(true);
    expect(settlesOnAppState('inactive')).toBe(true);
    expect(settlesOnAppState('active')).toBe(false);
  });
});

describe('one timeline for both drivers', () => {
  it('ordinary and crossed differ exactly as on the web', () => {
    const a = togetherTimeline(false);
    const b = togetherTimeline(true);
    expect(a.pulse.peakScale).toBe(1.1);
    expect(b.pulse.peakScale).toBe(1.13);
    expect(a.pieces).toBe(24);
    expect(b.pieces).toBe(28);
    expect(a.waves.map((w) => [w.delayMs, w.strength])).toEqual([
      [1460, 0.55],
      [1640, 0.22],
    ]);
    expect(b.waves.map((w) => [w.delayMs, w.strength])).toEqual([
      [1460, 0.55],
      [1640, 0.22],
      [1810, 0.12],
    ]);
    // Everything else is the same moment for both stories.
    for (const t of [a, b]) {
      expect(t.pulse.durationMs).toBe(TOGETHER_TIMING.pulseDurationMs);
      expect(t.fill).toEqual({ startMs: 1450, durationMs: 700 });
      expect(t.waves.every((w) => w.durationMs === 900)).toBe(true);
      expect(t.canvasEndMs).toBe(2900);
      expect(t.settleMs).toBe(3400);
    }
  });

  it('the pulse keyframes and easing are one set of numbers', () => {
    expect(TOGETHER_PULSE_EASING).toEqual([0.2, 0.65, 0.3, 1]);
    // The donor's string, byte for byte, and it is exactly those four numbers.
    expect(TOGETHER_PULSE_EASING_CSS).toBe('cubic-bezier(.2,.65,.3,1)');
    const parsed = /^cubic-bezier\(([^)]*)\)$/.exec(TOGETHER_PULSE_EASING_CSS)![1].split(',').map(Number);
    expect(parsed).toEqual([...TOGETHER_PULSE_EASING]);
    for (const crossed of [false, true]) {
      expect(pulseKeyframes(crossed)).toEqual(
        pulseStops(crossed).map((s) => ({ transform: `scale(${s.scale})`, offset: s.offset }))
      );
    }
    expect(pulseStops(false).map((s) => s.offset)).toEqual([0, 0.28, 0.46, 0.57, 0.72, 0.83, 1]);
  });

  it('the shared math is the donor’s formulas, unchanged', () => {
    const smooth = (n: number) => n * n * (3 - 2 * n);
    const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
    for (let ms = 0; ms <= 3000; ms += 37) {
      expect(glowAlphaAt(ms)).toBe(smooth(clamp01((ms - 280) / 1180)) * (1 - smooth(clamp01((ms - 1610) / 920))));
      const raw = (ms - 1460) / 900;
      const w = waveAt(ms, 1460, 0.55, 390);
      if (raw < 0 || raw > 1) expect(w).toBeNull();
      else
        expect(w).toEqual({
          radius: 28 + (1 - Math.pow(1 - raw, 3)) * 390 * 0.85,
          alpha: Math.pow(1 - raw, 1.4) * 0.55,
          lineWidth: (1 - raw) * 7 + 0.5,
        });
    }
    expect(glowRadius(200)).toBe(180);
    expect(glowRadius(390)).toBeCloseTo(230.1, 10);
    const piece = buildPieces(crossing)[3];
    const f = pieceFrameAt(piece, piece.delay + piece.duration / 2)!;
    expect(f.p).toBeCloseTo(0.5, 12);
    expect(f.u).toBeCloseTo(0.25 * 0.62 + 0.5 * 0.38, 12);
    expect(f.alpha).toBe(1);
    expect(f.length).toBeCloseTo(piece.length * (1 - 0.5 * 0.53), 12);
    expect(f.breadth).toBeCloseTo(piece.breadth * (1 - 0.5 * 0.2), 12);
    expect(pieceFrameAt(piece, piece.delay - 1)).toBeNull();
    expect(pieceFrameAt(piece, piece.delay + piece.duration + 1)).toBeNull();
  });

  it('the web driver draws from the shared functions, and the native driver restates no timing', () => {
    const web = readFileSync(nodePath.resolve(__dirname, '../src/ui/togetherMotion.ts'), 'utf8');
    const body = web.slice(web.indexOf('export function runTogetherMotion'));
    for (const name of ['pieceFrameAt(', 'waveAt(', 'glowAlphaAt(', 'glowRadius(', 'togetherWaves(', 'TOGETHER_PULSE_EASING_CSS']) {
      expect(body).toContain(name);
    }
    const native = readFileSync(nodePath.resolve(__dirname, '../src/ui/togetherMotionNative.tsx'), 'utf8');
    const code = native.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const literal of ['1450', '1460', '1640', '1810', '2700', '2900', '3400', '700', '900', '1.13']) {
      expect(code).not.toMatch(new RegExp(`\\b${literal.replace('.', '\\.')}\\b`));
    }
  });
});

const isValidTrack = (t: Track) => {
  expect(t.inputRange.length).toBeGreaterThanOrEqual(2);
  expect(t.inputRange.length).toBe(t.outputRange.length);
  for (let i = 1; i < t.inputRange.length; i += 1) expect(t.inputRange[i]).toBeGreaterThanOrEqual(t.inputRange[i - 1]);
  for (const v of [...t.inputRange, ...t.outputRange]) expect(Number.isFinite(v)).toBe(true);
};
const valueAt = (t: Track, input: number) => t.outputRange[t.inputRange.indexOf(input)];

describe('the native timeline is the web timeline, sampled', () => {
  it('crossed and ordinary build different motion: pieces, waves and pulse peak', () => {
    const a = buildNativeTogetherTimeline(ordinary);
    const b = buildNativeTogetherTimeline(crossing);
    expect(a.pieces).toHaveLength(24);
    expect(b.pieces).toHaveLength(28);
    expect(a.waves).toHaveLength(2);
    expect(b.waves).toHaveLength(3);
    expect(Math.max(...a.pulse.outputRange)).toBe(1.1);
    expect(Math.max(...b.pulse.outputRange)).toBe(1.13);
    expect(a.pulse.inputRange).toEqual(pulseStops(false).map((s) => s.offset));
    expect(a.pulse.outputRange.at(-1)).toBe(1);
    expect(b.pulse.outputRange.at(-1)).toBe(1);
  });

  it('every track is a valid interpolation, and each part’s clock ends where that part does', () => {
    for (const geom of [ordinary, crossing]) {
      const t = buildNativeTogetherTimeline(geom);
      const pieceTracks: Track[] = [];
      for (const piece of t.pieces) {
        pieceTracks.push(...Object.values(piece.head));
        for (const chord of piece.trail) pieceTracks.push(...Object.values(chord));
      }
      const waveTracks: Track[] = t.waves.flatMap((wave) => Object.values(wave));
      for (const track of [t.pulse, t.glow.opacity, ...pieceTracks, ...waveTracks]) isValidTrack(track);
      // Pieces: their clock stops when the last piece's window ends.
      const pieces = buildPieces(geom);
      expect(t.piecesEndMs).toBe(Math.max(...pieces.map((p) => p.delay + p.duration)));
      expect(Math.max(...pieceTracks.map((tr) => tr.inputRange.at(-1)!))).toBe(t.piecesEndMs);
      // Glow: its clock stops when the release ends.
      expect(t.glowEndMs).toBe(TOGETHER_GLOW.releaseStartMs + TOGETHER_GLOW.releaseMs);
      expect(t.glow.opacity.inputRange.at(-1)).toBe(t.glowEndMs);
      // Waves keep the web's canvas end.
      expect(t.wavesEndMs).toBe(TOGETHER_TIMING.canvasEndMs);
      for (const tr of waveTracks) expect(tr.inputRange.at(-1)!).toBeLessThanOrEqual(t.wavesEndMs);
      expect(t.piecesEndMs).toBeLessThan(t.wavesEndMs);
      expect(t.glowEndMs).toBeLessThan(t.wavesEndMs);
    }
  });

  it('pieces carry the web’s alpha, position and shrink at every sample, invisible outside their window', () => {
    const t = buildNativeTogetherTimeline(crossing);
    const pieces = buildPieces(crossing);
    t.pieces.forEach((native, i) => {
      const piece = pieces[i];
      const opacity = native.head.opacity;
      expect(opacity.inputRange[0]).toBe(piece.delay);
      expect(opacity.inputRange.at(-1)).toBe(piece.delay + piece.duration);
      expect(opacity.outputRange[0]).toBe(0);
      expect(opacity.outputRange.at(-1)).toBe(0);
      // The alpha ramps' corners are sampled exactly, so the fade is not flattened.
      expect(opacity.inputRange).toContain(piece.delay + piece.duration / 7);
      expect(opacity.inputRange).toContain(piece.delay + (piece.duration * 8) / 9);
      opacity.inputRange.forEach((ms, k) => {
        const f = pieceFrameAt(piece, ms)!;
        expect(opacity.outputRange[k]).toBe(f.alpha);
        expect(native.head.scaleX.outputRange[k]).toBeCloseTo(f.length / piece.length, 12);
        expect(native.head.scaleY.outputRange[k]).toBeCloseTo(f.breadth / piece.breadth, 12);
        // Centred 0.325 × breadth ahead of the head, along the heading.
        const a = native.head.rotate.outputRange[k];
        expect(native.head.x.outputRange[k]).toBeCloseTo(f.head.x + Math.cos(a) * 0.325 * f.breadth, 9);
        expect(native.head.y.outputRange[k]).toBeCloseTo(f.head.y + Math.sin(a) * 0.325 * f.breadth, 9);
        // The trail chords carry the gradient's mean alpha: 0.47 split 1 : 3.
        expect(native.trail[0].opacity.outputRange[k]).toBeCloseTo(f.alpha * 0.47 * 0.25, 12);
        expect(native.trail[1].opacity.outputRange[k]).toBeCloseTo(f.alpha * 0.47 * 0.75, 12);
      });
      // Headings are unwrapped: an interpolation never spins the long way round.
      const r = native.head.rotate.outputRange;
      for (let k = 1; k < r.length; k += 1) expect(Math.abs(r[k] - r[k - 1])).toBeLessThan(Math.PI);
    });
  });

  it('waves: hidden until their delay, then the web’s radius, stroke and alpha, gone at the end', () => {
    const t = buildNativeTogetherTimeline(crossing);
    togetherWaves(true).forEach((wave, i) => {
      const native = t.waves[i];
      expect(native.opacity.inputRange[0]).toBeLessThan(wave.delayMs);
      expect(native.opacity.outputRange[0]).toBe(0);
      expect(valueAt(native.opacity, wave.delayMs)).toBe(wave.strength);
      expect(native.opacity.outputRange.at(-1)).toBe(0);
      expect(valueAt(native.borderWidth, wave.delayMs)).toBe(7.5);
      expect(native.borderWidth.outputRange.at(-1)).toBe(0.5);
      native.size.inputRange.slice(1).forEach((ms, k) => {
        const w = waveAt(ms, wave.delayMs, wave.strength, crossing.width)!;
        const outer = w.radius + w.lineWidth / 2;
        expect(native.size.outputRange[k + 1]).toBeCloseTo(outer * 2, 9);
        expect(native.left.outputRange[k + 1]).toBeCloseTo(crossing.centerX - outer, 9);
        expect(native.top.outputRange[k + 1]).toBeCloseTo(crossing.centerY - outer, 9);
      });
    });
  });

  it('glow: the web’s strength over time, and bands that stack to the web’s gradient', () => {
    const t = buildNativeTogetherTimeline(ordinary);
    t.glow.opacity.inputRange.forEach((ms, k) => expect(t.glow.opacity.outputRange[k]).toBe(glowAlphaAt(ms)));
    expect(t.glow.opacity.inputRange[0]).toBe(TOGETHER_GLOW.gatherStartMs);
    expect(t.glow.opacity.inputRange).toContain(TOGETHER_GLOW.gatherStartMs + TOGETHER_GLOW.gatherMs);
    expect(t.glow.opacity.inputRange).toContain(TOGETHER_GLOW.releaseStartMs);
    expect(t.glow.opacity.outputRange[0]).toBe(0);
    expect(t.glow.opacity.outputRange.at(-1)).toBe(0);

    expect(glowProfile(0)).toBe(0.3);
    expect(glowProfile(0.4)).toBeCloseTo(0.12, 12);
    expect(glowProfile(1)).toBe(0);
    const radius = glowRadius(ordinary.width);
    const bands = glowBands(radius);
    expect(bands).toHaveLength(10);
    for (let k = 1; k <= 10; k += 1) {
      const x = (k - 0.5) / 10;
      expect(stackedAlpha(bands, x)).toBeCloseTo(glowProfile((x * radius - 4) / (radius - 4)), 12);
    }
    expect(bands.every((b) => b.alpha >= 0 && b.alpha < 1)).toBe(true);
  });

  it('unwrapAngle keeps consecutive headings within π', () => {
    expect(unwrapAngle(3, null)).toBe(3);
    expect(unwrapAngle(-3, 3)).toBeCloseTo(-3 + Math.PI * 2, 12);
    expect(unwrapAngle(3, -3)).toBeCloseTo(3 - Math.PI * 2, 12);
  });
});

describe('the native driver: truth first, one settle, every timer cancelled', () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date'],
    });
    // react-native-web has no native animated module and says so once.
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('holds the trusted before ratio until 1,450 ms, eases to the confirmed ratio, and settles once at 3,400 ms', () => {
    const ratios: number[] = [];
    const settled = vi.fn();
    startTogetherNativeMotion({
      run: createNativeTogetherRun(ordinary),
      from: 0.74,
      to: 0.744,
      onRatio: (r) => ratios.push(r),
      onSettled: settled,
    });
    vi.advanceTimersByTime(1449);
    expect(ratios).toEqual([]);
    vi.advanceTimersByTime(1000);
    expect(ratios.length).toBeGreaterThan(5);
    for (let i = 1; i < ratios.length; i += 1) expect(ratios[i]).toBeGreaterThanOrEqual(ratios[i - 1]);
    expect(ratios.at(-1)).toBe(0.744);
    expect(settled).not.toHaveBeenCalled();
    vi.advanceTimersByTime(3400 - 2449);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(ratios.at(-1)).toBe(0.744);
    vi.advanceTimersByTime(5000);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('stop(true) mid-flight settles at the confirmed ratio at once and nothing fires after', () => {
    const ratios: number[] = [];
    const settled = vi.fn();
    const run = createNativeTogetherRun(crossing);
    const stop = startTogetherNativeMotion({ run, from: 0.996, to: 1, onRatio: (r) => ratios.push(r), onSettled: settled });
    vi.advanceTimersByTime(1600);
    stop(true);
    expect(ratios.at(-1)).toBe(1);
    expect(settled).toHaveBeenCalledTimes(1);
    const count = ratios.length;
    vi.advanceTimersByTime(5000);
    expect(ratios.length).toBe(count);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stop(false) — unmount — only stops: no settle callback, no further ratio, no timers left, NO value written', () => {
    const onRatio = vi.fn();
    const settled = vi.fn();
    const run = createNativeTogetherRun(ordinary);
    const stop = startTogetherNativeMotion({ run, from: 0.2, to: 0.3, onRatio, onSettled: settled });
    vi.advanceTimersByTime(500);
    const values = [run.pulse, run.glowClock, run.pieceClock, run.waveClock];
    const writes = values.map((v) => vi.spyOn(v, 'setValue'));
    stop(false);
    for (const w of writes) expect(w).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(onRatio).not.toHaveBeenCalled();
    expect(settled).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a finish writes every value to its end, each clock to its own end', () => {
    const run = createNativeTogetherRun(crossing);
    const stop = startTogetherNativeMotion({ run, from: 0.99, to: 1, onRatio: () => undefined, onSettled: () => undefined });
    vi.advanceTimersByTime(300);
    const writes = {
      pulse: vi.spyOn(run.pulse, 'setValue'),
      glow: vi.spyOn(run.glowClock, 'setValue'),
      pieces: vi.spyOn(run.pieceClock, 'setValue'),
      waves: vi.spyOn(run.waveClock, 'setValue'),
    };
    stop(true);
    expect(writes.pulse).toHaveBeenCalledWith(1);
    expect(writes.glow).toHaveBeenCalledWith(run.timeline.glowEndMs);
    expect(writes.pieces).toHaveBeenCalledWith(run.timeline.piecesEndMs);
    expect(writes.waves).toHaveBeenCalledWith(run.timeline.wavesEndMs);
  });

  it('the run builds every layer style once: the same objects on every read', () => {
    const run = createNativeTogetherRun(crossing);
    expect(run.styles.pieces).toHaveLength(28);
    expect(run.styles.bands).toHaveLength(10);
    expect(run.styles.waves).toHaveLength(3);
    // Static and animated parts are prebuilt arrays, not built per render.
    expect(Array.isArray(run.styles.pieces[0].head)).toBe(true);
    expect(run.styles.pieces[0].trail).toHaveLength(2);
  });
});

describe('the web build never carries the native driver', () => {
  it('togetherMotionNative.web.ts provides every runtime name TogetherCompletion imports, in the same shape, each failing safe', async () => {
    const native = (await import('../src/ui/togetherMotionNative')) as Record<string, unknown>;
    const web = await import('../src/ui/togetherMotionNative.web');
    const stub = web as Record<string, unknown>;
    // Exactly the runtime names TogetherCompletion imports from './togetherMotionNative' (types excluded).
    const completion = readFileSync(nodePath.resolve(__dirname, '../src/ui/TogetherCompletion.tsx'), 'utf8');
    const block = /import \{([^}]*)\} from '\.\/togetherMotionNative';/.exec(completion)![1];
    const used = block
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n && !n.startsWith('type '));
    expect(used.sort()).toEqual(['TogetherNativeLayer', 'createNativeTogetherRun', 'startTogetherNativeMotion']);
    for (const name of used) {
      expect(stub[name], name).toBeDefined();
      expect(typeof stub[name], name).toBe(typeof native[name]);
      expect((stub[name] as { $$typeof?: symbol }).$$typeof, name).toBe((native[name] as { $$typeof?: symbol }).$$typeof);
    }
    // Building a run on the web throws (TogetherCompletion settles on that)…
    expect(() => web.createNativeTogetherRun(ordinary)).toThrow(/does not run on the web/);
    // …a start is a no-op whose finish settles at the confirmed ratio, and whose unmount stop does nothing…
    const onRatio = vi.fn();
    const onSettled = vi.fn();
    const stop = web.startTogetherNativeMotion({ run: {} as never, from: 0.2, to: 0.3, onRatio, onSettled });
    stop(false);
    expect(onSettled).not.toHaveBeenCalled();
    stop(true);
    expect(onRatio).toHaveBeenCalledWith(0.3);
    expect(onSettled).toHaveBeenCalledTimes(1);
    // …and the layer renders nothing.
    const layer = web.TogetherNativeLayer as unknown as { type: (p: { run: unknown }) => unknown };
    expect(layer.type({ run: {} })).toBeNull();
  });

  it('the stand-in imports only React at runtime (the native driver by type only), so the web bundle has no native driver code', () => {
    const src = readFileSync(nodePath.resolve(__dirname, '../src/ui/togetherMotionNative.web.ts'), 'utf8');
    const runtimeImports = [...src.matchAll(/^import (?!type )[^;]*from '([^']+)'/gm)].map((m) => m[1]);
    expect(runtimeImports).toEqual(['react']);
    expect(src).not.toMatch(/from 'react-native'/);
  });
});

describe('the native announcement states confirmed figures only', () => {
  it('amount and shared total, from the receipt — or the amount alone on an own-only receipt', async () => {
    const { togetherAnnouncement } = await import('../src/ui/TogetherCompletion');
    expect(
      togetherAnnouncement({ eyebrow: 'Recorded', amountText: '+20', unit: 'squats', shared: { total: 3720, target: 5000, unit: 'squats' } })
    ).toBe('Recorded: +20 squats. Shared total: 3,720 of 5,000 squats.');
    expect(
      togetherAnnouncement({ eyebrow: 'Already recorded', amountText: '35', unit: 'squats', shared: { total: 5015, target: 5000, unit: 'squats' } })
    ).toBe('Already recorded: 35 squats. Shared total: 5,015 of 5,000 squats.');
    expect(togetherAnnouncement({ eyebrow: 'Recorded', amountText: '+20', unit: null, shared: null })).toBe('Recorded: +20.');
  });
});
