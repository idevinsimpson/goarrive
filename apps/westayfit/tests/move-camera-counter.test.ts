/**
 * MOVE-CAMERA-NATIVE-PORT-1 — the runtime-independent counting core.
 *
 * The lock, counter and session are ported from the accepted MOVEMENT-VISION-1
 * R&D core (PR #475, donor eda58218) as a TECHNICAL DONOR ONLY: PR #475 is not
 * merged. Its tests come with it, unchanged in substance, so the port is held
 * to exactly the behaviour that was reviewed.
 */
import { describe, expect, it, vi } from 'vitest';

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
import {
  ACQUIRING,
  ADJUST_MAX,
  CameraSquatSet,
  cameraCue,
  cameraEntryAllowed,
  clampReps,
  COUNTDOWN_MS,
  countingPose,
  DEFAULT_MOVE_CAMERA_SETTINGS,
  FULL_BODY_STABLE_MS,
  moveCameraSettingsOf,
  stepCountdown,
  type CountdownState,
} from '../src/movement-camera/flow';
import { KEYPOINTS, type CameraFrame, type VisualPose } from '../src/movement-camera/types';
import { figureGeometry } from '../src/movement-camera/figure';
import {
  CameraSourceError,
  enginePoseSourceFactory,
  syntheticPoseSourceFactory,
  testPoseHook,
  type TestPoseHook,
} from '../src/movement-camera/source';
import {
  __resetMoveCameraSettingsCache,
  MOVE_CAMERA_SETTINGS_KEY,
  readMoveCameraSettings,
  writeMoveCameraSettings,
} from '../src/movement-camera/settingsStore';
import { readFileSync } from 'node:fs';
import * as nodePath from 'node:path';

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

// ── MOVE-CAMERA-NATIVE-PORT-1: the camera flow rules ─────────────────────────


const flowMember = (depth: number) => syntheticPose({ cx: 0.5, footY: 0.92, height: 0.7, depth });
const flowVisual: VisualPose = {
  leftEar: { x: 0.53, y: 0.2, visibility: 0.9 },
  rightEar: { x: 0.47, y: 0.2, visibility: 0.9 },
  leftElbow: { x: 0.62, y: 0.45, visibility: 0.9 },
  rightElbow: { x: 0.38, y: 0.45, visibility: 0.9 },
  leftWrist: { x: 0.64, y: 0.55, visibility: 0.9 },
  rightWrist: { x: 0.36, y: 0.55, visibility: 0.9 },
};

/** Feed `set` 30 fps frames over [from, to) of a scene; returns the last view. */
function feed(set: CameraSquatSet, from: number, to: number, depthAt: (t: number) => number, visual = true) {
  let v = set.view();
  for (let t = from; t < to; t += 1000 / 30) {
    const ts = Math.round(t * 1000) / 1000;
    const f: CameraFrame = { timestampMs: ts, poses: [flowMember(depthAt(ts))], visuals: visual ? [flowVisual] : undefined };
    v = set.update(f);
  }
  return v;
}

describe('camera settings', () => {
  it('default ON/ON, and a missing or malformed save reads as ON', () => {
    expect(DEFAULT_MOVE_CAMERA_SETTINGS).toEqual({ cameraCounter: true, stickFigure: true });
    expect(moveCameraSettingsOf(undefined)).toEqual({ cameraCounter: true, stickFigure: true });
    expect(moveCameraSettingsOf({ cameraCounter: 'no', stickFigure: 0 })).toEqual({ cameraCounter: true, stickFigure: true });
  });
  it('each toggle is kept independently', () => {
    expect(moveCameraSettingsOf({ cameraCounter: false })).toEqual({ cameraCounter: false, stickFigure: true });
    expect(moveCameraSettingsOf({ stickFigure: false })).toEqual({ cameraCounter: true, stickFigure: false });
  });
});

describe('camera entry', () => {
  const base = { settings: DEFAULT_MOVE_CAMERA_SETTINGS, unit: 'squats', mode: 'start' as const, resumed: false, supported: true };
  it('opens for a fresh squat Start moving with the counter on', () => {
    expect(cameraEntryAllowed(base)).toBe(true);
    expect(cameraEntryAllowed({ ...base, unit: ' Squats ' })).toBe(true);
  });
  it('never for another movement, a near-name, the counter off, Already moved, a resumed attempt, or an unsupported runtime', () => {
    for (const unit of ['push-ups', 'squat', 'jump squats', 'steps', '', null]) {
      expect(cameraEntryAllowed({ ...base, unit })).toBe(false);
    }
    expect(cameraEntryAllowed({ ...base, settings: { cameraCounter: false, stickFigure: true } })).toBe(false);
    expect(cameraEntryAllowed({ ...base, mode: 'already' })).toBe(false);
    expect(cameraEntryAllowed({ ...base, resumed: true })).toBe(false);
    expect(cameraEntryAllowed({ ...base, supported: false })).toBe(false);
  });
  it('the stick figure setting alone never opens the camera', () => {
    expect(cameraEntryAllowed({ ...base, settings: { cameraCounter: false, stickFigure: true } })).toBe(false);
    expect(cameraEntryAllowed({ ...base, settings: { cameraCounter: true, stickFigure: false } })).toBe(true);
  });
});

describe('adjust bounds', () => {
  it('clamps to 0..500 and rounds', () => {
    expect(ADJUST_MAX).toBe(500);
    expect(clampReps(-3)).toBe(0);
    expect(clampReps(600)).toBe(500);
    expect(clampReps(7.6)).toBe(8);
    expect(clampReps(Number.NaN)).toBe(0);
    expect(clampReps(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('the automatic 3-2-1', () => {
  it('shows 3, 2, 1 and fires GO at 3000 ms', () => {
    let s: CountdownState = ACQUIRING;
    let r = stepCountdown(s, true, 1000);
    expect(r.display).toBe(3);
    s = r.state;
    expect(stepCountdown(s, true, 1000 + 900).display).toBe(3);
    expect(stepCountdown(s, true, 1000 + 1100).display).toBe(2);
    expect(stepCountdown(s, true, 1000 + 2100).display).toBe(1);
    r = stepCountdown(s, true, 1000 + COUNTDOWN_MS);
    expect(r.go).toBe(true);
    expect(r.state.phase).toBe('counting');
  });
  it('losing readiness mid-countdown returns to acquisition, and the next countdown starts over from 3', () => {
    const s = stepCountdown(ACQUIRING, true, 0).state;
    const lost = stepCountdown(s, false, 2500);
    expect(lost.state).toEqual(ACQUIRING);
    expect(lost.go).toBe(false);
    const again = stepCountdown(lost.state, true, 2600);
    expect(again.display).toBe(3);
    expect(stepCountdown(again.state, true, 2600 + 2999).go).toBe(false);
  });
  it('never fires GO without readiness', () => {
    expect(stepCountdown(ACQUIRING, false, 99999).go).toBe(false);
  });
});

describe('the camera set: readiness, GO baseline, banking, finish', () => {
  it('is ready only after FULL_BODY_STABLE_MS locked with the whole body in view', () => {
    const set = new CameraSquatSet();
    let v = feed(set, 0, 200, () => 0);
    expect(v.ready).toBe(false);
    v = feed(set, 200, 3000, () => 0);
    expect(v.locked).toBe(true);
    expect(v.ready).toBe(true);
    expect(FULL_BODY_STABLE_MS).toBe(600);
  });

  it('GO is refused before ready', () => {
    const set = new CameraSquatSet();
    feed(set, 0, 100, () => 0);
    expect(set.beginSet()).toBe(false);
    expect(set.view().phase).toBe('acquiring');
  });

  it('squats before GO never reach the set: 2 before, 3 after → 3', () => {
    const set = new CameraSquatSet();
    feed(set, 0, 1500, () => 0);
    feed(set, 1500, 6000, (t) => repeatedSquats(t, 1500, 2, 1600, 0.95, 400));
    feed(set, 6000, 7000, () => 0);
    expect(set.view().setReps).toBe(0);
    expect(set.beginSet()).toBe(true);
    expect(set.view().setReps).toBe(0);
    feed(set, 7000, 13000, (t) => repeatedSquats(t, 7000, 3, 1600, 0.95, 400));
    const v = feed(set, 13000, 13500, () => 0);
    expect(v.phase).toBe('counting');
    expect(v.setReps).toBe(3);
    expect(set.finish()).toEqual({ estimatedReps: 3, source: 'camera-estimate', verified: false });
  });

  it('a pause banks the set, and after a fresh GO it resumes from the banked count', () => {
    const set = new CameraSquatSet();
    feed(set, 0, 1500, () => 0);
    expect(set.beginSet()).toBe(true);
    feed(set, 1500, 5500, (t) => repeatedSquats(t, 1500, 2, 1600, 0.95, 400));
    feed(set, 5500, 6000, () => 0);
    expect(set.view().setReps).toBe(2);
    set.pause();
    expect(set.view()).toMatchObject({ phase: 'acquiring', setReps: 2, ready: false });
    // Back in view: not ready until locked and stable again, and GO adds to the bank.
    feed(set, 20000, 21500, () => 0);
    expect(set.beginSet()).toBe(true);
    feed(set, 21500, 23500, (t) => repeatedSquats(t, 21500, 1, 1600, 0.95, 400));
    feed(set, 23500, 24000, () => 0);
    expect(set.view().setReps).toBe(3);
  });

  it('Finish freezes: later frames change nothing', () => {
    const set = new CameraSquatSet();
    feed(set, 0, 1500, () => 0);
    set.beginSet();
    feed(set, 1500, 3500, (t) => repeatedSquats(t, 1500, 1, 1600, 0.95, 400));
    feed(set, 3500, 4000, () => 0);
    const est = set.finish();
    expect(est.estimatedReps).toBe(1);
    const v = feed(set, 4000, 9000, (t) => repeatedSquats(t, 4000, 2, 1600, 0.95, 400));
    expect(v).toMatchObject({ phase: 'finished', setReps: 1 });
  });

  it('a brief loss while counting keeps the count on screen; nothing is invented', () => {
    const set = new CameraSquatSet();
    feed(set, 0, 1500, () => 0);
    set.beginSet();
    feed(set, 1500, 3500, (t) => repeatedSquats(t, 1500, 1, 1600, 0.95, 400));
    feed(set, 3500, 4000, () => 0);
    // Out of frame for 2 s.
    let v = set.view();
    for (let t = 4000; t < 6000; t += 1000 / 30) v = set.update({ timestampMs: Math.round(t), poses: [] });
    expect(v.locked).toBe(false);
    expect(v.setReps).toBe(1);
    expect(cameraCue({ status: 'live', countingNow: true, countdown: null, locked: v.locked, fullBody: v.fullBody })).toBe('Step back into view');
  });
});

describe('visual-only points never count', () => {
  it('countingPose keeps exactly the nine counting keypoints', () => {
    const p = { ...flowMember(0), ...flowVisual, leftEye: { x: 0, y: 0, visibility: 1 } } as never;
    expect(Object.keys(countingPose(p)).sort()).toEqual([...KEYPOINTS].sort());
  });

  it('the session only ever receives the nine counting keypoints', () => {
    const spy = vi.spyOn(MovementSession.prototype, 'update');
    try {
      const set = new CameraSquatSet();
      feed(set, 0, 500, () => 0);
      expect(spy).toHaveBeenCalled();
      for (const [frame] of spy.mock.calls) {
        expect(Object.keys(frame).sort()).toEqual(['aspect', 'poses', 'timestampMs']);
        for (const pose of frame.poses) {
          for (const k of Object.keys(pose)) expect(KEYPOINTS as readonly string[]).toContain(k);
        }
      }
    } finally {
      spy.mockRestore();
    }
  });

  it('the same motion counts the same with or without visual points, and wild visuals change nothing', () => {
    const run = (visual: boolean, wild = false) => {
      const set = new CameraSquatSet();
      const vis: VisualPose = wild
        ? { leftWrist: { x: 0.5, y: 0.99, visibility: 1 }, leftEar: { x: 0.1, y: 0.95, visibility: 1 } }
        : flowVisual;
      const step = (from: number, to: number, d: (t: number) => number) => {
        for (let t = from; t < to; t += 1000 / 30) {
          const ts = Math.round(t * 1000) / 1000;
          set.update({ timestampMs: ts, poses: [flowMember(d(ts))], visuals: visual ? [vis] : undefined });
        }
      };
      step(0, 1500, () => 0);
      set.beginSet();
      step(1500, 8000, (t) => repeatedSquats(t, 1500, 3, 1600, 0.95, 400));
      return set.view().setReps;
    };
    expect(run(true)).toBe(3);
    expect(run(false)).toBe(3);
    expect(run(true, true)).toBe(3);
  });

  it('the body guide gets the locked subject and its visuals, and nothing when not locked', () => {
    const set = new CameraSquatSet();
    let v = set.update({ timestampMs: 0, poses: [flowMember(0)], visuals: [flowVisual] });
    expect(v.subject).toBeNull();
    expect(v.subjectVisual).toBeNull();
    v = feed(set, 33, 1500, () => 0);
    expect(v.subject).not.toBeNull();
    expect(v.subjectVisual).toEqual(flowVisual);
  });
});

describe('camera cues are plain', () => {
  const base = { status: 'live' as const, countingNow: false, countdown: null, locked: true, fullBody: true };
  it('maps each state to one plain line', () => {
    expect(cameraCue({ ...base, status: 'starting' })).toBe('Starting camera…');
    expect(cameraCue({ ...base, locked: false })).toBe('Step back so I can see you');
    expect(cameraCue({ ...base, fullBody: false })).toBe('Step back so I can see you');
    expect(cameraCue(base)).toBe('Stand tall — getting ready');
    expect(cameraCue({ ...base, countdown: 2 })).toBe('Get ready');
    expect(cameraCue({ ...base, countingNow: true })).toBeNull();
  });
  it('never shows diagnostics or R&D language', () => {
    const all = [true, false].flatMap((locked) =>
      [true, false].flatMap((countingNow) =>
        (['starting', 'live', 'paused', 'failed'] as const).map((status) =>
          cameraCue({ status, countingNow, countdown: null, locked, fullBody: locked }),
        ),
      ),
    );
    for (const s of all) expect(s ?? '').not.toMatch(/confidence|lock|track|pose|landmark|%|debug|model/i);
  });
});

describe('the body guide geometry', () => {
  it('one figure: head ring, both arms and legs, torso sides and hips, no neck', () => {
    const g = figureGeometry(flowMember(0), flowVisual, 9 / 16);
    expect(g.width).toBe(563);
    expect(g.lines).toHaveLength(8);
    expect(g.lines.map((l) => l.length).sort()).toEqual([2, 2, 2, 2, 3, 3, 3, 3]);
    expect(g.head).not.toBeNull();
    // Centred between the ears, not on the nose.
    expect(g.head!.cx).toBeCloseTo(0.5 * 563, 5);
    expect(g.head!.r).toBeGreaterThanOrEqual(26);
    expect(g.head!.r).toBeLessThanOrEqual(150);
  });
  it('a missing joint lifts the pen; a one-point chain is not drawn; no ears falls back to the nose', () => {
    const p = flowMember(0);
    delete p.leftKnee;
    const g = figureGeometry(p, { rightElbow: flowVisual.rightElbow }, 1);
    // left leg splits into hip alone + ankle alone → dropped; left arm has no elbow/wrist → shoulder alone, dropped.
    expect(g.lines).toHaveLength(6);
    expect(g.head!.cx).toBeCloseTo(p.nose!.x * 1000, 5);
  });
});

describe('the pose source is fail-closed', () => {
  const hook: TestPoseHook = { scene: () => ({ poses: [] }) };
  const win = (hostname: string) => ({ location: { hostname }, __WSF_TEST_POSE__: hook });
  it('ships no on-device engine yet: the counter is unsupported outside the test gate', () => {
    expect(enginePoseSourceFactory).toBeNull();
  });
  it('the synthetic source is read only on an emulator build served from loopback', () => {
    expect(testPoseHook('1', win('127.0.0.1'))).toBe(hook);
    expect(testPoseHook('true', win('localhost'))).toBe(hook);
    expect(testPoseHook(undefined, win('127.0.0.1'))).toBeNull();
    expect(testPoseHook('0', win('127.0.0.1'))).toBeNull();
    expect(testPoseHook('1', win('westayfit-app.web.app'))).toBeNull();
    expect(testPoseHook('1', { location: { hostname: '127.0.0.1' }, __WSF_TEST_POSE__: { scene: 'x' } })).toBeNull();
  });
  it('the synthetic source keeps `active` truthful and raises its scripted failure', async () => {
    const h: TestPoseHook = { scene: () => ({ poses: [] }) };
    const src = await syntheticPoseSourceFactory(h)();
    expect(h.active).toBe(true);
    expect(src.stream).toBeNull();
    src.stop();
    expect(h.active).toBe(false);
    expect(src.estimate(null, 10)).toBeNull();
    await expect(syntheticPoseSourceFactory({ ...h, fail: 'permission' })()).rejects.toBeInstanceOf(CameraSourceError);
  });
});

describe('MOVE camera settings storage', () => {
  it('reads defaults with no storage, and a stored choice survives a fresh read', () => {
    const mem = new Map<string, string>();
    const ls = {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
    };
    vi.stubGlobal('window', { localStorage: ls });
    try {
      __resetMoveCameraSettingsCache();
      expect(readMoveCameraSettings()).toEqual({ cameraCounter: true, stickFigure: true });
      writeMoveCameraSettings({ stickFigure: false });
      __resetMoveCameraSettingsCache();
      expect(readMoveCameraSettings()).toEqual({ cameraCounter: true, stickFigure: false });
      mem.set(MOVE_CAMERA_SETTINGS_KEY, '{not json');
      __resetMoveCameraSettingsCache();
      expect(readMoveCameraSettings()).toEqual({ cameraCounter: true, stickFigure: true });
    } finally {
      vi.unstubAllGlobals();
      __resetMoveCameraSettingsCache();
    }
  });
});

describe('privacy: nothing leaves the device', () => {
  const src = (p: string) => readFileSync(nodePath.resolve(__dirname, '..', p), 'utf8');
  const files = [
    'src/ui/CameraRepCounter.tsx',
    'src/ui/CameraSkeletonOverlay.tsx',
    'src/movement-camera/source.ts',
    'src/movement-camera/flow.ts',
    'src/movement-camera/settingsStore.ts',
  ];
  it('no recording, canvas capture, upload, network or Firestore in the camera path', () => {
    for (const f of files) {
      const code = src(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code, f).not.toMatch(/MediaRecorder|captureStream|toDataURL|toBlob|getImageData|fetch\(|XMLHttpRequest|sendBeacon|httpsCallable|firebase|firestore|odml\.pa\.googleapis/i);
    }
  });
  it('the camera screen releases on every way out', () => {
    const code = src('src/ui/CameraRepCounter.tsx');
    expect(code).toMatch(/getTracks\(\)\.forEach\(\(t\) => t\.stop\(\)\)/);
    expect(code).toMatch(/srcObject = null/);
    expect(code).toMatch(/visibilitychange/);
    expect(code).toMatch(/pagehide/);
  });
  it('the contribute screen opens the camera only before any write, never on a kiosk or over a round attempt', () => {
    const code = src('app/contribute/[goalId].tsx');
    const block = code.slice(code.indexOf('const cameraOpen ='), code.indexOf('if (cameraOpen && cameraFactory)'));
    for (const need of ["step === 'move'", '!cameraDeclined', '!kiosk', 'beforeWrite', '!legacyOrphan', "state.kind === 'ready'", 'roundAttemptRef.current != null', 'cameraFactory != null']) {
      expect(block, need).toContain(need);
    }
    // The pending/sending branches return before the camera can.
    expect(code.indexOf('if (pending) {')).toBeLessThan(code.indexOf('const cameraOpen ='));
  });
});
