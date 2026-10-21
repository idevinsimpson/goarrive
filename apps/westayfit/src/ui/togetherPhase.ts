/**
 * NATIVE-MOTION-1 — whether a Together receipt may move, as pure decisions.
 *
 * The receipt's truth never depends on any of this: every number and sentence
 * renders from the first frame whatever the phase. These functions decide only
 * whether the decoration plays.
 *
 *   settled — the final receipt, still. The answer for anything not fresh, not
 *             `animate` (a replay, an own-only receipt, no trusted before
 *             total), reduced motion, or a backgrounded app.
 *   playing — the one-time motion.
 *   pending — native only: eligible, but the reduced-motion preference has not
 *             been read yet. The mark shows the trusted before ratio (the same
 *             frame `playing` opens on) and nothing moves until the answer
 *             arrives. Reduced → settled; not reduced → playing; a query that
 *             definitely failed → settled at once.
 *
 * ONE DECISION. Eligibility (`fresh`, `animate`) is read at mount and the
 * caller keeps it; `nextTogetherPhase` can only leave `pending`, never re-enter
 * `playing` from `settled`, so a re-render, a later preference change, a
 * remount or a reopen cannot celebrate again.
 */

export type TogetherPhase = 'pending' | 'playing' | 'settled';

/**
 * How long a native receipt may wait, from mount, for the reduced-motion
 * answer and its own layout before it gives up on moving and settles. Typical
 * waits are a frame or two; this bounds the rare slow answer so a late start
 * never detaches the celebration from the moment it belongs to.
 */
export const NATIVE_START_DEADLINE_MS = 500;

export type TogetherPhaseInput = {
  /** The owner's freshness for THIS instance, read at mount. */
  fresh: boolean;
  /** The presentation's `animate`: fresh, not a replay, shared, ordinary or crossed, trusted before. */
  animate: boolean;
  /** Whether the reduced-motion preference has been read. Always true in effect on the web. */
  reducedKnown: boolean;
  reduced: boolean;
  /** Native only: the preference query definitely failed and nothing has answered since. */
  reducedFailed?: boolean;
  /** Platform.OS. */
  platform: string;
  /** Native only: false when the app is not in the foreground. Defaults to true. */
  appActive?: boolean;
};

export function decideTogetherPhase(input: TogetherPhaseInput): TogetherPhase {
  if (!input.fresh || !input.animate) return 'settled';
  // The web reads the preference synchronously; its decision is unchanged.
  if (input.platform === 'web') return input.reduced ? 'settled' : 'playing';
  if (input.appActive === false) return 'settled';
  if (input.reduced) return 'settled';
  if (!input.reducedKnown) return input.reducedFailed ? 'settled' : 'pending';
  return 'playing';
}

/** Only `pending` can change, and only by the same rule; every other phase is final for the instance. */
export function nextTogetherPhase(current: TogetherPhase, input: TogetherPhaseInput): TogetherPhase {
  if (current !== 'pending') return current;
  return decideTogetherPhase(input);
}

/** At the native start deadline: anything that has not started moving settles. */
export function settlesAtDeadline(phase: TogetherPhase, started: boolean): boolean {
  return phase !== 'settled' && !started;
}

/** Leaving the foreground (background, or iOS's inactive) settles a native receipt for good. */
export function settlesOnAppState(next: string): boolean {
  return next === 'background' || next === 'inactive';
}

/**
 * Whether a measured box is real. A zero or near-zero layout (a collapsed or
 * not-yet-laid-out view) is not a measurement: the receipt keeps waiting, and
 * the start deadline settles it if nothing real arrives.
 */
export const MIN_MEASURED_PX = 1;
export function isMeasured(box: { width: number; height: number } | null | undefined): boolean {
  return (
    box != null &&
    Number.isFinite(box.width) &&
    Number.isFinite(box.height) &&
    box.width >= MIN_MEASURED_PX &&
    box.height >= MIN_MEASURED_PX
  );
}
