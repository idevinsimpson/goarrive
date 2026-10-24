import { describe, expect, it } from 'vitest';
import { isPastSession } from './sessionTiming';
import type { SessionInstance } from './schedulingTypes';

const timestamp = (iso: string) => ({ toMillis: () => Date.parse(iso) });
const fixture = (overrides: Record<string, unknown> = {}) => ({
  status: 'scheduled', timezone: 'America/New_York', scheduledDate: '2026-10-24',
  scheduledStartTime: '09:00', scheduledEndTime: '09:45', durationMinutes: 45,
  startUtc: timestamp('2026-10-24T13:00:00Z'), endUtc: timestamp('2026-10-24T13:45:00Z'),
  ...overrides,
} as unknown as SessionInstance);

describe('session list time classification', () => {
  it('keeps future and live sessions upcoming through the inclusive end boundary', () => {
    for (const status of ['scheduled', 'allocated', 'in_progress', 'allocation_failed']) {
      for (const now of ['2026-10-24T12:00:00Z', '2026-10-24T13:20:00Z', '2026-10-24T13:45:00Z']) {
        expect(isPastSession(fixture({status}), Date.parse(now))).toBe(false);
      }
      expect(isPastSession(fixture({status}), Date.parse('2026-10-24T13:45:00.001Z'))).toBe(true);
    }
  });
  it('preserves terminal status classification even before the scheduled time', () => {
    for (const status of ['cancelled', 'completed', 'missed', 'skipped']) {
      expect(isPastSession(fixture({status}), Date.parse('2026-10-23T00:00:00Z'))).toBe(true);
    }
  });
  it('uses start plus elapsed duration across the spring DST jump', () => {
    const session = fixture({startUtc: timestamp('2026-03-08T06:45:00Z'), endUtc: undefined});
    expect(isPastSession(session, Date.parse('2026-03-08T07:30:00Z'))).toBe(false);
    expect(isPastSession(session, Date.parse('2026-03-08T07:30:00.001Z'))).toBe(true);
  });
  it('disambiguates repeated fall DST hours using the absolute end timestamp', () => {
    const session = fixture({endUtc: timestamp('2026-11-01T06:30:00Z')});
    expect(isPastSession(session, Date.parse('2026-11-01T05:45:00Z'))).toBe(false);
    expect(isPastSession(session, Date.parse('2026-11-01T06:30:00.001Z'))).toBe(true);
  });
  it('uses serialized timestamps and ignores stale date fields', () => {
    const end = Date.parse('2026-10-25T01:00:00Z');
    expect(isPastSession(fixture({endUtc: {seconds: end / 1000, nanoseconds: 0}}), end + 1)).toBe(true);
  });
  it('compares legacy wall times in the session timezone rather than UTC day', () => {
    const session = fixture({startUtc: undefined, endUtc: undefined, scheduledStartTime: '20:00', scheduledEndTime: '21:00'});
    expect(isPastSession(session, Date.parse('2026-10-25T00:30:00Z'))).toBe(false);
    expect(isPastSession(session, Date.parse('2026-10-25T01:00:01Z'))).toBe(true);
  });
  it('keeps a legacy session spanning midnight until its next-day end', () => {
    const session = fixture({startUtc: undefined, endUtc: undefined, scheduledStartTime: '23:45', scheduledEndTime: '00:30'});
    expect(isPastSession(session, Date.parse('2026-10-25T04:15:00Z'))).toBe(false);
    expect(isPastSession(session, Date.parse('2026-10-25T04:30:01Z'))).toBe(true);
  });
});
