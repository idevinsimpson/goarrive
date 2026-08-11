/**
 * Pure helpers for useWorkoutMusic — no React/react-native/Firebase deps, so
 * they are safe to import in vitest (same pattern as WorkoutPlayer.helpers.ts).
 *
 * The queue order is the heart of the "same exact music" guarantee: it is a
 * deterministic permutation seeded by workoutId+style, so every listener on a
 * workout hears the same songs in the same order, and dislike-filtering
 * removes entries WITHOUT reshuffling the rest.
 */

/** FNV-1a 32-bit string hash — stable across sessions and platforms. */
export function hashSeed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32 — tiny deterministic PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MusicQueueInput {
  poolSize: number;
  /** Seed string — same seed → same order (e.g. `${workoutId}:${style}`). */
  seed: string;
  /** Pool indices to exclude (disliked tracks). */
  excludedIndices?: number[];
}

/**
 * Deterministic no-repeat queue: seeded Fisher-Yates permutation of
 * [0, poolSize) minus excluded indices. Every caller with the same seed and
 * exclusions gets the identical order.
 */
export function buildMusicQueue(input: MusicQueueInput): number[] {
  const { poolSize, seed, excludedIndices } = input;
  const excluded = new Set(excludedIndices ?? []);
  const order: number[] = [];
  for (let i = 0; i < poolSize; i++) order.push(i);
  const rng = mulberry32(hashSeed(seed));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.filter((i) => !excluded.has(i));
}

export function toTrackId(style: string, index: number): string {
  return `${style}/${index}`;
}

export function parseTrackId(id: string): { style: string; index: number } | null {
  const m = /^([a-z0-9]+)\/(\d+)$/.exec(id);
  if (!m) return null;
  return { style: m[1], index: Number(m[2]) };
}

/** Pool indices referenced by trackIds for the given style. */
export function indicesForStyle(trackIds: string[], style: string): number[] {
  const out: number[] = [];
  for (const id of trackIds) {
    const parsed = parseTrackId(id);
    if (parsed && parsed.style === style) out.push(parsed.index);
  }
  return out;
}
