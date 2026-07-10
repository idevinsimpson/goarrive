/**
 * Unit tests for prefetch offset clamping (P1-8).
 *
 * Guards against sparse/undefined access when the prefetch window
 * (offsets 1-3) extends past the end of flatMovements.
 */

import { getUpcomingMovements } from '../mediaPrefetch.helpers';

const m = (id: number) => ({ videoUrl: `https://x.com/${id}.mp4` });

describe('getUpcomingMovements', () => {
  test('returns next 3 movements mid-list', () => {
    const list = [m(0), m(1), m(2), m(3), m(4), m(5)];
    expect(getUpcomingMovements(list, 0)).toEqual([m(1), m(2), m(3)]);
  });

  test('clamps at end of list', () => {
    const list = [m(0), m(1), m(2)];
    expect(getUpcomingMovements(list, 1)).toEqual([m(2)]);
  });

  test('last movement → empty', () => {
    const list = [m(0), m(1)];
    expect(getUpcomingMovements(list, 1)).toEqual([]);
  });

  test('index past end → empty (no negative-range access)', () => {
    const list = [m(0)];
    expect(getUpcomingMovements(list, 5)).toEqual([]);
  });

  test('filters sparse/undefined entries', () => {
    const list: any[] = [m(0), undefined, m(2), null];
    expect(getUpcomingMovements(list, 0)).toEqual([m(2)]);
  });

  test('empty list → empty', () => {
    expect(getUpcomingMovements([], 0)).toEqual([]);
  });
});
