import { describe, expect, it } from 'vitest';

import { SquatCounter, type SquatOutput } from '../src/movement/squatCounter';
import { repeatedSquats, squatDepth } from '../src/movement/synthetic';

/** Feed a depth function at 30 fps over [0, endMs). Returns every output. */
function run(counter: SquatCounter, endMs: number, depthAt: (t: number) => number | null) {
  const outs: SquatOutput[] = [];
  for (let t = 0; t < endMs; t += 1000 / 30) outs.push(counter.update({ timestampMs: t, depth: depthAt(t) }));
  return outs;
}

const reps = (outs: SquatOutput[]) => outs.filter((o) => o.event === 'rep').length;

describe('SquatCounter — the rep state machine', () => {
  it('counts one full squat exactly once', () => {
    const c = new SquatCounter();
    const outs = run(c, 3000, (t) => squatDepth(t, 500, 1600, 1));
    expect(c.count).toBe(1);
    expect(reps(outs)).toBe(1);
    expect(outs.at(-1)!.phase).toBe('standing');
  });

  it('counts five reps as five', () => {
    const c = new SquatCounter();
    run(c, 12000, (t) => repeatedSquats(t, 500, 5, 1600, 1, 300));
    expect(c.count).toBe(5);
  });

  it('does not count a half squat, and reports it as a partial', () => {
    const c = new SquatCounter();
    const outs = run(c, 3000, (t) => squatDepth(t, 500, 1600, 0.45));
    expect(c.count).toBe(0);
    expect(outs.filter((o) => o.event === 'partial')).toHaveLength(1);
  });

  it('does not count a descent that stops just short of the down threshold', () => {
    const c = new SquatCounter();
    run(c, 3000, (t) => squatDepth(t, 500, 1600, 0.58));
    expect(c.count).toBe(0);
  });

  it('counts a slow squat (4 s down and up) once', () => {
    const c = new SquatCounter();
    run(c, 6000, (t) => squatDepth(t, 500, 4000, 1));
    expect(c.count).toBe(1);
  });

  it('counts fast squats (0.8 s each) one per rep', () => {
    const c = new SquatCounter();
    run(c, 6000, (t) => repeatedSquats(t, 300, 5, 800, 1, 150));
    expect(c.count).toBe(5);
  });

  it('a long pause at the bottom is still one rep', () => {
    const c = new SquatCounter();
    run(c, 7000, (t) => squatDepth(t, 500, 1600, 1, 4000));
    expect(c.count).toBe(1);
  });

  it('a long pause at the top adds nothing between reps', () => {
    const c = new SquatCounter();
    run(c, 12000, (t) => squatDepth(t, 500, 1600, 1) + squatDepth(t, 8000, 1600, 1));
    expect(c.count).toBe(2);
  });

  it('jitter across the down threshold at the bottom cannot double count', () => {
    const c = new SquatCounter();
    // Down, then 2 s of frame-by-frame chatter between 0.5 and 0.7 (either side
    // of downDepth 0.6), then back up.
    run(c, 5000, (t) => {
      if (t < 500) return 0;
      if (t < 1000) return ((t - 500) / 500) * 0.8;
      if (t < 3000) return Math.floor(t / 33) % 2 ? 0.7 : 0.5;
      if (t < 3500) return 0.8 - ((t - 3000) / 500) * 0.8;
      return 0;
    });
    expect(c.count).toBe(1);
  });

  it('bouncing between the thresholds without standing up is not a second rep', () => {
    const c = new SquatCounter();
    // Down, then three bounces up into the dead band (0.4) and back down.
    run(c, 6000, (t) => {
      if (t < 300) return 0;
      if (t < 4300) return 0.4 + 0.5 * Math.abs(Math.cos(((t - 300) / 1000) * Math.PI));
      return 0;
    });
    expect(c.count).toBe(1);
  });

  it('chatter across the UP threshold after a rep adds nothing', () => {
    const c = new SquatCounter();
    run(c, 5000, (t) => {
      const d = squatDepth(t, 300, 1400, 1);
      if (t > 1700 && t < 4500) return Math.floor(t / 33) % 2 ? 0.2 : 0.3; // around upDepth 0.25
      return d;
    });
    expect(c.count).toBe(1);
  });

  it('single noisy frames never move the phase (debounce)', () => {
    const c = new SquatCounter();
    // Standing, with one-frame spikes to full depth every 300 ms.
    run(c, 4000, (t) => (Math.floor(t / 33) % 9 === 0 ? 1.2 : 0));
    expect(c.count).toBe(0);
  });

  it('a spike that dwells only just under dwellMs does not count', () => {
    const c = new SquatCounter({ dwellMs: 100 });
    run(c, 2000, (t) => (t > 500 && t < 580 ? 1 : 0));
    expect(c.count).toBe(0);
  });

  it('interrupt() mid-rep discards the rep: returning to standing counts nothing', () => {
    const c = new SquatCounter();
    let t = 0;
    const feed = (d: number | null, ms: number) => {
      for (const end = t + ms; t < end; t += 33) c.update({ timestampMs: t, depth: d });
    };
    feed(0, 500); // standing
    feed(1, 500); // down
    expect(c.currentPhase).toBe('down');
    c.interrupt(); // tracking lost at the bottom
    feed(0, 800); // back standing
    expect(c.count).toBe(0);
    feed(1, 500);
    feed(0, 500); // a full rep after re-establishing standing
    expect(c.count).toBe(1);
  });

  it('starting in the down position counts nothing until standing is seen', () => {
    const c = new SquatCounter();
    run(c, 2000, (t) => (t < 1000 ? 1 : 0));
    expect(c.count).toBe(0);
  });

  it('null samples in the middle of a dwell cannot confirm it', () => {
    const c = new SquatCounter({ dwellMs: 100 });
    // Standing, then alternating [deep, null] — never two consecutive deep samples.
    run(c, 3000, (t) => (t < 500 ? 0 : Math.floor(t / 33) % 2 ? null : 1));
    expect(c.currentPhase).toBe('standing');
    expect(c.count).toBe(0);
  });

  it('reset() zeroes the count and requires standing again', () => {
    const c = new SquatCounter();
    run(c, 3000, (t) => squatDepth(t, 500, 1600, 1));
    expect(c.count).toBe(1);
    c.reset();
    expect(c.count).toBe(0);
    expect(c.currentPhase).toBe('unknown');
  });

  it('refuses a configuration without hysteresis', () => {
    expect(() => new SquatCounter({ downDepth: 0.3, upDepth: 0.3 })).toThrow();
  });
});
