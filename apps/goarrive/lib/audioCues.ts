/**
 * audioCues — Enhanced audio cue system for the Workout Player
 *
 * Provides distinct tones for each workout phase transition:
 *   - workStart: ascending two-tone chime (motivating)
 *   - restStart: descending soft chime (calming)
 *   - countdownTick: short tick at 3-2-1 seconds
 *   - countdownFinal: louder final tick at 0
 *   - workoutComplete: triumphant ascending arpeggio
 *   - repDone: short confirmation blip
 *
 * Uses Web Audio API oscillators — works on web and React Native (via expo-av fallback).
 * All cues are non-blocking and fail silently if audio is unavailable.
 */

// ── Shared AudioContext (reuse to avoid creation overhead) ──────────────
let sharedCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioCtx =
    (window as any).AudioContext || (window as any).webkitAudioContext;
  if (!AudioCtx) return null;

  if (!sharedCtx || sharedCtx.state === 'closed') {
    sharedCtx = new AudioCtx();
  }
  // Resume if suspended (autoplay policy)
  if (sharedCtx.state === 'suspended') {
    sharedCtx.resume().catch(() => {});
  }
  return sharedCtx;
}

// ── Low-level tone player ──────────────────────────────────────────────
function playTone(
  frequency: number,
  duration: number,
  volume: number,
  type: OscillatorType = 'sine',
  startDelay = 0,
): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  try {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(frequency, ctx.currentTime + startDelay);

    gain.gain.setValueAtTime(volume, ctx.currentTime + startDelay);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      ctx.currentTime + startDelay + duration,
    );

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start(ctx.currentTime + startDelay);
    osc.stop(ctx.currentTime + startDelay + duration);
  } catch {
    // Audio playback blocked or failed — silent fail
  }
}

// ── Public cue functions ───────────────────────────────────────────────

/** Ascending two-tone chime — signals WORK phase start */
export function cueWorkStart(): void {
  playTone(523.25, 0.15, 0.25, 'sine', 0); // C5
  playTone(659.25, 0.2, 0.3, 'sine', 0.12); // E5
}

/** Descending soft chime — signals REST phase start */
export function cueRestStart(): void {
  playTone(659.25, 0.15, 0.2, 'sine', 0); // E5
  playTone(523.25, 0.2, 0.15, 'sine', 0.12); // C5
}

/** Short tick for countdown 3-2-1 */
export function cueCountdownTick(): void {
  playTone(880, 0.08, 0.15, 'square', 0); // A5 short tick
}

/** Louder final tick at countdown zero */
export function cueCountdownFinal(): void {
  playTone(1046.5, 0.15, 0.3, 'square', 0); // C6 louder
}

/** Triumphant ascending arpeggio — workout complete */
export function cueWorkoutComplete(): void {
  playTone(523.25, 0.15, 0.25, 'sine', 0); // C5
  playTone(659.25, 0.15, 0.25, 'sine', 0.12); // E5
  playTone(783.99, 0.15, 0.25, 'sine', 0.24); // G5
  playTone(1046.5, 0.3, 0.3, 'sine', 0.36); // C6 (hold)
}

/** Short confirmation blip — rep-based movement done */
export function cueRepDone(): void {
  playTone(784, 0.1, 0.2, 'sine', 0); // G5
}

/** Get/set mute state (persisted in memory only) */
let muted = false;

export function setAudioMuted(value: boolean): void {
  muted = value;
}

export function isAudioMuted(): boolean {
  return muted;
}

/**
 * Wrapper that respects mute state.
 * All public cue functions should be called through this.
 */
export function playCue(
  cue:
    | 'workStart'
    | 'restStart'
    | 'countdownTick'
    | 'countdownFinal'
    | 'workoutComplete'
    | 'repDone',
): void {
  if (muted) return;

  switch (cue) {
    case 'workStart':
      cueWorkStart();
      break;
    case 'restStart':
      cueRestStart();
      break;
    case 'countdownTick':
      cueCountdownTick();
      break;
    case 'countdownFinal':
      cueCountdownFinal();
      break;
    case 'workoutComplete':
      cueWorkoutComplete();
      break;
    case 'repDone':
      cueRepDone();
      break;
  }
}
