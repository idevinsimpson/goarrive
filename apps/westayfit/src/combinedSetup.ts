/**
 * Combined movement goal — the rules the setup form obeys, as plain functions.
 *
 * A combined goal is several activity goals feeding ONE shared total while
 * each activity keeps its own goal, its own target, its own contribute page
 * and its own display. Enrolling an activity writes nothing to that activity.
 *
 * Kept out of the route module for the same reason as `kioskSession.ts`: a
 * file under a bracketed dynamic path cannot be imported by the test harness,
 * and these are the rules that most need testing directly. The Champion's
 * panel lives inside `app/community/[groupId]/index.tsx`, which is bracketed,
 * so everything here that could be got wrong is here rather than there.
 *
 * NOTHING HERE IS THE AUTHORITY. The server re-checks eligibility, the child
 * count and the frozen window inside `wsfCreateCombinedGoal`'s transaction,
 * and re-checks the window again on every read. These functions exist so the
 * Champion is told which activities can be combined BEFORE they submit, not so
 * the client can decide it.
 */

import { KIOSK_REFUSAL_BODY, KIOSK_REFUSAL_HEADLINE } from './kioskSession';

/** A combined goal of one activity is not combined. */
export const MIN_COMBINED_CHILDREN = 2;
/** Matches the server's MAX_COMBINED_CHILDREN, which bounds the read fan-out. */
export const MAX_COMBINED_CHILDREN = 6;

/**
 * The generic refusal, the SAME two strings the kiosk and the public display
 * use. A combined screen pointed at a setup it may not show must be no more of
 * an oracle than they are: identical copy, identical silence about the reason.
 * Re-exported rather than copied so there is one place these words live.
 */
export const COMBINED_REFUSAL_HEADLINE = KIOSK_REFUSAL_HEADLINE;
export const COMBINED_REFUSAL_BODY = KIOSK_REFUSAL_BODY;

/** The combined window a setup is being frozen with, as instants. */
export type CombinedWindow = { startsAt: Date; endsAt: Date };

/** What the form knows about one candidate activity, from `wsfListGoals`. */
export type CandidateChild = {
  goalId: string;
  title: string;
  status: string;
  /** ISO 8601, as wsfListGoals serializes a window. */
  startsAt: string;
  endsAt: string;
};

/**
 * WHY THIS ONE RULE. `wsfContribute` enforces each goal's own window on the
 * server, so every contribution that can ever exist on an eligible child
 * necessarily lands inside the combined window. A child's lifetime total is
 * therefore exactly its contribution to the parent, and the parent needs no
 * timestamp filter and no second definition of "counted".
 *
 * Bounds are INCLUSIVE at both ends: an activity whose window is exactly the
 * combined window is eligible.
 */
export type IneligibleReason = 'startsBefore' | 'endsAfter' | 'unreadableWindow';

export function isChildEligible(args: {
  child: CandidateChild;
  window: CombinedWindow;
}): boolean {
  return ineligibleReason(args) === null;
}

/**
 * Why an activity cannot be included, or null when it can. Returned as a code
 * rather than a sentence so the copy lives with the screen and one string is
 * not asserted in two places.
 */
export function ineligibleReason(args: {
  child: CandidateChild;
  window: CombinedWindow;
}): IneligibleReason | null {
  const { child, window } = args;
  const start = Date.parse(child.startsAt);
  const end = Date.parse(child.endsAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return 'unreadableWindow';
  const from = window.startsAt.getTime();
  const to = window.endsAt.getTime();
  if (Number.isNaN(from) || Number.isNaN(to)) return 'unreadableWindow';
  if (start < from) return 'startsBefore';
  if (end > to) return 'endsAfter';
  return null;
}

/** The sentence shown beside an activity that cannot be included. */
export function ineligibleMessage(reason: IneligibleReason): string {
  switch (reason) {
    case 'startsBefore':
      return 'This activity starts before the combined period.';
    case 'endsAfter':
      return 'This activity ends after the combined period.';
    case 'unreadableWindow':
      return 'This activity’s period can’t be read, so it can’t be combined.';
  }
}

export type ChildSelectionProblem = 'tooFew' | 'tooMany' | 'duplicate';

/**
 * The chosen list, checked the way the server checks it.
 *
 * THE DUPLICATE CASE MATTERS MORE THAN IT LOOKS: a repeated id would be summed
 * twice, and it is the only way this feature could double-count. It is refused
 * here, refused again at the callable's boundary, and deduped defensively when
 * the total is derived.
 */
export function validateChildSelection(ids: readonly string[]): ChildSelectionProblem | null {
  if (new Set(ids).size !== ids.length) return 'duplicate';
  if (ids.length < MIN_COMBINED_CHILDREN) return 'tooFew';
  if (ids.length > MAX_COMBINED_CHILDREN) return 'tooMany';
  return null;
}

/** The sentence shown under the activity list when the choice is not usable. */
export function childSelectionMessage(problem: ChildSelectionProblem): string {
  switch (problem) {
    case 'tooFew':
      return `Choose at least ${MIN_COMBINED_CHILDREN} activities to combine.`;
    case 'tooMany':
      return `Choose at most ${MAX_COMBINED_CHILDREN} activities.`;
    case 'duplicate':
      return 'Each activity can be chosen once.';
  }
}

/**
 * Reads a date-time control's value in the DEVICE's local time. The web
 * control always gives `YYYY-MM-DDTHH:mm`; the off-web fallback is typed, so a
 * space and seconds are read too. Anything else — including a calendar day
 * that does not exist — comes back null.
 *
 * This is the same shape `app/goals/new.tsx` parses, deliberately: the typed
 * local times are interpreted in the device's own zone, and the device's own
 * zone is what is submitted, so the words on screen, the instants sent and the
 * stored zone can never disagree. There is no time-zone picker anywhere in
 * this feature.
 */
const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?$/;

export function parseLocalDateTime(text: string): Date | null {
  const m = LOCAL_DATE_TIME.exec(text.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const hour = Number(h);
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    hour,
    Number(mi),
    s ? Number(s) : 0,
    0
  );
  if (Number.isNaN(date.getTime())) return null;
  // Reject values Date would silently roll over (Feb 30, 25:00).
  if (
    date.getFullYear() !== Number(y) ||
    date.getMonth() !== Number(mo) - 1 ||
    date.getDate() !== Number(d) ||
    date.getHours() !== hour ||
    date.getMinutes() !== Number(mi)
  ) {
    return null;
  }
  return date;
}

/**
 * The device's zone, when the platform can name it; otherwise the product
 * default. This is the creation zone: a Champion is never defaulted to a zone
 * their device does not report, and never offered a picker — the words, the
 * instants and the stored zone all come from this one value.
 */
export const COMBINED_FALLBACK_TIME_ZONE = 'America/New_York';

export function deviceTimeZone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof tz === 'string' && tz.trim() ? tz : COMBINED_FALLBACK_TIME_ZONE;
  } catch {
    return COMBINED_FALLBACK_TIME_ZONE;
  }
}

/** A target typed into a text field, as the callable will receive it. */
export function parseTargetInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!/^\d{1,9}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1 || n > 100_000_000) return null;
  return n;
}

/**
 * Zones whose generic name the platform gets wrong or unhelpfully. The same
 * one exception `app/goals/new.tsx` carries; kept in step deliberately so a
 * Champion reads the same words on both forms.
 */
const ZONE_LABELS: Readonly<Record<string, string>> = { 'America/Phoenix': 'Arizona Time' };

/**
 * A time zone in words: "Eastern Time", "United Kingdom Time", "Coordinated
 * Universal Time". The generic name is preferred (it does not flip between
 * standard and daylight); zones the platform can only name as an offset fall
 * back to the specific name, and a zone it cannot name at all reads as its
 * identifier with the underscores taken out.
 *
 * A COPY of the goal form's helper, deliberately, and for the same reason
 * `kioskSession.ts` copies the display's two refusal strings: `app/goals/new.tsx`
 * is owner-reviewed and is not edited to export it. This module's unit test
 * asserts the behaviour, so the two cannot drift silently.
 */
export function zoneInWords(tz: string): string {
  const named = ZONE_LABELS[tz];
  if (named) return named;
  const plain = tz.replace(/_/g, ' ');
  const nameOf = (timeZoneName: 'long' | 'longGeneric'): string | null => {
    try {
      const part = new Intl.DateTimeFormat(undefined, {
        timeZone: tz,
        // 'longGeneric' is newer than the lib typings; older engines ignore it.
        timeZoneName: timeZoneName as 'long',
      })
        .formatToParts(new Date())
        .find((p) => p.type === 'timeZoneName');
      return part && part.value.trim() ? part.value : null;
    } catch {
      return null;
    }
  };
  const generic = nameOf('longGeneric');
  // A bare offset ("GMT", "GMT+00:00") is not a name; the specific name
  // ("Coordinated Universal Time") reads better when there is one.
  if (generic && !/^(GMT|UTC)([+-].*)?$/.test(generic)) return generic;
  return nameOf('long') ?? generic ?? plain;
}
