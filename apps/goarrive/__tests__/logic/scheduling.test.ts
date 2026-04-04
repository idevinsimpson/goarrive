/**
 * Tests for scheduling utility functions from schedulingTypes.ts
 */
import {
  formatTime,
  addMinutesToTime,
  formatDateShort,
  defaultRoomSource,
  defaultHostingMode,
  defaultCoachExpectedLive,
} from '../../lib/schedulingTypes';

describe('formatTime', () => {
  it('formats morning time', () => {
    expect(formatTime('09:00')).toBe('9:00 AM');
  });

  it('formats afternoon time', () => {
    expect(formatTime('14:30')).toBe('2:30 PM');
  });

  it('formats noon as PM', () => {
    expect(formatTime('12:00')).toBe('12:00 PM');
  });

  it('formats midnight as 12 AM', () => {
    expect(formatTime('00:00')).toBe('12:00 AM');
  });
});

describe('addMinutesToTime', () => {
  it('adds minutes within the same hour', () => {
    expect(addMinutesToTime('09:00', 30)).toBe('09:30');
  });

  it('rolls over to next hour', () => {
    expect(addMinutesToTime('09:45', 30)).toBe('10:15');
  });

  it('wraps past midnight', () => {
    expect(addMinutesToTime('23:30', 60)).toBe('00:30');
  });
});

describe('formatDateShort', () => {
  it('formats a date string', () => {
    // 2026-04-06 is a Monday
    expect(formatDateShort('2026-04-06')).toBe('Mon, Apr 6');
  });
});

describe('defaultRoomSource', () => {
  it('returns coach_personal for coach_guided', () => {
    expect(defaultRoomSource('coach_guided')).toBe('coach_personal');
  });

  it('returns shared_pool for shared_guidance', () => {
    expect(defaultRoomSource('shared_guidance')).toBe('shared_pool');
  });

  it('returns shared_pool for self_guided', () => {
    expect(defaultRoomSource('self_guided')).toBe('shared_pool');
  });
});

describe('defaultHostingMode', () => {
  it('returns coach_led for coach_guided', () => {
    expect(defaultHostingMode('coach_guided')).toBe('coach_led');
  });

  it('returns hosted for shared_guidance', () => {
    expect(defaultHostingMode('shared_guidance')).toBe('hosted');
  });

  it('returns hosted for self_guided', () => {
    expect(defaultHostingMode('self_guided')).toBe('hosted');
  });
});

describe('defaultCoachExpectedLive', () => {
  it('coach is expected live for coach_guided', () => {
    expect(defaultCoachExpectedLive('coach_guided')).toBe(true);
  });

  it('coach is expected live for shared_guidance', () => {
    expect(defaultCoachExpectedLive('shared_guidance')).toBe(true);
  });

  it('coach is not expected live for self_guided', () => {
    expect(defaultCoachExpectedLive('self_guided')).toBe(false);
  });
});
