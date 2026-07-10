/**
 * Pure helpers for useOfflineVideoCache — kept free of react-native imports
 * so they can be unit-tested under vitest.
 */

// Refresh cached files older than 7 days — Firebase Storage download URLs
// can be revoked/rotated, and stale local copies mask replaced videos.
export const CACHE_STALE_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * True when a cache entry should be (re-)downloaded: never downloaded,
 * previously failed (errors must be retryable, not terminal), or stale.
 */
export function shouldRedownload(
  entry: { status: string; downloadedAt: number } | undefined,
  now: number = Date.now(),
): boolean {
  if (!entry) return true;
  if (entry.status === 'error') return true;
  if (entry.status === 'cached' && now - entry.downloadedAt > CACHE_STALE_MS) return true;
  return false;
}
