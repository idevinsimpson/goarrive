import { describe, expect, it } from 'vitest';

import { MovementSession } from '../src/movement/session';
import { SubjectLock } from '../src/movement/subjectLock';
import { syntheticPose } from '../src/movement/synthetic';

/**
 * W7 — CHECK 31: independent fail-closed instrument for W10's MOVEMENT-VISION-1
 * successor `eda58218` (delta from rejected `8642e330`; Director #434 `5827103237`).
 *
 * INERT here (docs/westayfit/qa). It is copied to `apps/westayfit/tests/` of a
 * detached worktree to run, on both heads, so every proof is shown able to fail.
 * Inputs are SYNTHETIC landmarks; nothing here says anything about a real body
 * or a real camera.
 *
 * Cases W10's own regressions do not use:
 *   L1  while locked, an overlapping second pose that is only PARTLY visible
 *       (ankles hidden, so not full-body) still makes the frame ambiguous;
 *   L2  three overlapping poses at acquisition never become one subject;
 *   L3  an exact duplicate (the same landmarks twice) is read as a crowd, never
 *       as one trusted person — the conservative side of the trade-off;
 *   L4  after an ambiguity, the member is only re-trusted once alone again, and
 *       a rep spanning the ambiguity is void;
 *   M1  partway down (between upDepth and downDepth), then an unobserved frame,
 *       then a full descent and standing: that cycle is void (re-arm required);
 *   M2  standing at rest, an unobserved frame, then a full rep: counts (only
 *       rest survives an unobserved frame);
 *   M3  a mid-rep frame whose timestamp is NaN is treated as out of order;
 *   T1  a gap of exactly 250 ms is within the documented bound (counts); 251 is
 *       over it (void);
 *   T2  a backward timestamp followed by fresh in-order frames: the rep in
 *       progress stays void, and the next fully observed rep counts;
 *   T3  a gap while STANDING at rest is suspended too: the member must be
 *       re-acquired before anything counts, and nothing is invented.
 */
const p = (depth = 0, cx = 0.5, hide: Parameters<typeof syntheticPose>[0]['hide'] = undefined) =>
  syntheticPose({ cx, footY: 0.92, height: 0.7, depth, hide });
const f = (s: MovementSession, t: number, poses: ReturnType<typeof p>[]) => s.update({ timestampMs: t, poses });
const ready = () => {
  const s = new MovementSession();
  for (let t = 0; t <= 1000; t += 50) f(s, t, [p()]);
  expect(s.snapshot.lockState).toBe('locked');
  return s;
};
/** A full observed rep starting at t0 (down 300 ms, then standing 300 ms), 50 ms steps. Returns the next t. */
const rep = (s: MovementSession, t0: number) => {
  let t = t0;
  for (let i = 0; i < 7; i += 1, t += 50) f(s, t, [p(0.8)]);
  for (let i = 0; i < 7; i += 1, t += 50) f(s, t, [p(0)]);
  return t;
};

describe('W7 · L — overlapping distinct poses', () => {
  it('L1 while locked, a partly visible overlapping pose makes the frame ambiguous', () => {
    const s = ready();
    const snap = f(s, 1050, [p(0, 0.5), p(0, 0.51, ['leftAnkle', 'rightAnkle'])]);
    expect(snap.counting).toBe(false);
    expect(snap.lockState).not.toBe('locked');
    expect(snap.subject).toBeNull();
  });

  it('L2 three overlapping poses at acquisition never become one subject', () => {
    const lock = new SubjectLock();
    let out;
    for (let t = 0; t <= 2000; t += 50) out = lock.update({ timestampMs: t, poses: [p(0, 0.49), p(0, 0.5), p(0, 0.51)] });
    expect(out!.state).not.toBe('locked');
    expect(out!.subject).toBeNull();
  });

  it('L3 an exact duplicate detection is read as a crowd, never one trusted person', () => {
    const s = ready();
    const snap = f(s, 1050, [p(0, 0.5), p(0, 0.5)]);
    expect(snap.counting).toBe(false);
    expect(snap.subject).toBeNull();
    const lock = new SubjectLock();
    let out;
    for (let t = 0; t <= 2000; t += 50) out = lock.update({ timestampMs: t, poses: [p(0, 0.5), p(0, 0.5)] });
    expect(out!.state).not.toBe('locked');
  });

  it('L4 a rep spanning an ambiguity is void; re-trusted only once alone again', () => {
    const s = ready();
    for (let t = 1050; t <= 1300; t += 50) f(s, t, [p(0.8)]);
    f(s, 1350, [p(0.8, 0.5), p(0.8, 0.505)]);
    let t = 1400;
    for (let i = 0; i < 30; i += 1, t += 50) f(s, t, [p(0)]);
    expect(s.snapshot.reps).toBe(0);
    expect(s.snapshot.lockState).toBe('locked');
    rep(s, t);
    expect(s.snapshot.reps).toBe(1);
  });
});

describe('W7 · M — unobserved samples mid-cycle', () => {
  it('M1 partway down, unobserved, then a full descent and standing: that cycle is void', () => {
    const s = ready();
    for (let t = 1050; t <= 1300; t += 50) f(s, t, [p(0.4)]);
    f(s, 1350, []);
    let t = 1400;
    for (let i = 0; i < 7; i += 1, t += 50) f(s, t, [p(0.8)]);
    for (let i = 0; i < 7; i += 1, t += 50) f(s, t, [p(0)]);
    expect(s.snapshot.reps).toBe(0);
    rep(s, t);
    expect(s.snapshot.reps).toBe(1);
  });

  it('M2 standing at rest survives an unobserved frame; the next full rep counts', () => {
    const s = ready();
    f(s, 1050, []);
    rep(s, 1100);
    expect(s.snapshot.reps).toBe(1);
  });

  it('M3 a NaN timestamp mid-rep is rejected and voids the rep', () => {
    const s = ready();
    for (let t = 1050; t <= 1300; t += 50) f(s, t, [p(0.8)]);
    const bad = f(s, Number.NaN, [p(0.8)]);
    expect(bad.frameIssue).toBe('outOfOrder');
    for (let t = 1350; t <= 1650; t += 50) f(s, t, [p(0)]);
    expect(s.snapshot.reps).toBe(0);
  });
});

describe('W7 · T — freshness', () => {
  it('T1 a 250 ms gap is inside the bound (counts); 251 ms is over it (void)', () => {
    const at = ready();
    for (let t = 1050; t <= 1300; t += 50) f(at, t, [p(0.8)]);
    for (let t = 1550, i = 0; i < 7; t += 50, i += 1) f(at, t, [p(0)]);
    expect(at.snapshot.reps).toBe(1);

    const over = ready();
    for (let t = 1050; t <= 1300; t += 50) f(over, t, [p(0.8)]);
    for (let t = 1551, i = 0; i < 7; t += 50, i += 1) f(over, t, [p(0)]);
    expect(over.snapshot.reps).toBe(0);
  });

  it('T2 a backward timestamp voids the rep; later in-order frames re-arm and the next rep counts', () => {
    const s = ready();
    for (let t = 1050; t <= 1300; t += 50) f(s, t, [p(0.8)]);
    f(s, 100, [p(0)]);
    let t = 1350;
    for (let i = 0; i < 7; i += 1, t += 50) f(s, t, [p(0)]);
    expect(s.snapshot.reps).toBe(0);
    rep(s, t);
    expect(s.snapshot.reps).toBe(1);
  });

  it('T3 a gap while standing suspends the lock; nothing is invented while re-acquiring', () => {
    const s = ready();
    const snap = f(s, 5000, [p(0)]);
    expect(snap.frameIssue).toBe('gap');
    expect(snap.lockState).not.toBe('locked');
    expect(snap.counting).toBe(false);
    let t = 5050;
    for (let i = 0; i < 40 && s.snapshot.lockState !== 'locked'; i += 1, t += 50) f(s, t, [p(0)]);
    expect(s.snapshot.lockState).toBe('locked');
    expect(s.snapshot.reps).toBe(0);
    // Re-armed only by being SEEN standing after the interruption (by design).
    for (let i = 0; i < 7; i += 1, t += 50) f(s, t, [p(0)]);
    expect(s.snapshot.reps).toBe(0);
    rep(s, t);
    expect(s.snapshot.reps).toBe(1);
  });
});
