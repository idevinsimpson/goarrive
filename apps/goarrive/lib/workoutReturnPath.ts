/** Only these resource routes may survive login; no arbitrary URLs or queries. */
export function workoutReturnPath(value: unknown): string | null {
  return typeof value === 'string' && /^\/(?:playbook|live-session)\/[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null;
}
