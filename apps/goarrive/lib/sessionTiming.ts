import type { SessionInstance } from './schedulingTypes';

const legacyEnds = new Map<string, number | null>();
function legacyEndMillis(date: string, time: string, timezone: string): number | null {
  const key = `${date}/${time}/${timezone}`;
  if (legacyEnds.has(key)) return legacyEnds.get(key)!;
  let result: number | null = null;
  try {
    const desired = Date.parse(`${date}T${time}:00Z`);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    const wallMillis = (instant: number) => {
      const parts = formatter.formatToParts(instant);
      const part = (type: string) => parts.find(p => p.type === type)?.value;
      return Date.parse(`${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}Z`);
    };
    if (Number.isFinite(desired) && new Date(desired).toISOString().slice(0, 16) === `${date}T${time}`) {
      const offsets = new Set<number>();
      for (let hours = -36; hours <= 36; hours += 6) {
        const sample = desired + hours * 3600000;
        offsets.add(wallMillis(sample) - sample);
      }
      const candidates = [...offsets].map(offset => desired - offset);
      const exact = candidates.filter(candidate => wallMillis(candidate) === desired);
      // Repeated fall times use the later occurrence, so classification never
      // reverses. Nonexistent spring times shift forward by the transition gap.
      if (exact.length) result = Math.max(...exact);
      else {
        const after = candidates.filter(candidate => wallMillis(candidate) > desired)
          .sort((a, b) => wallMillis(a) - wallMillis(b));
        result = after[0] ?? null;
      }
    }
  } catch { /* Invalid legacy timezone/date: keep visible as upcoming. */ }
  if (legacyEnds.size >= 512) legacyEnds.clear();
  legacyEnds.set(key, result);
  return result;
}

function timestampMillis(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null;
  const timestamp = value as { toMillis?: () => number; seconds?: number; nanoseconds?: number };
  const millis = typeof timestamp.toMillis === 'function' ? timestamp.toMillis()
    : typeof timestamp.seconds === 'number' ? timestamp.seconds * 1000 + (timestamp.nanoseconds || 0) / 1e6 : NaN;
  return Number.isFinite(millis) ? millis : null;
}

/** Shared by the stable link and player. Invalid times never unlock a workout. */
export function sessionWindowMs(session: SessionInstance): { startMs: number; endMs: number } {
  const startMs = timestampMillis(session.startUtc) ?? legacyEndMillis(
    session.scheduledDate, session.scheduledStartTime, session.timezone || 'America/New_York',
  ) ?? NaN;
  const endMs = timestampMillis(session.endUtc) ?? startMs + (session.durationMinutes || 45) * 60000;
  return { startMs, endMs };
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

  // Resolve legacy wall time once to an instant, independent of the current
  // clock's DST offset or the viewer's timezone.
  let endDate = session.scheduledDate;
  if (session.scheduledEndTime < session.scheduledStartTime) {
    const nextDay = new Date(`${session.scheduledDate}T00:00:00Z`);
    if (!Number.isFinite(nextDay.getTime())) return false;
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    endDate = nextDay.toISOString().slice(0, 10);
  }
  if (!/^\d{2}:\d{2}$/.test(session.scheduledEndTime || '')) return false;
  const legacyEnd = legacyEndMillis(endDate, session.scheduledEndTime, session.timezone || 'America/New_York');
  return legacyEnd !== null && now > legacyEnd;
}
