/**
 * Human date labels for goal windows.
 *
 * A goal has ONE published contribution window and ONE time zone. Where the
 * caller has the goal's IANA time zone (the public display receives it from
 * wsfGoalPulse), every label is derived in that zone, so two devices in
 * different local zones present the same period and the same "ends" meaning.
 * Calendar comparisons ("ends today") are made on date parts in the goal's
 * zone, never on the device's local getFullYear/getMonth/getDate.
 *
 * Without a zone the labels fall back to the reader's own zone. That is the
 * case for Community Home today: wsfListGoals does not return the goal's
 * zone (DESIGN / DATA GAP — MEMBER GOAL WINDOW TIMEZONE).
 */

export type DateOptions = {
  /** IANA zone. When given but invalid, the label is withheld (null). */
  timeZone?: string | null;
  /** Locale for Intl; undefined means the reader's locale. Tests pin 'en-US'. */
  locale?: string;
};

export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz.trim() });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves the zone to format in: the goal's zone when valid, the reader's
 * zone when none was supplied, and `undefined` (withhold) when a zone was
 * supplied but is unusable — a wrong calendar date is worse than no date.
 */
function resolveZone(opts?: DateOptions): { ok: true; timeZone: string | undefined } | { ok: false } {
  if (opts?.timeZone == null) return { ok: true, timeZone: undefined };
  return isValidTimeZone(opts.timeZone) ? { ok: true, timeZone: opts.timeZone.trim() } : { ok: false };
}

function ymd(d: Date, locale: string | undefined, timeZone: string | undefined): string {
  const parts = new Intl.DateTimeFormat(locale ?? 'en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * The end-of-window label, in one of two tenses. The DATE FORMATTING is
 * identical either way — only the verb differs — so "Ends Mon, Sep 14" and
 * "Ended Mon, Sep 14" can never disagree about which day they name.
 */
function endsLabel(
  verb: 'Ends' | 'Ended',
  iso: string,
  opts?: DateOptions & { now?: Date }
): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const zone = resolveZone(opts);
  if (!zone.ok) return null;
  const now = opts?.now ?? new Date();
  const sameDay = ymd(d, opts?.locale, zone.timeZone) === ymd(now, opts?.locale, zone.timeZone);
  if (sameDay) {
    const time = new Intl.DateTimeFormat(opts?.locale, {
      timeZone: zone.timeZone,
      hour: 'numeric',
      minute: '2-digit',
      // A clock time only means something with its zone. Named for the goal's
      // zone; the reader's own zone needs no designation.
      ...(zone.timeZone ? { timeZoneName: 'short' as const } : {}),
    }).format(d);
    return `${verb} today at ${time}`;
  }
  return `${verb} ${new Intl.DateTimeFormat(opts?.locale, {
    timeZone: zone.timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d)}`;
}

/** "Ends today at 5:00 PM EDT" / "Ends Mon, Sep 21" — in the goal's zone when given. */
export function formatEndsAt(iso: string, opts?: DateOptions & { now?: Date }): string | null {
  return endsLabel('Ends', iso, opts);
}

/**
 * Has the published window's end instant passed?
 *
 * An INSTANT comparison, deliberately: the window ends at one moment, and
 * that moment is the same moment everywhere. The zone decides how the end is
 * WRITTEN (see endsLabel), never whether it has happened.
 */
export function hasWindowEnded(endsIso: string, opts?: { now?: Date }): boolean {
  const d = new Date(endsIso);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() < (opts?.now ?? new Date()).getTime();
}

/**
 * The period line for a goal the SERVER still calls active — the public
 * display and Community Home render the same string from this one helper.
 *
 * Nothing closes a goal automatically, so a goal can be `active` with its end
 * instant already behind it. "Open · Ends Mon, Sep 14" on a Tuesday is simply
 * untrue, so once the instant has passed the label states the fact — "Ended
 * Mon, Sep 14" — and drops the "Open ·" claim.
 *
 * SCOPE, on purpose: this changes the LABEL only. The contribution routes stay
 * offered and wsfContribute stays the authority on whether a contribution is
 * accepted (it refuses with 'Goal window has ended.', which the contribution
 * screen already presents as a windowEnded refusal). Hiding or disabling those
 * routes off a client-side clock is a product decision that has not been taken
 * and is out of scope here.
 */
export function formatActiveWindowLabel(
  endsIso: string,
  opts?: DateOptions & { now?: Date }
): string {
  const ended = hasWindowEnded(endsIso, opts);
  const label = endsLabel(ended ? 'Ended' : 'Ends', endsIso, opts);
  // No usable label (unparsable instant, or a zone we will not substitute for):
  // say only what is still supportable without naming a calendar day.
  if (!label) return ended ? 'Ended' : 'Open';
  return ended ? label : `Open · ${label}`;
}

/**
 * "Jun 1 – 14" or "Jun 1 – Jul 14" or "Dec 20, 2025 – Jan 3, 2026" — in the
 * goal's zone when given.
 *
 * A8. The year is dropped only when the window is in the year the READER is
 * currently in, judged in the goal's own zone. A window that begins and ends
 * inside one year is still a different year from this one — a 2025 goal read
 * in 2026 must not print a bare "Jun 1 – Jul 14", which reads as this year.
 * `opts.now` is for tests; the default is the real clock.
 */
export function formatPeriod(
  startIso: string,
  endIso: string,
  opts?: DateOptions & { now?: Date }
): string | null {
  const a = new Date(startIso);
  const b = new Date(endIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const zone = resolveZone(opts);
  if (!zone.ok) return null;
  const tz = zone.timeZone;
  const [ay, am, ad] = ymd(a, opts?.locale, tz).split('-');
  const [by, bm] = ymd(b, opts?.locale, tz).split('-');
  const [ny] = ymd(opts?.now ?? new Date(), opts?.locale, tz).split('-');
  const sameYear = ay === by;
  const thisYear = sameYear && ay === ny;
  const sameMonth = thisYear && am === bm;
  const md = new Intl.DateTimeFormat(opts?.locale, { timeZone: tz, month: 'short', day: 'numeric' });
  const mdy = new Intl.DateTimeFormat(opts?.locale, { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' });
  const dayOnly = new Intl.DateTimeFormat(opts?.locale, { timeZone: tz, day: 'numeric' });
  // Either end outside the reader's current year carries the year on both ends.
  if (!thisYear) return `${mdy.format(a)} – ${mdy.format(b)}`;
  if (sameMonth) return `${md.format(a)} – ${dayOnly.format(b)}`;
  void ad;
  return `${md.format(a)} – ${md.format(b)}`;
}

/**
 * "Reached Sep 18" — the day the shared total first crossed the target,
 * written in the GOAL's zone so every member names the same day whatever
 * clock they are reading it on.
 *
 * The instant comes from the server's one-time crossing event (wsfListGoals'
 * `reachedAt`, a member-authorized field). This helper only writes it down:
 * it does not decide whether a goal is reached now, which stays derived from
 * the current total against the current target. A goal can be past its
 * crossing and below its target again after a correction — the date is still
 * the day it happened.
 *
 * The year is carried whenever the crossing is not in the reader's current
 * year, judged in the goal's zone, on the same rule as formatPeriod. An
 * unparsable instant or an unusable zone withholds the label (null) rather
 * than naming a day in the wrong calendar.
 */
export function formatReachedOn(iso: string, opts?: DateOptions & { now?: Date }): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const zone = resolveZone(opts);
  if (!zone.ok) return null;
  const [dy] = ymd(d, opts?.locale, zone.timeZone).split('-');
  const [ny] = ymd(opts?.now ?? new Date(), opts?.locale, zone.timeZone).split('-');
  const label = new Intl.DateTimeFormat(opts?.locale, {
    timeZone: zone.timeZone,
    month: 'short',
    day: 'numeric',
    ...(dy === ny ? {} : { year: 'numeric' as const }),
  }).format(d);
  return `Reached ${label}`;
}

/**
 * "Counting since Sep 19" — the instant a combined goal began counting, in its
 * own zone, on exactly the rule formatReachedOn uses for the year.
 *
 * It exists because a combined goal's total is what has been recorded SINCE
 * its activation, and a number with no stated boundary is how the first
 * implementation came to show repetitions nobody performed for it. An
 * unparsable instant or an unusable zone withholds the label (null) rather
 * than naming a day in the wrong calendar.
 */
export function formatCountingSince(
  iso: string,
  opts?: DateOptions & { now?: Date }
): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const zone = resolveZone(opts);
  if (!zone.ok) return null;
  const [dy] = ymd(d, opts?.locale, zone.timeZone).split('-');
  const [ny] = ymd(opts?.now ?? new Date(), opts?.locale, zone.timeZone).split('-');
  const label = new Intl.DateTimeFormat(opts?.locale, {
    timeZone: zone.timeZone,
    month: 'short',
    day: 'numeric',
    ...(dy === ny ? {} : { year: 'numeric' as const }),
  }).format(d);
  return `Counting since ${label}`;
}

/** "September 2026" */
export function formatMonthYear(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(d);
}

/** "3:41 PM" — the reader's own clock, used for client receipt times. */
export function formatClock(d: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
}
