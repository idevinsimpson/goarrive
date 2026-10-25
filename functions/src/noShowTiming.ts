/** Use the booked instant, never the Functions process timezone. Invalid data fails closed. */
export function noShowStartMs(session: any): number | null {
  if (session.startUtc != null) {
    const timestamp = session.startUtc;
    let value: number;
    try {
      value = typeof timestamp.toMillis === 'function' ? timestamp.toMillis()
        : typeof timestamp.seconds === 'number' ? timestamp.seconds * 1000
        : NaN;
    } catch { return null; }
    return Number.isFinite(value) && Number.isFinite(new Date(value).getTime()) ? value : null;
  }
  // Legacy records: resolve the stored wall time in their explicit IANA timezone.
  // Ambiguous fall-back times choose the later instant to avoid premature no-shows.
  // Nonexistent spring-forward times are not guessed.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session.scheduledDate || '') ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(session.scheduledStartTime || '') ||
      typeof session.timezone !== 'string' || !session.timezone) return null;
  const wall = Date.parse(`${session.scheduledDate}T${session.scheduledStartTime}:00Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== `${session.scheduledDate}T${session.scheduledStartTime}`) return null;
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: session.timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    const localMs = (instant: number) => {
      const p: Record<string, string> = {};
      formatter.formatToParts(instant).forEach(part => p[part.type] = part.value);
      return Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    };
    const candidates = new Set<number>();
    for (let hour = -36; hour <= 36; hour += 6) {
      const sample = wall + hour * 3600000;
      const candidate = wall - (localMs(sample) - sample);
      if (localMs(candidate) === wall) candidates.add(candidate);
    }
    return candidates.size ? Math.max(...candidates) : null;
  } catch { return null; }
}

export function noShowEligible(session: any, nowMs: number, graceMinutes: number): boolean {
  if (session.status !== 'allocated' || session.workoutCompletedAt || !Number.isFinite(nowMs) ||
      !Number.isFinite(graceMinutes) || graceMinutes < 5 || graceMinutes > 60) return false;
  const start = noShowStartMs(session);
  return start !== null && nowMs >= start + graceMinutes * 60000;
}
