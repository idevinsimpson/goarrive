import { Fragment } from 'react';
import { Animated, Easing, StyleSheet, View, type ViewStyle } from 'react-native';

import {
  bezier,
  buildPieces,
  fillRatioAt,
  glowAlphaAt,
  glowRadius,
  pieceFrameAt,
  TOGETHER_GLOW,
  TOGETHER_TIMING,
  togetherTimeline,
  waveAt,
  type TogetherTimeline,
} from './togetherMotion';

/**
 * NATIVE-MOTION-1 — the Together motion on iOS and Android.
 *
 * SAME TIMELINE AS THE WEB. Every time, duration, easing, scale, alpha and
 * geometry comes from togetherMotion.ts, the module the web driver
 * (`runTogetherMotion`) plays from: TOGETHER_TIMING, the pulse stops and
 * easing, the glow and wave functions, the pieces and their per-frame math.
 * Nothing timing-related is restated here.
 *
 * HOW IT PLAYS. React Native has no canvas, so the canvas layer is redrawn as
 * views, all driven from one clock that starts with the pulse:
 *   - pulse   — the mark's scale, an `Easing.bezier` of the web's
 *               cubic-bezier over 2,700 ms through the same keyframe offsets
 *               (native driver);
 *   - glow    — the radial gradient as concentric bands whose stacked alpha
 *               matches the gradient's stops, faded by `glowAlphaAt` (native);
 *   - pieces  — each piece's head and trail sampled from `pieceFrameAt` along
 *               its window, interpolated between samples (native);
 *   - waves   — radius, stroke width and alpha from `waveAt`; these change
 *               layout (size, border width), which the native driver cannot
 *               animate, so they run on the JS driver;
 *   - fill    — the confirmed-ratio tween, exactly as the web runs it:
 *               `fillRatioAt` per frame from 1,450 ms for 700 ms, every value
 *               mapped through the mark's own area calibration;
 *   - settle  — at 3,400 ms, whatever happened before.
 *
 * WHAT IS APPROXIMATED (decoration only, never a number): the gradient is
 * banded rather than continuous; each trail is two straight chords with the
 * gradient's mean alpha rather than a curved gradient stroke; piece glow uses
 * a static `boxShadow` (new architecture) and waves carry no blur.
 *
 * Nothing here decides what was recorded or whether a goal was crossed. It is
 * handed `crossed`, `from` and `to`; cancelling it at any moment leaves the
 * same final receipt.
 */

export type TogetherGeometry = {
  crossed: boolean;
  /** The stage (the web's canvas) size. */
  width: number;
  height: number;
  /** The mark's centre, relative to the stage. */
  centerX: number;
  centerY: number;
  markWidth: number;
  markHeight: number;
};

/** A piecewise-linear track over the motion clock (ms) or the pulse progress (0–1). */
export type Track = { inputRange: number[]; outputRange: number[] };

/** Samples per piece window, per wave window and across the glow's life. */
export const NATIVE_SAMPLES = { piece: 24, wave: 24, glow: 36 } as const;
/** Concentric bands standing in for the radial gradient. */
export const GLOW_BANDS = 10;
/** A trail chord's unscaled width; its length is a scaleX of this. */
export const TRAIL_BASE_PX = 100;
/** The web draws each piece as a parallelogram whose lower edge sits 0.65 × breadth to the right. */
export const PIECE_SKEW_RAD = Math.atan(0.65);
const PIECE_SHADOW = '0px 0px 12px rgba(145,203,125,0.55)';
const MIN_SCALE = 1e-4;
const FILL_RGB = '145,203,125';

type PieceTrack = {
  length: number;
  breadth: number;
  color: string;
  head: { x: Track; y: Track; rotate: Track; scaleX: Track; scaleY: Track; opacity: Track };
  trail: Array<{ x: Track; y: Track; rotate: Track; scaleX: Track; opacity: Track }>;
};

type WaveTrack = {
  left: Track;
  top: Track;
  size: Track;
  borderRadius: Track;
  borderWidth: Track;
  opacity: Track;
};

export type NativeTogetherTimeline = {
  shared: TogetherTimeline;
  width: number;
  height: number;
  /** The mark's scale over pulse progress (0–1): the same offsets and scales as the web keyframes. */
  pulse: Track;
  glow: { bands: Array<{ left: number; top: number; size: number; alpha: number }>; opacity: Track };
  pieces: PieceTrack[];
  waves: WaveTrack[];
};

const track = (): Track => ({ inputRange: [], outputRange: [] });
const push = (t: Track, input: number, output: number) => {
  t.inputRange.push(input);
  t.outputRange.push(output);
};

/** Brings `angle` within π of `previous`, so an interpolation never spins the long way round. */
export function unwrapAngle(angle: number, previous: number | null): number {
  if (previous == null) return angle;
  let a = angle;
  while (a - previous > Math.PI) a -= Math.PI * 2;
  while (a - previous < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Sorted, de-duplicated sample fractions in [0, 1], plus any exact breakpoints. */
function fractions(n: number, extra: number[] = []): number[] {
  const set = new Set<number>();
  for (let i = 0; i <= n; i += 1) set.add(i / n);
  extra.forEach((x) => set.add(x));
  return [...set].filter((x) => x >= 0 && x <= 1).sort((a, b) => a - b);
}

/** The web's gradient alpha at fraction `t` of the way from its inner to its outer circle. */
export function glowProfile(t: number): number {
  const { centerAlpha, midAlpha, midStop } = TOGETHER_GLOW;
  const c = Math.max(0, Math.min(1, t));
  if (c <= midStop) return centerAlpha + (midAlpha - centerAlpha) * (c / midStop);
  return midAlpha * (1 - (c - midStop) / (1 - midStop));
}

/**
 * Concentric bands, outermost first, whose STACKED alpha equals the web's
 * gradient at each band's mid radius. A band of fraction f covers every
 * radius ≤ f × radius; stacking alphas a₁…aₙ composite to 1 − Π(1 − aᵢ).
 */
export function glowBands(radius: number, n: number = GLOW_BANDS): Array<{ radiusFraction: number; alpha: number }> {
  const inner = 4; // the web gradient's inner circle
  const target = (k: number) => {
    if (k > n) return 0;
    const r = ((k - 0.5) / n) * radius;
    return glowProfile((r - inner) / (radius - inner));
  };
  const bands: Array<{ radiusFraction: number; alpha: number }> = [];
  for (let k = n; k >= 1; k -= 1) {
    const alpha = 1 - (1 - target(k)) / (1 - target(k + 1));
    bands.push({ radiusFraction: k / n, alpha: Math.max(0, alpha) });
  }
  return bands;
}

/** The stacked alpha of `bands` at fraction `x` of the glow radius. */
export function stackedAlpha(bands: Array<{ radiusFraction: number; alpha: number }>, x: number): number {
  return 1 - bands.filter((b) => b.radiusFraction >= x).reduce((keep, b) => keep * (1 - b.alpha), 1);
}

/**
 * The whole native timeline as plain numbers: no Animated, no React. Every
 * value is a sample of the web's own functions at that moment.
 */
export function buildNativeTogetherTimeline(geom: TogetherGeometry): NativeTogetherTimeline {
  const shared = togetherTimeline(geom.crossed);
  const { width, height, centerX, centerY } = geom;

  const pulse = track();
  for (const stop of shared.pulse.stops) push(pulse, stop.offset, stop.scale);

  // Glow: concentric bands, one opacity over the clock.
  const radius = glowRadius(width);
  const bands = glowBands(radius).map((b) => {
    const r = b.radiusFraction * radius;
    return { left: centerX - r, top: centerY - r, size: r * 2, alpha: b.alpha };
  });
  const glowOpacity = track();
  const glowStart = TOGETHER_GLOW.gatherStartMs;
  const glowEnd = TOGETHER_GLOW.releaseStartMs + TOGETHER_GLOW.releaseMs;
  const glowSpan = glowEnd - glowStart;
  for (const f of fractions(NATIVE_SAMPLES.glow, [
    (TOGETHER_GLOW.gatherStartMs + TOGETHER_GLOW.gatherMs - glowStart) / glowSpan,
    (TOGETHER_GLOW.releaseStartMs - glowStart) / glowSpan,
  ])) {
    const ms = glowStart + f * glowSpan;
    push(glowOpacity, ms, glowAlphaAt(ms));
  }

  // Pieces: the same pieces the web draws, each sampled across its window.
  const pieces = buildPieces(geom).map<PieceTrack>((piece) => {
    const head = { x: track(), y: track(), rotate: track(), scaleX: track(), scaleY: track(), opacity: track() };
    const trail = [0, 1].map(() => ({ x: track(), y: track(), rotate: track(), scaleX: track(), opacity: track() }));
    let headAngle: number | null = null;
    const trailAngle: Array<number | null> = [null, null];
    // 1/7 and 8/9 are where the web's alpha ramps end; sampling them keeps the fade exact.
    for (const p of fractions(NATIVE_SAMPLES.piece, [1 / 7, 8 / 9])) {
      const ms = piece.delay + p * piece.duration;
      const frame = pieceFrameAt(piece, ms);
      if (!frame) continue;
      const dx = frame.tangent.x - frame.head.x;
      const dy = frame.tangent.y - frame.head.y;
      // At the very end the tangent collapses onto the head; keep the last heading.
      const rawAngle = Math.hypot(dx, dy) > 1e-6 ? Math.atan2(dy, dx) : headAngle ?? 0;
      headAngle = unwrapAngle(rawAngle, headAngle);
      // The web's parallelogram is centred 0.325 × breadth ahead of the head, along the heading.
      const offset = 0.325 * frame.breadth;
      push(head.x, ms, frame.head.x + Math.cos(headAngle) * offset);
      push(head.y, ms, frame.head.y + Math.sin(headAngle) * offset);
      push(head.rotate, ms, headAngle);
      push(head.scaleX, ms, Math.max(MIN_SCALE, frame.length / piece.length));
      push(head.scaleY, ms, Math.max(MIN_SCALE, frame.breadth / piece.breadth));
      push(head.opacity, ms, frame.alpha);

      // The trail: tail → middle → head, as two chords carrying the gradient's mean alpha.
      const mid = bezier(piece.points, (frame.tailU + frame.u) / 2);
      const chords = [
        { a: frame.tail, b: mid, share: 0.25 },
        { a: mid, b: frame.head, share: 0.75 },
      ];
      chords.forEach(({ a, b, share }, i) => {
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        const angle = len > 1e-6 ? Math.atan2(b.y - a.y, b.x - a.x) : trailAngle[i] ?? headAngle ?? 0;
        trailAngle[i] = unwrapAngle(angle, trailAngle[i]);
        push(trail[i].x, ms, (a.x + b.x) / 2);
        push(trail[i].y, ms, (a.y + b.y) / 2);
        push(trail[i].rotate, ms, trailAngle[i]!);
        push(trail[i].scaleX, ms, Math.max(MIN_SCALE, len / TRAIL_BASE_PX));
        push(trail[i].opacity, ms, frame.alpha * 0.47 * share);
      });
    }
    return { length: piece.length, breadth: piece.breadth, color: piece.color, head, trail };
  });

  // Waves: radius, stroke and alpha from the web's waveAt; hidden before each one starts.
  const waves = shared.waves.map<WaveTrack>((wave) => {
    const t: WaveTrack = {
      left: track(),
      top: track(),
      size: track(),
      borderRadius: track(),
      borderWidth: track(),
      opacity: track(),
    };
    const sample = (ms: number, w: { radius: number; alpha: number; lineWidth: number }, alpha: number) => {
      // The web strokes centred on the radius; a border sits inside the box.
      const outer = w.radius + w.lineWidth / 2;
      push(t.left, ms, centerX - outer);
      push(t.top, ms, centerY - outer);
      push(t.size, ms, outer * 2);
      push(t.borderRadius, ms, outer);
      push(t.borderWidth, ms, w.lineWidth);
      push(t.opacity, ms, alpha);
    };
    const first = waveAt(wave.delayMs, wave.delayMs, wave.strength, width)!;
    sample(wave.delayMs - 0.5, first, 0);
    for (const f of fractions(NATIVE_SAMPLES.wave)) {
      const ms = wave.delayMs + f * wave.durationMs;
      const w = waveAt(ms, wave.delayMs, wave.strength, width);
      if (w) sample(ms, w, w.alpha);
    }
    return t;
  });

  return {
    shared,
    width,
    height,
    pulse,
    glow: { bands, opacity: glowOpacity },
    pieces,
    waves,
  };
}

type AnimatedNumber = Animated.AnimatedInterpolation<number>;
type AnimatedString = Animated.AnimatedInterpolation<string>;
type AnimatedViewStyle = Animated.WithAnimatedValue<ViewStyle>;

/** One instance's animated values and the styles built on them, created once. */
export type NativeTogetherRun = {
  timeline: NativeTogetherTimeline;
  /** Milliseconds since the start, 0 → canvasEndMs, native driver. */
  clock: Animated.Value;
  /** Pulse progress 0 → 1 under the web's easing, native driver. */
  pulse: Animated.Value;
  /** Milliseconds since the start for the waves, JS driver (they change layout). */
  waves: Animated.Value;
  styles: {
    pulse: AnimatedViewStyle;
    glow: AnimatedViewStyle;
    pieces: Array<{ head: AnimatedViewStyle; trail: AnimatedViewStyle[] }>;
    waves: AnimatedViewStyle[];
  };
};

const num = (value: Animated.Value, t: Track): AnimatedNumber =>
  value.interpolate({ inputRange: t.inputRange, outputRange: t.outputRange, extrapolate: 'clamp' });
const rad = (value: Animated.Value, t: Track): AnimatedString =>
  value.interpolate({
    inputRange: t.inputRange,
    outputRange: t.outputRange.map((r) => `${r.toFixed(5)}rad`),
    extrapolate: 'clamp',
  });

export function createNativeTogetherRun(geom: TogetherGeometry): NativeTogetherRun {
  const timeline = buildNativeTogetherTimeline(geom);
  const clock = new Animated.Value(0);
  const pulse = new Animated.Value(0);
  const waves = new Animated.Value(0);
  const skew = `${PIECE_SKEW_RAD}rad`;
  return {
    timeline,
    clock,
    pulse,
    waves,
    styles: {
      pulse: { transform: [{ scale: num(pulse, timeline.pulse) }] },
      glow: { opacity: num(clock, timeline.glow.opacity) },
      pieces: timeline.pieces.map((piece) => ({
        head: {
          opacity: num(clock, piece.head.opacity),
          transform: [
            { translateX: num(clock, piece.head.x) },
            { translateY: num(clock, piece.head.y) },
            { rotate: rad(clock, piece.head.rotate) },
            { skewX: skew },
            { scaleX: num(clock, piece.head.scaleX) },
            { scaleY: num(clock, piece.head.scaleY) },
          ],
        },
        trail: piece.trail.map((chord) => ({
          opacity: num(clock, chord.opacity),
          transform: [
            { translateX: num(clock, chord.x) },
            { translateY: num(clock, chord.y) },
            { rotate: rad(clock, chord.rotate) },
            { scaleX: num(clock, chord.scaleX) },
          ],
        })),
      })),
      waves: timeline.waves.map((wave) => ({
        left: num(waves, wave.left),
        top: num(waves, wave.top),
        width: num(waves, wave.size),
        height: num(waves, wave.size),
        borderRadius: num(waves, wave.borderRadius),
        borderWidth: num(waves, wave.borderWidth),
        opacity: num(waves, wave.opacity),
      })),
    },
  };
}

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

/**
 * Plays one run. The same contract as the web's `runTogetherMotion`: returns
 * `stop(finish)`; `stop(true)` settles (final ratio, then `onSettled`),
 * `stop(false)` only stops — used on unmount. Every animation, timer and frame
 * it starts is stopped by that one function, and every value is left at its
 * end (scale 1, decoration invisible).
 */
export function startTogetherNativeMotion(opts: {
  run: NativeTogetherRun;
  from: number;
  to: number;
  onRatio: (ratio: number) => void;
  onSettled: () => void;
}): (finish: boolean) => void {
  const { run, from, to, onRatio, onSettled } = opts;
  const { shared } = run.timeline;
  let disposed = false;
  let settled = false;
  let fillFrame = 0;
  const timers: ReturnType<typeof setTimeout>[] = [];

  const settle = () => {
    if (settled) return;
    settled = true;
    onRatio(to);
    onSettled();
  };

  const animations = [
    Animated.timing(run.pulse, {
      toValue: 1,
      duration: shared.pulse.durationMs,
      easing: Easing.bezier(...shared.pulse.easing),
      useNativeDriver: true,
    }),
    Animated.timing(run.clock, {
      toValue: shared.canvasEndMs,
      duration: shared.canvasEndMs,
      easing: Easing.linear,
      useNativeDriver: true,
    }),
    Animated.timing(run.waves, {
      toValue: shared.canvasEndMs,
      duration: shared.canvasEndMs,
      easing: Easing.linear,
      useNativeDriver: false,
    }),
  ];

  const stop = (finish: boolean) => {
    if (disposed) {
      if (finish) settle();
      return;
    }
    disposed = true;
    cancelAnimationFrame(fillFrame);
    timers.forEach(clearTimeout);
    animations.forEach((a) => a.stop());
    run.pulse.setValue(1);
    run.clock.setValue(shared.canvasEndMs);
    run.waves.setValue(shared.canvasEndMs);
    if (finish) settle();
  };

  // Always from the first frame, even if these values played before.
  run.pulse.setValue(0);
  run.clock.setValue(0);
  run.waves.setValue(0);
  animations.forEach((a) => a.start());

  // The confirmed-ratio tween, exactly as the web runs it.
  timers.push(
    setTimeout(() => {
      const fillStarted = now();
      const tick = () => {
        if (disposed) return;
        const ms = TOGETHER_TIMING.fillStartMs + (now() - fillStarted);
        onRatio(fillRatioAt(ms, from, to));
        if (ms < TOGETHER_TIMING.fillStartMs + TOGETHER_TIMING.fillDurationMs) {
          fillFrame = requestAnimationFrame(tick);
        }
      };
      fillFrame = requestAnimationFrame(tick);
    }, shared.fill.startMs)
  );
  timers.push(setTimeout(() => stop(true), shared.settleMs));

  return stop;
}

/**
 * The decorative layer over the stage, on top of the receipt like the web
 * canvas, never touchable and hidden from assistive technology. Rendered only
 * while a run plays.
 */
export function TogetherNativeLayer({ run }: { run: NativeTogetherRun }) {
  const { timeline: t, styles: s } = run;
  return (
    <View
      style={[layer.root, { width: t.width, height: t.height }]}
      aria-hidden
      testID="wsf-together-native-layer"
    >
      <Animated.View style={[StyleSheet.absoluteFill, s.glow]}>
        {t.glow.bands.map((band, i) => (
          <View
            key={i}
            style={{
              position: 'absolute',
              left: band.left,
              top: band.top,
              width: band.size,
              height: band.size,
              borderRadius: band.size / 2,
              backgroundColor: `rgba(${FILL_RGB},${band.alpha})`,
            }}
          />
        ))}
      </Animated.View>
      {t.pieces.map((piece, i) => (
        <Fragment key={i}>
          {piece.trail.map((_, j) => (
            <Animated.View
              key={j}
              style={[layer.trail, { backgroundColor: `rgb(${piece.color})` }, s.pieces[i].trail[j]]}
            />
          ))}
          <Animated.View
            style={[
              {
                position: 'absolute',
                left: -piece.length / 2,
                top: -piece.breadth / 2,
                width: piece.length,
                height: piece.breadth,
                backgroundColor: `rgb(${piece.color})`,
                boxShadow: PIECE_SHADOW,
              },
              s.pieces[i].head,
            ]}
          />
        </Fragment>
      ))}
      {t.waves.map((_, i) => (
        <Animated.View key={i} style={[layer.wave, s.waves[i]]} />
      ))}
    </View>
  );
}

const layer = StyleSheet.create({
  root: { position: 'absolute', left: 0, top: 0, overflow: 'hidden', pointerEvents: 'none' },
  trail: {
    position: 'absolute',
    left: -TRAIL_BASE_PX / 2,
    top: -0.85,
    width: TRAIL_BASE_PX,
    height: 1.7,
  },
  wave: { position: 'absolute', borderColor: `rgb(${FILL_RGB})`, transform: [{ scaleY: 0.87 }] },
});
