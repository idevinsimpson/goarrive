/**
 * Preserved October 3, 2026 audit counterexamples for the separate Lovable lab.
 * Project c1b16a13-34ff-4878-b798-750cc63aa595; exact source head
 * 8c61cd728a909df929b48ab6053a1818fb7322b8.
 *
 * To reproduce, place this file at that Lovable project root as
 * audit-probes.test.ts and run it with its Vitest setup. These imports name
 * that project's source; this inert evidence file is not a WSF app test.
 * Each assertion confirms the observed problematic behavior, not safety.
 * Do not combine these three counterexamples with the 21 original tests
 * and report 24 acceptance passes. Inputs are synthetic landmarks only.
 */
import { describe, it, expect } from 'vitest';
import { VisionEngine } from './src/lab/vision/engine';
import { reps, simulate, personPose, type PersonSpec } from './src/lab/vision/fixtures';

function feed(engine: VisionEngine, frames: ReturnType<typeof simulate>) {
  let s;
  for (const f of frames) {
    s = engine.step(f);
    if (s.lock === 'locked' && !engine.counting) engine.setCounting(true);
  }
  return s!;
}

describe('independent audit probes: synthetic only, no model or human accuracy claim', () => {
  it('measures immediate spatially indistinguishable replacement before lost timeout', () => {
    const first = reps(3);
    const second = reps(3, { start: first.end + 1000 });
    const p1: PersonSpec = { cx: 320, ground: 440, leg: 200, depth: first.fn, present: t => t < first.end };
    const p2: PersonSpec = { cx: 320, ground: 440, leg: 200, depth: second.fn, present: t => t >= first.end + 100 };
    const e = new VisionEngine();
    const s = feed(e, simulate([p1, p2], { durMs: second.end }));
    console.log('AUDIT immediate replacement', JSON.stringify({ originalMemberReps: 3, replacementReps: 3, observed: s.count, stats: s.stats, lock: s.lock }));
    expect(s.count).toBe(6);
    expect(s.stats.lockSwitches).toBe(0);
  });
  it('measures replaying identical timestamped frames', () => {
    const r = reps(3);
    const frames = simulate([{ cx: 320, ground: 440, leg: 200, depth: r.fn }], { durMs: r.end });
    const e = new VisionEngine();
    const first = feed(e, frames).count;
    const replayed = feed(e, frames).count;
    console.log('AUDIT exact frame replay', JSON.stringify({ first, replayed }));
    expect(first).toBe(3);
    expect(replayed).toBe(6);
  });
  it('measures one false deep landmark frame during a shallow cycle', () => {
    const r = reps(1, { depth: 0.4 });
    const p: PersonSpec = { cx: 320, ground: 440, leg: 200, depth: r.fn };
    const frames = simulate([p], { durMs: r.end });
    const spike = frames.findIndex(f => f.t >= r.start + 850);
    const f = frames[spike]!;
    f.poses = [personPose({ ...p, depth: () => 0.7 }, f.t, f.w, f.h)];
    const s = feed(new VisionEngine(), frames);
    console.log('AUDIT one-frame deep spike', JSON.stringify({ underlyingCompleteReps: 0, corruptFrames: 1, observed: s.count, counter: s.phase }));
    expect(s.count).toBe(1);
  });
});
