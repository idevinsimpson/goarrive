import type { SessionInstance } from './schedulingTypes';

function timestampMillis(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const timestamp = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
  const millis = typeof timestamp.toMillis === 'function' ? timestamp.toMillis()
    : typeof timestamp.seconds === 'number' ? timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1e6 : NaN;
  return Number.isFinite(millis) ? millis : null;
}

/** Absolute timestamps preserve elapsed duration across DST and viewer timezones. */
export function isPastSession(session: SessionInstance, now: number): boolean {
  if (['cancelled', 'completed', 'missed', 'skipped'].includes(session.status)) return true;
  const end = timestampMillis(session.endUtc);
  const start = timestampMillis(session.startUtc);
  const duration = session.durationMinutes;
  const resolvedEnd = end ?? (start !== null && Number.isFinite(duration) && duration > 0 ? start + duration * 60000 : null);
  // Match the player's inclusive live end boundary.
  if (resolvedEnd !== null) return now > resolvedEnd;

  // Legacy sessions lack absolute timestamps. Compare their wall-clock end in
  // the session's timezone, never the viewer's local calendar date.
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: session.timezone || 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    }).formatToParts(now);
  } catch { return false; }
  const part = (type: string) => parts.find(p => p.type === type)?.value || '';
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  let endDate = session.scheduledDate;
  if (session.scheduledEndTime < session.scheduledStartTime) {
    const nextDay = new Date(`${session.scheduledDate}T00:00:00Z`);
    if (!Number.isFinite(nextDay.getTime())) return false;
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    endDate = nextDay.toISOString().slice(0, 10);
  }
  if (date !== endDate) return date > endDate;
  return /^\d{2}:\d{2}$/.test(session.scheduledEndTime || '') &&
    `${part('hour')}:${part('minute')}:${part('second')}` > `${session.scheduledEndTime}:00`;
}
