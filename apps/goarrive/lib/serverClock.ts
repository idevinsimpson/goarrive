export const CLOCK_MAX_AGE_MS = 60000;
export const CLOCK_MAX_REQUEST_MS = 10000;
export type ServerClock = { serverMs: number; monotonicMs: number; wallMs: number };
export const monotonicNow = () => performance.now();

/** Reject slow observations. Do not add network latency (which could unlock early). */
export function observeServerClock(serverMs: number, sentAt: number, receivedAt = monotonicNow(), wallMs = Date.now()): ServerClock | null {
  const elapsed = receivedAt - sentAt;
  return Number.isFinite(serverMs) && serverMs > 0 && elapsed >= 0 && elapsed <= CLOCK_MAX_REQUEST_MS
    ? { serverMs, monotonicMs: receivedAt, wallMs } : null;
}

/** Device clock offset never drives eligibility; clock jumps/resume fail closed. */
export function serverClockNow(clock: ServerClock | null, monotonicMs = monotonicNow(), wallMs = Date.now()): number | null {
  if (!clock) return null;
  const elapsed = monotonicMs - clock.monotonicMs;
  if (elapsed < 0 || elapsed > CLOCK_MAX_AGE_MS || Math.abs(wallMs - clock.wallMs - elapsed) > 2000) return null;
  return clock.serverMs + elapsed;
}
