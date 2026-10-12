/**
 * TOGETHER-COMPLETION-1 — the owner-selected Together motion, ported from the
 * frozen Lovable reference (bdd69358…/lovable/source/src/demo/together.tsx at
 * product head 66e53073). Timing, keyframes, piece geometry and halo waves are
 * the donor's; the fill mapping is NOT: the canonical 1200×583 monogram keeps
 * its own area calibration (livingWeCalibration / heightFractionForFill), and
 * the donor's 1282×609 CDF is never applied to it.
 *
 * Everything here is presentation. It never decides what was recorded, never
 * decides a crossing and never stores anything. The receipt is fully readable
 * before, during and after it; cancelling it at any moment leaves the same
 * exact final receipt.
 */

/** The receipt-only palette. Scoped to the Together receipt; no shared token changes. */
export const TOGETHER_COLORS = {
  background: '#091B30',
  unfilled: '#314C65',
  fill: '#91CB7D',
  text: '#F6F9FD',
  muted: '#ADC0D7',
} as const;

/** The donor's timeline, in ms from the start of the motion. */
export const TOGETHER_TIMING = {
  fillStartMs: 1450,
  fillDurationMs: 700,
  pulseDurationMs: 2700,
  waveDelaysMs: [1460, 1640] as const,
  crossingWaveDelayMs: 1810,
  waveDurationMs: 900,
  canvasEndMs: 2900,
  /** Everything settles here, whatever happened before. */
  settleMs: 3400,
} as const;

/** 1 − (1 − p)³, the donor's confirmed-ratio easing. */
export function easeOutCubic(p: number): number {
  const c = Math.max(0, Math.min(1, p));
  return 1 - Math.pow(1 - c, 3);
}

/**
 * The confirmed ratio the mark shows at `ms`: the before ratio until the fill
 * starts, the eased tween for 700 ms, then the after ratio. Callers map every
 * value through the canonical area calibration, so intermediate ratios are
 * true AREA fractions, not interpolated clip edges.
 */
export function fillRatioAt(ms: number, from: number, to: number): number {
  const p = (ms - TOGETHER_TIMING.fillStartMs) / TOGETHER_TIMING.fillDurationMs;
  if (p <= 0) return from;
  if (p >= 1) return to;
  return from + (to - from) * easeOutCubic(p);
}

/** The gather (94%) and the single rebound (110%, or 113% on a crossing). */
export function pulseKeyframes(crossed: boolean): Keyframe[] {
  return [
    { transform: 'scale(1)', offset: 0 },
    { transform: 'scale(0.96)', offset: 0.28 },
    { transform: 'scale(0.94)', offset: 0.46 },
    { transform: `scale(${crossed ? 1.13 : 1.1})`, offset: 0.57 },
    { transform: 'scale(0.99)', offset: 0.72 },
    { transform: 'scale(1.018)', offset: 0.83 },
    { transform: 'scale(1)', offset: 1 },
  ];
}

/** Decorative pieces. A count of light, not of people or contributions. */
export function pieceCount(crossed: boolean): number {
  return crossed ? 28 : 24;
}

type Point = { x: number; y: number };
export type TogetherPiece = {
  delay: number;
  duration: number;
  breadth: number;
  length: number;
  color: string;
  points: [Point, Point, Point, Point];
};

/** The donor's angled pieces, curving inward onto the measured rendered WE. */
export function buildPieces(opts: {
  crossed: boolean;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  markWidth: number;
  markHeight: number;
}): TogetherPiece[] {
  const { crossed, width, height, centerX, centerY, markWidth, markHeight } = opts;
  const count = pieceCount(crossed);
  const pieces: TogetherPiece[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count + 0.1;
    const targetX = centerX + Math.sin(i * 2.39) * markWidth * 0.22;
    const targetY = centerY + Math.cos(i * 1.73) * markHeight * 0.16;
    pieces.push({
      delay: 80 + (i % 6) * 53,
      duration: 1220 + (i % 3) * 55,
      breadth: 5.5 + (i % 3) * 2,
      length: 26 + (i % 4) * 7,
      color: i % 5 === 0 ? '242,255,244' : '145,203,125',
      points: [
        { x: centerX + Math.cos(angle) * width * 0.77, y: centerY + Math.sin(angle) * height * 0.73 },
        { x: centerX + Math.cos(angle + 0.27) * width * 0.68, y: centerY + Math.sin(angle + 0.27) * height * 0.51 },
        { x: targetX + Math.cos(angle + 0.49) * width * 0.25, y: targetY + Math.sin(angle + 0.49) * height * 0.17 },
        { x: targetX, y: targetY },
      ],
    });
  }
  return pieces;
}

function bezier(points: TogetherPiece['points'], n: number): Point {
  const q = 1 - n;
  const [p0, p1, p2, p3] = points;
  return {
    x: q * q * q * p0.x + 3 * q * q * n * p1.x + 3 * q * n * n * p2.x + n * n * n * p3.x,
    y: q * q * q * p0.y + 3 * q * q * n * p1.y + 3 * q * n * n * p2.y + n * n * n * p3.y,
  };
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const smooth = (n: number) => n * n * (3 - 2 * n);

/**
 * Runs the decorative layer, the scale pulse and the confirmed-ratio tween on
 * the web. Returns a cancel function: `cancel(true)` settles (final ratio, then
 * `onSettled`), `cancel(false)` only stops — used on unmount, where the
 * receipt's final state is what renders anyway.
 *
 * Every timer, animation frame and Web Animation it starts is cancelled by
 * that one function, and the canvas is removed.
 */
export function runTogetherMotion(opts: {
  stage: HTMLElement;
  mark: HTMLElement;
  crossed: boolean;
  from: number;
  to: number;
  onRatio: (ratio: number) => void;
  onSettled: () => void;
}): (finish: boolean) => void {
  const { stage, mark, crossed, from, to, onRatio, onSettled } = opts;
  let disposed = false;
  let settled = false;
  let frame = 0;
  let fillFrame = 0;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const animations: Animation[] = [];

  const settle = () => {
    if (settled) return;
    settled = true;
    onRatio(to);
    onSettled();
  };

  const box = stage.getBoundingClientRect();
  const markBox = mark.getBoundingClientRect();
  const width = Math.max(1, box.width);
  const height = Math.max(1, box.height);
  const centerX = markBox.left - box.left + markBox.width / 2;
  const centerY = markBox.top - box.top + markBox.height / 2;

  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.setAttribute('data-testid', 'wsf-together-canvas');
  Object.assign(canvas.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${width}px`,
    height: `${height}px`,
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>);
  const dpr = Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  stage.appendChild(canvas);
  const g = canvas.getContext('2d');

  const stop = (finish: boolean) => {
    if (disposed) {
      if (finish) settle();
      return;
    }
    disposed = true;
    cancelAnimationFrame(frame);
    cancelAnimationFrame(fillFrame);
    timers.forEach(clearTimeout);
    animations.forEach((a) => a.cancel());
    canvas.remove();
    if (finish) settle();
  };

  if (typeof mark.animate === 'function') {
    animations.push(
      mark.animate(pulseKeyframes(crossed), {
        duration: TOGETHER_TIMING.pulseDurationMs,
        easing: 'cubic-bezier(.2,.65,.3,1)',
      })
    );
  }

  if (g) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const pieces = buildPieces({
      crossed,
      width,
      height,
      centerX,
      centerY,
      markWidth: markBox.width,
      markHeight: markBox.height,
    });
    const drawPiece = (piece: TogetherPiece, ms: number) => {
      const p = (ms - piece.delay) / piece.duration;
      if (p < 0 || p > 1) return;
      const u = p * p * 0.62 + p * 0.38;
      const head = bezier(piece.points, u);
      const tangent = bezier(piece.points, Math.min(1, u + 0.018));
      const alpha = clamp01(p * 7) * clamp01((1 - p) * 9);
      const tailU = Math.max(0, u - 0.19);
      const tail = bezier(piece.points, tailU);
      const trail = g.createLinearGradient(tail.x, tail.y, head.x, head.y);
      trail.addColorStop(0, `rgba(${piece.color},0)`);
      trail.addColorStop(1, `rgba(${piece.color},${alpha * 0.47})`);
      g.beginPath();
      for (let j = 0; j <= 10; j += 1) {
        const point = bezier(piece.points, tailU + ((u - tailU) * j) / 10);
        if (j === 0) g.moveTo(point.x, point.y);
        else g.lineTo(point.x, point.y);
      }
      g.lineWidth = 1.7;
      g.strokeStyle = trail;
      g.stroke();
      g.save();
      g.translate(head.x, head.y);
      g.rotate(Math.atan2(tangent.y - head.y, tangent.x - head.x));
      const length = piece.length * (1 - p * 0.53);
      const breadth = piece.breadth * (1 - p * 0.2);
      g.fillStyle = `rgba(${piece.color},${alpha})`;
      g.shadowColor = `rgba(145,203,125,${alpha * 0.55})`;
      g.shadowBlur = 12;
      g.beginPath();
      g.moveTo(-length / 2, -breadth / 2);
      g.lineTo(length / 2, -breadth / 2);
      g.lineTo(length / 2 + breadth * 0.65, breadth / 2);
      g.lineTo(-length / 2 + breadth * 0.65, breadth / 2);
      g.closePath();
      g.fill();
      g.restore();
    };
    const drawWave = (ms: number, delay: number, strength: number) => {
      const raw = (ms - delay) / TOGETHER_TIMING.waveDurationMs;
      if (raw < 0 || raw > 1) return;
      const p = 1 - Math.pow(1 - raw, 3);
      const radius = 28 + p * width * 0.85;
      const alpha = Math.pow(1 - raw, 1.4) * strength;
      g.save();
      g.translate(centerX, centerY);
      g.scale(1, 0.87);
      g.beginPath();
      g.arc(0, 0, radius, 0, Math.PI * 2);
      g.lineWidth = (1 - raw) * 7 + 0.5;
      g.strokeStyle = `rgba(145,203,125,${alpha})`;
      g.shadowColor = `rgba(145,203,125,${alpha * 0.6})`;
      g.shadowBlur = 15;
      g.stroke();
      g.restore();
    };
    const started = performance.now();
    const draw = (now: number) => {
      if (disposed) return;
      const ms = now - started;
      g.clearRect(0, 0, width, height);
      const gather = smooth(clamp01((ms - 280) / 1180));
      const release = 1 - smooth(clamp01((ms - 1610) / 920));
      const glowAlpha = gather * release;
      if (glowAlpha > 0) {
        const radius = Math.max(180, width * 0.59);
        const glow = g.createRadialGradient(centerX, centerY, 4, centerX, centerY, radius);
        glow.addColorStop(0, `rgba(145,203,125,${glowAlpha * 0.3})`);
        glow.addColorStop(0.4, `rgba(145,203,125,${glowAlpha * 0.12})`);
        glow.addColorStop(1, 'rgba(145,203,125,0)');
        g.fillStyle = glow;
        g.fillRect(0, 0, width, height);
      }
      pieces.forEach((piece) => drawPiece(piece, ms));
      drawWave(ms, TOGETHER_TIMING.waveDelaysMs[0], 0.55);
      drawWave(ms, TOGETHER_TIMING.waveDelaysMs[1], 0.22);
      if (crossed) drawWave(ms, TOGETHER_TIMING.crossingWaveDelayMs, 0.12);
      if (ms < TOGETHER_TIMING.canvasEndMs) frame = requestAnimationFrame(draw);
      else canvas.remove();
    };
    frame = requestAnimationFrame(draw);
  }

  // The confirmed-ratio tween: every intermediate ratio is handed to the
  // caller, which maps it through the canonical area calibration.
  timers.push(
    setTimeout(() => {
      const fillStarted = performance.now();
      const tick = (now: number) => {
        if (disposed) return;
        const ms = TOGETHER_TIMING.fillStartMs + (now - fillStarted);
        onRatio(fillRatioAt(ms, from, to));
        if (ms < TOGETHER_TIMING.fillStartMs + TOGETHER_TIMING.fillDurationMs) {
          fillFrame = requestAnimationFrame(tick);
        }
      };
      fillFrame = requestAnimationFrame(tick);
    }, TOGETHER_TIMING.fillStartMs)
  );
  // The 3,200 ms cleanup guard for the canvas, then the hard settle at 3,400.
  timers.push(setTimeout(() => canvas.remove(), 3200));
  timers.push(setTimeout(() => stop(true), TOGETHER_TIMING.settleMs));

  return stop;
}
