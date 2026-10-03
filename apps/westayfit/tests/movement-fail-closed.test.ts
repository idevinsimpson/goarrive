import { describe, expect, it } from 'vitest';

import { MovementSession } from '../src/movement/session';
import { SubjectLock } from '../src/movement/subjectLock';
import { syntheticPose } from '../src/movement/synthetic';

/**
 * THE DIRECTOR'S THREE CONSTRUCTED CASES (#475 comment 5825938854), as
 * regressions. Each one reproduced a rep or a trusted subject that the core
 * should have refused. Inputs are the review's own, verbatim.
 */
const p = (depth = 0, cx = 0.5) => syntheticPose({ cx, footY: 0.92, height: 0.7, depth });
const f = (s: MovementSession, t: number, poses: ReturnType<typeof p>[]) => s.update({ timestampMs: t, poses });
const ready = () => {
  const s = new MovementSession();
  for (let t = 0; t <= 1000; t += 50) f(s, t, [p()]);
  expect(s.snapshot.lockState).toBe('locked');
  return s;
};

describe('fail-closed 1: two overlapping distinct poses are never one trusted person', () => {
  it('a second, almost identical pose next to the locked member makes the frame ambiguous', () => {
    const s = ready();
    const snap = f(s, 1050, [p(0, 0.5), p(0, 0.505)]);
    expect(snap.candidates).toHaveLength(2);
    expect(snap.counting).toBe(false);
    expect(snap).toMatchObject({ lockState: 'lost', lockReason: 'ambiguous' });
  });

  it('two overlapping people at acquisition are two people, not one', () => {
    const lock = new SubjectLock();
    let out;
    for (let t = 0; t <= 1500; t += 50) out = lock.update({ timestampMs: t, poses: [p(0, 0.5), p(0, 0.505)] });
    expect(out).toMatchObject({ state: 'searching', reason: 'twoPeople' });
  });
});

describe('fail-closed 2: an unobserved frame mid-rep voids the rep', () => {
  it('poses=[] while down, then standing, counts nothing', () => {
    const s = ready();
    for (let t = 1050; t <= 1300; t += 50) f(s, t, [p(0.8)]);
    expect(s.snapshot.phase).toBe('down');
    const miss = f(s, 1350, []);
    expect(miss.counting).toBe(false);
    expect(miss.phase).toBe('unknown');
    for (let t = 1400; t <= 1550; t += 50) f(s, t, [p(0)]);
    expect(s.snapshot.reps).toBe(0);
    // Re-armed by standing: the next fully observed rep counts.
    for (let t = 1600; t <= 1900; t += 50) f(s, t, [p(0.8)]);
    for (let t = 1950; t <= 2200; t += 50) f(s, t, [p(0)]);
    expect(s.snapshot.reps).toBe(1);
  });

  it('a pose without a measurable leg mid-rep also voids it', () => {
    const s = ready();
    for (let t = 1050; t <= 1300; t += 50) f(s, t, [p(0.8)]);
    f(s, 1350, [syntheticPose({ cx: 0.5, footY: 0.92, height: 0.7, depth: 0.8, hide: ['leftAnkle', 'rightAnkle'] })]);
    for (let t = 1400; t <= 1550; t += 50) f(s, t, [p(0)]);
    expect(s.snapshot.reps).toBe(0);
  });
});

describe('fail-closed 3: frames must be fresh and in order', () => {
  it('a long gap between down and standing cannot complete a rep', () => {
    const s = ready();
    for (let t = 1050; t <= 1300; t += 50) f(s, t, [p(0.8)]);
    const after = f(s, 10000, [p(0)]);
    expect(after.counting).toBe(false);
    f(s, 10150, [p(0)]);
    expect(s.snapshot.reps).toBe(0);
  });

  it('a gap just over the bound breaks the cycle; one just under does not', () => {
    const over = ready();
    for (let t = 1050; t <= 1300; t += 50) f(over, t, [p(0.8)]);
    for (let t = 1300 + 260, i = 0; i < 6; t += 50, i += 1) f(over, t, [p(0)]);
    expect(over.snapshot.reps).toBe(0);

    const under = ready();
    for (let t = 1050; t <= 1300; t += 50) f(under, t, [p(0.8)]);
    for (let t = 1300 + 240, i = 0; i < 6; t += 50, i += 1) f(under, t, [p(0)]);
    expect(under.snapshot.reps).toBe(1);
  });

  it('an out-of-order or repeated timestamp is rejected and voids the rep in progress', () => {
    const s = ready();
    for (let t = 1050; t <= 1300; t += 50) f(s, t, [p(0.8)]);
    const stale = f(s, 1200, [p(0)]);
    expect(stale.counting).toBe(false);
    expect(stale.phase).toBe('unknown');
    const dup = f(s, 1300, [p(0)]);
    expect(dup.counting).toBe(false);
    for (let t = 1350; t <= 1600; t += 50) f(s, t, [p(0)]);
    expect(s.snapshot.reps).toBe(0);
  });

  it('SubjectLock itself ignores a non-increasing timestamp', () => {
    const lock = new SubjectLock();
    for (let t = 0; t <= 1000; t += 50) lock.update({ timestampMs: t, poses: [p()] });
    const out = lock.update({ timestampMs: 900, poses: [p()] });
    expect(out.subject).toBeNull();
  });
});
