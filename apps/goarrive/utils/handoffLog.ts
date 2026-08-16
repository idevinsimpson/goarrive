const KEY = 'goarrive.handoffLog';
// Pass 11: cap raised from 500 to 2000 entries. Devin reported the buffer
// growth is a secondary reclaim risk on iOS (contributor to the pass-10
// page-teardown seen at 17:44:23 → 17:44:37); an explicit ring cap here
// keeps the copy-log payload bounded (~400KB max at ~200 chars/line) and
// still gives ~10 minutes of session history at pass-10 log density.
const MAX = 2000;

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
