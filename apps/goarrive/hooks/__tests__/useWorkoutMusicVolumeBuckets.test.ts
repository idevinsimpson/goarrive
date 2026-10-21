/**
 * Unit tests for the volume-bucket prefetch logic added to useWorkoutMusic.
 *
 * Tests nearestBucket selection and the dedup guard in isolation — no RN/Firebase
 * deps, runs in Vitest node environment.
 */
import { describe, test, expect } from 'vitest';

// ── Mirror the pure helpers from useWorkoutMusic.ts ─────────────────────────

const VOLUME_BUCKETS = [1.0, 0.5, 0.25, 0.12, 0.05];

function nearestBucket(gain: number): number {
  return VOLUME_BUCKETS.reduce((best, b) =>
    Math.abs(b - gain) < Math.abs(best - gain) ? b : best
  );
}

// ── nearestBucket ────────────────────────────────────────────────────────────

describe('nearestBucket', () => {
  test('slider 100% → gain 1.0 → bucket 1.0', () =>
    expect(nearestBucket(1.0 * 1.0)).toBe(1.0));

  test('slider 71% → gain ~0.50 → bucket 0.5', () =>
    expect(nearestBucket(0.71 * 0.71)).toBe(0.5));

  test('slider 50% → gain 0.25 → bucket 0.25', () =>
    expect(nearestBucket(0.5 * 0.5)).toBe(0.25));

  test('slider 35% → gain ~0.1225 → bucket 0.12', () =>
    expect(nearestBucket(0.35 * 0.35)).toBe(0.12));

  test('slider 22% → gain ~0.048 → bucket 0.05', () =>
    expect(nearestBucket(0.22 * 0.22)).toBe(0.05));

  test('slider 10% → gain 0.01 → bucket 0.05', () =>
    expect(nearestBucket(0.1 * 0.1)).toBe(0.05));

  test('gain 0 → bucket 0.05 (clamp to smallest)', () =>
    expect(nearestBucket(0)).toBe(0.05));
});

// ── Dedup guard ──────────────────────────────────────────────────────────────

describe('prefetch dedup guard', () => {
  function makeGuard() {
    const prefetched = new Set<string>();
    return {
      shouldFire(style: string, index: number, bucket: number): boolean {
        const key = `${style}:${index}:${bucket}`;
        if (prefetched.has(key)) return false;
        prefetched.add(key);
        return true;
      },
    };
  }

  test('fires on first call for a given (style, index, bucket)', () => {
    const guard = makeGuard();
    expect(guard.shouldFire('workout', 3, 0.12)).toBe(true);
  });

  test('does not re-fire for the same (style, index, bucket)', () => {
    const guard = makeGuard();
    guard.shouldFire('workout', 3, 0.12);
    expect(guard.shouldFire('workout', 3, 0.12)).toBe(false);
  });

  test('fires for different track index', () => {
    const guard = makeGuard();
    guard.shouldFire('workout', 3, 0.12);
    expect(guard.shouldFire('workout', 4, 0.12)).toBe(true);
  });

  test('fires for different style', () => {
    const guard = makeGuard();
    guard.shouldFire('workout', 3, 0.12);
    expect(guard.shouldFire('edm', 3, 0.12)).toBe(true);
  });

  test('fires for different bucket', () => {
    const guard = makeGuard();
    guard.shouldFire('workout', 3, 0.12);
    expect(guard.shouldFire('workout', 3, 0.5)).toBe(true);
  });
});

// ── Fire-and-forget contract ─────────────────────────────────────────────────

/**
 * Mirrors the prefetch bookkeeping in attachTrack: which buckets a call would
 * request, and what happens to those keys when the call rejects.
 */
function makeAttemptGuard() {
  const prefetched = new Set<string>();
  const k = (style: string, index: number, b: number) => `${style}:${index}:${b}`;
  return {
    pending(style: string, index: number): number[] {
      return VOLUME_BUCKETS.filter((b) => {
        if (prefetched.has(k(style, index, b))) return false;
        prefetched.add(k(style, index, b));
        return true;
      });
    },
    release(style: string, index: number, buckets: number[]) {
      for (const b of buckets) prefetched.delete(k(style, index, b));
    },
  };
}

describe('fire-and-forget contract', () => {
  test('does not throw when callable rejects', async () => {
    const failingCallable = () =>
      Promise.reject(new Error('network error'));

    // This is the pattern used in attachTrack:
    await expect(
      failingCallable().catch((err: unknown) => {
        // Silently discard — no rethrow
        void err;
      })
    ).resolves.toBeUndefined();
  });

  test('attach warms every bucket, not just the slider position and the default', () => {
    // Replaces the old two-bucket assertion. The shadow re-points whenever the
    // member crosses a bucket boundary, so any bucket left unrendered 404s and
    // falls back to full volume — the member moves the slider and hears nothing
    // change. Measured 2026-08-14: `edm/track_2` carried exactly gain_025 +
    // gain_012 and nothing else, the fingerprint of the old two-bucket warm.
    // Costs no extra invocations: the callable takes a bucket array.
    const guard = makeAttemptGuard();
    expect(guard.pending('edm', 2)).toEqual(VOLUME_BUCKETS);
  });

  test('a failed prefetch is retried later in the session', () => {
    // The guard recorded ATTEMPTS, not successes: keys were added before the
    // call and never removed on rejection, so one transient error left the
    // track cold for the rest of the session. fetchTrack:220 clears its key on
    // failure; this must match.
    const guard = makeAttemptGuard();
    const first = guard.pending('edm', 15);
    expect(first).toEqual(VOLUME_BUCKETS);
    // Nothing retries while the call is still considered done.
    expect(guard.pending('edm', 15)).toEqual([]);
    // On rejection the keys are released.
    guard.release('edm', 15, first);
    expect(guard.pending('edm', 15)).toEqual(VOLUME_BUCKETS);
  });
});

// ── orderBucketsForFallback (never-louder cascade) ───────────────────────────
// The pre-fix HEAD-check fell back to the full-volume original URL when the
// exact bucket wasn't rendered — iOS ignores element.volume, so a member with
// the slider at 5% who caught an unrendered bucket got a 100%-gain leave.
// orderBucketsForFallback returns the order applyBucket iterates: loudest
// at-or-below target first (so a missing variant stays quieter than intended),
// then quietest above (last-ditch fallback if nothing at-or-below is rendered).
//
// Mirrored here (matching the nearestBucket pattern above) because importing
// useMusicHandoff pulls expo-modules-core transitively and the module needs
// __DEV__ defined. Keep in sync with useMusicHandoff.ts::orderBucketsForFallback.

function orderBucketsForFallback(target: number): number[] {
  return [
    ...VOLUME_BUCKETS.filter(b => b <= target).sort((a, b) => b - a),
    ...VOLUME_BUCKETS.filter(b => b > target).sort((a, b) => a - b),
  ];
}

describe('orderBucketsForFallback', () => {
  test('target present: the target bucket sits first in the order', () => {
    expect(orderBucketsForFallback(0.25)[0]).toBe(0.25);
  });

  test('target missing: iterating the order picks the next quieter rendered bucket', () => {
    const rendered = new Set([0.12, 0.5]);
    const chosen = orderBucketsForFallback(0.25).find(b => rendered.has(b));
    expect(chosen).toBe(0.12);
  });

  test('only louder rendered: iterating picks the quietest of the louder buckets', () => {
    const rendered = new Set([0.5, 1.0]);
    const chosen = orderBucketsForFallback(0.25).find(b => rendered.has(b));
    expect(chosen).toBe(0.5);
  });

  test('nothing rendered: the caller falls through to the full-volume URL', () => {
    const rendered = new Set<number>();
    const chosen = orderBucketsForFallback(0.25).find(b => rendered.has(b));
    expect(chosen).toBeUndefined();
  });

  test('full order for mid-target: loud-to-quiet at-or-below, then quiet-to-loud above', () => {
    expect(orderBucketsForFallback(0.25)).toEqual([0.25, 0.12, 0.05, 0.5, 1.0]);
  });

  test('target 1.0: nothing is louder, whole ladder is at-or-below', () => {
    expect(orderBucketsForFallback(1.0)).toEqual([1.0, 0.5, 0.25, 0.12, 0.05]);
  });

  test('target 0.05: only self at-or-below, then quietest-above ordered low-to-high', () => {
    expect(orderBucketsForFallback(0.05)).toEqual([0.05, 0.12, 0.25, 0.5, 1.0]);
  });
});
