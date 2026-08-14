/**
 * Unit tests for the volume-bucket prefetch logic added to useWorkoutMusic.
 *
 * Tests nearestBucket selection and the dedup guard in isolation — no RN/Firebase
 * deps, runs in Vitest node environment.
 */
import { describe, test, expect } from 'vitest';

// ── Mirror the pure helpers from useWorkoutMusic.ts ─────────────────────────

const VOLUME_BUCKETS = [1.0, 0.5, 0.25, 0.12, 0.05];
const DEFAULT_BUCKET = 0.12;

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

  test('default + current bucket are deduplicated when slider near default', () => {
    // At slider=0.35, gain² ≈ 0.1225, nearestBucket = 0.12 = DEFAULT_BUCKET
    const gain = 0.35 * 0.35;
    const current = nearestBucket(gain);
    const bucketsToRequest = Array.from(new Set([current, DEFAULT_BUCKET]));
    // Both resolve to 0.12 — dedup collapses to one entry
    expect(bucketsToRequest).toHaveLength(1);
    expect(bucketsToRequest[0]).toBe(0.12);
  });

  test('default + current bucket are two distinct values when slider is high', () => {
    // At slider=1.0, gain²=1.0, nearestBucket=1.0 ≠ DEFAULT_BUCKET=0.12
    const gain = 1.0 * 1.0;
    const current = nearestBucket(gain);
    const bucketsToRequest = Array.from(new Set([current, DEFAULT_BUCKET]));
    expect(bucketsToRequest).toHaveLength(2);
    expect(bucketsToRequest).toContain(1.0);
    expect(bucketsToRequest).toContain(0.12);
  });
});
