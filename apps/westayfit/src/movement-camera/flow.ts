/**
 * MOVE-CAMERA-NATIVE-PORT-1 — THE CAMERA SQUAT FLOW, AS PURE RULES.
 *
 * Everything the camera screen decides lives here, with no React, DOM, camera
 * or engine: who may enter it, when the member is ready, the automatic 3-2-1,
 * the GO baseline, pause banking, Finish and the adjust bounds. The screen
 * feeds frames and a clock and renders what this returns.
 *
 * Counting itself is the FROZEN live session (makeSessionR1421) behind
 * orchestrator.ts, which also owns readiness (armed + 600 ms stable full
 * body) and the GO baseline. Mirrors the reference's src/demo/camera-flow.ts.
 */
import type { CameraStatus } from './orchestrator';

// ── Settings ────────────────────────────────────────────────────────────────

export interface MoveCameraSettings {
  /** Automatically count squats with the camera. */
  cameraCounter: boolean;
  /** Show the body guide while counting. Subordinate: no effect when the counter is off. */
  stickFigure: boolean;
}

export const DEFAULT_MOVE_CAMERA_SETTINGS: MoveCameraSettings = Object.freeze({
  cameraCounter: true,
  stickFigure: true,
});

/** Anything missing or not a boolean reads as the default (ON). */
export function moveCameraSettingsOf(raw: unknown): MoveCameraSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    cameraCounter: typeof r.cameraCounter === 'boolean' ? r.cameraCounter : DEFAULT_MOVE_CAMERA_SETTINGS.cameraCounter,
    stickFigure: typeof r.stickFigure === 'boolean' ? r.stickFigure : DEFAULT_MOVE_CAMERA_SETTINGS.stickFigure,
  };
}

// ── Entry ───────────────────────────────────────────────────────────────────

/** Movements the camera counter is proven for. Exact unit match only. */
export const CAMERA_MOVEMENTS: readonly string[] = Object.freeze(['squats']);

export function isCameraMovement(unit: string | null | undefined): boolean {
  return CAMERA_MOVEMENTS.includes((unit ?? '').trim().toLowerCase().replace(/\s+/g, ' '));
}

export interface CameraEntryInput {
  settings: MoveCameraSettings;
  unit: string | null | undefined;
  /** "Start moving" (live) as opposed to logging something already done. */
  mode: 'start' | 'already';
  /** A resumed, pending, unknown or confirmed attempt keeps its existing recovery. */
  resumed: boolean;
  /** The runtime can actually run the counter (web with a camera). Native fails closed. */
  supported: boolean;
}

export function cameraEntryAllowed(i: CameraEntryInput): boolean {
  return i.supported && i.settings.cameraCounter && !i.resumed && i.mode === 'start' && isCameraMovement(i.unit);
}

// ── Adjust ──────────────────────────────────────────────────────────────────

export const ADJUST_MAX = 500;

export function clampReps(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(ADJUST_MAX, Math.round(n))) : 0;
}

// ── Countdown ───────────────────────────────────────────────────────────────

export const COUNTDOWN_MS = 3000;
export const FULL_BODY_STABLE_MS = 600;

export type CountdownState =
  | { phase: 'acquiring' }
  | { phase: 'countdown'; startedAt: number }
  | { phase: 'counting' };

export const ACQUIRING: CountdownState = Object.freeze({ phase: 'acquiring' });

export interface CountdownStep {
  state: CountdownState;
  /** 3, 2 or 1 while counting down; null otherwise. */
  display: number | null;
  /** True on the one step where the countdown completes. */
  go: boolean;
}

/** Losing readiness at any point before GO returns to acquisition. */
export function stepCountdown(state: CountdownState, ready: boolean, now: number): CountdownStep {
  if (state.phase === 'counting') return { state, display: null, go: false };
  if (!ready) return { state: ACQUIRING, display: null, go: false };
  if (state.phase === 'acquiring') {
    return { state: { phase: 'countdown', startedAt: now }, display: 3, go: false };
  }
  const elapsed = now - state.startedAt;
  if (elapsed >= COUNTDOWN_MS) return { state: { phase: 'counting' }, display: null, go: true };
  return { state, display: Math.max(1, 3 - Math.floor(elapsed / 1000)), go: false };
}

// ── Copy ────────────────────────────────────────────────────────────────────

/** The one plain line under the count. Null when nothing needs saying. */
export function cameraCue(i: {
  status: CameraStatus;
  countingNow: boolean;
  countdown: number | null;
  locked: boolean;
  fullBody: boolean;
}): string | null {
  if (i.status === 'failed' || i.status === 'paused') return null;
  if (i.status !== 'live') return 'Starting camera…';
  if (i.countingNow) return i.locked ? null : 'Step back into view';
  if (i.countdown !== null) return 'Get ready';
  if (!i.locked || !i.fullBody) return 'Step back so I can see you';
  return 'Stand tall — getting ready';
}
