import { describe, expect, it } from 'vitest';
import { memberSessionState, selectMemberSessions, sessionDay } from './memberPlaybookSessions';
import { sessionWindowMs } from './sessionTiming';
import { workoutReturnPath } from './workoutReturnPath';
import type { SessionInstance } from './schedulingTypes';
const start = Date.parse('2026-10-25T14:00:00Z');
const session = (extra: Partial<SessionInstance> = {}) => ({ id: 'a', status: 'scheduled', scheduledDate: '2026-10-25', scheduledStartTime: '10:00', scheduledEndTime: '10:45', timezone: 'America/New_York', durationMinutes: 45, startUtc: { seconds: start / 1000 }, endUtc: { seconds: (start + 2700000) / 1000 }, ...extra } as SessionInstance);
describe('permanent Playbook session selection', () => {
  it('uses exact existing early and inclusive end boundaries', () => {
    expect(memberSessionState(session(), start - 300001)).toBe('upcoming');
    expect(memberSessionState(session(), start - 300000)).toBe('active');
    expect(memberSessionState(session(), start + 2700000)).toBe('active');
    expect(memberSessionState(session(), start + 2700001)).toBe('ended');
  });
  it('presents all active candidates without selecting the first', () => {
    const list = [session({ id: 'b' }), session()];
    expect(selectMemberSessions(list, start).active.map(s => s.id)).toEqual(['a', 'b']);
    expect(selectMemberSessions(list.reverse(), start).active.map(s => s.id)).toEqual(['a', 'b']);
  });
  it.each(['cancelled', 'missed', 'skipped', 'rescheduled'])('does not open %s sessions', status => {
    expect(selectMemberSessions([session({ status: status as any })], start).active).toEqual([]);
  });
  it('distinguishes Zoom completion from workout completion', () => {
    expect(memberSessionState(session({ status: 'completed' }), start)).toBe('active');
    expect(memberSessionState(session({ workoutCompletedAt: true as any }), start)).toBe('completed');
  });
  it('shows upcoming today and next session without early access', () => {
    const tomorrow = session({ id: 'tomorrow', scheduledDate: '2026-10-26', startUtc: { seconds: start / 1000 + 86400 } as any, endUtc: null as any });
    const groups = selectMemberSessions([tomorrow, session()], start - 3600000);
    expect(groups.active).toEqual([]); expect(groups.today.map(s => s.id)).toEqual(['a']); expect(groups.next.map(s => s.id)).toEqual(['tomorrow']);
    expect(selectMemberSessions([], start)).toEqual({ active: [], today: [], next: [] });
  });
  it('uses the session timezone at day boundaries and keeps overnight active sessions', () => {
    expect(sessionDay(Date.parse('2026-10-25T02:00Z'), 'America/New_York')).toBe('2026-10-24');
    expect(sessionDay(Date.parse('2026-10-25T02:00Z'), 'Asia/Tokyo')).toBe('2026-10-25');
    const overnight = session({ scheduledDate: '2026-10-24' });
    expect(selectMemberSessions([overnight], start).active).toHaveLength(1);
  });
  it('handles legacy DST fold deterministically and spring gap forward', () => {
    const legacy = session({ startUtc: null as any, endUtc: null as any, scheduledDate: '2026-11-01', scheduledStartTime: '01:00' });
    expect(sessionWindowMs(legacy).startMs).toBe(Date.parse('2026-11-01T06:00Z'));
    expect(memberSessionState(legacy, Date.parse('2026-11-01T05:15Z'))).toBe('upcoming');
    expect(memberSessionState(legacy, Date.parse('2026-11-01T06:15Z'))).toBe('active');
    expect(sessionWindowMs({ ...legacy, scheduledDate: '2026-03-08', scheduledStartTime: '02:30' }).startMs).toBe(Date.parse('2026-03-08T07:30Z'));
  });
  it('does not open invalid schedule data', () => {
    expect(memberSessionState(session({ startUtc: null as any, scheduledDate: 'bad' }), start)).toBe('unavailable');
    expect(memberSessionState(session({ startUtc: null as any, scheduledDate: '2026-02-31' }), start)).toBe('unavailable');
  });
});
describe('internal workout return destinations', () => {
  it.each(['/playbook/plan_1', '/live-session/session-1'])('accepts %s', path => expect(workoutReturnPath(path)).toBe(path));
  it.each(['https://evil.invalid', '//evil.invalid', '/playbook/../login', '/playbook/a?next=evil', '/playbook/%2f%2fevil', '/playbook/a#x', '/login', ['/playbook/a'], undefined])('rejects arbitrary or ambiguous destinations', path => expect(workoutReturnPath(path)).toBeNull());
});
