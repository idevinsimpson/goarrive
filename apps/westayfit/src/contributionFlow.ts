/**
 * Pure rules for the contribution experience: what the member may enter,
 * how a callable error is classified, and what a confirmed result says.
 *
 * Kept out of the route so every rule is unit-tested directly. Nothing here
 * talks to the network or to storage.
 */

import { formatCount, isReached, totalOfTargetLabel } from './ui/progressFormat';

export const MAX_COUNT = 100_000;

// ---- entry ------------------------------------------------------------------

export type ParsedEntry = { ok: true; count: number } | { ok: false; message: string };

/** A whole number from 1 to MAX_COUNT. Anything else is not a submission. */
export function parseEntry(text: string): ParsedEntry {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, message: 'Enter how many you completed.' };
  if (!/^[0-9]+$/.test(trimmed)) return { ok: false, message: 'Whole numbers only.' };
  const count = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(count) || count < 1) {
    return { ok: false, message: 'Enter at least 1.' };
  }
  if (count > MAX_COUNT) {
    return { ok: false, message: `Enter a number up to ${formatCount(MAX_COUNT)}.` };
  }
  return { ok: true, count };
}

/** The entry after a +/− control, clamped to [0, MAX_COUNT]. Non-numeric text starts from 0. */
export function stepEntry(text: string, delta: number): string {
  const current = /^[0-9]+$/.test(text.trim()) ? Number.parseInt(text.trim(), 10) : 0;
  const next = Math.min(MAX_COUNT, Math.max(0, current + delta));
  return String(next);
}

// ---- failure classification -------------------------------------------------

export type RefusalReason =
  | 'closed'
  | 'notStarted'
  | 'windowEnded'
  | 'notMember'
  | 'notFound'
  | 'signedOut'
  | 'invalid';

export type ContributeFailure =
  | { kind: 'refused'; reason: RefusalReason }
  | { kind: 'unknown'; message: string };

/**
 * A caught callable error is one of two very different things.
 *
 * A DEFINITIVE application refusal — the server ran the request and said no
 * (closed goal, outside the window, not a member, unknown goal, not signed
 * in, bad argument). Nothing was recorded, and the attempt will not be
 * recorded later. Its local reminder can be retired.
 *
 * An UNKNOWN outcome — the request may or may not have reached the server
 * (network failure, timeout, an internal error after the transaction). The
 * attempt keeps its identity and its reminder; replaying the same attemptId
 * is safe because the server counts it once.
 */
export function classifyContributeError(e: unknown): ContributeFailure {
  const code = typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : '';
  const message =
    typeof (e as { message?: unknown })?.message === 'string' ? (e as { message: string }).message : '';
  switch (code) {
    case 'functions/failed-precondition': {
      const m = message.toLowerCase();
      if (m.includes('not started')) return { kind: 'refused', reason: 'notStarted' };
      if (m.includes('window')) return { kind: 'refused', reason: 'windowEnded' };
      return { kind: 'refused', reason: 'closed' };
    }
    case 'functions/permission-denied':
      return { kind: 'refused', reason: 'notMember' };
    case 'functions/not-found':
      return { kind: 'refused', reason: 'notFound' };
    case 'functions/unauthenticated':
      return { kind: 'refused', reason: 'signedOut' };
    case 'functions/invalid-argument':
      return { kind: 'refused', reason: 'invalid' };
    default:
      return { kind: 'unknown', message: message || 'No response.' };
  }
}

export function refusalCopy(
  reason: RefusalReason,
  count: number,
  unit: string
): { headline: string; body: string } {
  // The unit can be unknown (a replay after the goal refused to load).
  const effort = `${formatCount(count)} ${unit}`.trim();
  switch (reason) {
    case 'closed':
    case 'windowEnded':
      return {
        headline: 'This goal is no longer accepting contributions.',
        body: `Your ${effort} were not recorded. The goal closed before this contribution reached it.`,
      };
    case 'notStarted':
      return {
        headline: 'This goal hasn’t started yet.',
        body: `Your ${effort} were not recorded. Contributions open when the goal starts.`,
      };
    case 'notMember':
      return {
        headline: 'This contribution can’t be recorded from this account.',
        body: `Your ${effort} were not recorded. This account is not a current member of the goal’s community.`,
      };
    case 'notFound':
      return {
        headline: 'Goal not found',
        body: `Your ${effort} were not recorded. This goal doesn’t exist or isn’t available to this account.`,
      };
    case 'signedOut':
      return {
        headline: 'Sign in to contribute',
        body: `Your ${effort} were not recorded. Sign in and record them again.`,
      };
    case 'invalid':
      return {
        headline: 'That number couldn’t be recorded.',
        body: `Your ${effort} were not recorded. Enter a whole number from 1 to ${formatCount(MAX_COUNT)} and try again.`,
      };
  }
}

// ---- confirmed result -------------------------------------------------------

export type ContributeReceipt = {
  addedCount: number;
  ownCredit: number;
  alreadyRecorded: boolean;
  sharedTotal?: number;
  target?: number;
  unit?: string;
  status?: 'active' | 'closed';
  /**
   * THE SERVER'S ONE-TIME CROSSING SIGNAL. True on exactly one attempt per
   * goal — the one whose transaction moved the shared total from below the
   * target to at or beyond it — and stored on that attempt, so a replay of
   * the same attemptId says the same thing forever.
   *
   * The client never computes this and never falls back to computing it. When
   * the field is absent (an older server, or a caller who may not be told the
   * community's state) the result reads as it did before: the stable, honest
   * variants that attribute nothing to anyone.
   */
  crossedTarget?: boolean;
};

export type ResultVariant =
  | 'alreadyRecorded'
  | 'crossed'
  | 'reached'
  | 'postTarget'
  | 'ordinary'
  | 'ownOnly';

/**
 * Which story the confirmed result tells.
 *
 * The callable returns this member's exact addition and the community's
 * current confirmed total. It carries NO isolated before/after pair and no
 * one-time crossing event, and under concurrency the current total can
 * include work that landed after this member's own, so the client never
 * infers that THIS member crossed the target — not from
 * `sharedTotal - addedCount`, not from anything else.
 *
 * What it can say truthfully:
 *   - below the target: ordinary
 *   - at or beyond the target: `reached` ("Our goal is reached."), which
 *     attributes nothing to anyone; when the confirmed total this member
 *     saw BEFORE recording was already at or beyond the target, the goal
 *     was reached before they acted and the result reads as `postTarget`
 *     ("<community> is now at X together."). `sharedBefore` is the last confirmed
 *     total the screen showed; null when unknown (a replay after a reload)
 *     falls to `reached`, which is still true.
 *
 * THE ONE EXCEPTION — `crossed` — IS THE SERVER'S TO GRANT. The receipt now
 * carries `crossedTarget`, set by the wsfContribute transaction on exactly
 * the attempt that moved the total across the target and stored on that
 * attempt for its replays. It takes precedence over every variant below,
 * because it is the only thing here that knows whose work crossed the line.
 * A missing or false signal changes nothing: the stable variants stand, and
 * everyone who did not cross reads the same words they read before.
 */
export function resultVariant(r: ContributeReceipt, sharedBefore: number | null = null): ResultVariant {
  if (r.sharedTotal == null || r.target == null || r.unit == null || r.status == null) {
    return 'ownOnly';
  }
  // Server-authoritative, and ahead of `alreadyRecorded` on purpose: the
  // replay of the crossing attempt is the same attempt, and it is still true
  // that it was the one that took us past the goal. The copy below keeps the
  // "already recorded / it counted once" facts in the same breath.
  if (r.crossedTarget === true) return 'crossed';
  if (r.alreadyRecorded) return 'alreadyRecorded';
  if (!isReached(r.sharedTotal, r.target)) return 'ordinary';
  if (sharedBefore != null && isReached(sharedBefore, r.target)) return 'postTarget';
  return 'reached';
}

export function resultCopy(
  r: ContributeReceipt,
  communityName: string | null,
  /** The goal's unit as already loaded on the screen, for a receipt that carries none. */
  unitHint: string | null = null,
  sharedBefore: number | null = null
): { headline: string; subline: string; standing: string | null } {
  const variant = resultVariant(r, sharedBefore);
  const unit = r.unit ?? unitHint ?? '';
  const added = `${formatCount(r.addedCount)} ${unit}`.trim();
  const who = communityName ?? 'We';
  const isAre = communityName ? 'is' : 'are';
  if (variant === 'ownOnly') {
    // The server answered about this member's own contribution only. It
    // happened, it counted once, here is what it was — and nothing about
    // where the community stands now, which this account may no longer see.
    return {
      headline: r.alreadyRecorded ? 'This contribution was already recorded.' : `You added ${added}.`,
      subline: 'It counted once.',
      standing: null,
    };
  }
  const total = totalOfTargetLabel(r.sharedTotal!, r.target!, unit);
  const reachedStanding = `Our goal of ${formatCount(r.target!)} ${unit} is reached${
    r.status === 'active' ? ' and still open' : ''
  }. ${who} ${isAre} now at ${total}.`;
  switch (variant) {
    case 'alreadyRecorded':
      return {
        headline: 'This contribution was already recorded.',
        subline: 'It counted once.',
        standing: `${who} ${isAre} at ${total}.`,
      };
    case 'crossed':
      // The ONLY sentence in the product that ties one member to the moment
      // the target was met, and it is said only to that member, on their own
      // receipt, on the server's word. The shared display never says it: it
      // states "WE did it." as a state of the goal and names nobody.
      //
      // It says what happened, not that they won it. The goal is ours; the
      // contribution that carried it over the line was theirs.
      return {
        headline: r.alreadyRecorded ? 'This contribution was already recorded.' : `You added ${added}.`,
        subline: r.alreadyRecorded
          ? 'It counted once, and it took us past our goal.'
          : 'This one took us past our goal.',
        standing: reachedStanding,
      };
    case 'reached':
      return {
        headline: `You added ${added}.`,
        subline: 'Our goal is reached.',
        standing: reachedStanding,
      };
    case 'postTarget':
      // A7. Named like every other variant: the community says this, not a
      // generic "we". Falls back to "We are" only when no verified name is on
      // hand, exactly as `who`/`isAre` do above.
      return {
        headline: `You added ${added}.`,
        subline: `${who} ${isAre} now at ${total} together.`,
        standing: null,
      };
    case 'ordinary':
    default:
      return {
        headline: `You added ${added}.`,
        subline: 'You moved us closer.',
        standing: `${who} ${isAre} now at ${total}.`,
      };
  }
}
