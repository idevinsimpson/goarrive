import { expect, it } from 'vitest';
import { observeServerClock, serverClockNow } from './serverClock';
it.each([-86400000, 86400000])('ignores initial device offset %s', offset => {
  const clock = observeServerClock(100000, 0, 100, 100000 + offset);
  expect(serverClockNow(clock, 1100, 101000 + offset)).toBe(101000);
});
it('rejects delayed responses, expired observations and clock jumps', () => {
  expect(observeServerClock(100000, 0, 10001, 100000)).toBeNull();
  expect(observeServerClock(NaN, 0, 1, 100000)).toBeNull();
  const clock = observeServerClock(100000, 0, 100, 100000);
  expect(serverClockNow(clock, 60101, 160001)).toBeNull();
  expect(serverClockNow(clock, 1100, 200000)).toBeNull();
  expect(serverClockNow(clock, 1100, 0)).toBeNull();
  expect(serverClockNow(null, 0, 0)).toBeNull();
});
