/**
 * Human date labels. Goal windows arrive as ISO instants (wsfListGoals); the
 * goal's stored time zone is not returned, so labels are rendered in the
 * reader's own zone and say so where a time is shown.
 */
export function formatEndsAt(iso: string, now: Date = new Date()): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return `Ends today at ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d)}`;
  }
  return `Ends ${new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(d)}`;
}

/** "Jun 1 – 14" or "Jun 1 – Jul 14" or "Dec 20, 2025 – Jan 3, 2026" */
export function formatPeriod(startIso: string, endIso: string): string | null {
  const a = new Date(startIso);
  const b = new Date(endIso);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return null;
  const sameYear = a.getFullYear() === b.getFullYear();
  const sameMonth = sameYear && a.getMonth() === b.getMonth();
  const md = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
  const mdy = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  if (!sameYear) return `${mdy.format(a)} – ${mdy.format(b)}`;
  if (sameMonth) return `${md.format(a)} – ${b.getDate()}`;
  return `${md.format(a)} – ${md.format(b)}`;
}

/** "September 2026" */
export function formatMonthYear(d: Date): string | null {
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(d);
}

/** "3:41 PM" */
export function formatClock(d: Date): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(d);
}
