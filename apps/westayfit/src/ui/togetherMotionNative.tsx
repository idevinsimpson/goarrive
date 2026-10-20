import { Fragment, memo, type ComponentProps } from 'react';
import { Animated, Easing, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

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
 * views. Every part starts at the same instant as the pulse, and each part's
 * clock runs only as long as that part is visible (the pieces until the last
 * piece's window ends, the glow until its release ends, the waves until the
 * web's canvas end), so nothing keeps animating invisible views:
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
  /** When the last piece's window ends (ms): the pieces' clock stops here. */
  piecesEndMs: number;
  /** When the glow's release ends (ms): the glow's clock stops here. */
  glowEndMs: number;
  /** The waves' clock stops at the web's canvas end. */
  wavesEndMs: number;
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
  const sourcePieces = buildPieces(geom);
  const piecesEndMs = Math.max(...sourcePieces.map((piece) => piece.delay + piece.duration));
  const pieces = sourcePieces.map<PieceTrack>((piece) => {
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
    piecesEndMs,
    glowEndMs: glowEnd,
    wavesEndMs: shared.canvasEndMs,
    pulse,
    glow: { bands, opacity: glowOpacity },
    pieces,
    waves,
  };
}

type AnimatedNumber = Animated.AnimatedInterpolation<number>;
type AnimatedString = Animated.AnimatedInterpolation<string>;
type AnimatedViewStyle = Animated.WithAnimatedValue<ViewStyle>;
/** Whatever Animated.View accepts as `style`: static and animated parts together. */
type AnimatedStyleProp = ComponentProps<typeof Animated.View>['style'];

/**
 * One instance's animated values and EVERY style the layer renders — static
 * and animated — built once, so a re-render of the receipt (the fill tween
 * re-renders it every frame) hands the memoised layer the same objects and
 * the layer does not re-render at all.
 */
export type NativeTogetherRun = {
  timeline: NativeTogetherTimeline;
  /** Pulse progress 0 → 1 under the web's easing, native driver. */
  pulse: Animated.Value;
  /** Milliseconds since the start, 0 → glowEndMs, native driver. */
  glowClock: Animated.Value;
  /** Milliseconds since the start, 0 → piecesEndMs, native driver. */
  pieceClock: Animated.Value;
  /** Milliseconds since the start, 0 → wavesEndMs, JS driver (waves change layout). */
  waveClock: Animated.Value;
  styles: {
    root: StyleProp<ViewStyle>;
    pulse: AnimatedViewStyle;
    glow: AnimatedStyleProp;
    bands: ViewStyle[];
    pieces: Array<{ head: AnimatedStyleProp; trail: AnimatedStyleProp[] }>;
    waves: AnimatedStyleProp[];
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
  const pulse = new Animated.Value(0);
  const glowClock = new Animated.Value(0);
  const pieceClock = new Animated.Value(0);
  const waveClock = new Animated.Value(0);
  const skew = `${PIECE_SKEW_RAD}rad`;
  return {
    timeline,
    pulse,
    glowClock,
    pieceClock,
    waveClock,
    styles: {
      root: [layer.root, { width: timeline.width, height: timeline.height }],
      pulse: { transform: [{ scale: num(pulse, timeline.pulse) }] },
      glow: [StyleSheet.absoluteFill, { opacity: num(glowClock, timeline.glow.opacity) }],
      bands: timeline.glow.bands.map((band) => ({
        position: 'absolute',
        left: band.left,
        top: band.top,
        width: band.size,
        height: band.size,
        borderRadius: band.size / 2,
        backgroundColor: `rgba(${FILL_RGB},${band.alpha})`,
      })),
      pieces: timeline.pieces.map((piece) => ({
        head: [
          {
            position: 'absolute',
            left: -piece.length / 2,
            top: -piece.breadth / 2,
            width: piece.length,
            height: piece.breadth,
            backgroundColor: `rgb(${piece.color})`,
            boxShadow: PIECE_SHADOW,
          },
          {
            opacity: num(pieceClock, piece.head.opacity),
            transform: [
              { translateX: num(pieceClock, piece.head.x) },
              { translateY: num(pieceClock, piece.head.y) },
              { rotate: rad(pieceClock, piece.head.rotate) },
              { skewX: skew },
              { scaleX: num(pieceClock, piece.head.scaleX) },
              { scaleY: num(pieceClock, piece.head.scaleY) },
            ],
          },
        ],
        trail: piece.trail.map((chord) => [
          layer.trail,
          { backgroundColor: `rgb(${piece.color})` },
          {
            opacity: num(pieceClock, chord.opacity),
            transform: [
              { translateX: num(pieceClock, chord.x) },
              { translateY: num(pieceClock, chord.y) },
              { rotate: rad(pieceClock, chord.rotate) },
              { scaleX: num(pieceClock, chord.scaleX) },
            ],
          },
        ]),
      })),
      waves: timeline.waves.map((wave) => [
        layer.wave,
        {
          left: num(waveClock, wave.left),
          top: num(waveClock, wave.top),
          width: num(waveClock, wave.size),
          height: num(waveClock, wave.size),
          borderRadius: num(waveClock, wave.borderRadius),
          borderWidth: num(waveClock, wave.borderWidth),
          opacity: num(waveClock, wave.opacity),
        },
      ]),
    },
  };
}

const now = (): number =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

/**
 * Plays one run. The same contract as the web's `runTogetherMotion`: returns
 * `stop(finish)`; `stop(true)` settles (final ratio, then `onSettled`),
 * `stop(false)` only stops — used on unmount. Every animation, timer and frame
 * it starts is stopped by that one function. Only a FINISH writes values (scale
 * 1, decoration invisible, then the settle): an unmount's stop leaves the
 * values alone, so nothing is written to nodes that are detaching.
 */
export function startTogetherNativeMotion(opts: {
  run: NativeTogetherRun;
  from: number;
  to: number;
  onRatio: (ratio: number) => void;
  onSettled: () => void;
}): (finish: boolean) => void {
  const { run, from, to, onRatio, onSettled } = opts;
  const { shared, piecesEndMs, glowEndMs, wavesEndMs } = run.timeline;
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
    // Each clock reads in ms (value = elapsed) and stops when its part has ended.
    Animated.timing(run.glowClock, { toValue: glowEndMs, duration: glowEndMs, easing: Easing.linear, useNativeDriver: true }),
    Animated.timing(run.pieceClock, { toValue: piecesEndMs, duration: piecesEndMs, easing: Easing.linear, useNativeDriver: true }),
    Animated.timing(run.waveClock, { toValue: wavesEndMs, duration: wavesEndMs, easing: Easing.linear, useNativeDriver: false }),
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
    if (finish) {
      run.pulse.setValue(1);
      run.glowClock.setValue(glowEndMs);
      run.pieceClock.setValue(piecesEndMs);
      run.waveClock.setValue(wavesEndMs);
      settle();
    }
  };

  // Always from the first frame, even if these values played before.
  run.pulse.setValue(0);
  run.glowClock.setValue(0);
  run.pieceClock.setValue(0);
  run.waveClock.setValue(0);
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
 * while a run plays. Memoised on the run, whose every style is built once:
 * the fill tween re-renders the receipt each frame, and this layer's ~90
 * views do not re-render with it.
 */
export const TogetherNativeLayer = memo(function TogetherNativeLayer({ run }: { run: NativeTogetherRun }) {
  const { timeline: t, styles: s } = run;
  return (
    <View style={s.root} aria-hidden testID="wsf-together-native-layer">
      <Animated.View style={s.glow}>
        {s.bands.map((band, i) => (
          <View key={i} style={band} />
        ))}
      </Animated.View>
      {t.pieces.map((piece, i) => (
        <Fragment key={i}>
          {piece.trail.map((_, j) => (
            <Animated.View key={j} style={s.pieces[i].trail[j]} />
          ))}
          <Animated.View style={s.pieces[i].head} />
        </Fragment>
      ))}
      {s.waves.map((wave, i) => (
        <Animated.View key={i} style={wave} />
      ))}
    </View>
  );
});

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
