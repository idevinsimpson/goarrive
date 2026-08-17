/**
 * perfProbe — Pass-21 main-thread frame-gap sampler.
 *
 * Rides every build regardless of DIAG state (one summary line per 30s is
 * cheap enough to leave on). Purpose: give every future cut a before/after
 * number for main-thread health, and page a loud regression when a later
 * change starts stalling the player again.
 *
 * How it works: a plain rAF loop measures the gap between successive
 * animation frames. Under a healthy player that's ~16.7ms (60Hz) with
 * occasional bumps. Long gaps (>100ms) indicate the main thread was
 * blocked — a synchronous layout, a heavy render, GC, whatever. Every
 * 30s we compute mean/p95/max/stall-count and emit one summary line via
 * pushHandoffLogAlways so the COPY LOG button preserves it even when
 * DIAG is off.
 *
 * Why not PerformanceObserver('longtask')? Not implemented in iOS Safari
 * (as of 2026-08 — Devin's primary device). rAF gap sampling works
 * everywhere the player runs and is close enough — it catches the same
 * "main thread was stuck" symptoms even if it can't attribute them.
 *
 * Marker: perfProbe=1
 */

import { pushHandoffLogAlways } from './handoffLog';

const SUMMARY_INTERVAL_MS = 30_000;
const STALL_THRESHOLD_MS = 100;
// Cap sample array so a runaway loop can't grow unbounded (30s * 60Hz
// nominal + slack). Older samples drop first — we only need the last
// window's shape, not history.
const MAX_SAMPLES = 2400;

let started = false;
let rafId: number | null = null;
let flushTimer: ReturnType<typeof setInterval> | null = null;
let lastFrameAt = 0;
let samples: number[] = [];
let framesInWindow = 0;
let stallsInWindow = 0;

function tick(now: number) {
  if (lastFrameAt > 0) {
    const gap = now - lastFrameAt;
    if (Number.isFinite(gap) && gap >= 0) {
      samples.push(gap);
      if (samples.length > MAX_SAMPLES) samples.shift();
      framesInWindow++;
      if (gap > STALL_THRESHOLD_MS) stallsInWindow++;
    }
  }
  lastFrameAt = now;
  rafId = window.requestAnimationFrame(tick);
}

function flush() {
  const count = samples.length;
  if (count === 0) {
    pushHandoffLogAlways('[Perf] perfProbe=1 count=0');
    framesInWindow = 0;
    stallsInWindow = 0;
    return;
  }
  const sorted = samples.slice().sort((a, b) => a - b);
  let sum = 0;
  for (let i = 0; i < count; i++) sum += sorted[i];
  const mean = sum / count;
  const p95Index = Math.min(count - 1, Math.floor(count * 0.95));
  const p95 = sorted[p95Index];
  const max = sorted[count - 1];
  pushHandoffLogAlways(
    `[Perf] perfProbe=1 frames=${framesInWindow} mean=${mean.toFixed(1)}ms p95=${p95.toFixed(1)}ms max=${max.toFixed(1)}ms stalls=${stallsInWindow}`,
  );
  samples = [];
  framesInWindow = 0;
  stallsInWindow = 0;
}

/**
 * Begin sampling. Safe to call multiple times — the second call is a no-op.
 * Returns a stop function that can be used in a React useEffect cleanup.
 */
export function startPerfProbe(): () => void {
  if (started) return stopPerfProbe;
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') {
    return () => {};
  }
  started = true;
  lastFrameAt = 0;
  samples = [];
  framesInWindow = 0;
  stallsInWindow = 0;
  rafId = window.requestAnimationFrame(tick);
  flushTimer = setInterval(flush, SUMMARY_INTERVAL_MS);
  pushHandoffLogAlways('[Perf] perfProbe=1 started');
  return stopPerfProbe;
}

export function stopPerfProbe(): void {
  if (!started) return;
  started = false;
  if (rafId !== null && typeof window !== 'undefined') {
    try { window.cancelAnimationFrame(rafId); } catch {}
  }
  rafId = null;
  if (flushTimer !== null) {
    try { clearInterval(flushTimer); } catch {}
  }
  flushTimer = null;
  samples = [];
  framesInWindow = 0;
  stallsInWindow = 0;
  lastFrameAt = 0;
}
