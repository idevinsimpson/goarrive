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

// ── 9:16 artboard canvas math ───────────────────────────────────────────
// The player composition is designed on a 360×640 artboard. The naive fit
// (scale = min(w/360, h/640)) pillarboxes portrait phones whenever the
// viewport is shorter than 16:9 — which is nearly always on real devices
// (Safari toolbars, in-app webviews). Regression 2026-07-21: player rendered
// at 74% of screen width inside a webview.
//
// Rule: in portrait, WIDTH ALWAYS WINS up to a maximum artboard width. The
// scale is driven by viewport width; when the viewport is too short for the
// full 640-unit artboard, the media slot absorbs the shortfall (the 4:5 media
// crops via cover) down to a floor of BASE_MEDIA_MIN_H. Only below that
// degenerate height (or in landscape, where pillarboxing is the design) does
// the uniform fit apply.
//
// Regression 2026-08-06 (iPad): without a scale cap, iPad portrait (810px)
// yielded scale 2.25 — the countdown badge (fs(132)=297px) overlapped the
// title, and text/media grew past design intent. CANVAS_MAX_FRAME_W caps the
// artboard so tablet and desktop show a centered phone-sized canvas rather
// than a scaled-up phone.
export const CANVAS_BASE_W = 360;
export const CANVAS_BASE_H = 640;
// Non-media vertical slots: logo 56 + gap 4 + title 112 + gap 12 + gap 12
// + next-up 64. Must stay in sync with the slot constants in WorkoutPlayer.
export const CANVAS_BASE_CHROME_H = 260;
export const CANVAS_BASE_MEDIA_H = 380; // full design media slot height
export const CANVAS_BASE_MEDIA_W = 304; // 4:5 of 380
export const CANVAS_BASE_MEDIA_MIN_H = 160;
// Max artboard width in px. 480 comfortably fits the widest phone (iPhone 15
// Pro Max @ 430px) while producing a centered canvas on tablet/desktop.
export const CANVAS_MAX_FRAME_W = 480;
export const CANVAS_MAX_SCALE = CANVAS_MAX_FRAME_W / CANVAS_BASE_W;

export interface PlayerCanvas {
  scale: number;
  frameW: number;
  frameH: number;
  baseMediaW: number; // BASE units — caller scales via fs()
  baseMediaH: number; // BASE units — caller scales via fs()
}

export function computePlayerCanvas(
  winW: number,
  winH: number,
  safeTop: number,
  safeBottom: number,
): PlayerCanvas {
  const availW = winW;
  const availH = Math.max(1, winH - safeTop - safeBottom);
  // Cap the width-driven scale so tablet/desktop viewports don't scale the
  // artboard above phone-max width. Below the cap this is a no-op (phones
  // keep the width-always-wins behavior).
  const widthScale = Math.min(availW / CANVAS_BASE_W, CANVAS_MAX_SCALE);
  const fitScale = Math.max(
    0.0001,
    Math.min(widthScale, availH / CANVAS_BASE_H),
  );
  const portrait = winH >= winW;
  const minCanvasH = widthScale * (CANVAS_BASE_CHROME_H + CANVAS_BASE_MEDIA_MIN_H);
  const scale = portrait && availH >= minCanvasH ? widthScale : fitScale;
  const frameW = CANVAS_BASE_W * scale;
  const frameH = Math.min(CANVAS_BASE_H * scale, availH);
  const baseMediaH = Math.max(
    CANVAS_BASE_MEDIA_MIN_H,
    Math.min(CANVAS_BASE_MEDIA_H, frameH / scale - CANVAS_BASE_CHROME_H),
  );
  // Keep width proportional to height so the container is always exactly 4:5
  // regardless of viewport. Without this, wide viewports (iPad) produce a
  // landscape-shaped container (e.g. 692×506) instead of portrait 4:5.
  const baseMediaW = CANVAS_BASE_MEDIA_W * (baseMediaH / CANVAS_BASE_MEDIA_H);
  return { scale, frameW, frameH, baseMediaW, baseMediaH };
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
