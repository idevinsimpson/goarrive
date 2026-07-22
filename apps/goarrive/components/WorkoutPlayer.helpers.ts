/**
 * Pure helper functions extracted from WorkoutPlayer for testability.
 * No React or Firebase imports — safe to import in unit tests.
 */

// Compose a movement label that appends coach-prescribed weight and reps after
// the name (e.g. "Cable Curls, 75 lbs, 15 reps"). Purely-numeric weight/reps
// get the unit appended; freeform values ("bodyweight", "AMRAP") render as-is.
export function composePrescriptionLabel(name: string, weight?: string, reps?: string): string {
  const w = (weight || '').trim();
  const r = (reps || '').trim();
  const parts: string[] = [];
  if (w) parts.push(/^\d+(\.\d+)?$/.test(w) ? `${w} lbs` : w);
  if (r) parts.push(/^\d+$/.test(r) ? `${r} reps` : r);
  return parts.length === 0 ? name : `${name}, ${parts.join(', ')}`;
}

// ── Auto-fit title tier picking ─────────────────────────────────────────
// Picks the largest font tier where (a) the longest word fits on a single
// line at the available inner width, (b) greedy word-wrap produces ≤ maxLines
// lines, and (c) when maxHeight is given, the wrapped block's total height
// (lines × lineHeight) fits inside it. All inputs/outputs are in BASE design
// units — the caller scales via fs(). The char-width factor is a deliberately
// conservative estimate for the FH bold headline font.
export const NAME_CHAR_W_FACTOR = 0.62;
export const NAME_TIERS: readonly { size: number; line: number }[] = [
  { size: 40, line: 44 },
  { size: 34, line: 38 },
  { size: 28, line: 32 },
  { size: 24, line: 28 },
  { size: 20, line: 24 },
  { size: 17, line: 21 },
  { size: 14, line: 18 },
];

export function pickNameTier(
  text: string,
  baseAvailWidth: number,
  maxLines: number,
  maxFontSize?: number,
  maxHeight?: number,
): { size: number; line: number } {
  const words = (text || '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return NAME_TIERS.find(t => maxFontSize == null || t.size <= maxFontSize)
      ?? NAME_TIERS[NAME_TIERS.length - 1];
  }
  const longestWordLen = words.reduce((n, w) => (w.length > n ? w.length : n), 0);
  for (const t of NAME_TIERS) {
    if (maxFontSize != null && t.size > maxFontSize) continue;
    const charW = t.size * NAME_CHAR_W_FACTOR;
    if (longestWordLen * charW > baseAvailWidth) continue;
    const maxCharsPerLine = Math.max(1, Math.floor(baseAvailWidth / charW));
    let lines = 1;
    let curr = 0;
    for (const w of words) {
      if (curr === 0) curr = w.length;
      else if (curr + 1 + w.length <= maxCharsPerLine) curr += 1 + w.length;
      else { lines += 1; curr = w.length; }
    }
    if (lines > maxLines) continue;
    if (maxHeight != null && lines * t.line > maxHeight) continue;
    return t;
  }
  return NAME_TIERS[NAME_TIERS.length - 1];
}

// Peek by index: scan currentIndex+1 through currentIndex+3 for the first
// distinct videoUrl. Bounded lookahead avoids returning a far-future URL when
// the next several movements all share the active URL (which is the all-same-
// URL regression: walk-by-URL would skip to the next change wherever it is).
export function computePreloadVideoUrl(
  activeVideoUrl: string | null,
  currentIndex: number,
  flatMovements: Array<{ videoUrl?: string }>,
): string | null {
  if (!activeVideoUrl) return null;
  for (let offset = 1; offset <= 3; offset++) {
    const url = flatMovements[currentIndex + offset]?.videoUrl;
    if (url && url !== activeVideoUrl) return url;
  }
  return null;
}

// Handles a single onPlaybackStatusUpdate event from an expo-av Video layer.
// Warns on error and detects playback stalls via the caller-managed positionMap.
export function handleVideoLayerPlaybackStatus(
  status: any,
  url: string,
  positionMap: Map<string, { pos: number; ts: number }>,
  now: number = Date.now(),
): void {
  if (!status?.isLoaded) return;
  if (status.error) {
    console.warn('[WorkoutPlayer] video error', { url });
    return;
  }
  const prev = positionMap.get(url);
  if (prev === undefined || status.positionMillis !== prev.pos) {
    positionMap.set(url, { pos: status.positionMillis, ts: now });
  } else if (status.shouldPlay && now - prev.ts >= 5000) {
    console.warn('[WorkoutPlayer] video stall detected', { url, stallMs: now - prev.ts });
  }
}

// ── Stall recovery escalation ───────────────────────────────────────────
// Decides what to do about a detected stall, per URL. Escalates:
//   nudge — re-issue play() on the existing element (covers browser-applied
//           pauses where shouldPlay never changed, so expo-av won't retry)
//   remount — bump the layer epoch so the <Video> gets a fresh element and
//             decoder (covers iOS evicting the media pipeline of one of
//             several mounted videos)
//   fail — give up; caller marks the URL failed so the thumbnail fallback
//          renders instead of a frozen frame forever
// Attempts are throttled so the ladder climbs at most once per throttle
// window — each attempt needs time to take effect before escalating.
export const STALL_RECOVERY_THROTTLE_MS = 5000;
export const STALL_MAX_REMOUNTS = 2;

export interface StallRecoveryState { attempts: number; lastAttemptTs: number }

export function nextStallRecoveryAction(
  state: StallRecoveryState | undefined,
  now: number,
): { action: 'wait' | 'nudge' | 'remount' | 'fail'; state: StallRecoveryState } {
  const prev = state ?? { attempts: 0, lastAttemptTs: -Infinity };
  if (now - prev.lastAttemptTs < STALL_RECOVERY_THROTTLE_MS) return { action: 'wait', state: prev };
  const next = { attempts: prev.attempts + 1, lastAttemptTs: now };
  if (next.attempts === 1) return { action: 'nudge', state: next };
  if (next.attempts <= 1 + STALL_MAX_REMOUNTS) return { action: 'remount', state: next };
  return { action: 'fail', state: next };
}
