/** Pure validation for a future stream adapter. Never fetch arbitrary URLs or
 * return download URLs to guests. This module does not grant media access. */
export function guestMediaObjectPath(value: unknown, coachId: string): string | undefined {
  if (typeof value !== 'string' || typeof coachId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(coachId)) return undefined;
  // Require canonical storage object references produced by an owner-verified
  // workout projection, not URLs with reusable download tokens or arbitrary hosts.
  if (!value.startsWith(`movements/${coachId}/`) && !value.startsWith(`workouts/${coachId}/`)) return undefined;
  if (value.length > 1024 || /[\\%?#\x00-\x20]/.test(value) || value.split('/').some(p => !p || p === '.' || p === '..')) return undefined;
  return value;
}
export function boundedGuestMediaRange(range: unknown, size: number): { start: number; end: number } | undefined {
  const maxChunk = 1024 * 1024;
  if (!Number.isSafeInteger(size) || size <= 0 || size > 100 * 1024 * 1024 || typeof range !== 'string') return undefined;
  const match = /^bytes=(\d+)-(\d+)$/.exec(range);
  if (!match) return undefined;
  const start = Number(match[1]), end = Number(match[2]);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= size || end - start + 1 > maxChunk) return undefined;
  return { start, end };
}
