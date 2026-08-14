const KEY = 'goarrive.handoffLog';
const MAX = 500;

export function pushHandoffLog(line: string) {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.sessionStorage.getItem(KEY);
    const arr: string[] = raw ? JSON.parse(raw) : [];
    arr.push(`${new Date().toISOString()} ${line}`);
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
