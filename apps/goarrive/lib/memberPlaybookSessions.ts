import type { SessionInstance } from './schedulingTypes';
import { sessionWindowMs } from './sessionTiming';

export const EARLY_WORKOUT_MS = 5 * 60000;
export function sessionDay(now: number, timezone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
    const part = (type: string) => parts.find(p => p.type === type)?.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  } catch { return ''; }
}

export function memberSessionState(session: SessionInstance, now: number) {
  if (session.workoutCompletedAt) return 'completed';
  if (['cancelled', 'missed', 'skipped', 'rescheduled'].includes(session.status)) return session.status;
  const { startMs, endMs } = sessionWindowMs(session);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs < startMs) return 'unavailable';
  if (now > endMs) return session.status === 'completed' ? 'completed' : 'ended';
  // completed can be the Zoom lifecycle state; only workoutCompletedAt closes
  // the workout early, matching the existing player's completion semantics.
  if (!['scheduled', 'allocated', 'allocation_failed', 'in_progress', 'completed'].includes(session.status)) return 'unavailable';
  return now >= startMs - EARLY_WORKOUT_MS ? 'active' : 'upcoming';
}

/** Every eligible candidate is shown; no arbitrary first-match selection. */
export function selectMemberSessions(sessions: SessionInstance[], now: number) {
  const ordered = [...sessions].sort((a, b) => sessionWindowMs(a).startMs - sessionWindowMs(b).startMs || a.id.localeCompare(b.id));
  const active = ordered.filter(s => memberSessionState(s, now) === 'active');
  const today = ordered.filter(s => !active.includes(s) && s.scheduledDate === sessionDay(now, s.timezone || 'America/New_York'));
  const future = ordered.filter(s => !active.includes(s) && !today.includes(s) && memberSessionState(s, now) === 'upcoming');
  const nextStart = future.length ? sessionWindowMs(future[0]).startMs : null;
  const next = future.filter(s => sessionWindowMs(s).startMs === nextStart);
  return { active, today, next };
}
