/**
 * audioBeep — Web-compatible oscillator-based beep for countdowns
 *
 * Slice 1, Week 4, Loop 4 — Polish
 */

/** Play a short synth beep at a given frequency */
export function playBeep(frequency = 880, duration = 0.1, volume = 0.2): void {
  if (typeof window === 'undefined' || !window.AudioContext && !(window as any).webkitAudioContext) {
    return;
  }

  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);

    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + duration);
  } catch {
    // Audio playback blocked or failed — silent fail
  }
}
