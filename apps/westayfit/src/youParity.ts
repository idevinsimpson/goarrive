/**
 * YOU-PARITY-1 — the facts the You screen shows, and the pure rules that turn
 * them into what the accepted reference (Lovable `642f830b`,
 * `src/demo/screens/you.tsx`) draws.
 *
 * Nothing here reads Firebase, routes, or stores anything. The route resolves
 * canonical facts; these functions only decide how to present them, so they
 * are tested directly (tests/you-parity.test.ts). The shared-position and
 * lifecycle rules are src/goalTruth.ts, which Progress uses too.
 */

import {
  hasInstrument,
  sharedCell as goalSharedCell,
  statusOf as goalStatusOf,
  type LifecycleStatus,
  type SharedPosition,
} from './goalTruth';

export type YouProfile = {
  displayName: string | null;
  /** "September 2026". A join date is identity, not activity. */
  memberSince: string | null;
};

export type YouCommunity = {
  displayName: string;
  role: string;
  memberCount: number;
  /** From wsfMyCommunities; only names the kind of community. */
  groupType?: string;
};

/** A goal this member has a CONFIRMED part in, with both figures kept apart. */
export type YouGoal = {
  goalId: string;
  title: string;
  unit: string;
  target: number;
  /** Exactly what this member put in. Never summed with another unit. */
  yourPart: number;
  /** Where the community stands: a different number, or not known at all. */
  shared: SharedPosition;
  /** status === 'active' on the goal. */
  open: boolean;
  /**
   * The goal's window as the route formats it in the goal's own timezone
   * ("Ends Oct 1", "This week"), shown verbatim; null when there is none.
   */
  periodLabel: string | null;
};

export type YouState =
  | { kind: 'loading' }
  | { kind: 'signedOut' }
  | { kind: 'noCommunity'; profile: YouProfile }
  | { kind: 'pickCommunity'; profile: YouProfile; count: number }
  /** `community` is present when the failure came after it was resolved. */
  | { kind: 'failed'; profile: YouProfile; community?: YouCommunity }
  | {
      kind: 'member';
      profile: YouProfile;
      community: YouCommunity;
      /** Open goals with own credit, soonest-ending first. The first leads. */
      open: YouGoal[];
      /** Finished goals with own credit, most recent first. */
      finished: YouGoal[];
      /** A read failed and these lists may be short. */
      partial: boolean;
      /** The community has an active goal with a target: Start moving is truthful. */
      eligible: boolean;
    };

export type YouStatus = LifecycleStatus;

/** The reference's lifecycle pill; see goalTruth.statusOf. */
export function statusOf(goal: Pick<YouGoal, 'open' | 'target' | 'shared'>): YouStatus {
  return goalStatusOf(goal);
}

/** Up to two initials from the member's own display name; none when unknown. */
export function initialsOf(name: string | null | undefined): string | null {
  if (!name) return null;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts
    .slice(0, 2)
    .map((p) => Array.from(p)[0] ?? '')
    .join('');
  return letters ? letters.toUpperCase() : null;
}

/**
 * The lead and the rest. The lead is the first OPEN goal (the route sorts
 * soonest-ending first); "Other goals you helped" is every other credited
 * goal, open ones first, then finished — the reference's `memberGoalRows`
 * order.
 */
export function leadAndOthers(open: readonly YouGoal[], finished: readonly YouGoal[]) {
  const lead = open[0] ?? null;
  return { lead, others: [...open.slice(1), ...finished] };
}

/** Which "your part" block the member state shows. */
export type YouPartBlock = 'lead' | 'startMoving' | 'noEligible';

export function partBlock(state: Extract<YouState, { kind: 'member' }>): YouPartBlock {
  if (state.open.length > 0) return 'lead';
  return state.eligible ? 'startMoving' : 'noEligible';
}

const n = (v: number) => v.toLocaleString('en-US');

/**
 * The lead's shared line: "241 / 500 confirmed", the total alone when there is
 * no usable target, or null when the position is not known — the view then
 * says it is unavailable instead of drawing a number.
 */
export function sharedLine(goal: Pick<YouGoal, 'shared' | 'target' | 'unit'>): string | null {
  if (goal.shared.kind === 'unknown') return null;
  return goal.target > 0
    ? `${n(goal.shared.total)} / ${n(goal.target)} confirmed`
    : `${n(goal.shared.total)} ${goal.unit} confirmed`;
}

/** The "Shared" cell of an other-goal row; see goalTruth.sharedCell. */
export function sharedCell(goal: Pick<YouGoal, 'shared' | 'target' | 'unit' | 'open'>): string {
  return goalSharedCell(goal);
}

/** The lead draws its Living WE and track only on a confirmed total and a positive target. */
export { hasInstrument };
