import type { ReactNode } from 'react';

import { groupTypeCardLabel, joinPolicyLabel, roleLabel } from '../labels';
import {
  beyondTarget,
  formatCount,
  isReached,
  percentLabel,
  progressPhase,
  remaining,
} from './progressFormat';

/**
 * THE PROP CONTRACT FOR THE COMMUNITY PARITY PRESENTATION, AND ITS PURE RULES.
 *
 * Director release COMMUNITY-PRESENTATION-ACCELERATOR-1 (#447 `5840798701`)
 * and its data-mapping fast path (`5840935220`). These types carry ALREADY
 * RESOLVED canonical truth into `CommunityParityView` and
 * `CommunityPrivacyPanelView`. Nothing here reads Firestore, calls a
 * callable, owns a router or holds a timer: the route that wires them (W9's)
 * resolves the reads and passes what it knows.
 *
 * WHAT IS NOT KNOWN IS SAID TO BE NOT KNOWN. Every figure that comes from a
 * read that can fail is typed so a failed or partial read is distinguishable
 * from zero: a count is `number | null`, a list is a tagged read. The rules
 * below never turn an unknown into 0, and never derive a number from a partial
 * set.
 */

export type Visibility = 'visible' | 'private';

/** A read that can be in flight, can fail, or has answered. */
export type Read<T> =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'loaded'; value: T };

/**
 * A goal's shared total, as the route knows it:
 *   - `loading`: the total's read is in flight
 *   - `failed`: it cannot be confirmed (never shown as zero)
 *   - `confirmed`: the live confirmed total
 *   - `lastKnown`: a confirmed total kept from an earlier read that is not live
 *     now (the reference's "last known · not live")
 */
export type GoalTotal =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'confirmed'; value: number }
  | { state: 'lastKnown'; value: number };

/**
 * One goal, as the goals read resolved it. `target` is `null` for a goal
 * without a shared target. `windowLabel` is the route's own formatting of the
 * goal's window in the goal's timezone; this component never formats dates.
 */
export type ParityGoal = {
  goalId: string;
  title: string;
  unit: string;
  target: number | null;
  total: GoalTotal;
  status: 'active' | 'closed' | 'scheduled';
  windowLabel?: string | null;
};

/**
 * FAIL CLOSED ON AN IMPOSSIBLE FIGURE. A confirmed or last-known total is a
 * total only when it is finite and not negative; anything else (NaN, ±Infinity,
 * a negative) reads exactly as `failed` — unknown for the instrument, the
 * figures and the pill. It is never clamped to zero: an unusable number is not
 * evidence that nobody moved.
 */
export function effectiveTotal(total: GoalTotal): GoalTotal {
  if (total.state !== 'confirmed' && total.state !== 'lastKnown') return total;
  return Number.isFinite(total.value) && total.value >= 0 ? total : { state: 'failed' };
}

/** A target is a target only when it is finite and positive; otherwise `null`. */
export function validTarget(target: number | null): number | null {
  return target !== null && Number.isFinite(target) && target > 0 ? target : null;
}

/** The figure a total carries, or `null` when there is none to show. */
export function totalValue(total: GoalTotal): number | null {
  const t = effectiveTotal(total);
  return t.state === 'confirmed' || t.state === 'lastKnown' ? t.value : null;
}

/** The goals collection for this community, split by the canonical rules. */
export type ParityGoals = {
  /** The featured active goal by the existing selection rules, or none. */
  featured: ParityGoal | null;
  /** The other open goals, labelled separately. */
  otherOpen: ParityGoal[];
};

/**
 * One person the member-only roster read returned by name. There is no "you"
 * flag: the roster read carries no uid, so the view could only guess who the
 * viewer is by matching names, and two members may share a name.
 */
export type ParityRosterPerson = {
  key: string;
  displayName: string;
  role: string | null;
};

export type ParityRoster = {
  named: ParityRosterPerson[];
  /** True only when the read says the visible set is complete (no more pages). */
  complete: boolean;
};

export type ParityCommunityChip = { groupId: string; displayName: string };

export type CommunityParityProps = {
  groupId: string;
  displayName: string;
  groupType?: string | null;
  joinPolicy?: string | null;
  /**
   * `null` when the member count is not known. An impossible count (NaN,
   * ±Infinity, a negative, a fraction) is treated exactly as `null`.
   */
  memberCount: number | null;
  /** The member's own role in this community, or `null` when not known. */
  role: string | null;
  /** The member's joined communities, for the switch chips (a read: it can fail). */
  communities: Read<ParityCommunityChip[]>;
  goals: Read<ParityGoals>;
  /**
   * Finished goals. `unavailable` means the history fields were not part of
   * the read at all (render no history rows); `failed` means the read failed,
   * which is never shown as "no goals yet".
   */
  history: Read<ParityGoal[]> | { state: 'unavailable' };
  roster: Read<ParityRoster>;
  onSelectCommunity: (groupId: string) => void;
  onJoin: () => void;
  onStart: () => void;
  onRetryCommunities?: () => void;
  onRetryGoals?: () => void;
  onRetryHistory?: () => void;
  onRetryRoster?: () => void;
  onShowMoreMembers?: () => void;
  onOpenGoal?: (goalId: string) => void;
  /**
   * The route's own secondary content, drawn AFTER the reference hierarchy
   * inside the same scroll (Director #489 `5841270180`: canonical capability
   * survives after the North-Star core). This view gives it no style.
   */
  footer?: ReactNode;
  testID?: string;
};

/* ==========================================================================
   PURE RULES
   ========================================================================== */

/**
 * The banner's supporting slots. Lovable's sample has a free-form PLACE
 * (eyebrow) and DESCRIPTOR (line under the name); canonical WSF stores
 * neither. The eyebrow carries the human group type where there is one worth
 * printing, and the descriptor the join policy; a `custom` community has no
 * type, so the eyebrow is omitted rather than filled. Nothing geographic is
 * ever derived. Recorded as an intentional reference difference.
 */
export function bannerSupport(
  groupType: string | null | undefined,
  joinPolicy: string | null | undefined,
): { eyebrow: string | null; descriptor: string | null } {
  const eyebrow = groupType ? groupTypeCardLabel(groupType) : null;
  return { eyebrow, descriptor: joinPolicy ? policyDescriptor(joinPolicy) : null };
}

/**
 * The join policy as a line that reads naturally under a community's name,
 * composed from the existing `joinPolicyLabel` words: "Public community",
 * "Private community", "Anyone with the link can join".
 */
export function policyDescriptor(joinPolicy: string): string {
  const label = joinPolicyLabel(joinPolicy);
  return joinPolicy === 'inviteOnly' ? `${label} can join` : `${label} community`;
}

/**
 * The member-facing role: "Champion", "Co-Champion", "Member" — or null when
 * not known. A founding Champion reads as "Champion" here, as in the frozen
 * reference: the fact states the member's role, and "Founding" grants no
 * capability a member acts on (Director #506 `5845751705`). The wider
 * `roleLabel` wording is unchanged.
 */
export function roleFact(role: string | null): string | null {
  if (role === null) return null;
  return role === 'foundingChampion' ? 'Champion' : roleLabel(role);
}

/**
 * The Goals fact counts only a SUCCESSFULLY loaded collection: the goals read
 * AND the history read. A partial or failed read gives `null` — never a
 * fabricated count. History that was not part of the read (`unavailable`) is
 * partial too: finished goals can exist without their history fields, so the
 * open goals alone are not the community's count.
 */
export function goalsCountFact(
  goals: CommunityParityProps['goals'],
  history: CommunityParityProps['history'],
): number | null {
  if (goals.state !== 'loaded' || history.state !== 'loaded') return null;
  const open = (goals.value.featured ? 1 : 0) + goals.value.otherOpen.length;
  return open + history.value.length;
}

/**
 * FAIL CLOSED ON AN IMPOSSIBLE MEMBER COUNT (W5 K-F1, Director `5842638933`).
 * A member count is known only when it is a whole number and not negative;
 * anything else (NaN, ±Infinity, a negative, a fraction) reads as `null` —
 * unknown for the MEMBERS fact, the roster heading and the anonymous
 * remainder. It is never clamped: an unusable number is not a count. A known
 * zero stays a real zero (and `-0` is that zero, not "-0").
 */
export function knownMemberCount(memberCount: number | null): number | null {
  if (memberCount === null || !Number.isInteger(memberCount) || memberCount < 0) return null;
  return memberCount === 0 ? 0 : memberCount;
}

/**
 * The anonymous remainder: how many members are not shown by name. Derived
 * ONLY when the visible set is known complete and the member count is known;
 * otherwise `null` (the view then says nothing about a remainder).
 */
export function anonymousRemainder(
  memberCount: number | null,
  roster: CommunityParityProps['roster'],
): number | null {
  const known = knownMemberCount(memberCount);
  if (known === null || roster.state !== 'loaded' || !roster.value.complete) return null;
  return Math.max(0, known - roster.value.named.length);
}

/** A goal whose instrument can be drawn: a positive target and a figure. */
export type DrawableGoal = ParityGoal & {
  target: number;
  total: { state: 'confirmed' | 'lastKnown'; value: number };
};

/**
 * Living WE is drawn only for a finite positive target and a usable confirmed
 * figure — the live total, or a last-known one, which the view dims and labels
 * "last known" as the reference does. Loading, failed and impossible totals
 * draw nothing.
 */
export function canDrawLivingWe(goal: ParityGoal): goal is DrawableGoal {
  return validTarget(goal.target) !== null && totalValue(goal.total) !== null;
}

export type PillTone =
  | 'open'
  | 'reached'
  | 'closedReached'
  | 'unfinished'
  | 'scheduled'
  | 'unknown'
  | 'pending';

/**
 * The status pill, in the reference's own words (Lovable `statusLabel`):
 * "Open", "Reached · still open", "Closed · reached", "Closed · unfinished",
 * "Scheduled", "Last known · not live", "Unknown". Reached and closed are
 * separate facts; a total that is loading or failed never claims a phase, and
 * a loading one keeps only the lifecycle it knows.
 */
export function goalPill(goal: ParityGoal): { label: string; tone: PillTone } {
  if (goal.status === 'scheduled') return { label: 'Scheduled', tone: 'scheduled' };
  const t = effectiveTotal(goal.total);
  if (t.state === 'loading') {
    return { label: goal.status === 'closed' ? 'Closed' : 'Open', tone: 'pending' };
  }
  if (t.state === 'failed') return { label: 'Unknown', tone: 'unknown' };
  if (t.state === 'lastKnown') return { label: 'Last known · not live', tone: 'unknown' };
  const target = validTarget(goal.target);
  if (target === null) {
    return goal.status === 'closed'
      ? { label: 'Closed', tone: 'unfinished' }
      : { label: 'Open', tone: 'open' };
  }
  switch (progressPhase(t.value, target, goal.status)) {
    case 'closedReached':
      return { label: 'Closed · reached', tone: 'closedReached' };
    case 'closedUnreached':
      return { label: 'Closed · unfinished', tone: 'unfinished' };
    case 'reachedOpen':
      return { label: 'Reached · still open', tone: 'reached' };
    default:
      return { label: 'Open', tone: 'open' };
  }
}

/**
 * The line under the progress track, as the reference's GoalNumbers words it:
 * "48.2% complete" · "259 squats to go"; "Goal reached · +60 beyond" · "Still
 * open" / "Closed"; a closed unfinished goal "Ended 140 short"; a last-known
 * figure "Not live". Only for a goal whose Living WE can be drawn.
 */
export function goalMeta(goal: DrawableGoal): { strong: string; soft: string } {
  const total = goal.total.value;
  const { target } = goal;
  const notLive = goal.total.state === 'lastKnown';
  if (isReached(total, target)) {
    const over = beyondTarget(total, target);
    return {
      strong: over > 0 ? `Goal reached · +${formatCount(over)} beyond` : 'Goal reached',
      soft: notLive ? 'Not live' : goal.status === 'closed' ? 'Closed' : 'Still open',
    };
  }
  const left = remaining(total, target);
  return {
    strong: `${percentLabel(total, target)} complete`,
    soft: notLive
      ? 'Not live'
      : goal.status === 'closed'
        ? `Ended ${formatCount(left)} short`
        : `${formatCount(left)} ${goal.unit} to go`,
  };
}

/**
 * One goal's figures as a line: "1,240 of 2,000 squats", keeping the confirmed
 * overshoot ("2,060 of 2,000 squats"), marking a last-known figure, and saying
 * plainly when the total is loading or cannot be confirmed.
 */
export function goalFigures(goal: ParityGoal): string {
  const t = effectiveTotal(goal.total);
  if (t.state === 'loading') return 'Loading the total…';
  if (t.state === 'failed') return 'Total can’t be confirmed right now';
  const suffix = t.state === 'lastKnown' ? ' · last known' : '';
  const target = validTarget(goal.target);
  if (target === null) return `${formatCount(t.value)} ${goal.unit}${suffix}`;
  return `${formatCount(t.value)} of ${formatCount(target)} ${goal.unit}${suffix}`;
}

export function peopleLabel(n: number): string {
  return n === 1 ? '1 person' : `${formatCount(n)} people`;
}

/* ==========================================================================
   PRIVACY PANEL
   ========================================================================== */

/**
 * Why the last save did not settle as asked, as W7 Check 43 measured the
 * cases on `0b460ce3`:
 *   - `notSaved`: refused, or lost before it reached the server; the stored
 *     value is unchanged
 *   - `unconfirmed`: the reply was lost; the write may have landed, and the
 *     switch shows what the re-read found stored
 *   - `membershipRefused`: the server refused because the member no longer
 *     belongs to this community
 */
export type PrivacySaveErrorKind = 'notSaved' | 'unconfirmed' | 'membershipRefused';

export type PrivacyCommunity = {
  groupId: string;
  displayName: string;
  isChampion?: boolean;
  /**
   * How the member is named to others when their name is visible (their
   * profile display name), for the reference's "Members see “Alex M.”". When
   * absent the hint says "Members see your name".
   */
  shownName?: string | null;
  /**
   * The AUTHORITATIVE stored values. The switches never show anything else.
   * `unconfirmed` means these are what the re-read found stored.
   */
  stored: { name: Visibility; activity: Visibility };
  /** Which setting is being saved, if any. */
  saving: 'name' | 'activity' | null;
  /**
   * The last save's failure. The ROUTE keeps it until the member retries or
   * makes a new change — a re-read of the stored values does not clear it, and
   * the panel keeps saying it while a re-read is loading or has failed.
   */
  saveError: PrivacySaveErrorKind | null;
};

export type CommunityPrivacyPanelProps = {
  load: 'loading' | 'ready' | 'failed';
  communities: PrivacyCommunity[];
  /** A new change: the member asks for `value`; the switch waits for the store. */
  onChange: (groupId: string, key: 'name' | 'activity', value: Visibility) => void;
  onRetrySave: (groupId: string) => void;
  onRetryLoad: () => void;
  compact?: boolean;
  testID?: string;
};

export function privacySaveErrorCopy(kind: PrivacySaveErrorKind, displayName: string): string {
  switch (kind) {
    case 'notSaved':
      return 'That change wasn’t saved. The switches show your saved setting.';
    case 'unconfirmed':
      return 'We couldn’t confirm that change. The switches show what’s saved now.';
    case 'membershipRefused':
      return `You’re no longer a member of ${displayName}, so this setting can’t be changed.`;
  }
}
