/**
 * Scheduling constants — shared across ScheduleModal and its subcomponents.
 */
import { type GuidancePhase } from '../../lib/schedulingTypes';
import { GREEN } from '../../lib/theme';

// ── Time slot options ────────────────────────────────────────────────────────
export const TIME_OPTIONS: string[] = [];
for (let h = 5; h <= 21; h++) {
  for (let m = 0; m < 60; m += 15) {
    TIME_OPTIONS.push(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`);
  }
}

export const TIMEZONE_OPTIONS = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'Pacific/Honolulu',
];

// Phase mapping: plan intensity → scheduling guidance phase
export const INTENSITY_TO_PHASE: Record<string, GuidancePhase> = {
  'Fully Guided': 'coach_guided',
  'Shared Guidance': 'shared_guidance',
  'Self-Reliant': 'self_guided',
};

export const SCHED_PHASE_LABELS: Record<GuidancePhase, string> = {
  coach_guided: 'Coach Guided',
  shared_guidance: 'Shared Guidance',
  self_guided: 'Self Guided',
};

export const SCHED_PHASE_COLORS: Record<GuidancePhase, string> = {
  coach_guided: GREEN,
  shared_guidance: '#5B9BD5',
  self_guided: '#FFC000',
};

// ── Helper: convert HH:MM to total minutes ─────────────────────────────────
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}
