/**
 * Unit tests for offline video cache staleness/retry logic (P1-7).
 *
 * Guards against:
 *  - status='error' being terminal (failed downloads must be retryable)
 *  - cached entries older than the staleness window never refreshing
 *  - fresh cached entries being needlessly re-downloaded
 */

import { CACHE_STALE_MS, shouldRedownload } from '../offlineVideoCache.helpers';

const NOW = 1_800_000_000_000;

describe('shouldRedownload', () => {
  test('missing entry → download', () => {
    expect(shouldRedownload(undefined, NOW)).toBe(true);
  });

  test('error entry → retry (not terminal)', () => {
    expect(
      shouldRedownload({ status: 'error', downloadedAt: 0 }, NOW),
    ).toBe(true);
  });

  test('fresh cached entry → no re-download', () => {
    expect(
      shouldRedownload({ status: 'cached', downloadedAt: NOW - 1000 }, NOW),
    ).toBe(false);
  });

  test('cached entry just inside the 7-day window → no re-download', () => {
    expect(
      shouldRedownload(
        { status: 'cached', downloadedAt: NOW - CACHE_STALE_MS },
        NOW,
      ),
    ).toBe(false);
  });

  test('cached entry older than 7 days → refresh', () => {
    expect(
      shouldRedownload(
        { status: 'cached', downloadedAt: NOW - CACHE_STALE_MS - 1 },
        NOW,
      ),
    ).toBe(true);
  });

  test('in-flight download states are left alone', () => {
    expect(
      shouldRedownload({ status: 'downloading', downloadedAt: 0 }, NOW),
    ).toBe(false);
    expect(
      shouldRedownload({ status: 'pending', downloadedAt: 0 }, NOW),
    ).toBe(false);
  });
});
