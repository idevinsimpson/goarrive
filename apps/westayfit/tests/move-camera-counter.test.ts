/**
 * MOVE-CAMERA-NATIVE-PORT-1 — the runtime-independent counting core.
 *
 * The lock, counter and session are ported from the accepted MOVEMENT-VISION-1
 * R&D core (PR #475, donor eda58218) as a TECHNICAL DONOR ONLY: PR #475 is not
 * merged. Its tests come with it, unchanged in substance, so the port is held
 * to exactly the behaviour that was reviewed.
 */
import { describe, expect, it } from 'vitest';

import { depthFromRatio, squatRatio } from '../src/movement-camera/geometry';
import { MovementSession, type SessionSnapshot } from '../src/movement-camera/session';
import { SquatCounter, type SquatOutput } from '../src/movement-camera/squatCounter';
import { SubjectLock } from '../src/movement-camera/subjectLock';
import {
  syntheticPose,
  renderFrames,
  squatDepth,
  repeatedSquats,
  type SyntheticPerson,
} from '../src/movement-camera/synthetic';
import type { Pose } from '../src/movement-camera/types';

// ─── ported from PR #475 tests/movement-squat-counter.test.ts (donor eda58218) ───
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
    // Never reaches down; and since #475 review case 2, the null during the
    // partial descent also voids it (phase unknown until standing is re-seen).
    expect(c.currentPhase).not.toBe('down');
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

// ─── ported from PR #475 tests/movement-subject-lock.test.ts (donor eda58218) ───
const MEMBER: SyntheticPerson = { cx: 0.5, footY: 0.92, height: 0.7, depth: 0 };

function play(session: MovementSession, fromMs: number, toMs: number, scene: (t: number) => Pose[]) {
  return renderFrames(fromMs, toMs, scene).map((f) => session.update(f));
}

const repsIn = (snaps: SessionSnapshot[]) => snaps.filter((s) => s.event === 'rep').length;

/** A session already locked on MEMBER, and the time at which it locked. */
function lockedSession(): { s: MovementSession; t: number } {
  const s = new MovementSession();
  const snaps = play(s, 0, 1500, () => [syntheticPose(MEMBER)]);
  expect(snaps.at(-1)!.lockState).toBe('locked');
  return { s, t: 1500 };
}

describe('geometry — the squat signal', () => {
  it('reads ~2 standing, ~1 at parallel, and maps to depth 0 → 1', () => {
    const stand = squatRatio(syntheticPose(MEMBER))!;
    const parallel = squatRatio(syntheticPose({ ...MEMBER, depth: 1 }))!;
    expect(stand).toBeCloseTo(2, 5);
    expect(parallel).toBeCloseTo(1, 5);
    expect(depthFromRatio(stand, 2)).toBeCloseTo(0, 5);
    expect(depthFromRatio(parallel, 2)).toBeCloseTo(1, 5);
  });

  it('is independent of distance to the camera', () => {
    const near = squatRatio(syntheticPose({ ...MEMBER, height: 0.9, depth: 0.5 }))!;
    const far = squatRatio(syntheticPose({ ...MEMBER, height: 0.35, depth: 0.5 }))!;
    expect(near).toBeCloseTo(far, 5);
  });

  it('is null when no leg is fully visible', () => {
    expect(
      squatRatio(syntheticPose({ ...MEMBER, hide: ['leftAnkle', 'rightAnkle'] })),
    ).toBeNull();
  });
});

describe('SubjectLock — acquisition', () => {
  it('locks one standing, full-body, centred person after holding still', () => {
    const lock = new SubjectLock();
    const outs = renderFrames(0, 1000, () => [syntheticPose(MEMBER)]).map((f) => lock.update(f));
    expect(outs[0].state).toBe('acquiring');
    const lockedAt = outs.findIndex((o) => o.state === 'locked');
    expect(lockedAt).toBeGreaterThan(15); // ≥ 600 ms at 30 fps
    expect(outs.at(-1)!.state).toBe('locked');
  });

  it('does not lock with nobody in frame', () => {
    const lock = new SubjectLock();
    const outs = renderFrames(0, 2000, () => []).map((f) => lock.update(f));
    expect(outs.at(-1)).toMatchObject({ state: 'searching', reason: 'noOne' });
  });

  it('does not lock when two people qualify — it refuses to choose', () => {
    const lock = new SubjectLock();
    const outs = renderFrames(0, 3000, () => [
      syntheticPose({ ...MEMBER, cx: 0.35 }),
      syntheticPose({ ...MEMBER, cx: 0.65 }),
    ]).map((f) => lock.update(f));
    expect(outs.every((o) => o.state === 'searching')).toBe(true);
    expect(outs.at(-1)!.reason).toBe('twoPeople');
  });

  it('locks the centred member, not a small background person off to the side', () => {
    const s = new MovementSession();
    play(s, 0, 1500, () => [
      syntheticPose({ cx: 0.9, footY: 0.6, height: 0.25, depth: 0 }),
      syntheticPose(MEMBER),
    ]);
    expect(s.snapshot.lockState).toBe('locked');
    expect(s.snapshot.subjectBox!.cx).toBeCloseTo(0.5, 1);
  });

  it('does not lock someone whose legs are out of frame', () => {
    const lock = new SubjectLock();
    const outs = renderFrames(0, 2000, () => [
      syntheticPose({ ...MEMBER, hide: ['leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'] }),
    ]).map((f) => lock.update(f));
    expect(outs.at(-1)).toMatchObject({ state: 'searching', reason: 'notFullBody' });
  });

  it('does not lock someone who is already squatting (standing baseline required)', () => {
    const lock = new SubjectLock();
    const outs = renderFrames(0, 2000, () => [syntheticPose({ ...MEMBER, depth: 0.9 })]).map((f) =>
      lock.update(f),
    );
    expect(outs.at(-1)).toMatchObject({ state: 'searching', reason: 'notStanding' });
  });

  it('does not lock someone walking across the zone (never holds still)', () => {
    const lock = new SubjectLock();
    const outs = renderFrames(0, 2500, (t) => [syntheticPose({ ...MEMBER, cx: 0.2 + (t / 2500) * 0.6 })]).map(
      (f) => lock.update(f),
    );
    expect(outs.some((o) => o.state === 'locked')).toBe(false);
  });
});

describe('MovementSession — counting only the locked member', () => {
  it('counts the member’s full reps and ignores their half rep', () => {
    const { s, t } = lockedSession();
    const snaps = play(s, t, t + 9000, (ms) => {
      const d = repeatedSquats(ms, t + 200, 3, 1600, 1, 300) + squatDepth(ms, t + 6500, 1600, 0.4);
      return [syntheticPose({ ...MEMBER, depth: d })];
    });
    expect(s.snapshot.reps).toBe(3);
    expect(repsIn(snaps)).toBe(3);
    expect(snaps.some((x) => x.event === 'partial')).toBe(true);
  });

  it('a one-frame dropout mid-rep keeps the lock but voids that rep (unobserved = not countable)', () => {
    // Changed on the Director's review (#475 5825938854 case 2): this test
    // used to require the rep to SURVIVE a dropout. A cycle the counter did
    // not fully observe is now void; the next fully observed rep counts.
    const { s, t } = lockedSession();
    play(s, t, t + 5000, (ms) => {
      if (Math.abs(ms - (t + 1000)) < 20) return []; // one frame with nobody, at the bottom
      return [syntheticPose({ ...MEMBER, depth: squatDepth(ms, t + 200, 1600, 1) + squatDepth(ms, t + 2600, 1600, 1) })];
    });
    expect(s.snapshot.lockState).toBe('locked');
    expect(s.snapshot.reps).toBe(1); // the second rep only
  });

  it('lost tracking at the bottom voids that rep, then re-acquires and counts the next', () => {
    const { s, t } = lockedSession();
    const snaps = play(s, t, t + 7000, (ms) => {
      const r = ms - t;
      if (r < 1000) return [syntheticPose({ ...MEMBER, depth: squatDepth(ms, t, 2000, 1) })]; // going down
      if (r < 2000) return []; // gone for a second while down
      if (r < 3500) return [syntheticPose(MEMBER)]; // back, standing
      return [syntheticPose({ ...MEMBER, depth: squatDepth(ms, t + 3800, 1600, 1) })];
    });
    const states = new Set(snaps.map((x) => x.lockState));
    expect(states.has('lost')).toBe(true);
    expect(snaps.find((x) => x.lockState === 'lost')!.lockReason).toBe('missing');
    expect(s.snapshot.lockState).toBe('locked');
    expect(s.snapshot.reps).toBe(1); // the voided rep is not counted; the next one is
  });

  it('while lost, nothing is counted even if the member squats', () => {
    const { s, t } = lockedSession();
    // Member vanishes long enough to be lost, and a detection far away squats.
    const snaps = play(s, t, t + 3000, (ms) => [
      syntheticPose({ cx: 0.12, footY: 0.92, height: 0.7, depth: squatDepth(ms, t + 500, 1200, 1) }),
    ]);
    expect(snaps.some((x) => x.lockState === 'lost')).toBe(true);
    expect(s.snapshot.reps).toBe(0);
  });

  it('forgets after a long absence and must acquire from scratch', () => {
    const { s, t } = lockedSession();
    play(s, t, t + 5000, () => []);
    expect(s.snapshot.lockState).toBe('searching');
  });

  it('a second person exercising at the edge of frame adds nothing', () => {
    const { s, t } = lockedSession();
    play(s, t, t + 8000, (ms) => [
      syntheticPose(MEMBER), // member stands still
      syntheticPose({ cx: 0.1, footY: 0.9, height: 0.65, depth: repeatedSquats(ms, t, 5, 1200, 1, 200) }),
    ]);
    expect(s.snapshot.lockState).toBe('locked');
    expect(s.snapshot.reps).toBe(0);
  });

  it('with a second person exercising, only the member’s reps count', () => {
    const { s, t } = lockedSession();
    play(s, t, t + 8000, (ms) => [
      syntheticPose({ ...MEMBER, depth: repeatedSquats(ms, t + 200, 2, 1600, 1, 400) }),
      syntheticPose({ cx: 0.1, footY: 0.9, height: 0.65, depth: repeatedSquats(ms, t, 5, 1200, 1, 200) }),
    ]);
    expect(s.snapshot.reps).toBe(2);
  });

  it('a person walking BEHIND the member pauses counting and never adds a rep', () => {
    const { s, t } = lockedSession();
    const snaps = play(s, t, t + 6000, (ms) => {
      const r = ms - t;
      const poses = [syntheticPose({ ...MEMBER, depth: squatDepth(ms, t + 1200, 1400, 1) })];
      if (r < 3000) {
        poses.push(syntheticPose({ cx: 0.1 + (r / 3000) * 0.8, footY: 0.8, height: 0.55, depth: 0 }));
      }
      return poses;
    });
    const during = snaps.filter((x) => x.lockState === 'lost');
    expect(during.length).toBeGreaterThan(0);
    expect(during.every((x) => x.lockReason === 'ambiguous' || x.lockReason === 'missing')).toBe(true);
    expect(during.every((x) => !x.counting)).toBe(true);
    // The rep that happened while the walker overlapped the member is not
    // counted (not guessed); after they pass, the member is re-acquired.
    expect(s.snapshot.lockState).toBe('locked');
    expect(s.snapshot.reps).toBe(0);
  });

  it('a person walking briefly IN FRONT never steals the lock', () => {
    const { s, t } = lockedSession();
    const snaps = play(s, t, t + 6000, (ms) => {
      const r = ms - t;
      const walker = r > 500 && r < 2500 ? 0.1 + ((r - 500) / 2000) * 0.8 : null;
      // Closer to the camera: bigger, and while overlapping they hide the member.
      const hidden = walker !== null && Math.abs(walker - 0.5) < 0.12;
      const poses: Pose[] = [];
      if (!hidden) poses.push(syntheticPose(MEMBER));
      if (walker !== null) poses.push(syntheticPose({ cx: walker, footY: 0.98, height: 0.8, depth: 0 }));
      return poses;
    });
    // At no point is the walker's box the tracked box.
    for (const x of snaps) {
      if (x.lockState === 'locked') expect(x.subjectBox!.cx).toBeCloseTo(0.5, 1);
    }
    expect(s.snapshot.lockState).toBe('locked');
    expect(s.snapshot.reps).toBe(0);
  });

  it('a second person arriving next to the member and staying makes it ambiguous, not a guess', () => {
    const { s, t } = lockedSession();
    const snaps = play(s, t, t + 3000, (ms) => [
      syntheticPose({ ...MEMBER, depth: squatDepth(ms, t + 500, 1600, 1) }),
      syntheticPose({ ...MEMBER, cx: 0.62, depth: squatDepth(ms, t + 500, 1600, 1) }),
    ]);
    expect(snaps.at(-1)).toMatchObject({ lockState: 'lost', lockReason: 'ambiguous' });
    expect(s.snapshot.reps).toBe(0);
  });

  it('the member drifting slowly (phone nudged) stays locked and keeps counting', () => {
    const { s, t } = lockedSession();
    play(s, t, t + 7000, (ms) => [
      syntheticPose({
        ...MEMBER,
        cx: 0.5 + ((ms - t) / 7000) * 0.1,
        height: 0.7 * (1 - ((ms - t) / 7000) * 0.1),
        depth: repeatedSquats(ms, t + 200, 3, 1600, 1, 400),
      }),
    ]);
    expect(s.snapshot.lockState).toBe('locked');
    expect(s.snapshot.reps).toBe(3);
  });

  it('low-confidence landmarks count as not seen — the counter pauses', () => {
    const { s, t } = lockedSession();
    const snaps = play(s, t, t + 3000, (ms) => [
      syntheticPose({ ...MEMBER, visibility: 0.3, depth: squatDepth(ms, t + 300, 1600, 1) }),
    ]);
    expect(snaps.every((x) => !x.counting)).toBe(true);
    expect(s.snapshot.lockState).toBe('lost');
    expect(s.snapshot.reps).toBe(0);
  });
});

describe('MovementSession — manual fallback and reset', () => {
  it('manual mode counts taps, never goes below zero, and ignores camera frames', () => {
    const s = new MovementSession();
    s.useManual();
    s.tap(1);
    s.tap(1);
    s.tap(-1);
    s.tap(-1);
    s.tap(-1);
    expect(s.snapshot).toMatchObject({ mode: 'manual', reps: 0 });
    s.tap(1);
    play(s, 0, 5000, (ms) => [syntheticPose({ ...MEMBER, depth: repeatedSquats(ms, 1000, 2, 1600, 1) })]);
    expect(s.snapshot).toMatchObject({ mode: 'manual', reps: 1 });
  });

  it('switching to manual carries the camera count over', () => {
    const { s, t } = lockedSession();
    play(s, t, t + 3000, (ms) => [syntheticPose({ ...MEMBER, depth: squatDepth(ms, t + 200, 1600, 1) })]);
    expect(s.snapshot.reps).toBe(1);
    s.useManual();
    s.tap(1);
    expect(s.snapshot.reps).toBe(2);
  });

  it('reset() returns to camera mode, zero, searching', () => {
    const s = new MovementSession();
    s.useManual();
    s.tap(1);
    s.reset();
    expect(s.snapshot).toMatchObject({ mode: 'camera', reps: 0, lockState: 'searching' });
  });
});

// ─── ported from PR #475 tests/movement-fail-closed.test.ts (donor eda58218) ───
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
