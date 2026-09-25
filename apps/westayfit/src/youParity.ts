/**
 * YOU-PARITY-1 — the facts the You screen shows, and the pure rules that turn
 * them into what the accepted reference (Lovable `642f830b`,
 * `src/demo/screens/you.tsx`) draws.
 *
 * Nothing here reads Firebase, routes, or stores anything. The route resolves
 * canonical facts; these functions only decide how to present them, so they
 * are tested directly (tests/you-parity.test.ts).
 */

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
  /** Where the community stands. A different number, labelled as one. */
  sharedTotal: number;
  /** status === 'active' on the goal. */
  open: boolean;
  endsAt?: string;
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

export type YouStatusTone = 'open' | 'closedReached' | 'closedUnfinished';
export type YouStatus = { label: string; tone: YouStatusTone };

/**
 * The reference's lifecycle pill (`baseView` → `statusLabel`), derived only
 * from the goal's own status and its two figures. Upper-cased as the
 * reference's CSS renders it.
 */
export function statusOf(goal: Pick<YouGoal, 'open' | 'target' | 'sharedTotal'>): YouStatus {
  const reached = goal.target > 0 && goal.sharedTotal >= goal.target;
  if (goal.open) return { label: reached ? 'REACHED · STILL OPEN' : 'OPEN', tone: 'open' };
  return reached
    ? { label: 'CLOSED · REACHED', tone: 'closedReached' }
    : { label: 'CLOSED · UNFINISHED', tone: 'closedUnfinished' };
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

/** "Ends Oct 2" / "Ended Sep 14", or null when the window cannot be read. */
export function whenLabel(goal: Pick<YouGoal, 'open' | 'endsAt'>): string | null {
  if (!goal.endsAt) return null;
  const d = new Date(goal.endsAt);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return goal.open ? `Ends ${day}` : `Ended ${day}`;
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

/** "241 / 500 confirmed", or the total alone when there is no usable target. */
export function sharedLine(goal: Pick<YouGoal, 'sharedTotal' | 'target' | 'unit'>): string {
  return goal.target > 0
    ? `${n(goal.sharedTotal)} / ${n(goal.target)} confirmed`
    : `${n(goal.sharedTotal)} ${goal.unit} confirmed`;
}

/** The "Shared" cell of an other-goal row. */
export function sharedCell(goal: Pick<YouGoal, 'sharedTotal' | 'target' | 'unit'>): string {
  return goal.target > 0
    ? `${n(goal.sharedTotal)} / ${n(goal.target)} ${goal.unit}`
    : `${n(goal.sharedTotal)} ${goal.unit}`;
}
