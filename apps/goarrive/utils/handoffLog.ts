const KEY = 'goarrive.handoffLog';
// Pass 14: cap raised from 2000 to 5000 entries. Pass-13 device log
// rotated past the leave-with-PiP event (Devin's "no music after you
// leave the app" — zero HANDOFF lines in the copied window). At the
// pass-11 density of ~200 chars/line this is ~1MB payload cap and
// buys ~25 minutes of session history so the leave event survives
// even when the tester takes a few beats before copying. Note: this
// only helps if visibilitychange actually fires under PiP; if it
// doesn't, no ring size makes the event appear — pass-14's seam-exit
// reason logs cover that branch.
const MAX = 5000;

export function pushHandoffLog(line: string) {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const arr: string[] = raw ? JSON.parse(raw) : [];
    arr.push(`${new Date().toISOString()} ${line}`);
    // Ring buffer semantics — oldest entries drop first once cap is hit.
    while (arr.length > MAX) arr.shift();
    window.sessionStorage.setItem(KEY, JSON.stringify(arr));
  } catch {}
}

export function readHandoffLog(): string {
  if (typeof window === 'undefined') return '';
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const arr: string[] = raw ? JSON.parse(raw) : [];
    return arr.join('\n');
  } catch { return ''; }
}

// Pass 11: emit a PAGE-INIT marker the moment this module is imported.
// Every full page teardown-and-reload will emit a fresh line, so the
// spontaneous mid-PiP reload seen at 17:44:37 becomes unmistakable in
// the log grep instead of inferred from canvasId/videoId churn. The
// timestamp is Date.now() so the exact ms of the boot is captured.
if (typeof window !== 'undefined') {
  pushHandoffLog(`[PiP] PAGE-INIT ${Date.now()} url=${window.location?.pathname ?? ''}`);
}
