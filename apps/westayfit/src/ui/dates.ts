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

/** "Ends today at 5:00 PM EDT" / "Ends Mon, Sep 21" — in the goal's zone when given. */
export function formatEndsAt(iso: string, opts?: DateOptions & { now?: Date }): string | null {
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
    return `Ends today at ${time}`;
  }
  return `Ends ${new Intl.DateTimeFormat(opts?.locale, {
    timeZone: zone.timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(d)}`;
}

/** "Jun 1 – 14" or "Jun 1 – Jul 14" or "Dec 20, 2025 – Jan 3, 2026" — in the goal's zone when given. */
export function formatPeriod(startIso: string, endIso: string, opts?: DateOptions): string | null {
  const a = new Date(startIso);
  const b = new Date(endIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const zone = resolveZone(opts);
  if (!zone.ok) return null;
  const tz = zone.timeZone;
  const [ay, am, ad] = ymd(a, opts?.locale, tz).split('-');
  const [by, bm] = ymd(b, opts?.locale, tz).split('-');
  const sameYear = ay === by;
  const sameMonth = sameYear && am === bm;
  const md = new Intl.DateTimeFormat(opts?.locale, { timeZone: tz, month: 'short', day: 'numeric' });
  const mdy = new Intl.DateTimeFormat(opts?.locale, { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric' });
  const dayOnly = new Intl.DateTimeFormat(opts?.locale, { timeZone: tz, day: 'numeric' });
  if (!sameYear) return `${mdy.format(a)} – ${mdy.format(b)}`;
  if (sameMonth) return `${md.format(a)} – ${dayOnly.format(b)}`;
  void ad;
  return `${md.format(a)} – ${md.format(b)}`;
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
