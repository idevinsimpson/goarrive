/**
 * pipProbeMode — reads the pass-2 PiP canvas mechanism probe switch.
 *
 * Pass 1 (PR #289) proved the always-on `usePipCanvasStream` hook was
 * starving the foreground music path — mechanism unknown. Pass 2 needs to
 * run the hook inline (outside PiP) with a subset of its components so a
 * device tester can isolate which step starves music:
 *   canvas → rAF + canvas draws only, NO audio track merge, NO hidden video
 *   audio  → rAF + canvas + audio merge, NO hidden video
 *   full   → everything, including the caller-owned hidden video element
 *
 * Whichever mode FIRST flips foreground music from audible → silent names
 * the culprit. Default is `full` because that is the pre-fix always-on
 * baseline — landing on staging should reproduce the known-silent state so
 * the tester can A/B against `canvas` and `audio` without hunting.
 *
 * Staging-only surface. Not read outside staging pill code paths.
 */
export type PipProbeMode = 'canvas' | 'audio' | 'full';

const STORAGE_KEY = 'goarrive.pipProbeMode';

function parseQuery(search: string): PipProbeMode | null {
  try {
    const params = new URLSearchParams(search);
    const raw = params.get('pipprobe');
    if (raw === 'canvas' || raw === 'audio' || raw === 'full') return raw;
  } catch {}
  return null;
}

/**
 * Resolve the current probe mode. Query param wins; localStorage persists
 * the last pill choice so a reload keeps state; default `full`.
 */
export function getPipProbeMode(): PipProbeMode {
  if (typeof window === 'undefined') return 'full';
  const fromQuery = parseQuery(window.location.search);
  if (fromQuery) {
    try { window.localStorage.setItem(STORAGE_KEY, fromQuery); } catch {}
    return fromQuery;
  }
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'canvas' || stored === 'audio' || stored === 'full') return stored;
  } catch {}
  return 'full';
}

/**
 * Persist a mode to localStorage. Paired with the on-screen PROBE pill so
 * the tester can cycle modes without typing ?pipprobe= on an iPhone
 * keyboard. Caller reloads after this — steady state per mode is the point.
 */
export function setPipProbeMode(m: PipProbeMode): void {
  if (typeof window === 'undefined') return;
  try { window.localStorage.setItem(STORAGE_KEY, m); } catch {}
}

const CYCLE: readonly PipProbeMode[] = ['canvas', 'audio', 'full'] as const;

/** Advance mode: canvas → audio → full → canvas. */
export function nextPipProbeMode(current: PipProbeMode): PipProbeMode {
  const i = CYCLE.indexOf(current);
  return CYCLE[(i + 1) % CYCLE.length];
}

/**
 * Human-readable strategy label for the on-screen probe pill. The internal
 * mode names ('canvas' / 'audio' / 'full') are opaque to a device tester —
 * pass-4 log showed the pill saying FULL while behavior was ambiguous
 * (initial merge failed because getPipAudioStream was cold, then attach-at-tap
 * succeeded, making FULL and AUDIO indistinguishable in the log). Word labels
 * name the *strategy*, not the mode, so the pill and behavior can't disagree.
 *
 * 'canvas' = NO-PIP — no hidden target video created, PiP is impossible
 *            (control condition, not a PiP strategy).
 * 'audio'  = AUDIO@TAP — video-only warm stream + late-attach audio at tap.
 * 'full'   = AUDIO@MOUNT — merged audio from mount when the audio graph is
 *            hot; falls back to tap-attach if getPipAudioStream() returned
 *            null at mount (verified pass-4 behavior).
 */
export function pipProbeModeLabel(m: PipProbeMode): string {
  switch (m) {
    case 'canvas': return 'NO-PIP';
    case 'audio':  return 'AUDIO@TAP';
    case 'full':   return 'AUDIO@MOUNT';
  }
}
