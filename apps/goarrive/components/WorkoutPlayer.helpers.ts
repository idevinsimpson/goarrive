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
