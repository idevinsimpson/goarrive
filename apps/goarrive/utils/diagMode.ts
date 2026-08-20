/**
 * diagMode — Pass-21 Cut #3 runtime toggle for verbose PiP/handoff logging.
 *
 * Every prior pass wrote to sessionStorage on every log line (get/parse/
 * push/shift/stringify/set) — 20-30Hz during workout runtime, on the main
 * thread. With the PiP feature locked in, that instrumentation is only
 * needed during active diagnosis. Default OFF removes the storage churn
 * from the steady-state player and lets the "player feels fast again" bar
 * be met without deleting the diagnostic surface — flip the pill to
 * re-enable when investigating a new regression.
 *
 * Precedence:
 *   URL `?diag=on|off` wins on load (and persists into localStorage).
 *   localStorage persists the last pill choice across reloads.
 *   Default OFF.
 *
 * Cached in-module so `isDiagOn()` is a single field read on every hot-path
 * call site (pushHandoffLog fires up to ~30Hz during rAF ticks — reading
 * localStorage per call would defeat the point of the toggle).
 *
 * Marker: pipDiag=1 (only emitted when DIAG is on).
 */

const STORAGE_KEY = 'goarrive.diagMode';

function parseQuery(search: string): boolean | null {
  try {
    const p = new URLSearchParams(search);
    const raw = p.get('diag');
    if (raw === 'on' || raw === '1' || raw === 'true') return true;
    if (raw === 'off' || raw === '0' || raw === 'false') return false;
  } catch {}
  return null;
}

function readInitial(): boolean {
  if (typeof window === 'undefined') return false;
  const q = parseQuery(window.location?.search ?? '');
  if (q !== null) {
    try { window.localStorage.setItem(STORAGE_KEY, q ? 'on' : 'off'); } catch {}
    return q;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

let cached: boolean = readInitial();

export function isDiagOn(): boolean {
  return cached;
}

export function setDiagOn(on: boolean): void {
  cached = on;
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, on ? 'on' : 'off'); } catch {}
}

/** Flip current state, persist, return the new value. */
export function toggleDiag(): boolean {
  setDiagOn(!cached);
  return cached;
}

export function diagLabel(): string {
  return cached ? 'ON' : 'OFF';
}
