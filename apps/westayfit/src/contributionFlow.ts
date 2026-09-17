/**
 * Pure rules for the contribution experience: what the member may enter,
 * how a callable error is classified, and what a confirmed result says.
 *
 * Kept out of the route so every rule is unit-tested directly. Nothing here
 * talks to the network or to storage.
 */

import { formatCount, isReached, percentLabel, totalOfTargetLabel } from './ui/progressFormat';

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
  const effort = `${formatCount(count)} ${unit}`;
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
};

export type ResultVariant = 'alreadyRecorded' | 'crossed' | 'postTarget' | 'ordinary' | 'ownOnly';

/**
 * Which story the confirmed result tells.
 *
 * `crossed` is claimed only when the confirmed shared total is at or beyond
 * the target AND the total without this member's own confirmed addition is
 * below it. Under concurrency the server's total may include contributions
 * that landed after this one, so this rule can UNDER-claim a crossing (it
 * falls to `postTarget`); it never assigns someone else's crossing to this
 * member. The callable supplies no isolated before/after pair, so nothing
 * here computes or shows one.
 */
export function resultVariant(r: ContributeReceipt): ResultVariant {
  if (r.sharedTotal == null || r.target == null || r.unit == null || r.status == null) {
    return 'ownOnly';
  }
  if (r.alreadyRecorded) return 'alreadyRecorded';
  const reached = isReached(r.sharedTotal, r.target);
  if (!reached) return 'ordinary';
  const withoutThis = r.sharedTotal - r.addedCount;
  return withoutThis < r.target ? 'crossed' : 'postTarget';
}

export function resultCopy(
  r: ContributeReceipt,
  communityName: string | null
): { headline: string; subline: string; standing: string | null } {
  const variant = resultVariant(r);
  const unit = r.unit ?? '';
  const added = `${formatCount(r.addedCount)} ${unit}`.trim();
  const who = communityName ?? 'We';
  const isAre = communityName ? 'is' : 'are';
  if (variant === 'ownOnly') {
    return {
      headline: r.alreadyRecorded ? 'This contribution was already recorded.' : `You added ${added}.`,
      subline: `Your confirmed total on this goal is ${formatCount(r.ownCredit)}${unit ? ` ${unit}` : ''}.`,
      standing: null,
    };
  }
  const total = totalOfTargetLabel(r.sharedTotal!, r.target!, unit);
  switch (variant) {
    case 'alreadyRecorded':
      return {
        headline: 'This contribution was already recorded.',
        subline: `It counted once. Your confirmed total on this goal is ${formatCount(r.ownCredit)} ${unit}.`,
        standing: `${who} ${isAre} at ${total}.`,
      };
    case 'crossed':
      return {
        headline: `You added ${added}.`,
        subline: 'WE did it.',
        standing: `Our ${formatCount(r.target!)}-${unit} goal is reached${
          r.status === 'active' ? ' and still open' : ''
        }. ${who} ${isAre} at ${total}.`,
      };
    case 'postTarget':
      return {
        headline: `You added ${added}.`,
        subline: `We’re now at ${total} together.`,
        standing: r.status === 'active' ? 'The goal is reached and still open.' : 'The goal is reached.',
      };
    case 'ordinary':
    default:
      return {
        headline: `You added ${added}.`,
        subline: 'You moved us closer.',
        standing: `${who} ${isAre} now at ${total} · ${percentLabel(r.sharedTotal!, r.target!)}.`,
      };
  }
}
