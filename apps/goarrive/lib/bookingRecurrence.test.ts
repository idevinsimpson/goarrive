import { describe, expect, it } from 'vitest';
import { bookingRecurrence } from './bookingRecurrence';

describe('coach booking recurrence request', () => {
  it('requests exactly one occurrence for one selected weekday', () => {
    expect(bookingRecurrence('none', [6])).toEqual({ repeatFrequency: 'none' });
  });
  it('rejects multiple selected days instead of silently booking multiple one-time sessions', () => {
    expect(() => bookingRecurrence('none', [1, 3])).toThrow('exactly one day');
    expect(() => bookingRecurrence('none', [])).toThrow('exactly one day');
  });
  it('preserves the existing weekly series selection', () => {
    expect(bookingRecurrence('weekly', [1, 3])).toEqual({ repeatFrequency: 'weekly' });
  });
});
